/** Canonical in-app paths for social objects. */

export const topicHref = (tag: string) => `/topics/${encodeURIComponent(tag.replace(/^#/, "").toLowerCase())}`;
export const memberHref = (handle: string) => `/members/${handle}`;

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
