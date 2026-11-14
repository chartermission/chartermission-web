import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { FeedNewQuery, FeedNewResponse, FeedQuery, Page, PostView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, follows, users, hashtags, initiativeMembers, initiatives, memberProfiles, pageAdmins, pages, postHashtags, postViews, posts, profileSectors, sectors } from '../db/schema.js';
import { pseudonym } from '../common/crypto.js';
import { decodeCursor, encodeCursor, paginate } from '../common/cursor.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { RelationsService } from '../core/relations.service.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { engagementSql, listablePostsSql, personalPostSql, tsKey } from '../posts/visibility.js';
import { isUuid } from '../media/uuid-param.js';

/** Pinned announcements shown above the first page of every tab. */
const MAX_PINNED = 3;
/** "For you" looks back this far. */
const FOR_YOU_DAYS = 7;

/*
 * "For you" score (CM-FED-04/05), transparent and rule-based — no opaque models:
 *
 *   base  = (1 + ln(1 + reactions + 2·comments + 3·reposts))                    engagement, log-damped
 *         × (1 + 1·followed + 0.5·official + 0.25·sameCountry)                    source boosts
 *         × 0.35 if the viewer already saw the post before this feed was opened   seen demotion
 *         ÷ (1 + ageHours / 12) ^ 1.2                                            recency decay
 *
 *   score = base × 0.5^(n − 1), n = the post's rank among the same author's posts  author spread
 *
 * "followed" = the viewer's own post, a connection, a followed member, page, chapter or hashtag.
 * "official" = Charter Mission's official accounts and pages (and broadcast posts), which every member
 * sees but which no longer outrank people the member chose. An author (or page) is a member or page;
 * their second-best post scores half, the third a quarter, so one busy account can't fill the page.
 *
 * The window is the last 7 days. When it runs out the feed carries on with older posts, newest first,
 * instead of ending. The reference time is fixed in the cursor so scores stay stable across pages,
 * and "seen" only counts views from before that time.
 */
export const FOR_YOU_WEIGHTS = {
  followed: 1,
  official: 0.5,
  sameCountry: 0.25,
  seen: 0.35,
  authorRepeat: 0.5,
  halfLifeHours: 12,
  decayExponent: 1.2,
} as const;

type ForYouCursor = { s?: string; id?: string; at?: string; p?: string; t?: string };

/** Who a post is "from" for the author spread: the page it was published as, else its author. */
const authorKeySql = sql<string>`coalesce(${posts.pageId}::text, ${posts.authorId}::text)`;

/**
 * Display order for one page: the same ranking, but a post never sits directly under another from
 * the same author when a later post on the page can go there instead. Only the order within the page
 * changes, so cursors (taken from the last ranked row) are unaffected.
 */
export function spreadAuthors<T extends { authorKey: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const rest = [...rows];
  while (rest.length) {
    const prev = out[out.length - 1]?.authorKey;
    const at = rest.findIndex((r) => r.authorKey !== prev);
    out.push(...rest.splice(at === -1 ? 0 : at, 1));
  }
  return out;
}

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
    if (q.author || q.page || q.initiative) {
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
      const conds = q.tab === 'following' ? [...base, sql`(${this.followedSql(viewer.id)} or ${this.officialSql()} or ${posts.kind} = 'announcement')`] : base;
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
      sql`(${posts.authorId} <> ${viewer.id} or ${posts.pageId} is not null)`,
      sql`${posts.status} = 'published'`,
      sql`${posts.createdAt} > ${q.since}::timestamptz`,
    ];
    if (q.tab === 'following') conds.push(sql`(${this.followedSql(viewer.id)} or ${this.officialSql()} or ${posts.kind} = 'announcement')`);
    if (q.tab === 'for_you') conds.push(sql`${posts.createdAt} > now() - make_interval(days => ${FOR_YOU_DAYS}::int)`);
    const [counted] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(...conds));
    const count = counted?.n ?? 0;
    if (!count) return { count: 0, authors: [] };
    const recent = await this.db
      .select({ authorId: posts.authorId, pageId: posts.pageId })
      .from(posts)
      .where(and(...conds))
      .orderBy(desc(posts.createdAt))
      .limit(20);
    // Faces on the "new posts" pill are members; posts published as a page don't show who wrote them.
    const authorIds = [...new Set(recent.filter((r) => !r.pageId).map((r) => r.authorId))].slice(0, 3);
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
    const c = decodeCursor<ForYouCursor>(q.cursor);
    const older = c?.p === 'o';
    if (
      c &&
      (typeof c.at !== 'string' ||
        Number.isNaN(Date.parse(c.at)) ||
        (older
          ? c.t !== undefined && (typeof c.t !== 'string' || Number.isNaN(Date.parse(c.t)) || !isUuid(c.id))
          : !/^-?\d+(\.\d+)?$/.test(String(c.s)) || !isUuid(c.id)))
    ) {
      throw Errors.badRequest('Invalid cursor');
    }
    const asOf = c?.at ?? new Date().toISOString();
    const windowStart = sql`${asOf}::timestamptz - make_interval(days => ${FOR_YOU_DAYS}::int)`;

    let ranked: { id: string; authorKey: string }[] = [];
    if (!older) {
      const rows = await this.ranked(viewer, conds, asOf, windowStart, c, limit);
      if (rows.length > limit) {
        const items = rows.slice(0, limit);
        const last = items[items.length - 1]!;
        return { ids: spreadAuthors(items).map((r) => r.id), nextCursor: encodeCursor({ s: last.score, id: last.id, at: asOf }) };
      }
      ranked = rows;
    }

    // The last 7 days are used up: carry on with older posts, newest first. One extra row tells
    // whether there are more (fetched even when the ranked rows filled this page exactly).
    const need = limit - ranked.length;
    const keyset = older && c?.t ? sql`(${posts.createdAt}, ${posts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined;
    const ts = tsKey(posts.createdAt);
    const rows = await this.db
      .select({ id: posts.id, ts, authorKey: authorKeySql })
      .from(posts)
      .where(and(...conds, sql`${posts.createdAt} <= ${windowStart}`, keyset))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(need + 1);
    const items = rows.slice(0, need);
    const lastOld = items[items.length - 1];
    let nextCursor: string | null = null;
    if (rows.length > need) {
      // No older row fits on this page (the ranked rows filled it): the next page starts the older posts.
      nextCursor = lastOld ? encodeCursor({ p: 'o', t: lastOld.ts, id: lastOld.id, at: asOf }) : encodeCursor({ p: 'o', at: asOf });
    }
    return { ids: spreadAuthors([...ranked, ...items]).map((r) => r.id), nextCursor };
  }

  /** The 7-day ranked window (see FOR_YOU_WEIGHTS), limit + 1 rows after the cursor, best first. */
  private async ranked(viewer: AuthUser, conds: SQL[], asOf: string, windowStart: SQL, c: ForYouCursor | null, limit: number) {
    const w = FOR_YOU_WEIGHTS;
    const viewerKey = pseudonym(viewer.id);
    // Each signal is worked out once per post, then combined in the layer above.
    const candidates = this.db
      .select({
        id: posts.id,
        authorKey: authorKeySql.as('author_key'),
        engagement: sql<number>`${engagementSql}`.as('engagement'),
        ageSeconds: sql<number>`greatest(extract(epoch from (${asOf}::timestamptz - ${posts.createdAt})), 0)`.as('age_seconds'),
        sameCountry: sql<boolean>`coalesce(${posts.countryCode} = ${viewer.countryCode}::text, false)`.as('same_country'),
        followed: sql<boolean>`${this.followedSql(viewer.id)}`.as('followed'),
        official: sql<boolean>`${this.officialSql()}`.as('official'),
        seen: sql<boolean>`exists (select 1 from ${postViews} sv where sv.post_id = ${posts.id} and sv.viewer_key = ${viewerKey} and sv.created_at < ${asOf}::timestamptz)`.as(
          'seen',
        ),
      })
      .from(posts)
      .where(and(...conds, sql`${posts.createdAt} <= ${asOf}::timestamptz`, sql`${posts.createdAt} > ${windowStart}`))
      .as('candidates');
    const scored = this.db
      .select({
        id: candidates.id,
        authorKey: candidates.authorKey,
        base: sql<number>`(
          (1 + ln(1 + ${candidates.engagement}))
          * (1 + (case when ${candidates.followed} then ${w.followed}::float8 when ${candidates.official} then ${w.official}::float8 else 0 end)
               + (case when ${candidates.sameCountry} then ${w.sameCountry}::float8 else 0 end))
          * (case when ${candidates.seen} then ${w.seen}::float8 else 1 end)
          / power(1 + ${candidates.ageSeconds} / ${w.halfLifeHours * 3600}::float8, ${w.decayExponent}::float8)
        )`.as('base'),
      })
      .from(candidates)
      .as('scored');
    const spread = this.db
      .select({
        id: scored.id,
        authorKey: scored.authorKey,
        score: sql<string>`round((${scored.base} * power(${w.authorRepeat}::float8,
          row_number() over (partition by ${scored.authorKey} order by ${scored.base} desc, ${scored.id} desc) - 1))::numeric, 9)`.as('score'),
      })
      .from(scored)
      .as('spread');
    return this.db
      .select({ id: spread.id, authorKey: spread.authorKey, score: sql<string>`${spread.score}::text` })
      .from(spread)
      .where(c ? sql`(${spread.score}, ${spread.id}) < (${c.s}::numeric, ${c.id}::uuid)` : undefined)
      .orderBy(desc(spread.score), desc(spread.id))
      .limit(limit + 1);
  }

  /**
   * Posts from Charter Mission's official accounts and official pages. Every member sees them in
   * Following and they get the followed-source boost in For you, whether or not the member follows
   * them (mutes and blocks still apply through listablePostsSql). Posts marked broadcast (members'
   * Charter Center certificates) are treated the same way so that everyone sees them.
   */
  private officialSql(): SQL {
    return sql`(${posts.broadcast} or (${posts.pageId} is null and exists (select 1 from ${users} ou where ou.id = ${posts.authorId} and ou.is_official))
      or (${posts.pageId} is not null and exists (select 1 from ${pages} op where op.id = ${posts.pageId} and op.official)))`;
  }

  /**
   * The viewer's own posts, connections, followed members, followed and managed pages, followed chapters
   * and followed hashtags (CM-FED-05). A connection counts as followed: connecting is how most members
   * build their network, so their posts belong in Following without a separate follow.
   */
  private followedSql(viewerId: string): SQL {
    return sql`(${posts.authorId} = ${viewerId}
      or (${posts.pageId} is null and exists (select 1 from ${connections} fcn
            where fcn.status = 'accepted'
              and least(fcn.requester_id, fcn.addressee_id) = least(${viewerId}::uuid, ${posts.authorId})
              and greatest(fcn.requester_id, fcn.addressee_id) = greatest(${viewerId}::uuid, ${posts.authorId})))
      or (${posts.pageId} is null and exists (select 1 from ${follows} ff where ff.follower_id = ${viewerId} and ff.target_type = 'member' and ff.target_id = ${posts.authorId}::text))
      or (${posts.pageId} is not null and (
            exists (select 1 from ${follows} ff where ff.follower_id = ${viewerId} and ff.target_type = 'page' and ff.target_id = ${posts.pageId}::text)
            or exists (select 1 from ${pageAdmins} fpa where fpa.user_id = ${viewerId} and fpa.page_id = ${posts.pageId})))
      or exists (select 1 from ${follows} ff join ${chapters} fc on fc.id = ${posts.chapterId}
                 where ff.follower_id = ${viewerId} and ff.target_type = 'chapter' and (ff.target_id = fc.id::text or ff.target_id = fc.slug))
      or (${posts.initiativeId} is not null and (
            exists (select 1 from ${follows} ff where ff.follower_id = ${viewerId} and ff.target_type = 'initiative' and ff.target_id = ${posts.initiativeId}::text)
            or exists (select 1 from ${initiativeMembers} fim where fim.user_id = ${viewerId} and fim.initiative_id = ${posts.initiativeId})))
      or exists (select 1 from ${postHashtags} fph join ${hashtags} fh on fh.id = fph.hashtag_id
                 join ${follows} ff on ff.target_type = 'hashtag' and ff.target_id = fh.tag and ff.follower_id = ${viewerId}
                 where fph.post_id = ${posts.id}))`;
  }

  /** Author, country, sector (author's sectors), chapter (slug or id) and announcements filters (CM-FED-04). Null = nothing can match. */
  private async filters(q: Omit<FeedQuery, 'cursor' | 'author' | 'page' | 'initiative'> & { author?: string; page?: string; initiative?: string }): Promise<SQL[] | null> {
    const out: SQL[] = [];
    if (q.author) {
      const [member] = await this.db
        .select({ userId: memberProfiles.userId })
        .from(memberProfiles)
        .where(isUuid(q.author) ? eq(memberProfiles.userId, q.author) : sql`lower(${memberProfiles.handle}) = ${q.author.toLowerCase()}`)
        .limit(1);
      if (!member) return null;
      // A profile lists what the member posted as themselves, not what they published for a page.
      out.push(eq(posts.authorId, member.userId), personalPostSql);
    }
    if (q.page) {
      const [page] = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(isUuid(q.page) ? eq(pages.id, q.page) : sql`lower(${pages.slug}) = ${q.page.toLowerCase()}`)
        .limit(1);
      if (!page) return null;
      // The page's own posts, and members' posts about it (Charter Center certificates on Charter Center's page).
      out.push(sql`(${posts.pageId} = ${page.id} or ${posts.aboutPageId} = ${page.id})`);
    }
    if (q.initiative) {
      const [initiative] = await this.db
        .select({ id: initiatives.id })
        .from(initiatives)
        .where(and(isUuid(q.initiative) ? eq(initiatives.id, q.initiative) : eq(initiatives.slug, q.initiative.toLowerCase()), isNull(initiatives.deletedAt)))
        .limit(1);
      if (!initiative) return null;
      out.push(eq(posts.initiativeId, initiative.id));
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
