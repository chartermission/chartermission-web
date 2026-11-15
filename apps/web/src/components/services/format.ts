import type { ConsultationMode, ServiceHost, ServiceHostInput, ServiceInput, ServiceView } from "@chartermission/contracts";
import type { IconName } from "@chartermission/ui";
import type { Translate } from "@/i18n/translate";

/*
 * Small helpers shared by the services and bookings UI. Plain module (no "use client"), so server
 * pages can call them too.
 */

export const serviceHref = (id: string) => `/services/${id}`;

/** The write-side host for a service's host. */
export function hostInputOf(host: ServiceHost): ServiceHostInput {
  return host.type === "page" ? { type: "page", pageId: host.page.id } : { type: "member" };
}

export function hostName(host: ServiceHost): string {
  return host.type === "page" ? host.page.name : host.member.name;
}

export function hostHref(host: ServiceHost): string {
  return host.type === "page" ? `/pages/${host.page.slug}` : `/${host.member.handle}`;
}

/** A stable key for a host, for effects and React keys. */
export function hostKey(host: ServiceHost | ServiceHostInput): string {
  if (host.type === "page") return `page:${"page" in host ? host.page.id : host.pageId}`;
  return "member";
}

/** Query string for GET/PUT /availability. */
export function availabilityQuery(host: ServiceHostInput): { host: "member" | "page"; pageId?: string } {
  return host.type === "page" ? { host: "page", pageId: host.pageId } : { host: "member" };
}

/** Where the host sets their hours: the member's settings, or the page's own availability screen. */
export function availabilityHref(host: ServiceHost): string {
  return host.type === "page" ? `/pages/${host.page.slug}/availability` : "/settings/availability";
}

/** Bookings for this host, seen from the host's side. */
export function hostBookingsHref(host: ServiceHost): string {
  return host.type === "page" ? `/bookings?role=host&page=${host.page.id}` : "/bookings?role=host";
}

export const modeIcon: Record<ConsultationMode, IconName> = {
  video: "video",
  phone: "mic",
  in_person: "map-pin",
};

/** "30 min" (lengths are offered in minutes, up to 120). */
export function durationLabel(t: Translate, minutes: number): string {
  return t("{count} min", { count: minutes });
}

/** The full PATCH/POST body for an existing service (the API takes the whole service). */
export function toServiceInput(service: ServiceView, patch: Partial<ServiceInput> = {}): ServiceInput {
  return {
    host: hostInputOf(service.host),
    title: service.title,
    description: service.description,
    skills: service.skills,
    rateNote: service.rateNote,
    bookable: service.bookable,
    durationMinutes: service.bookable ? service.durationMinutes : null,
    mode: service.bookable ? service.mode : null,
    locationHint: service.bookable ? service.locationHint : null,
    meetingDetails: service.bookable ? service.meetingDetails : null,
    noticeHours: service.noticeHours,
    windowDays: service.windowDays,
    active: service.active,
    position: service.position,
    ...patch,
  };
}

export function sortServices(services: ServiceView[]): ServiceView[] {
  return [...services].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** Lists come back as an array; accept a paged `{ items }` body too. */
export function asServiceList(body: unknown): ServiceView[] {
  if (Array.isArray(body)) return body as ServiceView[];
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) return (body as { items: ServiceView[] }).items;
  return [];
}

/* ---------------- Calendar dates (YYYY-MM-DD) ---------------- */

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Formats a calendar date (not an instant) in the page's language: "Mon 24 Nov". */
export function formatDate(date: string, intl: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intl, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const isUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());
