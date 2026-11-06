import { z } from "zod";
import { QueryBoolean } from "./common.js";

/*
 * Learning (spec 4.10 LRN). The catalogue is pulled from Charter Center; course content is managed
 * there and never edited here. Charter Mission stores a synced copy for browsing and search, and
 * admins curate locally only (hide / feature). No enrolment, progress or completion (CM-LRN-06).
 *
 * Endpoints (member API, /api/v1). Hidden and removed courses never appear to members (NOT_FOUND
 * on detail); paths skip hidden/removed courses and are omitted when none remain.
 *  GET  /learning                  LearningHub — the Learning page above the catalogue.
 *  GET  /courses                   Page<CourseSummary>; CoursesQuery.
 *  GET  /courses/:slug             CourseDetail.
 *  GET  /learning/paths/:slug      LearningPath.
 *  POST /courses/:id/click         204, no body. Records the first-party analytics event
 *                                  charter_center_click with the course id (CM-LRN-04). The client
 *                                  opens startUrl itself in a new tab (rel="noopener") and fires this
 *                                  without waiting (fetch keepalive); startUrl never gets tracking
 *                                  parameters added. Rate-limited per member; unknown id → 404.
 *  Saving a course reuses the bookmark endpoints:
 *    PUT    /bookmarks  { targetType: "course", targetId: <course id> } → Ok (idempotent)
 *    DELETE /bookmarks  { targetType: "course", targetId: <course id> } → Ok
 *  CourseSummary.saved reflects it; list saved courses with GET /courses?saved=true.
 *  (GET /me/bookmarks stays posts-only.)
 *
 * Admin API (admin audience, needs course.curate):
 *  GET   /admin/courses              Page<AdminCourseView>; AdminCoursesQuery. Includes hidden/removed.
 *  PATCH /admin/courses/:id          UpdateCourseCurationInput → AdminCourseView. Audited.
 *  GET   /admin/learning/sync-runs   Page<SyncRunView>, newest first (sync and link-check runs).
 *  POST  /admin/learning/sync        202 SyncRunView (status running). Queues a sync on the maintenance
 *                                    queue; CONFLICT if one is already running.
 *  POST  /admin/learning/link-check  202 SyncRunView (kind link_check). Same rules.
 *
 * Background (maintenance queue): sync every 6 h (trigger "schedule"); link check weekly. A link
 * check HEADs/GETs each course's startUrl (SSRF-safe fetcher, https only); a 2xx/3xx sets ok, two
 * consecutive failures set broken (hides Start learning) and notify admins with course.curate
 * (course_link_broken). A later success sets ok again.
 */

/** Permission strings used by Learning (apps/api/src/core/permissions.ts). */
export const LEARNING_PERMISSIONS = {
  /** Admin Learning section: hide/unhide, feature, sync history, run sync and link checks. platform_admin, super_admin. */
  curate: "course.curate",
} as const;

/** How often the scheduled sync runs, and the link-check interval. */
export const LEARNING_SYNC_INTERVAL_HOURS = 6;
export const LEARNING_LINK_CHECK_INTERVAL_DAYS = 7;
/** Consecutive failed checks before a link counts as broken. */
export const LEARNING_LINK_FAILURES_TO_BREAK = 2;
/** Featured courses shown on GET /learning. */
export const LEARNING_FEATURED_LIMIT = 6;

export const CourseLevel = z.enum(["beginner", "intermediate", "advanced"]);
export type CourseLevel = z.infer<typeof CourseLevel>;

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** BCP-47 language tag as sent by Charter Center, e.g. "en", "fr", "sw", "pt-BR". */
export const CourseLanguage = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Use a language code like en or pt-BR");
export type CourseLanguage = z.infer<typeof CourseLanguage>;

/** Duration buckets for filters: under 1 hour, 1–5 hours inclusive, over 5 hours. */
export const CourseDuration = z.enum(["under_1h", "1_5h", "over_5h"]);
export type CourseDuration = z.infer<typeof CourseDuration>;

export const COURSE_DURATION_LABELS: Record<CourseDuration, string> = {
  under_1h: "Under 1 hour",
  "1_5h": "1–5 hours",
  over_5h: "Over 5 hours",
};

/** Reference topic (seeded: Business & trade, Tech & data, Leadership, Climate, Finance, Policy, Health, Agriculture). */
export const CourseTopic = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() });
export type CourseTopic = z.infer<typeof CourseTopic>;

/** ok = last check succeeded; broken = failed LEARNING_LINK_FAILURES_TO_BREAK times in a row; unknown = never checked. */
export const LinkStatus = z.enum(["ok", "broken", "unknown"]);
export type LinkStatus = z.infer<typeof LinkStatus>;

/** Course tile / list row. */
export const CourseSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  /** Who made the course, e.g. "Charter Center" or a partner university. */
  provider: z.string(),
  level: CourseLevel,
  topics: z.array(CourseTopic),
  /** Total length in minutes (null if Charter Center does not say). */
  durationMinutes: z.number().int().nullable(),
  /** Ready-made label: "4 hours · 12 lessons", "45 min", "6 lessons". Empty when nothing is known. */
  durationLabel: z.string(),
  lessons: z.number().int().nullable(),
  /** BCP-47 tag. */
  language: z.string(),
  /** Human name of the language in English, e.g. "French". */
  languageName: z.string(),
  free: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  featured: z.boolean(),
  linkStatus: LinkStatus,
  /** The viewer bookmarked it (targetType "course"). False for signed-out viewers. */
  saved: z.boolean(),
  /** The exact Charter Center course page; null while the link is broken (hide "Start learning"). */
  startUrl: z.string().nullable(),
});
export type CourseSummary = z.infer<typeof CourseSummary>;

/** A path as listed on the hub or on a course page. */
export const LearningPathSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  level: CourseLevel.nullable(),
  /** Visible courses in the path. */
  courseCount: z.number().int(),
  /** Sum of the visible courses' durationMinutes (unknown durations count as 0). */
  totalMinutes: z.number().int(),
});
export type LearningPathSummary = z.infer<typeof LearningPathSummary>;

/** GET /courses/:slug */
export const CourseDetail = CourseSummary.extend({
  /** From the source; plain text or simple Markdown (paragraphs, lists, **bold**). Never HTML. */
  description: z.string(),
  /** Who can take it, e.g. "Open to founders of registered SMEs". Null if not stated. */
  eligibility: z.string().nullable(),
  /** How to get in, e.g. "Free Charter Center account required". Null if not stated. */
  accessConditions: z.string().nullable(),
  /** What you will learn, as bullet points. */
  outcomes: z.array(z.string()),
  /** When Charter Center last changed the course. */
  sourceUpdatedAt: z.string().nullable(),
  /** Paths that include this course. */
  paths: z.array(LearningPathSummary),
});
export type CourseDetail = z.infer<typeof CourseDetail>;

/** GET /learning/paths/:slug */
export const LearningPath = LearningPathSummary.extend({
  /** In path order; hidden/removed courses left out. */
  courses: z.array(CourseSummary),
  /** Link to the path on Charter Center, if it has one. */
  sourceUrl: z.string().nullable(),
});
export type LearningPath = z.infer<typeof LearningPath>;

/**
 * GET /courses. Filters combine with AND; topic and language accept one value each.
 *  - sort: featured = featured first then newest; newest = sourceUpdatedAt desc; title = A–Z;
 *    shortest = durationMinutes asc (unknown last).
 *  - q: title, provider and description (case-insensitive).
 *  - saved=true: only courses the viewer bookmarked (newest bookmark first unless sort is given).
 */
export const CoursesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** Topic slug. */
  topic: z.string().trim().max(60).optional(),
  level: CourseLevel.optional(),
  language: CourseLanguage.optional(),
  duration: CourseDuration.optional(),
  free: QueryBoolean.optional(),
  saved: QueryBoolean.optional(),
  sort: z.enum(["featured", "newest", "title", "shortest"]).default("featured"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type CoursesQuery = z.infer<typeof CoursesQuery>;

/** GET /learning */
export const LearningHub = z.object({
  /** Admin-featured visible courses (up to LEARNING_FEATURED_LIMIT), newest first. */
  featured: z.array(CourseSummary),
  /** All visible paths, Charter Center order. */
  paths: z.array(LearningPathSummary),
  /** Every topic with its visible course count, in position order (zero-count topics included). */
  topics: z.array(z.object({ topic: CourseTopic, courses: z.number().int() })),
  /** Languages that have at least one visible course, most courses first. */
  languages: z.array(z.object({ code: z.string(), name: z.string(), courses: z.number().int() })),
  levels: z.array(z.object({ level: CourseLevel, courses: z.number().int() })),
  /** Visible courses in total. */
  total: z.number().int(),
  /** Last successful sync, for "Updated from Charter Center 2 h ago". */
  syncedAt: z.string().nullable(),
});
export type LearningHub = z.infer<typeof LearningHub>;

/* ---------------- Admin ---------------- */

export const AdminCourseView = CourseSummary.extend({
  /** Hidden by an admin (still synced). */
  hidden: z.boolean(),
  /** No longer in the Charter Center feed; hidden from members until it reappears. */
  removedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  /** HTTP status of the last link check (null for network errors or never checked). */
  httpStatus: z.number().int().nullable(),
  /** The course URL even when broken, for admins to inspect. */
  sourceUrl: z.string(),
  externalId: z.string(),
  syncedAt: z.string(),
  sourceUpdatedAt: z.string().nullable(),
  /** charter_center_click events in the last 30 days. */
  clicks30d: z.number().int(),
});
export type AdminCourseView = z.infer<typeof AdminCourseView>;

/** GET /admin/courses */
export const AdminCoursesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "visible", "hidden", "removed", "broken", "featured"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminCoursesQuery = z.infer<typeof AdminCoursesQuery>;

/** PATCH /admin/courses/:id — local curation only; content cannot be edited. */
export const UpdateCourseCurationInput = z
  .object({ hidden: z.boolean().optional(), featured: z.boolean().optional() })
  .refine((v) => v.hidden !== undefined || v.featured !== undefined, "Nothing to change");
export type UpdateCourseCurationInput = z.infer<typeof UpdateCourseCurationInput>;

export const SyncRunKind = z.enum(["sync", "link_check"]);
export type SyncRunKind = z.infer<typeof SyncRunKind>;

export const SyncRunView = z.object({
  id: z.string().uuid(),
  kind: SyncRunKind,
  trigger: z.enum(["schedule", "admin"]),
  /** The admin who started it (trigger "admin"). */
  triggeredBy: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** sync: courses and paths created / updated / marked removed. link_check: links checked / ok / broken. */
  created: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  /** link_check only. */
  checked: z.number().int(),
  broken: z.number().int(),
  error: z.string().nullable(),
});
export type SyncRunView = z.infer<typeof SyncRunView>;

/* ---------------- Charter Center source records (ASSUMED) ---------------- */

/*
 * ASSUMPTION — to confirm with Charter Center. We assume a REST API with an API key header
 * (Authorization: Bearer <CHARTER_CENTER_API_KEY>) and snake_case JSON:
 *   GET {CHARTER_CENTER_API_URL}/courses?updated_since=<ISO>&page=<n>  → CharterCenterCoursesPage
 *   GET {CHARTER_CENTER_API_URL}/paths                                 → CharterCenterPathsPage
 * A full sync omits updated_since; a course missing from a full sync is marked removed.
 * Records are parsed loosely (unknown fields ignored) and converted in one mapping file, so
 * adapting to the real API touches only the mapper and these schemas.
 */
export const CharterCenterCourseRecord = z.looseObject({
  /** Stable id on Charter Center → courses.external_id. */
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string(),
  title: z.string(),
  provider: z.string().default("Charter Center"),
  description: z.string().default(""),
  /** Case-insensitive; anything else maps to "beginner". */
  level: z.string().default("beginner"),
  /** Topic names or slugs, mapped to our topics; unknown topics are created. */
  topics: z.array(z.string()).default([]),
  duration_minutes: z.number().int().nonnegative().nullable().default(null),
  lessons_count: z.number().int().nonnegative().nullable().default(null),
  language: z.string().default("en"),
  is_free: z.boolean().default(true),
  eligibility: z.string().nullable().default(null),
  access_conditions: z.string().nullable().default(null),
  outcomes: z.array(z.string()).default([]),
  /** The exact course page members are sent to. */
  url: z.string(),
  thumbnail_url: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
  /** "published" (default) or "archived"; archived records are treated as removed. */
  status: z.string().default("published"),
});
export type CharterCenterCourseRecord = z.infer<typeof CharterCenterCourseRecord>;

export const CharterCenterCoursesPage = z.looseObject({
  data: z.array(CharterCenterCourseRecord),
  /** Next page number, null on the last page. */
  next_page: z.number().int().nullable().default(null),
});
export type CharterCenterCoursesPage = z.infer<typeof CharterCenterCoursesPage>;

export const CharterCenterPathRecord = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string(),
  title: z.string(),
  description: z.string().default(""),
  level: z.string().nullable().default(null),
  /** Charter Center course ids in path order. */
  course_ids: z.array(z.union([z.string(), z.number()]).transform(String)),
  url: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type CharterCenterPathRecord = z.infer<typeof CharterCenterPathRecord>;

export const CharterCenterPathsPage = z.looseObject({ data: z.array(CharterCenterPathRecord) });
export type CharterCenterPathsPage = z.infer<typeof CharterCenterPathsPage>;
