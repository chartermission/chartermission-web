import { z } from "zod";
import { MemberRef, PageRef, TimeZone } from "./common.js";

/*
 * Services, consultations and products.
 *
 *  - A service is offered by a member (on their profile) or by a page. It describes what they do
 *    and, when `bookable`, it is a free consultation people can book straight away in an open slot.
 *  - Availability is per host (one member, or one page shared by its admins): weekly hours in the
 *    host's time zone, plus days off. Slots are worked out from availability, the service's length,
 *    the host's other bookings, notice and how far ahead booking is open.
 *  - Consultations are free for now. They happen on the host's own link or at their place: the
 *    meeting details are only shown to the booker once booked.
 *  - Pages also list products (a catalogue with prices as text). Visitors enquire about a product or
 *    a service; the page's admins see enquiries and reply in Messages.
 *
 * Times are ISO 8601 UTC strings; dates are YYYY-MM-DD; clock times are HH:MM (24 h).
 */

export const SERVICE_TITLE_MAX = 100;
export const SERVICE_DESCRIPTION_MAX = 2000;
export const SERVICE_RATE_NOTE_MAX = 120;
export const SERVICE_MAX_SKILLS = 6;
/** Services one member or one page can list. */
export const SERVICES_MAX_PER_HOST = 12;
export const CONSULTATION_DURATIONS = [15, 20, 30, 45, 60, 90, 120] as const;
export const BOOKING_NOTE_MAX = 1000;
export const BOOKING_CANCEL_REASON_MAX = 500;
/** Reminders before a booking, in minutes (same as events). */
export const BOOKING_REMINDER_OFFSETS = [1440, 60] as const;
/** Bookings one member can make per day, across all hosts. */
export const BOOKINGS_PER_DAY = 10;
/** Upcoming bookings one member can hold with the same host. */
export const BOOKINGS_OPEN_PER_HOST = 3;

export const PRODUCT_NAME_MAX = 100;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const PRODUCT_PRICE_MAX = 60;
export const PRODUCT_MAX_IMAGES = 4;
export const PRODUCTS_MAX_PER_PAGE = 50;
export const ENQUIRY_MIN = 10;
export const ENQUIRY_MAX = 2000;

const HttpUrl = z
  .string()
  .trim()
  .max(500)
  .url("Enter a full link, starting with https://")
  .refine((v) => /^https?:\/\//i.test(v), "Enter a full link, starting with https://");

/* ------------------------------------------------------------------ hosts */

/** Who offers a service: a member, or a page (run by its admins). */
export const ServiceHost = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member"), member: MemberRef }),
  z.object({ type: z.literal("page"), page: PageRef }),
]);
export type ServiceHost = z.infer<typeof ServiceHost>;

/** Which host a write is for. Members act for themselves, or for a page they manage. */
export const ServiceHostInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member") }),
  z.object({ type: z.literal("page"), pageId: z.string().uuid() }),
]);
export type ServiceHostInput = z.infer<typeof ServiceHostInput>;

/** Query-string form of a host (GET /availability?host=member | host=page&pageId=…). */
export const ServiceHostQuery = z.object({ host: z.enum(["member", "page"]).default("member"), pageId: z.string().uuid().optional() });
export type ServiceHostQuery = z.infer<typeof ServiceHostQuery>;

/* --------------------------------------------------------------- services */

/** How a consultation happens. The details (link, number, address) go in `meetingDetails`. */
export const ConsultationMode = z.enum(["video", "phone", "in_person"]);
export type ConsultationMode = z.infer<typeof ConsultationMode>;
export const CONSULTATION_MODE_LABELS: Record<ConsultationMode, string> = {
  video: "Video call",
  phone: "Phone call",
  in_person: "In person",
};

export const ServiceView = z.object({
  id: z.string().uuid(),
  host: ServiceHost,
  title: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  /** Free text shown with the service, e.g. "Projects quoted after a first call". Consultations themselves are free. */
  rateNote: z.string().nullable(),
  /** People can book it as a free consultation. */
  bookable: z.boolean(),
  /** For bookable services. */
  durationMinutes: z.number().int().nullable(),
  mode: ConsultationMode.nullable(),
  /** Short public hint about the place, e.g. "Google Meet" or "Accra, Osu". */
  locationHint: z.string().nullable(),
  /** The link, number or address. Only for the host and for people with a booking. */
  meetingDetails: z.string().nullable(),
  /** Hours of notice needed before a slot. */
  noticeHours: z.number().int(),
  /** How many days ahead people can book. */
  windowDays: z.number().int(),
  /** Hidden services are only shown to the host. */
  active: z.boolean(),
  position: z.number().int(),
  /** Upcoming confirmed bookings (host only). */
  upcomingBookings: z.number().int().optional(),
  viewer: z.object({ canManage: z.boolean(), canBook: z.boolean(), cantBookReason: z.string().nullable() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServiceView = z.infer<typeof ServiceView>;

/** POST /services · PATCH /services/{id} (host only). */
export const ServiceInput = z
  .object({
    host: ServiceHostInput.default({ type: "member" }),
    title: z.string().trim().min(3, "Give the service a name").max(SERVICE_TITLE_MAX),
    description: z.string().trim().min(20, "Describe it in a sentence or two (at least 20 characters)").max(SERVICE_DESCRIPTION_MAX),
    skills: z.array(z.string().trim().min(1).max(40)).max(SERVICE_MAX_SKILLS, `Up to ${SERVICE_MAX_SKILLS} skills`).default([]),
    rateNote: z.string().trim().max(SERVICE_RATE_NOTE_MAX).nullable().default(null),
    bookable: z.boolean().default(false),
    durationMinutes: z
      .number()
      .int()
      .refine((n) => (CONSULTATION_DURATIONS as readonly number[]).includes(n), "Choose a length")
      .nullable()
      .default(null),
    mode: ConsultationMode.nullable().default(null),
    locationHint: z.string().trim().max(80).nullable().default(null),
    meetingDetails: z.string().trim().max(500).nullable().default(null),
    noticeHours: z.number().int().min(0).max(168).default(12),
    windowDays: z.number().int().min(1).max(90).default(30),
    active: z.boolean().default(true),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.bookable) return;
    if (v.durationMinutes == null) ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Choose how long a consultation lasts" });
    if (v.mode == null) ctx.addIssue({ code: "custom", path: ["mode"], message: "Choose how you meet" });
    if (!v.meetingDetails) ctx.addIssue({ code: "custom", path: ["meetingDetails"], message: "Add the link, number or address people get once they book" });
  });
export type ServiceInput = z.infer<typeof ServiceInput>;
/** PATCH body: same fields; the host can't change. Send the whole service (the form always does). */
export const ServiceUpdateInput = ServiceInput;
export type ServiceUpdateInput = z.infer<typeof ServiceUpdateInput>;

/* ----------------------------------------------------------- availability */

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

/** One stretch of time on a weekday. weekday: 0 = Sunday … 6 = Saturday. */
export const AvailabilityWindow = z
  .object({ weekday: z.number().int().min(0).max(6), start: ClockTime, end: ClockTime })
  .refine((w) => w.start < w.end, { message: "End after the start", path: ["end"] });
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>;

/** GET /availability?host=…  ·  PUT /availability?host=… (the host). */
export const AvailabilityView = z.object({
  timezone: z.string(),
  windows: z.array(AvailabilityWindow),
  /** Days with no slots at all (holidays, travel). */
  daysOff: z.array(IsoDate),
  /** Least time between two consultations, in minutes. */
  bufferMinutes: z.number().int(),
  /** Most consultations in one day (null: no limit). */
  maxPerDay: z.number().int().nullable(),
  /** Set once the host has saved availability; before that nothing is bookable. */
  configured: z.boolean(),
});
export type AvailabilityView = z.infer<typeof AvailabilityView>;

export const AvailabilityInput = z
  .object({
    timezone: TimeZone,
    windows: z.array(AvailabilityWindow).max(35),
    daysOff: z.array(IsoDate).max(120).default([]),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
    maxPerDay: z.number().int().min(1).max(24).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    for (let d = 0; d < 7; d++) {
      const day = v.windows
        .map((w, i) => ({ ...w, i }))
        .filter((w) => w.weekday === d)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let k = 1; k < day.length; k++) {
        if (day[k]!.start < day[k - 1]!.end) ctx.addIssue({ code: "custom", path: ["windows", day[k]!.i, "start"], message: "Times overlap" });
      }
    }
  });
export type AvailabilityInput = z.infer<typeof AvailabilityInput>;

/** GET /services/{id}/slots?from=YYYY-MM-DD&days=14&tz=Area/City — open slots, grouped by day in `tz`. */
export const SlotsQuery = z.object({
  from: IsoDate.optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
  /** The viewer's time zone (defaults to the host's). */
  tz: TimeZone.optional(),
});
export type SlotsQuery = z.infer<typeof SlotsQuery>;

export const SlotsView = z.object({
  /** The zone the days below are grouped in. */
  timezone: z.string(),
  hostTimezone: z.string(),
  durationMinutes: z.number().int(),
  days: z.array(z.object({ date: IsoDate, slots: z.array(z.object({ startsAt: z.string(), endsAt: z.string() })) })),
  /** Earliest day with a slot after this range, or null. */
  nextAvailable: IsoDate.nullable(),
});
export type SlotsView = z.infer<typeof SlotsView>;

/* --------------------------------------------------------------- bookings */

export const BookingStatus = z.enum(["confirmed", "cancelled"]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const BookingView = z.object({
  id: z.string().uuid(),
  service: z.object({ id: z.string().uuid(), title: z.string(), durationMinutes: z.number().int(), mode: ConsultationMode }),
  host: ServiceHost,
  booker: MemberRef,
  startsAt: z.string(),
  endsAt: z.string(),
  hostTimezone: z.string(),
  status: BookingStatus,
  /** What the booker wants to talk about. */
  note: z.string().nullable(),
  /** The link, number or address (both sides). */
  meetingDetails: z.string().nullable(),
  locationHint: z.string().nullable(),
  cancelledBy: z.enum(["booker", "host"]).nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  /** Ended (endsAt in the past). */
  past: z.boolean(),
  viewer: z.object({ role: z.enum(["booker", "host"]), canCancel: z.boolean() }),
  createdAt: z.string(),
});
export type BookingView = z.infer<typeof BookingView>;

/** POST /services/{id}/bookings (verified members; not your own service). 409 when the slot was just taken. */
export const BookingInput = z.object({
  startsAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(BOOKING_NOTE_MAX).nullable().default(null),
});
export type BookingInput = z.infer<typeof BookingInput>;

/** GET /bookings — the viewer's bookings as booker, as host (themselves), or for a page they manage. */
export const BookingsQuery = z.object({
  role: z.enum(["booker", "host"]).default("booker"),
  /** With role=host: a page the viewer manages (else the viewer's own consultations). */
  pageId: z.string().uuid().optional(),
  when: z.enum(["upcoming", "past", "cancelled"]).default("upcoming"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type BookingsQuery = z.infer<typeof BookingsQuery>;

/** POST /bookings/{id}/cancel (booker or host, before it starts). */
export const CancelBookingInput = z.object({ reason: z.string().trim().max(BOOKING_CANCEL_REASON_MAX).nullable().default(null) });
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;
/** GET /bookings/{id}/calendar.ics — the booking as a calendar file (booker or host). */

/* --------------------------------------------------------------- products */

export const ProductView = z.object({
  id: z.string().uuid(),
  page: PageRef,
  name: z.string(),
  description: z.string(),
  /** Free text, e.g. "USD 25 / kg" or "From $1,200". Null: price on request. */
  price: z.string().nullable(),
  imageUrls: z.array(z.string()),
  /** The upload ids behind imageUrls, same order (send them back as imageFileIds when editing). */
  imageFileIds: z.array(z.string().uuid()),
  /** Where to buy or read more (the page's own site). */
  link: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
});
export type ProductView = z.infer<typeof ProductView>;

/** POST /pages/{slug}/products · PATCH /pages/{slug}/products/{id} (page admins). */
export const ProductInput = z.object({
  name: z.string().trim().min(2, "Name the product").max(PRODUCT_NAME_MAX),
  description: z.string().trim().max(PRODUCT_DESCRIPTION_MAX).default(""),
  price: z.string().trim().max(PRODUCT_PRICE_MAX).nullable().default(null),
  /** Clean product_image uploads owned by the caller, in order. */
  imageFileIds: z.array(z.string().uuid()).max(PRODUCT_MAX_IMAGES, `Up to ${PRODUCT_MAX_IMAGES} pictures`).default([]),
  link: HttpUrl.nullable().default(null),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(1000).optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

/* -------------------------------------------------------------- enquiries */

export const EnquiryView = z.object({
  id: z.string().uuid(),
  page: PageRef,
  from: MemberRef,
  /** What it's about, if a product or service. */
  about: z.object({ type: z.enum(["product", "service"]), id: z.string().uuid(), title: z.string() }).nullable(),
  message: z.string(),
  status: z.enum(["new", "replied", "closed"]),
  /** The Messages conversation the reply went into. */
  conversationId: z.string().uuid().nullable(),
  repliedBy: MemberRef.nullable(),
  createdAt: z.string(),
});
export type EnquiryView = z.infer<typeof EnquiryView>;

/** POST /pages/{slug}/enquiries (verified members; not the page's own admins). */
export const EnquiryInput = z.object({
  about: z.object({ type: z.enum(["product", "service"]), id: z.string().uuid() }).nullable().default(null),
  message: z.string().trim().min(ENQUIRY_MIN, `Write at least ${ENQUIRY_MIN} characters`).max(ENQUIRY_MAX),
});
export type EnquiryInput = z.infer<typeof EnquiryInput>;

/** GET /pages/{slug}/enquiries?status=new|replied|closed|all (page admins). */
export const EnquiriesQuery = z.object({
  status: z.enum(["new", "replied", "closed", "all"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EnquiriesQuery = z.infer<typeof EnquiriesQuery>;

/**
 * POST /pages/{slug}/enquiries/{id}/reply (page admins): sends `message` to the enquirer as a
 * direct message from the admin (the conversation is opened as active, since they asked) and marks
 * the enquiry replied. Returns the enquiry with its conversationId.
 */
export const EnquiryReplyInput = z.object({ message: z.string().trim().min(1, "Write a reply").max(4000) });
export type EnquiryReplyInput = z.infer<typeof EnquiryReplyInput>;
/** POST /pages/{slug}/enquiries/{id}/close (page admins). */
