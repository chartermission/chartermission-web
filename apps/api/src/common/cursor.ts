import { Errors } from './errors.js';

/**
 * Opaque cursors (spec 6.1). The payload is a small JSON object, base64url-encoded.
 * Keyset pagination: pass the last row's sort key and id.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw Errors.badRequest('Invalid cursor');
  }
}

/** Fetch limit + 1 rows, then call this to split items and next cursor. */
export function paginate<T>(rows: T[], limit: number, cursorOf: (last: T) => Record<string, string | number>) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
