import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import type {
  HashtagSuggestion,
  Page,
  PostView,
  TopicPostsQuery,
  TopicSummary,
  TopicView,
  TopicsQuery,
  TrendingQuery,
  TrendingResponse,
  TrendingScope,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, countries, follows, hashtags, mutes, postHashtags, posts, trendingOverrides } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthUser } from '../core/auth-context.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { engagementSql, listablePostsSql, tsKey } from '../posts/visibility.js';
import { isUuid } from '../media/uuid-param.js';
import { latestSnapshot, servedEntries, type Scope } from './trending.js';

const TAG = /^[a-z0-9_]{2,50}$/;
const GLOBAL: Scope = { type: 'global', id: '' };

/** Hashtag topic pages, composer suggestions and the member-facing trending list (CM-FED-04). */
@Injectable()
export class TopicsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly serializer: PostSerializer,
  ) {}

  private async hashtag(raw: string) {
    const tag = raw.replace(/^#/, '').toLowerCase();
    if (!TAG.test(tag)) throw Errors.notFound('Topic');
    const [row] = await this.db.select().from(hashtags).where(eq(hashtags.tag, tag)).limit(1);
    if (!row) throw Errors.notFound('Topic');
    return row;
  }

  /** GET /topics/{tag} */
  async topic(viewer: AuthUser, raw: string): Promise<TopicView> {
    const h = await this.hashtag(raw);
    const [[followers], [following], [muted], activity, related, snapshot] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(follows)
        .where(and(eq(follows.targetType, 'hashtag'), eq(follows.targetId, h.tag))),
      this.db
        .select({ x: sql`1` })
        .from(follows)
        .where(and(eq(follows.followerId, viewer.id), eq(follows.targetType, 'hashtag'), eq(follows.targetId, h.tag)))
        .limit(1),
      this.db
        .select({ x: sql`1` })
        .from(mutes)
        .where(and(eq(mutes.userId, viewer.id), eq(mutes.targetType, 'hashtag'), eq(mutes.targetId, h.tag)))
        .limit(1),
      this.activity7d(viewer, h.id),
      this.related(h.id),
      latestSnapshot(this.db, GLOBAL, '24h'),
    ]);
    const entry = snapshot?.entries.find((e) => e.tag === h.tag);
    const rank = servedEntries(snapshot?.entries ?? []).findIndex((e) => e.tag === h.tag);
    return {
      tag: h.display,
      description: h.description,
      posts: h.postCount,
      followers: followers?.n ?? 0,
      following: !!following,
      muted: !!muted,
      velocityPct: entry && entry.status !== 'suppressed' ? entry.velocityPct : null,
      trending: rank >= 0 ? { rank: rank + 1, scopeLabel: 'Africa' } : null,
      activity7d: activity,
      related,
    };
  }

  /** Posts per UTC day for the last 7 days, oldest first; the last value is today. */
  private async activity7d(viewer: AuthUser, hashtagId: string): Promise<number[]> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const since = new Date(today.getTime() - 6 * 86400_000);
    const day = sql<string>`to_char(${posts.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ day, n: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          sql`exists (select 1 from ${postHashtags} tph where tph.post_id = ${posts.id} and tph.hashtag_id = ${hashtagId})`,
          sql`${posts.createdAt} >= ${since}`,
          listablePostsSql(viewer.id),
        ),
      )
      .groupBy(day);
    const counts = new Map(rows.map((r) => [r.day, r.n]));
    return Array.from({ length: 7 }, (_, i) => counts.get(new Date(since.getTime() + i * 86400_000).toISOString().slice(0, 10)) ?? 0);
  }

  /** Tags that most often appear on the same posts. */
  private async related(hashtagId: string): Promise<string[]> {
    const rows = await this.db.execute<{ display: string }>(sql`
      select h2.display, count(*) as n
      from post_hashtags ph1
      join post_hashtags ph2 on ph2.post_id = ph1.post_id and ph2.hashtag_id <> ph1.hashtag_id
      join hashtags h2 on h2.id = ph2.hashtag_id
      join posts p on p.id = ph1.post_id
      where ph1.hashtag_id = ${hashtagId}
        and p.deleted_at is null and p.status = 'published' and p.moderation_state = 'visible'
      group by h2.display
      order by n desc, h2.display
      limit 5`);
    return rows.rows.map((r) => r.display);
  }

  /** GET /topics/{tag}/posts — top (engagement, last 7 days), latest, or media (posts with images). */
  async topicPosts(viewer: AuthUser, raw: string, q: TopicPostsQuery): Promise<Page<PostView>> {
    const h = await this.hashtag(raw);
    const conds: (SQL | undefined)[] = [
      sql`exists (select 1 from ${postHashtags} tph where tph.post_id = ${posts.id} and tph.hashtag_id = ${h.id})`,
      listablePostsSql(viewer.id),
    ];
    const ts = tsKey(posts.createdAt);
    if (q.sort === 'top') {
      const score = sql<number>`${engagementSql}::int`;
      const c = decodeCursor<{ e: number; t: string; id: string }>(q.cursor);
      conds.push(sql`${posts.createdAt} > now() - interval '7 days'`);
      if (c) conds.push(sql`(${engagementSql}, ${posts.createdAt}, ${posts.id}) < (${c.e}::int, ${c.t}::timestamptz, ${c.id}::uuid)`);
      const rows = await this.db
        .select({ id: posts.id, ts, e: score })
        .from(posts)
        .where(and(...conds))
        .orderBy(desc(engagementSql), desc(posts.createdAt), desc(posts.id))
        .limit(q.limit + 1);
      const page = paginate(rows, q.limit, (last) => ({ e: last.e, t: last.ts, id: last.id }));
      return { items: await this.serializer.posts(page.items.map((r) => r.id), viewer), nextCursor: page.nextCursor };
    }
    if (q.sort === 'media') {
      conds.push(
        sql`exists (select 1 from post_attachments pa join files f on f.id = pa.file_id where pa.post_id = ${posts.id} and pa.kind = 'image' and f.scan_status = 'clean')`,
      );
    }
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c) conds.push(sql`(${posts.createdAt}, ${posts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
    const rows = await this.db
      .select({ id: posts.id, ts })
      .from(posts)
      .where(and(...conds))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.id }));
    return { items: await this.serializer.posts(page.items.map((r) => r.id), viewer), nextCursor: page.nextCursor };
  }

  /**
   * GET /topics?sort=popular|new|followed&q= — the explore page. Popular = most followed,
   * then most used; new = most recently created; followed = the viewer's topics. Tags the
   * moderation team suppressed everywhere are left out of popular and new.
   */
  async list(viewer: AuthUser, q: TopicsQuery): Promise<Page<TopicSummary>> {
    const c = decodeCursor<{ o: number }>(q.cursor);
    const offset = c ? Number(c.o) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw Errors.badRequest('Invalid cursor');
    const term = q.q?.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    // Columns of the outer hashtags row are written out in full: drizzle leaves them
    // unqualified in single-table selects, which a subquery would resolve to its own table.
    const followedSql = sql`exists (select 1 from ${follows} tf where tf.follower_id = ${viewer.id} and tf.target_type = 'hashtag' and tf.target_id = "hashtags"."tag")`;
    const suppressedSql = sql`exists (select 1 from ${trendingOverrides} tov where tov.hashtag_id = "hashtags"."id" and tov.action = 'suppress'
      and tov.scope_type = 'global' and tov.revoked_at is null and (tov.expires_at is null or tov.expires_at > now()))`;
    const conds: SQL[] = [sql`${hashtags.postCount} > 0`];
    if (term) conds.push(like(hashtags.tag, `%${term.replace(/_/g, '\\_')}%`));
    if (q.sort === 'followed') conds.push(followedSql);
    else conds.push(sql`not ${suppressedSql}`);
    const posts7d = sql<number>`(select count(*)::int from ${postHashtags} tph join ${posts} tp on tp.id = tph.post_id
      where tph.hashtag_id = "hashtags"."id" and tp.deleted_at is null and tp.status = 'published' and tp.moderation_state = 'visible'
      and tp.created_at > now() - interval '7 days')`;
    const order =
      q.sort === 'new'
        ? [desc(hashtags.createdAt), asc(hashtags.tag)]
        : [desc(hashtags.followerCount), desc(hashtags.postCount), asc(hashtags.tag)];
    const rows = await this.db
      .select({
        tag: hashtags.display,
        description: hashtags.description,
        posts: hashtags.postCount,
        followers: hashtags.followerCount,
        following: sql<boolean>`${followedSql}`,
        posts7d,
        createdAt: hashtags.createdAt,
      })
      .from(hashtags)
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    return { items, nextCursor: hasMore ? Buffer.from(JSON.stringify({ o: offset + q.limit })).toString('base64url') : null };
  }

  /** GET /hashtags/suggest?q= — prefix match on the tag, most used first, up to 8. */
  async suggest(q: string): Promise<HashtagSuggestion[]> {
    const prefix = q.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const rows = await this.db
      .select({ tag: hashtags.tag, display: hashtags.display, posts: hashtags.postCount })
      .from(hashtags)
      .where(prefix ? like(hashtags.tag, `${prefix.replace(/_/g, '\\_')}%`) : undefined)
      .orderBy(desc(hashtags.postCount), asc(hashtags.tag))
      .limit(8);
    const snapshot = await latestSnapshot(this.db, GLOBAL, '24h');
    const trending = new Set(servedEntries(snapshot?.entries ?? []).map((e) => e.tag));
    return rows.map((r) => ({ tag: r.display, posts: r.posts, trending: trending.has(r.tag) }));
  }

  /** GET /trending — from the latest snapshot; pinned first, then trending; never suppressed or below threshold. */
  async trending(q: TrendingQuery): Promise<TrendingResponse> {
    const { scope, label } = await this.resolveScope(q.scope, q.scopeId);
    const snapshot = await latestSnapshot(this.db, scope, q.window);
    const items = servedEntries(snapshot?.entries ?? [])
      .slice(0, q.limit)
      .map((e, i) => ({
        rank: i + 1,
        tag: e.display,
        context: `Trending in ${label}`,
        posts: e.posts,
        authors: e.authors,
        velocityPct: e.velocityPct,
        pinned: e.status === 'pinned',
      }));
    return {
      computedAt: snapshot?.computedAt.toISOString() ?? null,
      scope: q.scope,
      scopeId: scope.id || null,
      window: q.window,
      items,
    };
  }

  private async resolveScope(type: TrendingScope, scopeId: string | undefined): Promise<{ scope: Scope; label: string }> {
    if (type === 'global') return { scope: GLOBAL, label: 'Africa' };
    if (!scopeId) throw Errors.validation({ scopeId: 'Choose a country or chapter' });
    if (type === 'country') {
      const code = scopeId.toUpperCase();
      const [country] = await this.db.select().from(countries).where(eq(countries.code, code)).limit(1);
      if (!country) throw Errors.notFound('Country');
      return { scope: { type, id: code }, label: country.name };
    }
    const [chapter] = await this.db
      .select()
      .from(chapters)
      .where(isUuid(scopeId) ? eq(chapters.id, scopeId) : eq(chapters.slug, scopeId.toLowerCase()))
      .limit(1);
    if (!chapter) throw Errors.notFound('Chapter');
    return { scope: { type, id: chapter.id }, label: chapter.name };
  }
}
