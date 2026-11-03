/** Canonical in-app paths for social objects. */

export const topicHref = (tag: string) => `/topics/${encodeURIComponent(tag.replace(/^#/, "").toLowerCase())}`;
export const memberHref = (handle: string) => `/members/${handle}`;
export const postHref = (id: string) => `/posts/${id}`;
export const commentHref = (postId: string, commentId: string) => `/posts/${postId}#comment-${commentId}`;

/** Absolute URL for copying/sharing (client only). */
export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
