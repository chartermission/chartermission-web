/** Formatting helpers for social screens (relative times in feeds, compact counts). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", "4w", then "3 Nov 2025". */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  if (diff < 5 * 7 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  return absoluteDate(iso);
}

/** "3 Nov 2026" */
export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "3 Nov 2026, 14:05" */
export function absoluteDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Time left until a date: "2 days left", "5 hours left", "Closes soon". */
export function timeLeft(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "Closed";
  if (diff >= DAY) {
    const days = Math.round(diff / DAY);
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  if (diff >= HOUR) {
    const hours = Math.round(diff / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} left`;
  }
  return "Closes soon";
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
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
