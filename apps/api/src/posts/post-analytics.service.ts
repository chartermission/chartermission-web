import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnalyticsDay, CreatorAnalytics, CreatorAnalyticsQuery, PostAnalytics, PostAnalyticsQuery } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookmarks, comments, connections, countries, follows, pages, postViewDays, postViews, posts, reactions } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { PageRefsService, type PageRefRow } from '../core/page-refs.service.js';
import { pseudonym } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../media/uuid-param.js';
import { listablePostsSql } from './visibility.js';

/** A member counts as a new impression of the same post after this long. */
export const IMPRESSION_WINDOW_MINUTES = 30;
/** Countries with fewer viewers than this are grouped as "Other", so one viewer can't be singled out. */
export const MIN_COUNTRY_VIEWERS = 3;
const TOP_COUNTRIES = 6;
const TOP_POSTS = 5;
const DAY_MS = 86_400_000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The last `days` UTC days, oldest first, ending today. */
function lastDays(days: number, end = new Date()): string[] {
  const today = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Array.from({ length: days }, (_, i) => dayKey(new Date(today - (days - 1 - i) * DAY_MS)));
}

function excerpt(body: string, max = 140): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const title = (details: Record<string, unknown> | null) => (typeof details?.title === 'string' ? details.title : null);

/**
 * Post analytics for authors and page admins: how many members a post reached, how they
 * engaged and roughly who they were. Views are stored against a keyed hash of the viewer, so
 * the numbers can be counted but nobody (author or staff) can list who looked at a post.
 */
@Injectable()
export class PostAnalyticsService {
  private readonly logger = new Logger('PostAnalytics');
  private firstView: { at: Date | null; read: number } | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pageRefs: PageRefsService,
  ) {}

  /**
   * POST /posts/views: the member had these posts on screen. Their own posts, posts of pages they
   * manage and posts they can't see are ignored; repeat views inside the window don't count again.
   */
  async recordViews(viewer: AuthUser, postIds: string[]): Promise<void> {
    const ids = [...new Set(postIds)];
    const managed = await this.pageRefs.managedIds(viewer.id);
    const rows = await this.db
      .select({ id: posts.id, authorId: posts.authorId, pageId: posts.pageId })
      .from(posts)
      .where(and(inArray(posts.id, ids), listablePostsSql(viewer.id), eq(posts.status, 'published'), eq(posts.moderationState, 'visible')));
    const seen = rows.filter((r) => (r.pageId ? !managed.has(r.pageId) : r.authorId !== viewer.id));
    if (!seen.length) return;

    const authorIds = [...new Set(seen.filter((r) => !r.pageId).map((r) => r.authorId))];
    const pageIds = [...new Set(seen.map((r) => r.pageId).filter((x): x is string => !!x))];
    const [connected, followed] = await Promise.all([
      authorIds.length
        ? this.db
            .select({ a: connections.requesterId, b: connections.addresseeId })
            .from(connections)
            .where(
              and(
                eq(connections.status, 'accepted'),
                sql`((${connections.requesterId} = ${viewer.id} and ${inArray(connections.addresseeId, authorIds)}) or (${connections.addresseeId} = ${viewer.id} and ${inArray(connections.requesterId, authorIds)}))`,
              ),
            )
        : [],
      this.db
        .select({ type: follows.targetType, id: follows.targetId })
        .from(follows)
        .where(and(eq(follows.followerId, viewer.id), inArray(follows.targetType, ['member', 'page']), inArray(follows.targetId, [...authorIds, ...pageIds]))),
    ]);
    const connectedTo = new Set(connected.map((c) => (c.a === viewer.id ? c.b : c.a)));
    const follows_ = new Set(followed.map((f) => `${f.type}:${f.id}`));
    const audienceOf = (r: (typeof seen)[number]) =>
      r.pageId ? (follows_.has(`page:${r.pageId}`) ? 'follower' : 'other') : connectedTo.has(r.authorId) ? 'connection' : follows_.has(`member:${r.authorId}`) ? 'follower' : 'other';

    const key = pseudonym(viewer.id);
    const values = sql.join(
      seen.map((r) => sql`(${r.id}::uuid, ${audienceOf(r)}::text)`),
      sql`, `,
    );
    // One statement: add or refresh the per-viewer rows, then roll what counted into the day totals.
    await this.db.execute(sql`
      with input(post_id, audience) as (values ${values}),
      counted as (
        insert into ${postViews} (post_id, viewer_key, country_code, audience)
        select post_id, ${key}, ${viewer.countryCode}, audience from input
        on conflict (post_id, viewer_key) do update
          set views = ${postViews.views} + 1, last_seen_at = now(), updated_at = now()
          where ${postViews.lastSeenAt} < now() - make_interval(mins => ${IMPRESSION_WINDOW_MINUTES}::int)
        returning post_id, (xmax = 0) as is_new
      )
      insert into ${postViewDays} (post_id, day, impressions, viewers)
      select post_id, (now() at time zone 'utc')::date, 1, case when is_new then 1 else 0 end from counted
      on conflict (post_id, day) do update
        set impressions = ${postViewDays.impressions} + 1, viewers = ${postViewDays.viewers} + excluded.viewers, updated_at = now()
    `);
  }

  /** Never lets a failed beacon surface as an error to the member. */
  recordViewsQuietly(viewer: AuthUser, postIds: string[]): Promise<void> {
    return this.recordViews(viewer, postIds).catch((err: unknown) => this.logger.warn(`recordViews failed: ${String(err)}`));
  }

  /** GET /posts/{id}/analytics */
  async forPost(user: AuthUser, id: string, q: PostAnalyticsQuery): Promise<PostAnalytics> {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post || post.deletedAt) throw Errors.notFound('Post');
    const allowed = post.pageId ? !!(await this.pageRefs.role(user.id, post.pageId)) : post.authorId === user.id;
    // Not the author: the same answer whether or not the post exists.
    if (!allowed) throw Errors.notFound('Post');
    if (post.repostOfId) throw Errors.conflict('Reposts don’t have their own analytics. Open the original post.');

    const days = lastDays(q.days);
    const since = `${days[0]}T00:00:00Z`;
    const [viewTotals, saves, audience, countryRows, viewDays, engagementDays, page, firstView] = await Promise.all([
      this.db
        .select({ impressions: sql<number>`coalesce(sum(${postViews.views}), 0)::int`, reach: sql<number>`count(*)::int` })
        .from(postViews)
        .where(eq(postViews.postId, id)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(bookmarks)
        .where(and(eq(bookmarks.targetType, 'post'), eq(bookmarks.targetId, id))),
      this.db
        .select({ audience: postViews.audience, n: sql<number>`count(*)::int` })
        .from(postViews)
        .where(eq(postViews.postId, id))
        .groupBy(postViews.audience),
      this.db
        .select({ code: postViews.countryCode, name: countries.name, n: sql<number>`count(*)::int` })
        .from(postViews)
        .leftJoin(countries, eq(countries.code, postViews.countryCode))
        .where(eq(postViews.postId, id))
        .groupBy(postViews.countryCode, countries.name)
        .orderBy(sql`count(*) desc`),
      this.db
        .select({ day: postViewDays.day, impressions: postViewDays.impressions, viewers: postViewDays.viewers })
        .from(postViewDays)
        .where(and(eq(postViewDays.postId, id), sql`${postViewDays.day} >= ${days[0]}::date`)),
      this.engagementByDay(sql`= ${id}::uuid`, since),
      post.pageId ? this.pageRefs.refs([post.pageId]).then((m) => m.get(post.pageId!)) : undefined,
      this.firstViewAt(),
    ]);

    const reach = viewTotals[0]?.reach ?? 0;
    const savesCount = saves[0]?.n ?? 0;
    const engagements = post.reactionCount + post.commentCount + post.repostCount + savesCount;
    const byAudience = new Map(audience.map((a) => [a.audience, a.n]));

    // Small countries are folded into "Other" so a single viewer can't be identified by where they are.
    const named = countryRows.filter((c) => c.code && c.n >= MIN_COUNTRY_VIEWERS).slice(0, TOP_COUNTRIES);
    const rest = reach - named.reduce((sum, c) => sum + c.n, 0);
    const countryList = named.map((c) => ({ code: c.code, name: c.name ?? c.code!, viewers: c.n }));
    if (rest > 0) countryList.push({ code: null, name: named.length ? 'Other' : 'All countries', viewers: rest });

    const tracked = firstView && firstView > post.createdAt ? firstView : post.createdAt;
    return {
      post: {
        id: post.id,
        type: post.type,
        title: title(post.details),
        excerpt: excerpt(post.body),
        createdAt: post.createdAt.toISOString(),
        page: page ? PageRefsService.toRef(page) : null,
      },
      totals: {
        impressions: viewTotals[0]?.impressions ?? 0,
        reach,
        reactions: post.reactionCount,
        comments: post.commentCount,
        reposts: post.repostCount,
        saves: savesCount,
        engagements,
        engagementRate: reach ? Math.min(1, engagements / reach) : 0,
      },
      reactions: { like: post.likeCount, insightful: post.insightfulCount, support: post.supportCount },
      daily: this.series(days, viewDays, engagementDays),
      audience: {
        connections: byAudience.get('connection') ?? 0,
        followers: byAudience.get('follower') ?? 0,
        others: byAudience.get('other') ?? 0,
        countries: countryList,
      },
      trackedSince: tracked.toISOString(),
    };
  }

  /** GET /me/analytics: everything the member posted as themselves, or one of their pages. */
  async forCreator(user: AuthUser, q: CreatorAnalyticsQuery): Promise<CreatorAnalytics> {
    let page: PageRefRow | undefined;
    if (q.page) {
      const [row] = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(isUuid(q.page) ? eq(pages.id, q.page) : sql`lower(${pages.slug}) = ${q.page.toLowerCase()}`)
        .limit(1);
      if (!row || !(await this.pageRefs.role(user.id, row.id))) throw Errors.notFound('Page');
      page = (await this.pageRefs.refs([row.id])).get(row.id);
    }
    const mine: SQL = page ? eq(posts.pageId, page.id) : and(eq(posts.authorId, user.id), sql`${posts.pageId} is null`)!;
    const own = and(mine, sql`${posts.deletedAt} is null`, sql`${posts.repostOfId} is null`)!;
    const followTarget = page ? and(eq(follows.targetType, 'page'), eq(follows.targetId, page.id))! : and(eq(follows.targetType, 'member'), eq(follows.targetId, user.id))!;

    const days = lastDays(q.days);
    const since = `${days[0]}T00:00:00Z`;
    const previousSince = new Date(Date.parse(since) - q.days * DAY_MS).toISOString();
    const ownIds = sql`in (select ${posts.id} from ${posts} where ${own})`;

    const viewsBetween = (from: string, to: string | null) =>
      this.db
        .select({ impressions: sql<number>`coalesce(sum(${postViewDays.impressions}), 0)::int`, viewers: sql<number>`coalesce(sum(${postViewDays.viewers}), 0)::int` })
        .from(postViewDays)
        .where(and(sql`${postViewDays.postId} ${ownIds}`, sql`${postViewDays.day} >= ${from}::timestamptz::date`, to ? sql`${postViewDays.day} < ${to}::timestamptz::date` : undefined));
    const followsBetween = (from: string, to: string | null) =>
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(follows)
        .where(and(followTarget, sql`${follows.createdAt} >= ${from}::timestamptz`, to ? sql`${follows.createdAt} < ${to}::timestamptz` : undefined));

    const [postCount, current, previous, viewDays, engagementDays, previousEngagement, followerTotal, newFollowers, previousFollowers, top] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(and(own, sql`${posts.createdAt} >= ${since}::timestamptz`)),
      viewsBetween(since, null),
      viewsBetween(previousSince, since),
      this.db
        .select({ day: postViewDays.day, impressions: sql<number>`sum(${postViewDays.impressions})::int`, viewers: sql<number>`sum(${postViewDays.viewers})::int` })
        .from(postViewDays)
        .where(and(sql`${postViewDays.postId} ${ownIds}`, sql`${postViewDays.day} >= ${days[0]}::date`))
        .groupBy(postViewDays.day),
      this.engagementByDay(ownIds, since),
      this.engagementByDay(ownIds, previousSince, since),
      this.db.select({ n: sql<number>`count(*)::int` }).from(follows).where(followTarget),
      followsBetween(since, null),
      followsBetween(previousSince, since),
      this.db
        .select({
          id: posts.id,
          type: posts.type,
          details: posts.details,
          body: posts.body,
          createdAt: posts.createdAt,
          impressions: sql<number>`coalesce(sum(${postViewDays.impressions}), 0)::int`,
          reach: sql<number>`coalesce(sum(${postViewDays.viewers}), 0)::int`,
          engagements: sql<number>`(${posts.reactionCount} + ${posts.commentCount} + ${posts.repostCount})::int`,
        })
        .from(posts)
        .leftJoin(postViewDays, and(eq(postViewDays.postId, posts.id), sql`${postViewDays.day} >= ${days[0]}::date`))
        .where(own)
        .groupBy(posts.id)
        .having(sql`coalesce(sum(${postViewDays.impressions}), 0) > 0 or ${posts.createdAt} >= ${since}::timestamptz`)
        .orderBy(sql`coalesce(sum(${postViewDays.impressions}), 0) desc`, sql`${posts.createdAt} desc`)
        .limit(TOP_POSTS),
    ]);

    const daily = this.series(days, viewDays, engagementDays);
    const engagements = daily.reduce((sum, d) => sum + d.engagements, 0);
    const viewers = current[0]?.viewers ?? 0;
    return {
      days: q.days,
      page: page ? PageRefsService.toRef(page) : null,
      totals: {
        posts: postCount[0]?.n ?? 0,
        impressions: current[0]?.impressions ?? 0,
        engagements,
        engagementRate: viewers ? Math.min(1, engagements / viewers) : 0,
        followers: followerTotal[0]?.n ?? 0,
        newFollowers: newFollowers[0]?.n ?? 0,
      },
      previous: {
        impressions: previous[0]?.impressions ?? 0,
        engagements: [...previousEngagement.values()].reduce((sum, n) => sum + n, 0),
        newFollowers: previousFollowers[0]?.n ?? 0,
      },
      daily,
      topPosts: top.map((p) => ({
        id: p.id,
        type: p.type,
        title: title(p.details),
        excerpt: excerpt(p.body),
        createdAt: p.createdAt.toISOString(),
        impressions: p.impressions,
        reach: p.reach,
        engagements: p.engagements,
      })),
    };
  }

  private series(days: string[], views: { day: string; impressions: number; viewers: number }[], engagement: Map<string, number>): AnalyticsDay[] {
    const byDay = new Map(views.map((v) => [v.day, v]));
    return days.map((day) => ({
      day,
      impressions: byDay.get(day)?.impressions ?? 0,
      viewers: byDay.get(day)?.viewers ?? 0,
      engagements: engagement.get(day) ?? 0,
    }));
  }

  /** Reactions, comments and reposts per UTC day on the posts matched by `match` (an SQL tail such as `= $id` or `in (…)`). */
  private async engagementByDay(match: SQL, since: string, until?: string): Promise<Map<string, number>> {
    const window = (col: SQL) => (until ? sql`${col} >= ${since}::timestamptz and ${col} < ${until}::timestamptz` : sql`${col} >= ${since}::timestamptz`);
    const day = (col: SQL) => sql`to_char(${col} at time zone 'utc', 'YYYY-MM-DD')`;
    const result = await this.db.execute<{ day: string; n: number }>(sql`
      select day, sum(n)::int as n from (
        select ${day(sql`r.created_at`)} as day, count(*) as n from ${reactions} r
          where r.target_type = 'post' and r.target_id ${match} and ${window(sql`r.created_at`)} group by 1
        union all
        select ${day(sql`c.created_at`)}, count(*) from ${comments} c
          where c.post_id ${match} and c.deleted_at is null and ${window(sql`c.created_at`)} group by 1
        union all
        select ${day(sql`rp.created_at`)}, count(*) from ${posts} rp
          where rp.repost_of_id ${match} and rp.deleted_at is null and ${window(sql`rp.created_at`)} group by 1
      ) e group by day
    `);
    return new Map(result.rows.map((r) => [r.day, Number(r.n)]));
  }

  /** When view counting began on this platform (cached for an hour). */
  private async firstViewAt(): Promise<Date | null> {
    if (this.firstView?.at && Date.now() - this.firstView.read < 3_600_000) return this.firstView.at;
    const [row] = await this.db.select({ at: sql<string | null>`min(${postViews.createdAt})::text` }).from(postViews);
    const at = row?.at ? new Date(row.at) : null;
    this.firstView = { at, read: Date.now() };
    return at;
  }
}
