/*
 * Date helpers for ISO calendar dates ("YYYY-MM-DD"). Everything is computed
 * in UTC so server and client render the same strings.
 */

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

/** "14 Nov" */
export function formatDayMonth(intl: string, iso: string) {
  return toDate(iso).toLocaleDateString(intl, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Tue 24 Nov" */
export function formatWeekdayDayMonth(intl: string, iso: string) {
  const date = toDate(iso);
  const weekday = date.toLocaleDateString(intl, { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${formatDayMonth(intl, iso)}`;
}

/** "Saturday" */
export function formatWeekday(intl: string, iso: string) {
  return toDate(iso).toLocaleDateString(intl, { weekday: "long", timeZone: "UTC" });
}

/** { month: "NOV", day: "24" } for date badges. */
export function dateBadge(intl: string, iso: string) {
  const date = toDate(iso);
  return {
    month: date.toLocaleDateString(intl, { month: "short", timeZone: "UTC" }).toUpperCase(),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

/** ISO date `days` after `iso`. */
export function addDays(iso: string, days: number) {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** True when `iso` falls within [from, from + days]. */
export function isWithinDays(iso: string, from: string, days: number) {
  return iso >= from && iso <= addDays(from, days);
}

/** True when `iso` is on or after `from` and in the same calendar month. */
export function isRestOfMonth(iso: string, from: string) {
  return iso >= from && iso.slice(0, 7) === from.slice(0, 7);
}
