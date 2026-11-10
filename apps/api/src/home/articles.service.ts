import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { ArticlesHub, ArticlesQuery, Page, PostView, RelatedArticles } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { hashtags, postHashtags, posts } from '../db/schema.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { RelationsService } from '../core/relations.service.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { listablePostsSql, tsKey } from '../posts/visibility.js';
import { isUuid } from '../media/uuid-param.js';
import { HomeQueries } from './home-queries.js';

/** `popular` and the featured article look back this far. */
const POPULAR_DAYS = 30;
/** The hub's "popular this week" list. */
const HUB_POPULAR_DAYS = 7;
const HUB_POPULAR = 5;
const HUB_TOPICS = 12;
const HUB_AUTHORS = 5;
const RELATED = 3;

/** Article engagement: reactions + 2 × comments. */
const scoreSql = sql<number>`(${posts.reactionCount} + 2 * ${posts.commentCount})`;

/** The Articles section: GET /articles, /articles/hub and /articles/:id/related. */
@Injectable()
export class ArticlesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly serializer: PostSerializer,
    private readonly relations: RelationsService,
    private readonly queries: HomeQueries,
  ) {}

  /** Published, visible articles the viewer may list (feed rules: blocks, mutes, inactive authors). */
  private articleSql(viewerId: string): SQL {
    return and(
      listablePostsSql(viewerId, { muteHashtags: true }),
      eq(posts.type, 'article'),
      eq(posts.status, 'published'),
      eq(posts.moderationState, 'visible'),
      isNull(posts.repostOfId),
    )!;
  }

  private sinceSql(days: number, asOf?: string): SQL {
    return asOf
      ? sql`${posts.createdAt} > ${asOf}::timestamptz - make_interval(days => ${days}::int)`
      : sql`${posts.createdAt} > now() - make_interval(days => ${days}::int)`;
  }

  /** GET /articles: latest (keyset on created_at, id) or popular (last 30 days, keyset on score, created_at, id). */
  async list(viewer: AuthUser, q: ArticlesQuery): Promise<Page<PostView>> {
    const conds: SQL[] = [this.articleSql(viewer.id)];
    if (q.tag) {
      conds.push(
        sql`exists (select 1 from ${postHashtags} aph join ${hashtags} ah on ah.id = aph.hashtag_id where aph.post_id = "posts"."id" and ah.tag = ${q.tag.toLowerCase()})`,
      );
    }
    const ts = tsKey(posts.createdAt);
    let page: { ids: string[]; nextCursor: string | null };
    if (q.sort === 'popular') {
      const c = decodeCursor<{ s: number; t: string; id: string; at: string }>(q.cursor);
      if (c && (!Number.isInteger(c.s) || typeof c.t !== 'string' || !isUuid(c.id) || Number.isNaN(Date.parse(c.at)))) {
        throw Errors.badRequest('Invalid cursor');
      }
      // The window is fixed in the cursor so later pages rank the same set.
      const asOf = c?.at ?? new Date().toISOString();
      conds.push(this.sinceSql(POPULAR_DAYS, asOf), sql`${posts.createdAt} <= ${asOf}::timestamptz`);
      if (c) conds.push(sql`(${scoreSql}, ${posts.createdAt}, ${posts.id}) < (${c.s}::int, ${c.t}::timestamptz, ${c.id}::uuid)`);
      const rows = await this.db
        .select({ id: posts.id, ts, s: sql<number>`${scoreSql}::int` })
        .from(posts)
        .where(and(...conds))
        .orderBy(desc(scoreSql), desc(posts.createdAt), desc(posts.id))
        .limit(q.limit + 1);
      const p = paginate(rows, q.limit, (last) => ({ s: last.s, t: last.ts, id: last.id, at: asOf }));
      page = { ids: p.items.map((r) => r.id), nextCursor: p.nextCursor };
    } else {
      const c = decodeCursor<{ t: string; id: string }>(q.cursor);
      if (c && (typeof c.t !== 'string' || Number.isNaN(Date.parse(c.t)) || !isUuid(c.id))) throw Errors.badRequest('Invalid cursor');
      if (c) conds.push(sql`(${posts.createdAt}, ${posts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
      const rows = await this.db
        .select({ id: posts.id, ts })
        .from(posts)
        .where(and(...conds))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(q.limit + 1);
      const p = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.id }));
      page = { ids: p.items.map((r) => r.id), nextCursor: p.nextCursor };
    }
    const blocked = await this.relations.blockedSet(viewer.id);
    return { items: await this.serializer.posts(page.ids, viewer, blocked), nextCursor: page.nextCursor };
  }

  /** GET /articles/hub */
  async hub(viewer: AuthUser): Promise<ArticlesHub> {
    const visible = this.articleSql(viewer.id);
    const [featuredRow] = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(visible, this.sinceSql(POPULAR_DAYS)))
      .orderBy(desc(scoreSql), desc(posts.createdAt), desc(posts.id))
      .limit(1);
    const [latestRow] = featuredRow
      ? [featuredRow]
      : await this.db.select({ id: posts.id }).from(posts).where(visible).orderBy(desc(posts.createdAt), desc(posts.id)).limit(1);
    const featuredId = latestRow?.id ?? null;

    const [popularRows, topicRows, authorRows, [total], blocked] = await Promise.all([
      this.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(visible, this.sinceSql(HUB_POPULAR_DAYS), featuredId ? sql`${posts.id} <> ${featuredId}::uuid` : undefined))
        .orderBy(desc(scoreSql), desc(posts.createdAt), desc(posts.id))
        .limit(HUB_POPULAR),
      this.db
        .select({ tag: hashtags.display, articles: sql<number>`count(distinct ${posts.id})::int` })
        .from(posts)
        .innerJoin(postHashtags, eq(postHashtags.postId, posts.id))
        .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
        .where(visible)
        .groupBy(hashtags.id, hashtags.display)
        .orderBy(sql`count(distinct ${posts.id}) desc`, asc(hashtags.tag))
        .limit(HUB_TOPICS),
      this.db
        .select({ authorId: posts.authorId, articles: sql<number>`count(*)::int` })
        .from(posts)
        // Top writers are members; articles published as a page count for the page, not its admin.
        .where(and(visible, isNull(posts.pageId)))
        .groupBy(posts.authorId)
        .orderBy(sql`count(*) desc`, sql`max(${posts.createdAt}) desc`, asc(posts.authorId))
        .limit(HUB_AUTHORS),
      this.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(visible),
      this.relations.blockedSet(viewer.id),
    ]);

    const ids = [...(featuredId ? [featuredId] : []), ...popularRows.map((r) => r.id)];
    const [views, cards] = await Promise.all([
      this.serializer.posts(ids, viewer, blocked),
      this.queries.momentMembers(
        viewer.id,
        authorRows.map((r) => r.authorId),
      ),
    ]);
    const byId = new Map(views.map((v) => [v.id, v]));
    return {
      featured: (featuredId && byId.get(featuredId)) || null,
      popular: popularRows.map((r) => byId.get(r.id)).filter((v) => !!v),
      topics: topicRows,
      authors: authorRows
        .map((r) => {
          const member = cards.get(r.authorId);
          return member ? { member, articles: r.articles } : null;
        })
        .filter((a) => !!a),
      total: total?.n ?? 0,
    };
  }

  /** GET /articles/:id/related — 404 unless the id is an article the viewer may see. */
  async related(viewer: AuthUser, id: string): Promise<RelatedArticles> {
    if (!isUuid(id)) throw Errors.notFound('Article');
    const visible = this.articleSql(viewer.id);
    const [article] = await this.db
      .select({ id: posts.id, authorId: posts.authorId, pageId: posts.pageId })
      .from(posts)
      .where(and(visible, eq(posts.id, id)))
      .limit(1);
    if (!article) throw Errors.notFound('Article');

    const byAuthor = await this.db
      .select({ id: posts.id })
      .from(posts)
      // "More from" the same writer: the page for an article published as a page, otherwise the member.
      .where(
        and(
          visible,
          article.pageId ? eq(posts.pageId, article.pageId) : and(eq(posts.authorId, article.authorId), isNull(posts.pageId)),
          sql`${posts.id} <> ${article.id}::uuid`,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(RELATED);
    const exclude = [article.id, ...byAuthor.map((r) => r.id)];

    // Most shared hashtags first, then newest.
    const shared = sql<number>`(select count(*)::int from ${postHashtags} rph where rph.post_id = "posts"."id"
      and rph.hashtag_id in (select oph.hashtag_id from ${postHashtags} oph where oph.post_id = ${article.id}::uuid))`;
    const sharing = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(visible, notInArray(posts.id, exclude), sql`${shared} > 0`))
      .orderBy(desc(shared), desc(posts.createdAt), desc(posts.id))
      .limit(RELATED);
    let relatedIds = sharing.map((r) => r.id);
    if (relatedIds.length < RELATED) {
      const latest = await this.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(visible, notInArray(posts.id, [...exclude, ...relatedIds])))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(RELATED - relatedIds.length);
      relatedIds = [...relatedIds, ...latest.map((r) => r.id)];
    }

    const blocked = await this.relations.blockedSet(viewer.id);
    const views = await this.serializer.posts([...byAuthor.map((r) => r.id), ...relatedIds], viewer, blocked);
    const byId = new Map(views.map((v) => [v.id, v]));
    const pick = (ids: string[]) => ids.map((i) => byId.get(i)).filter((v) => !!v);
    return { moreByAuthor: pick(byAuthor.map((r) => r.id)), related: pick(relatedIds) };
  }
}

