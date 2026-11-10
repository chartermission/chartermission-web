/** Canonical in-app paths for social objects. */

export const topicHref = (tag: string) => `/topics/${encodeURIComponent(tag.replace(/^#/, "").toLowerCase())}`;
export const memberHref = (handle: string) => `/members/${handle}`;

export const pageHref = (slug: string) => `/pages/${slug}`;

/**
 * Where a post's author lives: the page for a post published as a page, otherwise the member's
 * profile. (For page posts `author` carries the page's name and logo, and `page` its address.)
 */
export const authorHref = (post: { author: { handle: string }; page?: { slug: string } | null }) =>
  post.page ? pageHref(post.page.slug) : memberHref(post.author.handle);

/** A post's numbers, for its author (or the admins of the page it was published as). */
export const postAnalyticsHref = (id: string) => `/posts/${id}/analytics`;

/** The reader page of an article (long-form post). */
export const articleHref = (id: string) => `/articles/${id}`;

/** All articles, optionally filtered by a hashtag. */
export const articlesHref = (tag?: string | null) => (tag ? `/articles?tag=${encodeURIComponent(tag.replace(/^#/, ""))}` : "/articles");

/** A post, or anything that knows its id and type. Articles open on their reader page. */
export type PostLinkTarget = string | { id: string; type?: string | null };

/**
 * Where a post lives. Pass the post (or `{ id, type }`) so articles open on /articles/[id];
 * a bare id gives /posts/[id], which redirects articles there anyway.
 */
export function postHref(post: PostLinkTarget): string {
  if (typeof post === "string") return `/posts/${post}`;
  return post.type === "article" ? articleHref(post.id) : `/posts/${post.id}`;
}

export const commentHref = (post: PostLinkTarget, commentId: string) => `${postHref(post)}#comment-${commentId}`;

/** Absolute URL for copying/sharing (client only). */
export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
