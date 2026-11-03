import { and, desc, eq, gt, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { TrendingRules, TrendingScope, TrendingWindow } from '@chartermission/contracts';
import type { Db } from '../db/db.module.js';
import { chapters, hashtags, platformSettings, trendingOverrides, trendingSnapshots } from '../db/schema.js';
import { SETTING_DEFAULTS } from '../infra/settings.service.js';

/*
 * Trending hashtags (spec 4.5 / admin trending controls). Transparent and rule-based:
 *  - counts posts per hashtag from visible, published, non-deleted posts by active authors;
 *  - each author counts for at most `maxPostsPerAuthorPerHour` posts per hashtag per hour;
 *  - baseline = average count per equal-length window over the previous `baselineDays`;
 *  - velocityPct = round((count − baseline) / max(baseline, 1) × 100);
 *  - a tag is eligible only with at least `minDistinctAuthors` distinct authors; eligible tags rank by velocity;
 *  - admin overrides: "suppress" hides a tag, "pin" keeps it on top (global overrides apply in every scope).
 * Pure function of the database so the seed can run it without Nest.
 */

export type SnapshotEntry = (typeof trendingSnapshots.$inferSelect)['entries'][number];
export type Scope = { type: TrendingScope; id: string };

export const WINDOWS: Record<TrendingWindow, number> = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 };
export const SNAPSHOT_ENTRIES = 50;
export const SNAPSHOTS_KEPT = 20;

export async function loadTrendingRules(db: Db): Promise<TrendingRules> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'trending_rules')).limit(1);
  return { ...SETTING_DEFAULTS.trending_rules, ...(row?.value as Partial<TrendingRules> | undefined) };
}

/** Items shown to members: pinned first, then trending, in snapshot order. */
export function servedEntries(entries: SnapshotEntry[]): SnapshotEntry[] {
  return [...entries.filter((e) => e.status === 'pinned'), ...entries.filter((e) => e.status === 'trending')];
}

type ActiveOverride = { tag: string; display: string; action: string; scopeType: string; scopeId: string };

/** Active overrides with scope ids normalised (country codes upper-case; chapter slugs resolved to ids). */
async function activeOverrides(db: Db, now: Date): Promise<ActiveOverride[]> {
  const rows = await db
    .select({
      tag: hashtags.tag,
      display: hashtags.display,
      action: trendingOverrides.action,
      scopeType: trendingOverrides.scopeType,
      scopeId: trendingOverrides.scopeId,
    })
    .from(trendingOverrides)
    .innerJoin(hashtags, eq(hashtags.id, trendingOverrides.hashtagId))
    .where(and(isNull(trendingOverrides.revokedAt), or(isNull(trendingOverrides.expiresAt), gt(trendingOverrides.expiresAt, now))));
  const chapterRows = rows.some((r) => r.scopeType === 'chapter')
    ? await db.select({ id: chapters.id, slug: chapters.slug }).from(chapters)
    : [];
  return rows.map((r) => {
    if (r.scopeType === 'country') return { ...r, scopeId: r.scopeId.toUpperCase() };
    if (r.scopeType === 'chapter') {
      const match = chapterRows.find((c) => c.id === r.scopeId || c.slug === r.scopeId.toLowerCase());
      return { ...r, scopeId: match?.id ?? r.scopeId };
    }
    return r;
  });
}

/** Scopes: global, plus every country and chapter with posts in the last 7 days or an override. */
async function scopes(db: Db, now: Date, overrides: ActiveOverride[]): Promise<Scope[]> {
  const since = new Date(now.getTime() - WINDOWS['7d']);
  const rows = await db.execute<{ type: string; id: string }>(sql`
    select distinct 'country' as type, country_code as id from posts
      where country_code is not null and deleted_at is null and created_at > ${since}
    union
    select distinct 'chapter' as type, chapter_id::text as id from posts
      where chapter_id is not null and deleted_at is null and created_at > ${since}`);
  const list: Scope[] = [{ type: 'global', id: '' }];
  const seen = new Set<string>(['global:']);
  const add = (type: string, id: string) => {
    const key = `${type}:${id}`;
    if (seen.has(key) || (type !== 'country' && type !== 'chapter')) return;
    seen.add(key);
    list.push({ type, id });
  };
  for (const r of rows.rows) add(r.type, r.id);
  for (const o of overrides) if (o.scopeType !== 'global') add(o.scopeType, o.scopeId);
  return list;
}

type Counted = { tag: string; display: string; posts: number; authors: number; baselineTotal: number };

async function countScope(db: Db, rules: TrendingRules, scope: Scope, windowMs: number, now: Date): Promise<Counted[]> {
  const windowStart = new Date(now.getTime() - windowMs);
  const baselineStart = new Date(windowStart.getTime() - rules.baselineDays * 24 * 3600_000);
  const scopeCond =
    scope.type === 'country'
      ? sql`and p.country_code = ${scope.id}`
      : scope.type === 'chapter'
        ? sql`and p.chapter_id::text = ${scope.id}`
        : sql``;
  const result = await db.execute<{ tag: string; display: string; posts: string; authors: string; baseline_total: string }>(sql`
    with eligible as (
      select p.author_id, p.created_at, ph.hashtag_id, (p.created_at > ${windowStart}) as cur
      from posts p
      join post_hashtags ph on ph.post_id = p.id
      join users u on u.id = p.author_id
      where p.deleted_at is null
        and p.status = 'published'
        and p.moderation_state = 'visible'
        and u.status in ('active', 'unverified')
        and (u.suspended_until is null or u.suspended_until <= ${now})
        and p.created_at > ${baselineStart}
        and p.created_at <= ${now}
        ${scopeCond}
    ),
    capped as (
      select hashtag_id, author_id, cur, least(count(*), ${rules.maxPostsPerAuthorPerHour}::int) as n
      from eligible
      group by hashtag_id, author_id, date_trunc('hour', created_at), cur
    )
    select h.tag, h.display,
           coalesce(sum(c.n) filter (where c.cur), 0) as posts,
           count(distinct c.author_id) filter (where c.cur) as authors,
           coalesce(sum(c.n) filter (where not c.cur), 0) as baseline_total
    from capped c
    join hashtags h on h.id = c.hashtag_id
    group by h.tag, h.display
    having coalesce(sum(c.n) filter (where c.cur), 0) > 0`);
  return result.rows.map((r) => ({
    tag: r.tag,
    display: r.display,
    posts: Number(r.posts),
    authors: Number(r.authors),
    baselineTotal: Number(r.baseline_total),
  }));
}

/** Rank one scope/window into snapshot entries (exported for unit reasoning and the admin console). */
export function rankEntries(
  counted: Counted[],
  rules: TrendingRules,
  windowMs: number,
  overrides: ActiveOverride[],
  scope: Scope,
): SnapshotEntry[] {
  const applies = overrides.filter((o) => o.scopeType === 'global' || (o.scopeType === scope.type && o.scopeId === scope.id));
  const suppressed = new Set(applies.filter((o) => o.action === 'suppress').map((o) => o.tag));
  const pinned = new Map(applies.filter((o) => o.action === 'pin').map((o) => [o.tag, o.display]));
  const baselineWindows = (rules.baselineDays * 24 * 3600_000) / windowMs;

  const entries: SnapshotEntry[] = counted.map((c) => {
    const baseline = c.baselineTotal / baselineWindows;
    const velocityPct = Math.round(((c.posts - baseline) / Math.max(baseline, 1)) * 100);
    const status: SnapshotEntry['status'] = suppressed.has(c.tag)
      ? 'suppressed'
      : pinned.has(c.tag)
        ? 'pinned'
        : c.authors >= rules.minDistinctAuthors
          ? 'trending'
          : 'below_threshold';
    return { tag: c.tag, display: c.display, posts: c.posts, authors: c.authors, velocityPct, status };
  });
  // Pinned tags stay listed even without recent posts.
  for (const [tag, display] of pinned) {
    if (!suppressed.has(tag) && !entries.some((e) => e.tag === tag)) {
      entries.push({ tag, display, posts: 0, authors: 0, velocityPct: 0, status: 'pinned' });
    }
  }
  const byVelocity = (a: SnapshotEntry, b: SnapshotEntry) =>
    b.velocityPct - a.velocityPct || b.posts - a.posts || a.tag.localeCompare(b.tag);
  const byPosts = (a: SnapshotEntry, b: SnapshotEntry) => b.posts - a.posts || byVelocity(a, b);
  return [
    ...entries.filter((e) => e.status === 'pinned').sort(byVelocity),
    ...entries.filter((e) => e.status === 'trending').sort(byVelocity),
    ...entries.filter((e) => e.status === 'below_threshold' || e.status === 'suppressed').sort(byPosts),
  ].slice(0, SNAPSHOT_ENTRIES);
}

export async function latestSnapshot(db: Db, scope: Scope, window: TrendingWindow) {
  const [row] = await db
    .select()
    .from(trendingSnapshots)
    .where(and(eq(trendingSnapshots.scopeType, scope.type), eq(trendingSnapshots.scopeId, scope.id), eq(trendingSnapshots.window, window)))
    .orderBy(desc(trendingSnapshots.computedAt), desc(trendingSnapshots.createdAt))
    .limit(1);
  return row;
}

function top5(entries: SnapshotEntry[] | undefined): string[] {
  return servedEntries(entries ?? [])
    .slice(0, 5)
    .map((e) => e.tag);
}

/**
 * Recompute every scope and window, store one snapshot each (keeping the latest 20),
 * and return the tags that newly entered the global 24h top 5.
 */
export async function computeTrending(db: Db, now = new Date()): Promise<{ enteredTop5: string[] }> {
  const rules = await loadTrendingRules(db);
  const overrides = await activeOverrides(db, now);
  const previous = top5((await latestSnapshot(db, { type: 'global', id: '' }, '24h'))?.entries);
  let current: string[] = [];

  for (const scope of await scopes(db, now, overrides)) {
    for (const window of Object.keys(WINDOWS) as TrendingWindow[]) {
      const counted = await countScope(db, rules, scope, WINDOWS[window], now);
      const entries = rankEntries(counted, rules, WINDOWS[window], overrides, scope);
      const [inserted] = await db
        .insert(trendingSnapshots)
        .values({ scopeType: scope.type, scopeId: scope.id, window, computedAt: now, entries })
        .returning({ id: trendingSnapshots.id });
      const keep = db
        .select({ id: trendingSnapshots.id })
        .from(trendingSnapshots)
        .where(
          and(eq(trendingSnapshots.scopeType, scope.type), eq(trendingSnapshots.scopeId, scope.id), eq(trendingSnapshots.window, window)),
        )
        .orderBy(desc(trendingSnapshots.computedAt), desc(trendingSnapshots.createdAt))
        .limit(SNAPSHOTS_KEPT);
      await db
        .delete(trendingSnapshots)
        .where(
          and(
            eq(trendingSnapshots.scopeType, scope.type),
            eq(trendingSnapshots.scopeId, scope.id),
            eq(trendingSnapshots.window, window),
            notInArray(trendingSnapshots.id, keep),
          ),
        );
      if (scope.type === 'global' && window === '24h' && inserted) current = top5(entries);
    }
  }
  return { enteredTop5: current.filter((t) => !previous.includes(t)) };
}
