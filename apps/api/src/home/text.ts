/** Small helpers shared by the home feed and articles services. */

export const DAY_MS = 86_400_000;

/** The UTC calendar day of `d` as YYYY-MM-DD (moment ids, daily rotation). */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Midnight UTC at the start of the day of `d`. */
export function startOfUtcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 1-based day of the year in UTC (1 January = 1). */
export function utcDayOfYear(d: Date = new Date()): number {
  return Math.floor((startOfUtcDay(d).getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

/** Whole days since 1970-01-01 UTC, for rotations that should not jump at new year. */
export function utcDayNumber(d: Date = new Date()): number {
  return Math.floor(startOfUtcDay(d).getTime() / DAY_MS);
}

/**
 * Plain-text excerpt of a post body: markdown markers removed, whitespace collapsed,
 * cut at a word boundary with an ellipsis when longer than `max` characters.
 */
export function excerpt(text: string | null | undefined, max: number): string {
  const plain = (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?–—-]+$/u, '')}…`;
}
