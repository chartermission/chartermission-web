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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks the fields a keyset cursor carries before they reach SQL casts, so a tampered or stale
 * cursor is a 400, not a database error: 'uuid', 'date' (ISO timestamp), 'int' or 'text'.
 */
export function checkCursor(cursor: Record<string, unknown> | null, fields: Record<string, 'uuid' | 'date' | 'int' | 'text'>): void {
  if (!cursor) return;
  for (const [key, type] of Object.entries(fields)) {
    const v = cursor[key];
    const ok =
      v === undefined
        ? false
        : type === 'uuid'
          ? typeof v === 'string' && UUID_RE.test(v)
          : type === 'date'
            ? typeof v === 'string' && !Number.isNaN(Date.parse(v))
            : type === 'int'
              ? Number.isInteger(typeof v === 'string' ? Number(v) : v)
              : typeof v === 'string';
    if (!ok) throw Errors.badRequest('Invalid cursor');
  }
}
