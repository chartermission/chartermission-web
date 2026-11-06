import { EventFormat } from "@chartermission/contracts";

/** /events URL state. Everything is optional so a bare /events is the default view. */
export type EventFilters = {
  when: "upcoming" | "past";
  view: "list" | "calendar";
  format: EventFormat | null;
  category: string | null;
  country: string | null;
  chapter: string | null;
  q: string | null;
  /** Calendar month "YYYY-MM" (calendar view). */
  month: string | null;
  /** Selected calendar day "YYYY-MM-DD" (calendar view). */
  day: string | null;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || null;
const SLUG = /^[a-z0-9-]{1,80}$/;

export function parseEventFilters(params: Raw): EventFilters {
  const format = EventFormat.safeParse(one(params.format)).data ?? null;
  const country = one(params.country)?.toUpperCase() ?? null;
  const month = one(params.month);
  const day = one(params.day);
  const category = one(params.category);
  const chapter = one(params.chapter);
  return {
    when: one(params.when) === "past" ? "past" : "upcoming",
    view: one(params.view) === "calendar" ? "calendar" : "list",
    format,
    category: category && SLUG.test(category) ? category : null,
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    chapter: chapter && SLUG.test(chapter) ? chapter : null,
    q: one(params.q)?.slice(0, 100) ?? null,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
  };
}

/** Query-string for the URL (defaults omitted). */
export function eventFiltersQuery(f: EventFilters): string {
  const params = new URLSearchParams();
  if (f.view === "calendar") params.set("view", "calendar");
  if (f.when === "past" && f.view === "list") params.set("when", "past");
  if (f.format) params.set("format", f.format);
  if (f.category) params.set("category", f.category);
  if (f.country) params.set("country", f.country);
  if (f.chapter) params.set("chapter", f.chapter);
  if (f.q) params.set("q", f.q);
  if (f.view === "calendar" && f.month) params.set("month", f.month);
  if (f.view === "calendar" && f.day) params.set("day", f.day);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** The API filters shared by GET /events and GET /events/calendar. */
export function apiFilters(f: EventFilters) {
  return {
    format: f.format ?? undefined,
    category: f.category ?? undefined,
    country: f.country ?? undefined,
    chapter: f.chapter ?? undefined,
    q: f.q ?? undefined,
  };
}

export const hasNarrowingFilters = (f: EventFilters) => Boolean(f.format || f.category || f.country || f.chapter || f.q);

export const EVENTS_PAGE = 12;
