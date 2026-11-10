import { and, isNull, sql, type SQL } from 'drizzle-orm';
import { blocks, hashtags, mutes, pages, postHashtags, posts, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { isActiveUntil } from '../core/policy.js';

/*
 * Who may see a post (spec 4.5 rules, brief "Moderation states" and "Blocks"):
 *  - deleted posts: nobody;
 *  - hidden/removed posts: only the author (with moderationState) and moderators;
 *  - pending_media posts: only the author until every attachment is clean;
 *  - blocked either way: never;
 *  - suspended, deactivated or deleted authors: dropped from feeds and topic pages.
 */

export type PostRow = typeof posts.$inferSelect;
export type AuthorState = { status: string; suspendedUntil: Date | null };

/** Moderators see hidden content and its state (admin console, appeals). */
export function isModerator(viewer: AuthUser | undefined): boolean {
  return !!viewer?.permissions.has('moderation.view');
}

export function authorIsActive(author: AuthorState | undefined): boolean {
  if (!author) return false;
  return (author.status === 'active' || author.status === 'unverified') && !isActiveUntil(author.suspendedUntil);
}

/** Single-post check used by GET /posts/{id}, interactions and repost embedding. */
export function canViewPost(
  post: PostRow,
  author: AuthorState | undefined,
  viewer: AuthUser | undefined,
  blocked: Set<string>,
  /** For posts published as a page: is that page live? Leave out for ordinary posts. */
  pageIsLive = true,
): boolean {
  if (post.deletedAt) return false;
  const own = viewer?.id === post.authorId;
  const mod = isModerator(viewer);
  if (!viewer && post.visibility !== 'public') return false;
  if (post.pageId && !pageIsLive && !own && !mod) return false;
  // Blocking a member doesn't hide the pages they help run: page posts never show who wrote them.
  if (blocked.has(post.authorId) && !post.pageId) return false;
  if (post.status !== 'published' && !own) return false;
  if (post.moderationState !== 'visible' && !own && !mod) return false;
  // A page's posts stay up when the admin who wrote one leaves or is suspended.
  if (!post.pageId && !authorIsActive(author) && !own && !mod) return false;
  return true;
}

/** True when the post can receive comments, reactions, votes and reposts. */
export function isInteractive(post: PostRow): boolean {
  return !post.deletedAt && post.status === 'published' && post.moderationState === 'visible';
}

/** SQL: the post author's account is active (not suspended, deactivated or deleted). */
export function authorActiveSql(authorCol: SQL | typeof posts.authorId = posts.authorId): SQL {
  return sql`exists (select 1 from ${users} au where au.id = ${authorCol} and au.status in ('active','unverified') and (au.suspended_until is null or au.suspended_until <= now()))`;
}

/** SQL: the user in `col` and the viewer have not blocked each other. */
export function notBlockedSql(viewerId: string, col: SQL | typeof posts.authorId = posts.authorId): SQL {
  return sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${col}) or (b.blocked_id = ${viewerId} and b.blocker_id = ${col}))`;
}

/** SQL: an ordinary post, or a page post whose page is live (pending, rejected and suspended pages are hidden). */
export const pageLiveSql: SQL = sql`(${posts.pageId} is null or exists (select 1 from ${pages} lp where lp.id = ${posts.pageId} and lp.status = 'active'))`;

/** SQL: written by this member as themselves (posts they published as a page are the page's). */
export const personalPostSql: SQL = sql`${posts.pageId} is null`;

/**
 * SQL filter for any list of posts (feed tabs, topic pages, bookmarks).
 * `muteHashtags` drops posts carrying a hashtag the viewer muted (feeds only;
 * opening a muted topic page still shows it). `muteMembers: false` keeps a muted
 * member's posts, for when the viewer opens that member's profile.
 */
export function listablePostsSql(viewerId: string | null, opts: { muteHashtags?: boolean; muteMembers?: boolean } = {}): SQL {
  const conds: (SQL | undefined)[] = [isNull(posts.deletedAt), sql`(${posts.pageId} is not null or ${authorActiveSql()})`, pageLiveSql];
  if (!viewerId) {
    conds.push(sql`${posts.visibility} = 'public'`, sql`${posts.status} = 'published'`, sql`${posts.moderationState} = 'visible'`);
    return and(...conds)!;
  }
  conds.push(
    sql`(${posts.moderationState} = 'visible' or ${posts.authorId} = ${viewerId})`,
    sql`(${posts.status} = 'published' or ${posts.authorId} = ${viewerId})`,
    // Page posts don't show who wrote them, so blocks and mutes between members don't apply to them.
    sql`(${posts.pageId} is not null or ${notBlockedSql(viewerId)})`,
  );
  if (opts.muteMembers !== false) {
    conds.push(
      sql`(${posts.pageId} is not null or not exists (select 1 from ${mutes} mm where mm.user_id = ${viewerId} and mm.target_type = 'member' and mm.target_id = ${posts.authorId}::text))`,
    );
  }
  if (opts.muteHashtags) {
    conds.push(
      sql`(${posts.authorId} = ${viewerId} or not exists (select 1 from ${postHashtags} mph join ${hashtags} mh on mh.id = mph.hashtag_id join ${mutes} mt on mt.target_type = 'hashtag' and mt.target_id = mh.tag and mt.user_id = ${viewerId} where mph.post_id = ${posts.id}))`,
    );
  }
  return and(...conds)!;
}

/** Engagement used by "top" sorts and the For You score: reactions + 2×comments + 3×reposts. */
export const engagementSql = sql`(${posts.reactionCount} + 2 * ${posts.commentCount} + 3 * ${posts.repostCount})`;

/** Full-precision timestamp text for keyset cursors (JS Dates drop microseconds). */
export function tsKey(col: typeof posts.createdAt): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
