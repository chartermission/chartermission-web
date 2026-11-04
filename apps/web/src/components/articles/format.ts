/** Articles per list request: small enough that the grid pages a few times. */
export const ARTICLES_PAGE = 6;

/** "3 Nov" this year, "3 Nov 2025" otherwise. */
export function articleDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "3 November 2026", for bylines. */
export function articleLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** The body without a trailing line of hashtags (the reader shows them as chips). */
export function withoutTrailingTags(body: string): string {
  return body.replace(/(?:\s*#[\p{L}\p{N}_]{2,60})+\s*$/u, "").trimEnd();
}
