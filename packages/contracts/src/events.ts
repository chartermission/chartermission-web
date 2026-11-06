import { z } from "zod";
import { ChapterRef, CountryCode, ExternalUrl, IsoDateTime, MemberRef, OrganisationRef, QueryBoolean, TimeZone } from "./common.js";
import { PublishStatus } from "./listings.js";

/*
 * Events (spec 4.9 EVT): online, in-person and hybrid events hosted by a member, a chapter or
 * (later) an organisation, with internal registration (capacity, waitlist, reminders,
 * attendance) or an external registration link, plus review before public listing.
 *
 * Conventions for every endpoint below:
 *  - All timestamps are ISO 8601 UTC strings. Every event also carries an IANA `timezone`;
 *    clients render the time in the viewer's zone and the event's own zone
 *    ("18:00 WAT · 21:00 your time").
 *  - `:idOrSlug` accepts the event UUID or its slug; `:id` accepts the UUID only.
 *  - Lists are Page<T> with opaque cursors (CursorQuery limits: 1–50, default 20).
 *  - Errors use the API-wide ApiError codes: VALIDATION_FAILED (with `fields`), NOT_FOUND
 *    (also for events the viewer may not see, e.g. someone else's draft), FORBIDDEN,
 *    CONFLICT (already registered, event full without waitlist, wrong lifecycle state),
 *    PRECONDITION_FAILED (registration closed: deadline passed, event started, cancelled,
 *    external mode, not published).
 *
 * Endpoints (member API, /api/v1):
 *  GET    /events                          Page<EventSummary>; EventsQuery. Public listing: status
 *                                          published or archived only (cancelled ones included, flagged).
 *                                          Featured events are not lifted; ask with featured=true.
 *  GET    /events/calendar?month=YYYY-MM   EventsCalendar; EventsCalendarQuery (same filters as /events).
 *  GET    /events/categories               EventCategory[] in position order.
 *  GET    /events/host-options             EventHostOptions — what the viewer may create events as.
 *  GET    /events/:idOrSlug                EventDetail. Drafts and other non-public states only for
 *                                          canManage viewers (host, creator, event.manage); else NOT_FOUND.
 *  POST   /events                          CreateEventInput → EventDetail with status "draft". Needs
 *                                          event.create (see EVENT_PERMISSIONS for who has it).
 *  PATCH  /events/:id                      UpdateEventInput → EventDetail. canManage only. Allowed in
 *                                          draft, changes_requested, rejected (edits keep the state) and
 *                                          published (goes live at once; a change to startsAt, endsAt,
 *                                          venue or online access notifies registrants: event_updated).
 *                                          Not allowed once cancelled or past (CONFLICT).
 *  POST   /events/:id/submit               SubmitForReviewInput → EventDetail. From draft /
 *                                          changes_requested / rejected / unpublished. Viewers with
 *                                          event.publish go straight to "published" (event_published
 *                                          analytics); others go to "pending_review". Full validation
 *                                          (eventInputIssues) runs here; startsAt must be in the future.
 *  POST   /events/:id/cancel               CancelEventInput → EventDetail. Published, not yet ended.
 *                                          Sets cancelledAt/cancelReason (status stays published),
 *                                          notifies every registered and waitlisted member
 *                                          (event_cancelled, in-app + email), event_cancelled analytics.
 *  DELETE /events/:id                      204. Drafts (and never-published rejected events) only;
 *                                          otherwise CONFLICT — cancel instead.
 *  POST   /events/:id/registrations        RegisterInput → RegistrationResult. Internal mode only.
 *                                          In one transaction with the event row locked
 *                                          (SELECT … FOR UPDATE): registered while registeredCount <
 *                                          capacity (or capacity null), else waitlisted if
 *                                          waitlistEnabled, else CONFLICT "This event is full".
 *                                          Re-registering after cancelling reuses the row. Sends
 *                                          event_registration_confirmed (email with .ics link) or
 *                                          event_waitlisted; event_registered analytics.
 *  DELETE /events/:id/registrations/me     → RegistrationResult (status "cancelled"). Allowed until
 *                                          startsAt. Cancelling a registered seat promotes the first
 *                                          waitlisted member in the same transaction
 *                                          (event_waitlist_promoted, in-app + email).
 *  GET    /events/:id/registrations        Page<RegistrationView>; HostRegistrationsQuery. canManage only.
 *  PUT    /events/:id/registrations/:userId/attendance
 *                                          MarkAttendanceInput → RegistrationView. canManage only, once
 *                                          the event has started; registered ↔ attended.
 *  GET    /events/:id.ics                  text/calendar (one VEVENT, UTC times, TZID noted, URL to
 *                                          the event page). Never contains the online join link.
 *                                          Public for public events.
 *  GET    /me/events                       Page<EventSummary>; MyEventsQuery. role=registered: events
 *                                          where the viewer is registered/waitlisted/attended;
 *                                          role=hosting: events the viewer created or hosts, any status.
 *
 * Admin API (admin audience, needs event.review unless noted):
 *  GET    /admin/events                    Page<AdminEventRow>; AdminEventsQuery (review queue: oldest first).
 *  POST   /admin/events/:id/review         ReviewDecisionInput → AdminEventRow. pending_review only.
 *                                          approve → published (event_published analytics,
 *                                          event_review_approved); request_changes → changes_requested
 *                                          (event_review_changes_requested); reject → rejected
 *                                          (event_review_rejected). Notes go to the host. Audited.
 *  POST   /admin/events/:id/unpublish      UnpublishEventInput → AdminEventRow. published → unpublished
 *                                          (hidden from lists; registrants keep their rows). Audited.
 *  PUT    /admin/events/:id/featured       FeatureEventInput → AdminEventRow. Needs event.feature.
 */

/* ---------------- Constants ---------------- */

export const EVENT_TITLE_MAX_CHARS = 140;
export const EVENT_SUMMARY_MAX_CHARS = 280;
export const EVENT_DESCRIPTION_MAX_CHARS = 10000;
export const EVENT_MAX_SPEAKERS = 20;
export const EVENT_MAX_AGENDA_ITEMS = 40;
/** Largest capacity an internal-registration event may set. */
export const EVENT_MAX_CAPACITY = 10000;
/** Longest an event may run (multi-day conferences fit; anything longer is a programme). */
export const EVENT_MAX_DURATION_DAYS = 14;
/** Reminders before start for registered members, in minutes (24 h and 1 h; CM-EVT-07). */
export const EVENT_REMINDER_OFFSETS = [24 * 60, 60] as const;
export type EventReminderOffset = (typeof EVENT_REMINDER_OFFSETS)[number];
/** The online join link is shown to registered members from this many hours before start. */
export const JOIN_LINK_LEAD_HOURS = 24;
/** Calendar day cells carry at most this many event summaries (the rest are counted). */
export const CALENDAR_DAY_PREVIEW = 3;

/**
 * Permission strings (apps/api/src/core/permissions.ts) used by Events. The session's
 * `permissions` array carries them, so clients can show or hide actions.
 *  - event.create: create, edit and submit own events. Roles: event_host, chapter_lead,
 *    platform_admin, super_admin. A chapter_lead role is scoped (user_roles.scope_type =
 *    'chapter', scope_id = chapter id) and may host only for that chapter; the permission alone
 *    lets them host as themselves.
 *  - event.publish: submit goes straight to published (no review). platform_admin, super_admin.
 *  - event.review: admin Events section, review queue, approve/request changes/reject,
 *    unpublish. moderator, platform_admin, super_admin.
 *  - event.feature: feature an event. platform_admin, super_admin.
 *  - event.manage: act as host on any event (edit, cancel, registrations, attendance).
 *    platform_admin, super_admin.
 */
export const EVENT_PERMISSIONS = {
  create: "event.create",
  publish: "event.publish",
  review: "event.review",
  feature: "event.feature",
  manage: "event.manage",
} as const;

/* ---------------- Enumerations ---------------- */

export const EventFormat = z.enum(["online", "in_person", "hybrid"]);
export type EventFormat = z.infer<typeof EventFormat>;

export const EVENT_FORMAT_LABELS: Record<EventFormat, string> = { online: "Online", in_person: "In person", hybrid: "Hybrid" };

/**
 * Publishing lifecycle (same states as other listings):
 *  draft → (submit) → pending_review → published | changes_requested | rejected;
 *  changes_requested / rejected → (edit, submit) → pending_review;
 *  published → (admin) unpublished → (submit) pending_review or published;
 *  archived: an ended event retired by the maintenance job — still public, shown under Past.
 * Clients decide Upcoming/Past from `past`, not from status. A called-off event keeps status
 * "published" and has `cancelledAt` set.
 */
export const EventStatus = PublishStatus;
export type EventStatus = PublishStatus;

/** internal: registration on Charter Mission; external: the host's own link (externalUrl). */
export const RegistrationMode = z.enum(["internal", "external"]);
export type RegistrationMode = z.infer<typeof RegistrationMode>;

/**
 * registered (holds a seat) → cancelled (by the member, until start) or attended (host marks it
 * after start); waitlisted → registered (promoted) or cancelled.
 */
export const RegistrationStatus = z.enum(["registered", "waitlisted", "cancelled", "attended"]);
export type RegistrationStatus = z.infer<typeof RegistrationStatus>;

/* ---------------- Shapes ---------------- */

/** Who hosts the event. Only member and chapter hosts can be created this round. */
export const EventHost = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member"), member: MemberRef }),
  z.object({ type: z.literal("chapter"), chapter: ChapterRef }),
  z.object({ type: z.literal("organisation"), organisation: OrganisationRef }),
]);
export type EventHost = z.infer<typeof EventHost>;

/** Reference values from GET /events/categories (seeded: Conference, Workshop, Webinar …). */
export const EventCategory = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() });
export type EventCategory = z.infer<typeof EventCategory>;

export const EventSpeaker = z.object({
  name: z.string(),
  /** Role, e.g. "Head of Trade Policy". */
  title: z.string().nullable(),
  organisation: z.string().nullable(),
  /** Set when the speaker is a member; their name/avatar come from the profile. */
  member: MemberRef.nullable(),
  /** The member's avatar when linked, otherwise null (no separate speaker photos this round). */
  avatarUrl: z.string().nullable(),
});
export type EventSpeaker = z.infer<typeof EventSpeaker>;

export const AgendaItem = z.object({
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  /** Free-text names, matching EventSpeaker.name where possible. */
  speakerNames: z.array(z.string()),
});
export type AgendaItem = z.infer<typeof AgendaItem>;

/** Where the event is, for cards: e.g. { city: "Accra", countryCode: "GH", label: "Accra, Ghana & online" }. */
export const EventLocation = z.object({
  city: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** "Online" | "Accra, Ghana" | "Accra, Ghana & online". */
  label: z.string(),
  /** Compact form for narrow lists: "Online" | "Accra" | "Accra & online". */
  shortLabel: z.string(),
});
export type EventLocation = z.infer<typeof EventLocation>;

export const EventViewerState = z.object({
  /** The viewer's registration, including "cancelled" if they cancelled; null if never registered. */
  status: RegistrationStatus.nullable(),
  /** 1-based place in the waitlist when status is "waitlisted", else null. */
  waitlistPosition: z.number().int().nullable(),
  /** Host, creator or event.manage: may edit, cancel, see registrations and mark attendance. */
  canManage: z.boolean(),
  /** The viewer bookmarked the event (bookmarks targetType "event"). */
  saved: z.boolean(),
});
export type EventViewerState = z.infer<typeof EventViewerState>;

/** Card / list shape (event list, calendar cells, home widgets, my events). */
export const EventSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  /** One or two sentences for cards (≤ 280 chars). */
  summary: z.string(),
  category: EventCategory.nullable(),
  format: EventFormat,
  startsAt: z.string(),
  endsAt: z.string(),
  /** IANA zone the event is organised in, e.g. "Africa/Lagos". */
  timezone: z.string(),
  location: EventLocation,
  host: EventHost,
  coverUrl: z.string().nullable(),
  /** Null = unlimited (also always null for external registration). */
  capacity: z.number().int().nullable(),
  /** Members holding a seat (registered + attended). 0 for external events. */
  registeredCount: z.number().int(),
  waitlistCount: z.number().int(),
  /** capacity - registeredCount, never below 0; null when capacity is unlimited or external. */
  spotsLeft: z.number().int().nullable(),
  registrationMode: RegistrationMode,
  /**
   * The viewer could act now: internal mode → published, not cancelled, before the deadline (or
   * start when no deadline), and a seat or the waitlist is available; external mode → published,
   * not cancelled, before the deadline/start (the link opens externalUrl).
   */
  registrationOpen: z.boolean(),
  /** Registration deadline (≤ startsAt) or null = until start. */
  deadline: z.string().nullable(),
  status: EventStatus,
  cancelledAt: z.string().nullable(),
  featured: z.boolean(),
  /** endsAt is in the past. */
  past: z.boolean(),
  viewer: EventViewerState,
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventVenue = z.object({
  name: z.string(),
  address: z.string().nullable(),
  city: z.string(),
  countryCode: z.string(),
  mapUrl: z.string().nullable(),
});
export type EventVenue = z.infer<typeof EventVenue>;

/**
 * Online access. joinUrl is decrypted and returned only when the viewer may join:
 *  - canManage viewers: always, until the event ends;
 *  - members with status registered/attended: from JOIN_LINK_LEAD_HOURS before start until end.
 * Otherwise joinUrl is null. joinAvailableAt is set (startsAt - 24 h) for a registered viewer
 * who is too early, else null. After the event ends joinUrl is null for everyone (CM-EVT-08).
 */
export const EventOnlineAccess = z.object({
  /** e.g. "Zoom", "Google Meet", "YouTube Live". */
  platform: z.string(),
  joinUrl: z.string().nullable(),
  joinAvailableAt: z.string().nullable(),
});
export type EventOnlineAccess = z.infer<typeof EventOnlineAccess>;

/** Review state, only for canManage viewers (null for everyone else). */
export const EventReviewState = z.object({
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  /** The reviewer's note for changes_requested / rejected (or the unpublish reason). */
  note: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type EventReviewState = z.infer<typeof EventReviewState>;

/** GET /events/:idOrSlug */
export const EventDetail = EventSummary.extend({
  /** Plain text with blank-line paragraphs and "## " headings, like article bodies. Kept after the event. */
  description: z.string(),
  speakers: z.array(EventSpeaker),
  /** Ordered by startsAt; preserved after the event (CM-EVT-08). */
  agenda: z.array(AgendaItem),
  /** Present for in_person and hybrid. */
  venue: EventVenue.nullable(),
  /** Present for online and hybrid. */
  online: EventOnlineAccess.nullable(),
  /** Registration link for external mode, else null. Shown even after the deadline; hidden once past. */
  externalUrl: z.string().nullable(),
  waitlistEnabled: z.boolean(),
  cancelReason: z.string().nullable(),
  review: EventReviewState.nullable(),
  /** Up to 3 upcoming public events in the same category or from the same host. */
  related: z.array(EventSummary).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDetail = z.infer<typeof EventDetail>;

/* ---------------- Queries ---------------- */

/**
 * GET /events. Filters combine with AND.
 *  - when: upcoming = endsAt ≥ now, sorted startsAt asc; past = endsAt < now, startsAt desc;
 *    all = both, startsAt asc.
 *  - from/to: events overlapping [from, to) (calendar month or "this week"); combine with when=all.
 *  - country: venue country; for online-only events the host chapter's country (events.country_code).
 *  - chapter: chapter id or slug of a chapter host, or "mine" = chapters the viewer follows.
 *  - host: member id or handle of a member host.
 *  - mine: registered = viewer's status registered/waitlisted/attended; hosting = viewer is host/creator
 *    (public statuses only here; use /me/events for drafts).
 *  - q: title/summary search (case-insensitive).
 */
export const EventsQuery = z.object({
  when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  format: EventFormat.optional(),
  /** Category slug. */
  category: z.string().trim().max(60).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  chapter: z.string().trim().max(80).optional(),
  host: z.string().trim().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  mine: z.enum(["registered", "hosting"]).optional(),
  featured: QueryBoolean.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EventsQuery = z.infer<typeof EventsQuery>;

/**
 * GET /events/calendar?month=YYYY-MM&tz= — month grid data. Events are bucketed by their start
 * day in `tz` (the viewer's IANA zone, default UTC). Same filters as /events except when/from/to/cursor.
 */
export const EventsCalendarQuery = EventsQuery.omit({ when: true, from: true, to: true, cursor: true, limit: true }).extend({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11"),
  tz: TimeZone.default("UTC"),
});
export type EventsCalendarQuery = z.infer<typeof EventsCalendarQuery>;

export const EventsCalendarDay = z.object({
  /** YYYY-MM-DD in the requested tz. Only days with at least one event are listed. */
  date: z.string(),
  count: z.number().int(),
  /** First CALENDAR_DAY_PREVIEW events of the day by start time. */
  events: z.array(EventSummary),
});
export type EventsCalendarDay = z.infer<typeof EventsCalendarDay>;

export const EventsCalendar = z.object({
  month: z.string(),
  tz: z.string(),
  days: z.array(EventsCalendarDay),
  total: z.number().int(),
});
export type EventsCalendar = z.infer<typeof EventsCalendar>;

/** GET /me/events?role=&when= */
export const MyEventsQuery = z.object({
  role: z.enum(["registered", "hosting"]).default("registered"),
  when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  /** role=hosting only: one lifecycle state. */
  status: EventStatus.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MyEventsQuery = z.infer<typeof MyEventsQuery>;

/** GET /events/host-options — empty `chapters` and canHostAsMember=false means the viewer cannot create events. */
export const EventHostOptions = z.object({
  /** Has event.create. */
  canHostAsMember: z.boolean(),
  /** Chapters the viewer leads (scoped chapter_lead role); all chapters for event.manage. */
  chapters: z.array(ChapterRef),
  /** Has event.publish: submit publishes immediately. */
  canPublishDirectly: z.boolean(),
});
export type EventHostOptions = z.infer<typeof EventHostOptions>;

/* ---------------- Writing events ---------------- */

/** Host as chosen in the form. "member" = the creator (staff with event.manage may name another member). */
export const EventHostInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member"), memberId: z.string().uuid().optional() }),
  z.object({ type: z.literal("chapter"), chapterId: z.string().uuid() }),
]);
export type EventHostInput = z.infer<typeof EventHostInput>;

export const EventSpeakerInput = z.object({
  name: z.string().trim().min(1, "Add the speaker’s name").max(100),
  title: z.string().trim().max(120).optional(),
  organisation: z.string().trim().max(120).optional(),
  /** Link a member; their profile avatar is used. */
  memberId: z.string().uuid().optional(),
});
export type EventSpeakerInput = z.infer<typeof EventSpeakerInput>;

export const AgendaItemInput = z.object({
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.optional(),
  title: z.string().trim().min(1, "Add a title").max(140),
  description: z.string().trim().max(1000).optional(),
  speakerNames: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
});
export type AgendaItemInput = z.infer<typeof AgendaItemInput>;

export const EventVenueInput = z.object({
  name: z.string().trim().min(1, "Add the venue name").max(140),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().min(1, "Add the city").max(80),
  countryCode: CountryCode,
  mapUrl: ExternalUrl.optional(),
});
export type EventVenueInput = z.infer<typeof EventVenueInput>;

export const EventOnlineInput = z.object({
  platform: z.string().trim().min(1, "Say where it happens, e.g. Zoom").max(60),
  /** Stored encrypted (AES-256-GCM, apps/api/src/common/crypto.ts). */
  url: ExternalUrl,
});
export type EventOnlineInput = z.infer<typeof EventOnlineInput>;

const EventCapacity = z
  .number()
  .int("Capacity must be a whole number")
  .min(1, "Capacity must be at least 1")
  .max(EVENT_MAX_CAPACITY, `Capacity can be up to ${EVENT_MAX_CAPACITY.toLocaleString("en")}`);

/** The editable fields of an event, all present (create) — PATCH sends a subset. */
export const EventFields = z.object({
  title: z.string().trim().min(5, "Give the event a title").max(EVENT_TITLE_MAX_CHARS),
  summary: z.string().trim().min(10, "Add a one-line summary").max(EVENT_SUMMARY_MAX_CHARS),
  description: z.string().trim().max(EVENT_DESCRIPTION_MAX_CHARS).default(""),
  categoryId: z.string().uuid().nullable().default(null),
  format: EventFormat,
  host: EventHostInput,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  timezone: TimeZone,
  venue: EventVenueInput.nullable().default(null),
  online: EventOnlineInput.nullable().default(null),
  registrationMode: RegistrationMode.default("internal"),
  /** Required for external mode, must be null for internal. */
  externalUrl: ExternalUrl.nullable().default(null),
  /** Null = unlimited. Must be null for external mode. */
  capacity: EventCapacity.nullable().default(null),
  /** Only meaningful with internal mode and a capacity. */
  waitlistEnabled: z.boolean().default(true),
  /** Null = registration open until startsAt. */
  registrationDeadline: IsoDateTime.nullable().default(null),
  /** An uploaded file with purpose "event_cover" owned by the creator. */
  coverFileId: z.string().uuid().nullable().default(null),
  speakers: z.array(EventSpeakerInput).max(EVENT_MAX_SPEAKERS, `Up to ${EVENT_MAX_SPEAKERS} speakers`).default([]),
  agenda: z.array(AgendaItemInput).max(EVENT_MAX_AGENDA_ITEMS, `Up to ${EVENT_MAX_AGENDA_ITEMS} agenda items`).default([]),
});
export type EventFields = z.infer<typeof EventFields>;

type Issue = { path: (string | number)[]; message: string };

/**
 * Cross-field rules. CreateEventInput applies them; for PATCH the API merges the stored event with
 * the input and calls this on the result (returning VALIDATION_FAILED with the same field paths).
 */
export function eventInputIssues(v: EventFields): Issue[] {
  const issues: Issue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const start = Date.parse(v.startsAt);
  const end = Date.parse(v.endsAt);
  if (!(end > start)) add(["endsAt"], "The event must end after it starts");
  else if (end - start > EVENT_MAX_DURATION_DAYS * 86_400_000) add(["endsAt"], `Events can run for up to ${EVENT_MAX_DURATION_DAYS} days`);
  if (v.registrationDeadline && Date.parse(v.registrationDeadline) > start) {
    add(["registrationDeadline"], "Registration must close before the event starts");
  }
  if (v.format !== "in_person" && !v.online) add(["online"], "Add the online access link");
  if (v.format === "in_person" && v.online) add(["online"], "In-person events have no online link");
  if (v.format !== "online" && !v.venue) add(["venue"], "Add the venue city and country");
  if (v.format === "online" && v.venue) add(["venue"], "Online events have no venue");
  if (v.registrationMode === "external") {
    if (!v.externalUrl) add(["externalUrl"], "Add the registration link");
    if (v.capacity !== null) add(["capacity"], "Capacity is managed on the external registration site");
  } else if (v.externalUrl) {
    add(["externalUrl"], "Only external registration uses a link");
  }
  v.agenda.forEach((item, i) => {
    const s = Date.parse(item.startsAt);
    const e = item.endsAt ? Date.parse(item.endsAt) : s;
    if (s < start || s > end || e > end) add(["agenda", i, "startsAt"], "Agenda items must fall within the event");
    if (item.endsAt && e < s) add(["agenda", i, "endsAt"], "An agenda item must end after it starts");
  });
  return issues;
}

/** POST /events — creates a draft. */
export const CreateEventInput = EventFields.superRefine((v, ctx) => {
  for (const issue of eventInputIssues(v)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

/**
 * PATCH /events/:id — any subset; arrays and nested objects (venue, online, speakers, agenda)
 * replace the stored value whole. `host` cannot change after the event was first published.
 */
export const UpdateEventInput = z
  .object({
    title: EventFields.shape.title,
    summary: EventFields.shape.summary,
    description: z.string().trim().max(EVENT_DESCRIPTION_MAX_CHARS),
    categoryId: z.string().uuid().nullable(),
    format: EventFormat,
    host: EventHostInput,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    timezone: TimeZone,
    venue: EventVenueInput.nullable(),
    online: EventOnlineInput.nullable(),
    registrationMode: RegistrationMode,
    externalUrl: ExternalUrl.nullable(),
    capacity: EventCapacity.nullable(),
    waitlistEnabled: z.boolean(),
    registrationDeadline: IsoDateTime.nullable(),
    coverFileId: z.string().uuid().nullable(),
    speakers: z.array(EventSpeakerInput).max(EVENT_MAX_SPEAKERS),
    agenda: z.array(AgendaItemInput).max(EVENT_MAX_AGENDA_ITEMS),
  })
  .partial();
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;

/** POST /events/:id/submit — an optional note for the reviewer. */
export const SubmitForReviewInput = z.object({ note: z.string().trim().max(500).optional() });
export type SubmitForReviewInput = z.infer<typeof SubmitForReviewInput>;

/** POST /events/:id/cancel — the reason is sent to registrants. */
export const CancelEventInput = z.object({ reason: z.string().trim().min(5, "Tell registrants why").max(500) });
export type CancelEventInput = z.infer<typeof CancelEventInput>;

/* ---------------- Registrations ---------------- */

/** POST /events/:id/registrations — nothing to send yet (questions come later). */
export const RegisterInput = z.object({}).strict();
export type RegisterInput = z.infer<typeof RegisterInput>;

/** Response of register / cancel registration. */
export const RegistrationResult = z.object({
  status: RegistrationStatus,
  waitlistPosition: z.number().int().nullable(),
  event: EventSummary,
});
export type RegistrationResult = z.infer<typeof RegistrationResult>;

/** A row in the host's registrations list. */
export const RegistrationView = z.object({
  member: MemberRef,
  status: RegistrationStatus,
  registeredAt: z.string(),
  /** 1-based current waitlist place for waitlisted rows, else null. */
  position: z.number().int().nullable(),
  promotedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  attendedAt: z.string().nullable(),
});
export type RegistrationView = z.infer<typeof RegistrationView>;

/** GET /events/:id/registrations — default: everyone except cancelled; waitlist in position order. */
export const HostRegistrationsQuery = z.object({
  status: z.enum(["active", "registered", "waitlisted", "attended", "cancelled", "all"]).default("active"),
  /** Member name or handle. */
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type HostRegistrationsQuery = z.infer<typeof HostRegistrationsQuery>;

/** PUT /events/:id/registrations/:userId/attendance */
export const MarkAttendanceInput = z.object({ attended: z.boolean() });
export type MarkAttendanceInput = z.infer<typeof MarkAttendanceInput>;

/* ---------------- Admin ---------------- */

/** GET /admin/events */
export const AdminEventsQuery = z.object({
  /** "queue" = pending_review. Default queue. */
  status: z.union([EventStatus, z.enum(["queue", "all", "cancelled"])]).default("queue"),
  q: z.string().trim().max(100).optional(),
  /** Only items submitted (queue) or created at least this many hours ago, for "waiting > 48 h". */
  olderThanHours: z.coerce.number().int().min(1).max(24 * 90).optional(),
  sort: z.enum(["oldest", "newest", "starts_soon"]).default("oldest"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminEventsQuery = z.infer<typeof AdminEventsQuery>;

export const AdminEventRow = EventSummary.extend({
  createdBy: MemberRef,
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: MemberRef.nullable(),
  reviewNote: z.string().nullable(),
  /** The host's note from submit. */
  submitNote: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminEventRow = z.infer<typeof AdminEventRow>;

/** POST /admin/events/:id/review — a note is required for request_changes and reject. */
export const ReviewDecisionInput = z
  .object({
    decision: z.enum(["approve", "request_changes", "reject"]),
    note: z.string().trim().max(1000).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "approve" && v.note.length < 5) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Explain what the host should change (at least 5 characters)" });
    }
  });
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInput>;

/** POST /admin/events/:id/unpublish */
export const UnpublishEventInput = z.object({ reason: z.string().trim().min(5).max(500) });
export type UnpublishEventInput = z.infer<typeof UnpublishEventInput>;

/** PUT /admin/events/:id/featured */
export const FeatureEventInput = z.object({ featured: z.boolean() });
export type FeatureEventInput = z.infer<typeof FeatureEventInput>;
