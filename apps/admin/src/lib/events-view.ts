import type { AdminEventsQuery, EventSummary, RegistrationView } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";

type Params = Record<string, string | string[] | undefined>;

/** Review queue tabs, in display order. "queue" is GET /admin/events?status=queue (pending_review). */
export const EVENT_TABS = [
  { value: "queue", label: "Pending review" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "unpublished", label: "Unpublished" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
] as const;

export type EventTab = (typeof EVENT_TABS)[number]["value"];
export type EventSort = AdminEventsQuery["sort"];

export const EVENT_SORTS: { value: EventSort; label: string }[] = [
  { value: "oldest", label: "Oldest submission first" },
  { value: "newest", label: "Newest submission first" },
  { value: "starts_soon", label: "Starting soonest" },
];

/** "Waiting longer than" filter, in hours. */
export const EVENT_AGES = [
  { value: "", label: "Any age" },
  { value: "24", label: "Waiting > 24 hours" },
  { value: "48", label: "Waiting > 48 hours" },
  { value: "168", label: "Waiting > 7 days" },
] as const;

/** Events queue view, kept in the URL so it can be shared and reloaded. */
export type EventsView = {
  tab: EventTab;
  q?: string;
  sort: EventSort;
  olderThanHours?: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEventsView(params: Params): EventsView {
  const tab = first(params.status);
  const sort = first(params.sort);
  const q = first(params.q)?.trim().slice(0, 100);
  const age = Number(first(params.age));
  return {
    tab: EVENT_TABS.some((t) => t.value === tab) ? (tab as EventTab) : "queue",
    q: q || undefined,
    sort: EVENT_SORTS.some((s) => s.value === sort) ? (sort as EventSort) : "oldest",
    olderThanHours: EVENT_AGES.some((a) => a.value !== "" && Number(a.value) === age) ? age : undefined,
  };
}

export function parseSelectedEvent(params: Params): string | null {
  const id = first(params.event);
  return id && UUID.test(id) ? id : null;
}

/** URL search string for /events; defaults are omitted. */
export function eventsSearch(v: EventsView, eventId?: string | null): string {
  const qs = new URLSearchParams();
  if (v.tab !== "queue") qs.set("status", v.tab);
  if (v.q) qs.set("q", v.q);
  if (v.sort !== "oldest") qs.set("sort", v.sort);
  if (v.olderThanHours) qs.set("age", String(v.olderThanHours));
  if (eventId) qs.set("event", eventId);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const eventsViewKey = (v: EventsView) => eventsSearch(v) || "default";

/** Query for GET /admin/events. */
export function eventsApiQuery(v: EventsView, cursor?: string | null) {
  return {
    status: v.tab,
    q: v.q,
    sort: v.sort,
    olderThanHours: v.olderThanHours,
    cursor: cursor ?? undefined,
    limit: 25,
  };
}

type StatusLike = Pick<EventSummary, "status" | "cancelledAt" | "past">;

/** Lifecycle chip for an event row or detail. A called-off event keeps status published. */
export function eventStatusChip(e: StatusLike): { label: string; tone: ChipTone } {
  if (e.cancelledAt) return { label: "Cancelled", tone: "error" };
  switch (e.status) {
    case "draft":
      return { label: "Draft", tone: "neutral" };
    case "pending_review":
      return { label: "Pending review", tone: "warning" };
    case "changes_requested":
      return { label: "Changes requested", tone: "info" };
    case "published":
      return e.past ? { label: "Published · ended", tone: "neutral" } : { label: "Published", tone: "success" };
    case "rejected":
      return { label: "Rejected", tone: "error" };
    case "unpublished":
      return { label: "Unpublished", tone: "neutral" };
    case "archived":
      return { label: "Archived", tone: "neutral" };
  }
}

/** Members can open the public page (published or archived). */
export const isPublic = (e: Pick<EventSummary, "status">) => e.status === "published" || e.status === "archived";

/** Latest registrations for the review panel; "forbidden" when the admin lacks host powers (event.manage). */
export type EventRegistrationsPreview = { items: RegistrationView[]; more: boolean } | "forbidden" | null;
