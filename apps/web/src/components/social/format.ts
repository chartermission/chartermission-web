
import type { Translate } from "@/i18n/translate";/** Formatting helpers for social screens (relative times in feeds, compact counts). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", "4w", then "3 Nov 2025". */
export function relativeTime(intl: string, t: Translate, iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return t("now");
  if (diff < HOUR) return t("{count}m", { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t("{count}h", { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t("{count}d", { count: Math.floor(diff / DAY) });
  if (diff < 5 * 7 * DAY) return t("{count}w", { count: Math.floor(diff / (7 * DAY)) });
  return absoluteDate(intl, iso);
}

/** "3 Nov 2026" */
export function absoluteDate(intl: string, iso: string): string {
  return new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });
}

/** "3 Nov 2026, 14:05" */
export function absoluteDateTime(intl: string, iso: string): string {
  return new Date(iso).toLocaleString(intl, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Time left until a date: "2 days left", "5 hours left", "Closes soon". */
export function timeLeft(t: Translate, iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return t("Closed");
  if (diff >= DAY) return t("{count} days left", { count: Math.round(diff / DAY) });
  if (diff >= HOUR) return t("{count} hours left", { count: Math.round(diff / HOUR) });
  return t("Closes soon");
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

/** "1 comment", "3 comments". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
