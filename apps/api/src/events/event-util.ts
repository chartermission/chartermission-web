import { AppError } from '../common/errors.js';

/** Registration closed, event started, external mode, not published (contract: PRECONDITION_FAILED). */
export const closed = (message: string) => new AppError(412, 'PRECONDITION_FAILED', message);

export const PUBLIC_STATUSES = ['published', 'archived'] as const;
export const isPublicStatus = (status: string) => status === 'published' || status === 'archived';

/** Published events whose end is this far in the past are archived by the maintenance job. */
export const ARCHIVE_AFTER_MS = 7 * 86_400_000;

export const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');

export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
  return base || 'event';
}

/* ---------- Time zones (no dependency: Intl only) ---------- */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, date: Date) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at `date`, in milliseconds (e.g. +3_600_000 for Africa/Lagos). */
export function tzOffsetMs(tz: string, date: Date): number {
  const p = parts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on y-m-d in `tz`. */
export function zonedMidnight(tz: string, year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = tzOffsetMs(tz, new Date(guess));
  let t = guess - first;
  const second = tzOffsetMs(tz, new Date(t));
  if (second !== first) t = guess - second;
  return new Date(t);
}

/** YYYY-MM-DD of `date` in `tz`. */
export function dayKey(date: Date, tz: string): string {
  const p = parts(tz, date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "Thursday 3 December 2026, 18:00 (Africa/Lagos)" for emails. */
export function formatLocal(date: Date, tz: string): string {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${s} (${tz.replace(/_/g, ' ')})`;
}

/** "45 minutes" / "1 hour" / "23 hours". */
export function formatLeadTime(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
