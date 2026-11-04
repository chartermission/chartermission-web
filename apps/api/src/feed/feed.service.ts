import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { FeedNewQuery, FeedNewResponse, FeedQuery, Page, PostView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, follows, hashtags, memberProfiles, postHashtags, posts, profileSectors, sectors } from '../db/schema.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { RelationsService } from '../core/relations.service.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { engagementSql, listablePostsSql, tsKey } from '../posts/visibility.js';
import { isUuid } from '../media/uuid-param.js';

/** Pinned announcements shown above the first page of every tab. */
const MAX_PINNED = 3;
/** "For you" looks back this far. */
const FOR_YOU_DAYS = 7;

/*
 * "For you" score (CM-FED-04/05), transparent and rule-based — no opaque models:
 *
 *   score = (1 + ln(1 + reactions + 2·comments + 3·reposts))      engagement, log-damped
 *         × (1 + 1·followed + 0.25·sameCountry)                    followed source / same country boost
 *         ÷ (1 + ageHours / 12) ^ 1.2                              recency decay
 *
 * "followed" = the viewer's own post, or a followed member, chapter or hashtag.
 * The reference time is fixed in the cursor so scores stay stable across pages.
 */
export const FOR_YOU_WEIGHTS = { followed: 1, sameCountry: 0.25, halfLifeHours: 12, decayExponent: 1.2 } as const;

@Injectable()
export class FeedService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly serializer: PostSerializer,
    private readonly relations: RelationsService,
  ) {}

  /** GET /feed (CM-FED-04, -05, -07): cursor-paginated, 20 per page by default. */
  async feed(viewer: AuthUser, q: FeedQuery): Promise<Page<PostView>> {
    const filters = await this.filters(q);
    if (!filters) return { items: [], nextCursor: null };
    const blocked = await this.relations.blockedSet(viewer.id);

    // One member's posts (profile "Recent posts"): newest first, pinned posts in place, and the
    // member's posts still show when the viewer muted them (like opening a muted topic page).
    if (q.author) {
      const visible = listablePostsSql(viewer.id, { muteHashtags: true, muteMembers: false });
      const page = await this.newest(q, [visible, ...filters], q.limit);
      return { items: await this.serializer.posts(page.ids, viewer, blocked), nextCursor: page.nextCursor };
    }

    const visible = listablePostsSql(viewer.id, { muteHashtags: true });
    const notPinned = sql`not (${posts.kind} = 'announcement' and ${posts.pinnedAt} is not null)`;
    const base = [visible, notPinned, ...filters];

    // Pinned announcements lead the first page and count towards its size (CM-FED-07: 20 per page).
    // They obey the same country, sector and chapter filters as the rest of the page.
    const pinned = q.cursor ? [] : await this.pinned([visible, ...filters], Math.min(MAX_PINNED, q.limit - 1));
    const limit = q.limit - pinned.length;
    let page: { ids: string[]; nextCursor: string | null };
    if (q.tab === 'for_you') page = await this.forYou(viewer, q, base, limit);
    else {
      const conds = q.tab === 'following' ? [...base, sql`(${this.followedSql(viewer.id)} or ${posts.kind} = 'announcement')`] : base;
      page = await this.newest(q, conds, limit);
    }
    const ids = [...pinned, ...page.ids.filter((id) => !pinned.includes(id))];
    return { items: await this.serializer.posts(ids, viewer, blocked), nextCursor: page.nextCursor };
  }

  /**
   * GET /feed/new: posts newer than `since` that the tab would show, for the
   * "See N new posts" pill. The viewer's own posts don't count (they already see them).
   */
  async newSince(viewer: AuthUser, q: FeedNewQuery): Promise<FeedNewResponse> {
    const filters = await this.filters({ ...q, limit: 20 });
    if (!filters) return { count: 0, authors: [] };
    const conds = [
      listablePostsSql(viewer.id, { muteHashtags: true }),
      ...filters,
      ne(posts.authorId, viewer.id),
      sql`${posts.status} = 'published'`,
      sql`${posts.createdAt} > ${q.since}::timestamptz`,
    ];
    if (q.tab === 'following') conds.push(sql`(${this.followedSql(viewer.id)} or ${posts.kind} = 'announcement')`);
    if (q.tab === 'for_you') conds.push(sql`${posts.createdAt} > now() - make_interval(days => ${FOR_YOU_DAYS}::int)`);
    const [counted] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(...conds));
    const count = counted?.n ?? 0;
    if (!count) return { count: 0, authors: [] };
    const recent = await this.db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(and(...conds))
      .orderBy(desc(posts.createdAt))
      .limit(20);
    const authorIds = [...new Set(recent.map((r) => r.authorId))].slice(0, 3);
    const refs = await this.serializer.memberRefs(authorIds);
    return { count, authors: authorIds.map((id) => refs.get(id)).filter((r) => !!r) };
  }

  private async pinned(conds: SQL[], max: number): Promise<string[]> {
    if (max < 1) return [];
    const rows = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(...conds, eq(posts.kind, 'announcement'), isNotNull(posts.pinnedAt)))
      .orderBy(desc(posts.pinnedAt))
      .limit(max);
    return rows.map((r) => r.id);
  }

  private async newest(q: FeedQuery, conds: SQL[], limit: number) {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c && (typeof c.t !== 'string' || !isUuid(c.id))) throw Errors.badRequest('Invalid cursor');
    const ts = tsKey(posts.createdAt);
    const rows = await this.db
      .select({ id: posts.id, ts })
      .from(posts)
      .where(and(...conds, c ? sql`(${posts.createdAt}, ${posts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    const page = paginate(rows, limit, (last) => ({ t: last.ts, id: last.id }));
    return { ids: page.items.map((r) => r.id), nextCursor: page.nextCursor };
  }

  private async forYou(viewer: AuthUser, q: FeedQuery, conds: SQL[], limit: number) {
    const c = decodeCursor<{ s: string; id: string; at: string }>(q.cursor);
    if (c && (!/^-?\d+(\.\d+)?$/.test(String(c.s)) || !isUuid(c.id) || Number.isNaN(Date.parse(c.at)))) {
      throw Errors.badRequest('Invalid cursor');
    }
    const asOf = c?.at ?? new Date().toISOString();
    const w = FOR_YOU_WEIGHTS;
    const score = sql<string>`round((
      (1 + ln(1 + ${engagementSql}))
      * (1 + (case when ${this.followedSql(viewer.id)} then ${w.followed}::float8 else 0 end)
           + (case when ${posts.countryCode} = ${viewer.countryCode}::text then ${w.sameCountry}::float8 else 0 end))
      / power(1 + greatest(extract(epoch from (${asOf}::timestamptz - ${posts.createdAt})), 0) / ${w.halfLifeHours * 3600}::float8, ${w.decayExponent}::float8)
    )::numeric, 9)`;
    const scored = this.db
      .select({ id: posts.id, score: score.as('score') })
      .from(posts)
      .where(
        and(
          ...conds,
          sql`${posts.createdAt} <= ${asOf}::timestamptz`,
          sql`${posts.createdAt} > ${asOf}::timestamptz - make_interval(days => ${FOR_YOU_DAYS}::int)`,
        ),
      )
      .as('scored');
    const rows = await this.db
      .select({ id: scored.id, score: sql<string>`${scored.score}::text` })
      .from(scored)
      .where(c ? sql`(${scored.score}, ${scored.id}) < (${c.s}::numeric, ${c.id}::uuid)` : undefined)
      .orderBy(desc(scored.score), desc(scored.id))
      .limit(limit + 1);
    const page = paginate(rows, limit, (last) => ({ s: last.score, id: last.id, at: asOf }));
    return { ids: page.items.map((r) => r.id), nextCursor: page.nextCursor };
  }

  /** The viewer's own posts, followed members, followed chapters and followed hashtags (CM-FED-05). */
  private followedSql(viewerId: string): SQL {
    return sql`(${posts.authorId} = ${viewerId}
      or exists (select 1 from ${follows} ff where ff.follower_id = ${viewerId} and ff.target_type = 'member' and ff.target_id = ${posts.authorId}::text)
      or exists (select 1 from ${follows} ff join ${chapters} fc on fc.id = ${posts.chapterId}
                 where ff.follower_id = ${viewerId} and ff.target_type = 'chapter' and (ff.target_id = fc.id::text or ff.target_id = fc.slug))
      or exists (select 1 from ${postHashtags} fph join ${hashtags} fh on fh.id = fph.hashtag_id
                 join ${follows} ff on ff.target_type = 'hashtag' and ff.target_id = fh.tag and ff.follower_id = ${viewerId}
                 where fph.post_id = ${posts.id}))`;
  }

  /** Author, country, sector (author's sectors), chapter (slug or id) and announcements filters (CM-FED-04). Null = nothing can match. */
  private async filters(q: Omit<FeedQuery, 'cursor' | 'author'> & { author?: string }): Promise<SQL[] | null> {
    const out: SQL[] = [];
    if (q.author) {
      const [member] = await this.db
        .select({ userId: memberProfiles.userId })
        .from(memberProfiles)
        .where(isUuid(q.author) ? eq(memberProfiles.userId, q.author) : sql`lower(${memberProfiles.handle}) = ${q.author.toLowerCase()}`)
        .limit(1);
      if (!member) return null;
      out.push(eq(posts.authorId, member.userId));
    }
    if (q.country) out.push(sql`${posts.countryCode} = ${q.country.toUpperCase()}`);
    if (q.sector) {
      out.push(
        sql`exists (select 1 from ${profileSectors} fps join ${sectors} fs on fs.id = fps.item_id where fps.user_id = ${posts.authorId} and (fs.slug = ${q.sector} or fs.id::text = ${q.sector}))`,
      );
    }
    if (q.chapter) {
      const [chapter] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .where(isUuid(q.chapter) ? eq(chapters.id, q.chapter) : eq(chapters.slug, q.chapter.toLowerCase()))
        .limit(1);
      if (!chapter) return null;
      out.push(eq(posts.chapterId, chapter.id));
    }
    if (q.announcements) out.push(eq(posts.kind, 'announcement'));
    if (q.type) out.push(eq(posts.type, q.type));
    if (q.unanswered) out.push(eq(posts.type, 'question'), isNull(posts.acceptedCommentId));
    return out;
  }
}
