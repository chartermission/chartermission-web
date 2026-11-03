import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { Errors } from '../common/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string | undefined | null): boolean => !!v && UUID_RE.test(v);

/** Path ids that are not UUIDs can never match a row: answer 404 instead of a database error. */
export function uuidOr404(id: string, what = 'That item'): string {
  if (!isUuid(id)) throw Errors.notFound(what);
  return id.toLowerCase();
}

/** Microsecond-exact ISO key for keyset cursors (JS Dates drop microseconds). */
export function tsKey(col: AnyColumn | SQL): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function truncate(text: string | null | undefined, max = 120): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Postgres unique-violation check for race-safe inserts. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Escape LIKE wildcards in a user-supplied prefix. */
export const likePrefix = (v: string) => `${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const DAY_MS = 24 * 3600_000;
export const APPEAL_WINDOW_DAYS = 30;
