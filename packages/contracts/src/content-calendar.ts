import { z } from "zod";
import { ChapterRef, MemberRef, PageRef } from "./common.js";
import { BULK_MAX } from "./admin-ops.js";
import { LinkPreview, ModerationState, PostType } from "./social.js";

/*
 * Content calendar (admin console): posts members write and schedule with Claude (the MCP
 * connector), and, when staff ask for it, every scheduled post on the platform. By default
 * ("after") scheduled posts publish on time and staff review them afterwards: they can hold,
 * reschedule or cancel a scheduled post and hide a published one. With "before" a post Claude
 * writes waits for a reviewer's approval before anyone else sees it.
 */

/** Where an item stands. */
export const ContentCalendarState = z.enum(["scheduled", "held", "awaiting_approval", "published", "declined", "failed"]);
export type ContentCalendarState = z.infer<typeof ContentCalendarState>;

export const ContentCalendarKind = z.enum(["draft", "post"]);
export type ContentCalendarKind = z.infer<typeof ContentCalendarKind>;

/** Longest date range one request may cover (a month view with its leading and trailing days). */
export const CONTENT_CALENDAR_MAX_DAYS = 62;

/** Platform setting: when Claude posts are reviewed. */
export const ClaudeContentSettings = z.object({ approval: z.enum(["after", "before"]) });
export type ClaudeContentSettings = z.infer<typeof ClaudeContentSettings>;

const IsoDate = z.string().datetime({ offset: true });

/** Filters shared by the list and the counts. */
const CalendarFilters = z.object({
  /** "claude" (default): posts written with Claude. "all": every scheduled post on the platform too. */
  source: z.enum(["claude", "all"]).default("claude"),
  /** Words in the post, or the author's name or handle. */
  q: z.string().trim().max(100).optional(),
  author: z.string().uuid().optional(),
  chapter: z.string().uuid().optional(),
  /** Posts published (or to be published) as this page. */
  page: z.string().uuid().optional(),
});

/** GET /admin/content-calendar/items */
export const ContentCalendarQuery = CalendarFilters.extend({
  /** Range on the item's date (scheduled time, or when it was published); both or neither. */
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  state: z.enum(["all", ...ContentCalendarState.options]).default("all"),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).superRefine((v, ctx) => {
  if (!!v.from !== !!v.to) ctx.addIssue({ code: "custom", path: [v.from ? "to" : "from"], message: "Give both a start and an end date" });
  if (v.from && v.to) {
    const span = new Date(v.to).getTime() - new Date(v.from).getTime();
    if (span < 0) ctx.addIssue({ code: "custom", path: ["to"], message: "The end date must be after the start date" });
    else if (span > CONTENT_CALENDAR_MAX_DAYS * 24 * 3600_000) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `Choose a range of up to ${CONTENT_CALENDAR_MAX_DAYS} days` });
    }
  }
});
export type ContentCalendarQuery = z.infer<typeof ContentCalendarQuery>;

/** GET /admin/content-calendar/counts */
export const ContentCalendarCountsQuery = CalendarFilters.extend({
  /** The month the per-day counts cover, YYYY-MM (default: this month in `tz`). */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM").optional(),
  /** IANA time zone the days are counted in (default UTC). */
  tz: z.string().max(64).default("UTC"),
});
export type ContentCalendarCountsQuery = z.infer<typeof ContentCalendarCountsQuery>;

export type ContentCalendarCounts = {
  /** Every item matching the filters, by state (all dates). */
  states: Record<ContentCalendarState | "all", number>;
  month: string;
  tz: string;
  /** Days of the month that have items, with how many in each state. */
  days: { date: string; total: number; states: Partial<Record<ContentCalendarState, number>> }[];
  /** The current review mode, so every viewer sees it. */
  approval: ClaudeContentSettings["approval"];
};

export const ContentReviewInfo = z.object({
  state: z.enum(["pending", "approved", "declined"]),
  by: MemberRef.nullable(),
  at: z.string().nullable(),
  note: z.string().nullable(),
});
export type ContentReviewInfo = z.infer<typeof ContentReviewInfo>;

export type ContentCalendarItem = {
  kind: ContentCalendarKind;
  id: string;
  /** `${kind}:${id}`, the id bulk actions report. */
  key: string;
  author: MemberRef;
  /** Set when it is (to be) published as a page. */
  page: PageRef | null;
  chapter: ChapterRef | null;
  excerpt: string;
  type: z.infer<typeof PostType>;
  media: { count: number; thumbnailUrl: string | null };
  visibility: "members" | "public";
  state: ContentCalendarState;
  /** Published posts: whether moderators hid or removed it. */
  moderationState: z.infer<typeof ModerationState> | null;
  source: "web" | "claude";
  /** The Claude client that wrote it ("Claude"), when known. */
  claudeClient: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** The date the calendar places it on: scheduled time, publication, or when it was decided. */
  at: string;
  review: ContentReviewInfo | null;
  /** Why a scheduled post could not be published (failed). */
  lastError: string | null;
  /** Link on the member site once it is live. */
  postUrl: string | null;
};

export type ContentCalendarPage = { items: ContentCalendarItem[]; nextCursor: string | null };

export type ContentCalendarHistoryEntry = {
  id: string;
  /** Audit action, e.g. content_calendar.held or moderation.hide. */
  action: string;
  actor: MemberRef | null;
  at: string;
  note: string | null;
  /** For reschedules: the new time. */
  scheduledFor: string | null;
};

export type ContentCalendarDetail = ContentCalendarItem & {
  body: string;
  attachments: { id: string; kind: "image" | "document" | "video"; url: string | null; name: string | null; alt: string | null }[];
  poll: { question: string; options: { label: string; votes: number | null }[]; durationHours: number | null; closesAt: string | null; totalVotes: number | null } | null;
  article: { title: string | null; subtitle: string | null } | null;
  celebration: { category: string | null; headline: string | null; organisation: string | null } | null;
  request: { title: string | null; category: string | null; location: string | null; remote: boolean | null; skills: string[] } | null;
  linkPreview: z.infer<typeof LinkPreview> | null;
  linkUrl: string | null;
  /** What Claude did with it (from the connector's activity log), newest first. */
  claudeActivity: { id: string; action: string; clientName: string; at: string }[];
  /** Review and moderation steps, newest first. */
  history: ContentCalendarHistoryEntry[];
  /** Actions valid for its state. */
  actions: ContentCalendarAction[];
};

export const ContentCalendarAction = z.enum(["hold", "release", "reschedule", "cancel", "approve", "decline", "hide", "restore"]);
export type ContentCalendarAction = z.infer<typeof ContentCalendarAction>;

const Note = z.string().trim().max(1000);
const RequiredNote = z.string().trim().min(5, "Write a note of at least 5 characters").max(1000);

/** POST /admin/content-calendar/{kind}/{id}/actions */
export const ContentCalendarActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hold"), note: Note.optional() }),
  z.object({ action: z.literal("release"), note: Note.optional() }),
  z.object({ action: z.literal("reschedule"), scheduledFor: IsoDate, note: Note.optional() }),
  z.object({ action: z.literal("cancel"), note: RequiredNote }),
  z.object({ action: z.literal("approve"), note: Note.optional() }),
  z.object({ action: z.literal("decline"), note: RequiredNote }),
  z.object({ action: z.literal("hide"), reason: RequiredNote }),
  z.object({ action: z.literal("restore"), reason: RequiredNote }),
]);
export type ContentCalendarActionInput = z.infer<typeof ContentCalendarActionInput>;

/** What an action returns: the item as it is now, or null when it left the calendar (cancelled). */
export type ContentCalendarActionResult = { item: ContentCalendarDetail | null };

/** POST /admin/content-calendar/bulk — ids in the result are `${kind}:${id}`. */
export const ContentCalendarBulkInput = z
  .object({
    items: z
      .array(z.object({ kind: ContentCalendarKind, id: z.string().uuid() }))
      .min(1, "Choose at least one")
      .max(BULK_MAX, `Choose up to ${BULK_MAX} at a time`),
    action: z.enum(["hold", "release", "approve", "decline", "cancel", "reschedule"]),
    note: Note.optional(),
    scheduledFor: IsoDate.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "decline" || v.action === "cancel") && (v.note ?? "").length < 5) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Write a note of at least 5 characters" });
    }
    if (v.action === "reschedule" && !v.scheduledFor) ctx.addIssue({ code: "custom", path: ["scheduledFor"], message: "Pick a new date and time" });
  });
export type ContentCalendarBulkInput = z.infer<typeof ContentCalendarBulkInput>;

/** How the member app labels a post or scheduled post that is under review. */
export const CONTENT_REVIEW_LABELS = {
  held: "Paused by the Charter Mission team",
  pending: "Waiting for approval",
} as const;
