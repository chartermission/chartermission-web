/** Hashtag, mention and link extraction for posts and comments. */

export const MAX_HASHTAGS = 10;
export const MAX_MENTIONS = 20;

const HASHTAG = /(?<![\w&/#])#([A-Za-z0-9_]{2,50})(?![A-Za-z0-9_])/g;
/** Handles follow the profile rule: 3–30 letters, numbers or hyphens, not starting or ending with a hyphen. */
const MENTION = /(?<![\w@./-])@([A-Za-z0-9][A-Za-z0-9-]{1,28}[A-Za-z0-9])(?![A-Za-z0-9-])/g;
const HTTPS_URL = /https:\/\/[^\s<>"'`]+/i;

export type ParsedTag = { tag: string; display: string };

/** `#Tag` tokens, de-duplicated case-insensitively (first spelling wins), at most 10. */
export function parseHashtags(text: string): ParsedTag[] {
  const seen = new Map<string, ParsedTag>();
  for (const m of text.matchAll(HASHTAG)) {
    const display = m[1]!;
    const tag = display.toLowerCase();
    if (!seen.has(tag)) seen.set(tag, { tag, display });
    if (seen.size >= MAX_HASHTAGS) break;
  }
  return [...seen.values()];
}

/** `@handle` tokens, lower-cased and de-duplicated, at most 20. */
export function parseMentions(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION)) {
    seen.add(m[1]!.toLowerCase());
    if (seen.size >= MAX_MENTIONS) break;
  }
  return [...seen];
}

/** The first https URL in the text, without trailing punctuation. */
export function firstHttpsUrl(text: string): string | null {
  const m = HTTPS_URL.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]]+$/, '');
  try {
    return new URL(url).toString().slice(0, 500);
  } catch {
    return null;
  }
}
