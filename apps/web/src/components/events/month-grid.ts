/** Monday-first month grid helpers shared by the mini calendar and the calendar view. */

export type MonthRef = { year: number; month: number }; // month: 0–11

/** Monday-first one-letter day names in the page language ("M T W…", "L M M…"). */
export function weekdayInitials(intl = "en-GB"): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(intl, { weekday: "narrow", timeZone: "UTC" }));
}
export const weekdayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function monthOf(iso: string): MonthRef {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function monthLabel(intl: string, { year, month }: MonthRef) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(intl, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Weeks of ISO dates (null for padding cells), Monday first. */
export function monthWeeks({ year, month }: MonthRef): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "YYYY-MM" for a MonthRef. */
export function monthKey({ year, month }: MonthRef): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** The ISO calendar date after `iso` ("YYYY-MM-DD"). */
export function nextDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** "Saturday 21 November" for an ISO calendar date. */
export function dateHeading(intl: string, iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", "");
}
