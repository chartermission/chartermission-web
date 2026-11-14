import type { PostView } from "@chartermission/contracts";
import { postHref } from "./links";
import type { ShareRequest } from "./share-out";

/** Plain text from a post body (markdown marks and mention/link syntax removed), on one line. */
export function plainExcerpt(body: string, max = 200): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Sharing a post or article: its link, its words, and "send in a message" for members. */
export function postShare(post: Pick<PostView, "id" | "type" | "body" | "article" | "author" | "page">, fallbackTitle: string): ShareRequest {
  const excerpt = plainExcerpt(post.body);
  const title = post.article?.title ?? (excerpt || fallbackTitle);
  return {
    path: postHref(post),
    title,
    text: post.article ? [post.article.title, post.article.subtitle].filter(Boolean).join(": ") : excerpt || fallbackTitle,
    send: { type: post.type === "article" ? "article" : "post", key: post.id },
  };
}
