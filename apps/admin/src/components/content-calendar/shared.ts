import type { ContentCalendarAction, ContentCalendarItem, ContentCalendarState } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";

export type CalendarView = "month" | "week" | "list";
export type StateFilter = "all" | ContentCalendarState;
export type SourceFilter = "claude" | "all";

/** What the page shows, kept in the URL. `date` is a day (YYYY-MM-DD) in the viewer's zone the month or week contains. */
export type CalendarParams = {
  view: CalendarView;
  date: string | null;
  state: StateFilter;
  source: SourceFilter;
  q: string;
  author: string | null;
};

export const STATES: { value: ContentCalendarState; label: string; tone: ChipTone; dot: string }[] = [
  { value: "scheduled", label: "Scheduled", tone: "info", dot: "bg-info" },
  { value: "awaiting_approval", label: "Awaiting approval", tone: "hashtag", dot: "bg-accent" },
  { value: "held", label: "On hold", tone: "warning", dot: "bg-warning" },
  { value: "published", label: "Published", tone: "success", dot: "bg-success" },
  { value: "declined", label: "Declined", tone: "neutral", dot: "bg-secondary" },
  { value: "failed", label: "Couldn’t publish", tone: "error", dot: "bg-error" },
];

export const stateMeta = (state: ContentCalendarState) => STATES.find((s) => s.value === state)!;

/** Chip classes per state for calendar entries (compact, coloured by state). */
export const ENTRY_CLASSES: Record<ContentCalendarState, string> = {
  scheduled: "bg-info-light text-info border-info/25",
  awaiting_approval: "bg-accent-light text-accent-hover border-accent/25",
  held: "bg-warning-light text-warning border-warning/30",
  published: "bg-success-light text-success border-success/25",
  declined: "bg-muted text-secondary border-line",
  failed: "bg-error-light text-error border-error/25",
};

export const ACTION_LABELS: Record<ContentCalendarAction, string> = {
  hold: "Hold",
  release: "Release",
  reschedule: "Reschedule",
  cancel: "Cancel post",
  approve: "Approve",
  decline: "Decline",
  hide: "Hide",
  restore: "Restore",
};

/** Actions that change what members see, so they are shown in red. */
export const DANGER: ReadonlySet<ContentCalendarAction> = new Set(["cancel", "decline", "hide"]);

/** Day key (YYYY-MM-DD) in the viewer's zone. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A local date from a day key (midnight in the viewer's zone). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return addDays(d, -offset);
}

/** The 6×7 (or 5×7) days a month grid shows, Monday first. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = addDays(startOfWeek(last), 7);
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The [from, to) range a view needs, as ISO instants. */
export function rangeFor(view: CalendarView, anchor: Date): { from: string; to: string } | null {
  if (view === "list") return null;
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
  }
  const days = monthGrid(anchor);
  return { from: days[0]!.toISOString(), to: addDays(days[days.length - 1]!, 1).toISOString() };
}

/** Items grouped by the day (viewer's zone) the calendar places them on. */
export function byDay(items: ContentCalendarItem[]): Map<string, ContentCalendarItem[]> {
  const map = new Map<string, ContentCalendarItem[]>();
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  for (const list of map.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return map;
}

/** "14:05" in the viewer's zone. */
export function timeOf(iso: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "Mon 24 Nov 2026, 14:05 UTC", for tooltips. */
export function utcTitle(iso: string, tag: string): string {
  return `${new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso))} UTC`;
}

/** The query string for the page's URL (defaults left out). */
export function searchFor(p: CalendarParams): string {
  const qs = new URLSearchParams();
  if (p.view !== "month") qs.set("view", p.view);
  if (p.date) qs.set("date", p.date);
  if (p.state !== "all") qs.set("state", p.state);
  if (p.source !== "claude") qs.set("source", p.source);
  if (p.q) qs.set("q", p.q);
  if (p.author) qs.set("author", p.author);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const VIEWS: CalendarView[] = ["month", "week", "list"];
const STATE_VALUES: StateFilter[] = ["all", ...STATES.map((s) => s.value)];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the page's URL parameters, ignoring anything unexpected. */
export function parseParams(raw: Record<string, string | string[] | undefined>): CalendarParams {
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const view = one("view");
  const state = one("state");
  const date = one("date");
  const author = one("author");
  return {
    view: VIEWS.includes(view as CalendarView) ? (view as CalendarView) : "month",
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    state: STATE_VALUES.includes(state as StateFilter) ? (state as StateFilter) : "all",
    source: one("source") === "all" ? "all" : "claude",
    q: (one("q") ?? "").slice(0, 100),
    author: author && UUID.test(author) ? author : null,
  };
}
