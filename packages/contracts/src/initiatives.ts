import { z } from "zod";
import { ChapterRef, MemberRef, PageRef } from "./common.js";
import { InitiativeStatus } from "./listings.js";

/*
 * Initiatives: projects members run across Africa and the diaspora. Hosted by a member, an
 * organisation page they manage, or a chapter they lead. Live as soon as they are created
 * (members can report them; moderators hide or remove them from the moderation queue).
 *
 * Who manages an initiative ("organisers"): its team members marked organiser (the creator is one,
 * and the lead), the admins of the host page, and the leads of the host chapter. Organisers edit
 * it, answer join requests, manage the team and post updates.
 *
 * Member API (/api/v1):
 *  GET    /initiatives                         Page<InitiativeSummary>; InitiativesQuery.
 *  GET    /initiatives/host-options            InitiativeHostOptions — pages and chapters the viewer may host as.
 *  POST   /initiatives                         InitiativeInput → 201 InitiativeDetail. Verified members.
 *  GET    /initiatives/:idOrSlug               InitiativeDetail. Hidden/removed ones only for organisers and moderators.
 *  PATCH  /initiatives/:id                     UpdateInitiativeInput → InitiativeDetail. Organisers.
 *  DELETE /initiatives/:id                     Ok. The lead, host page admins, host chapter leads.
 *  PUT    /initiatives/:id/follow              Ok. DELETE to unfollow.
 *  POST   /initiatives/:id/join-requests       JoinInitiativeInput → InitiativeDetail. Verified members, while recruiting.
 *  DELETE /initiatives/:id/join-requests/me    InitiativeDetail. Withdraws a pending request.
 *  GET    /initiatives/:id/join-requests       InitiativeJoinRequestView[] (pending first). Organisers.
 *  POST   /initiatives/:id/join-requests/:rid/decision
 *                                              DecideJoinRequestInput → InitiativeJoinRequestView. Accepting adds them to the team.
 *  PATCH  /initiatives/:id/team/:userId        UpdateTeamMemberInput → InitiativeDetail. Organisers.
 *  DELETE /initiatives/:id/team/:userId        InitiativeDetail. Organisers remove; a member can leave. The lead stays.
 *
 * Updates are posts: POST /posts with `initiativeId` (organisers only) posts an update that shows on
 * the initiative (GET /feed?initiative=slug) and in its followers' Following feed.
 */

export const INITIATIVE_STATUS_LABELS: Record<InitiativeStatus, string> = {
  idea: "Idea",
  recruiting: "Recruiting",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

/** Statuses an organiser can choose (archived is set by deleting). */
export const InitiativeEditableStatus = z.enum(["idea", "recruiting", "active", "paused", "completed"]);
export type InitiativeEditableStatus = z.infer<typeof InitiativeEditableStatus>;

export const INITIATIVE_TITLE_MAX = 120;
export const INITIATIVE_SUMMARY_MAX = 280;
export const INITIATIVE_DESCRIPTION_MAX = 6000;
export const INITIATIVE_MAX_ROLES = 10;
export const INITIATIVE_MAX_MILESTONES = 20;
export const JOIN_NOTE_MIN = 20;
export const JOIN_NOTE_MAX = 500;

/* ---------------- Shapes ---------------- */

export const InitiativeHost = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member"), member: MemberRef }),
  z.object({ type: z.literal("page"), page: PageRef }),
  z.object({ type: z.literal("chapter"), chapter: ChapterRef }),
]);
export type InitiativeHost = z.infer<typeof InitiativeHost>;

export const InitiativeTheme = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() });
export type InitiativeTheme = z.infer<typeof InitiativeTheme>;

export const InitiativeRoleView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  /** Still looking for someone (closed roles are listed for organisers only). */
  open: z.boolean(),
});
export type InitiativeRoleView = z.infer<typeof InitiativeRoleView>;

export const MilestoneState = z.enum(["done", "current", "upcoming"]);
export type MilestoneState = z.infer<typeof MilestoneState>;

export const InitiativeMilestoneView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  /** e.g. "40 farms across Ogun and Oyo". */
  note: z.string().nullable(),
  /** YYYY-MM-DD. */
  targetDate: z.string().nullable(),
  doneAt: z.string().nullable(),
  /** done; current = the first not done; upcoming = the rest. */
  state: MilestoneState,
});
export type InitiativeMilestoneView = z.infer<typeof InitiativeMilestoneView>;

export const InitiativeTeamMember = z.object({
  member: MemberRef,
  /** What they do on the initiative, e.g. "Trade advisor · Casablanca". */
  role: z.string().nullable(),
  organiser: z.boolean(),
  lead: z.boolean(),
  joinedAt: z.string(),
});
export type InitiativeTeamMember = z.infer<typeof InitiativeTeamMember>;

export const JoinRequestStatus = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export type JoinRequestStatus = z.infer<typeof JoinRequestStatus>;

export const InitiativeViewerState = z.object({
  following: z.boolean(),
  /** On the team. */
  member: z.boolean(),
  /** Organiser: edit, answer requests, manage the team, post updates. */
  canManage: z.boolean(),
  /** Can delete it (the lead, host page admins, host chapter leads). */
  canDelete: z.boolean(),
  /** The viewer's latest join request, if any. */
  request: z.object({ id: z.string().uuid(), status: JoinRequestStatus, roleId: z.string().uuid().nullable() }).nullable(),
});
export type InitiativeViewerState = z.infer<typeof InitiativeViewerState>;

export const InitiativeSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  theme: InitiativeTheme.nullable(),
  status: InitiativeStatus,
  /** Where it runs. */
  country: z.object({ code: z.string(), name: z.string() }).nullable(),
  host: InitiativeHost,
  lead: MemberRef,
  coverUrl: z.string().nullable(),
  milestones: z.object({ done: z.number().int(), total: z.number().int(), current: z.string().nullable() }),
  /** Milestones done, 0–100. */
  percent: z.number().int(),
  teamCount: z.number().int(),
  followerCount: z.number().int(),
  openRoles: z.array(z.object({ id: z.string().uuid(), title: z.string() })),
  /** Present for organisers and moderators when it is not visible to members. */
  moderationState: z.enum(["hidden", "removed"]).optional(),
  viewer: InitiativeViewerState,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InitiativeSummary = z.infer<typeof InitiativeSummary>;

export const InitiativeDetail = InitiativeSummary.extend({
  description: z.string(),
  roles: z.array(InitiativeRoleView),
  milestoneList: z.array(InitiativeMilestoneView),
  /** Lead first, then organisers, then everyone else by joining date. */
  team: z.array(InitiativeTeamMember),
  /** Countries the team members are in. */
  countryCount: z.number().int(),
  updatesCount: z.number().int(),
  /** Pending join requests, for organisers (0 for everyone else). */
  pendingRequests: z.number().int(),
  /** Open opportunities posted by the initiative's organisers. */
  related: z.array(z.object({ slug: z.string(), title: z.string(), organisation: z.string(), type: z.string() })),
});
export type InitiativeDetail = z.infer<typeof InitiativeDetail>;

export const InitiativeHostOptions = z.object({
  /** Live pages the viewer manages. */
  pages: z.array(PageRef),
  /** Chapters the viewer leads (chapter lead or ambassador). */
  chapters: z.array(ChapterRef),
});
export type InitiativeHostOptions = z.infer<typeof InitiativeHostOptions>;

export const InitiativeJoinRequestView = z.object({
  id: z.string().uuid(),
  member: MemberRef,
  role: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  skills: z.string().nullable(),
  note: z.string(),
  status: JoinRequestStatus,
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type InitiativeJoinRequestView = z.infer<typeof InitiativeJoinRequestView>;

/* ---------------- Queries ---------------- */

/** GET /initiatives. Newest activity first. */
export const InitiativesQuery = z.object({
  status: InitiativeStatus.optional(),
  /** Theme (sector) id or slug. */
  theme: z.string().max(80).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  q: z.string().trim().max(100).optional(),
  /** mine = initiatives the viewer is on the team of or follows. */
  scope: z.enum(["all", "mine"]).default("all"),
  /** Hosted by this page (id or slug) or chapter (id or slug). */
  page: z.string().max(80).optional(),
  chapter: z.string().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type InitiativesQuery = z.infer<typeof InitiativesQuery>;

/* ---------------- Writing ---------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const InitiativeHostInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member") }),
  z.object({ type: z.literal("page"), pageId: z.string().uuid() }),
  z.object({ type: z.literal("chapter"), chapterId: z.string().uuid() }),
]);
export type InitiativeHostInput = z.infer<typeof InitiativeHostInput>;

export const InitiativeRoleInput = z.object({
  /** Existing role to keep; leave out for a new one. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Name the role").max(80, "At most 80 characters"),
  description: z.string().trim().max(400, "At most 400 characters").default(""),
  skills: z.array(z.string().trim().min(1).max(40)).max(6, "Up to 6 skills").default([]),
  open: z.boolean().default(true),
});
export type InitiativeRoleInput = z.infer<typeof InitiativeRoleInput>;

export const InitiativeMilestoneInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Name the milestone").max(120, "At most 120 characters"),
  note: optionalText(200),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")
    .nullish()
    .transform((v) => v ?? null),
  done: z.boolean().default(false),
});
export type InitiativeMilestoneInput = z.infer<typeof InitiativeMilestoneInput>;

const fields = {
  title: z.string().trim().min(5, "Give it a title (at least 5 characters)").max(INITIATIVE_TITLE_MAX, `At most ${INITIATIVE_TITLE_MAX} characters`),
  summary: z
    .string()
    .trim()
    .min(20, "Sum it up in a sentence or two (at least 20 characters)")
    .max(INITIATIVE_SUMMARY_MAX, `At most ${INITIATIVE_SUMMARY_MAX} characters`),
  description: z.string().trim().max(INITIATIVE_DESCRIPTION_MAX, `At most ${INITIATIVE_DESCRIPTION_MAX.toLocaleString("en")} characters`).default(""),
  /** Theme: a sector id from GET /taxonomies. */
  themeId: z.string().uuid().nullish().transform((v) => v ?? null),
  countryCode: z.string().length(2).toUpperCase().nullish().transform((v) => v ?? null),
  status: InitiativeEditableStatus.default("recruiting"),
  /** An uploaded file with purpose "initiative_cover", or null for the brand banner. */
  coverFileId: z.string().uuid().nullish().transform((v) => v ?? null),
  roles: z.array(InitiativeRoleInput).max(INITIATIVE_MAX_ROLES, `Up to ${INITIATIVE_MAX_ROLES} roles`).default([]),
  milestones: z.array(InitiativeMilestoneInput).max(INITIATIVE_MAX_MILESTONES, `Up to ${INITIATIVE_MAX_MILESTONES} milestones`).default([]),
};

/** POST /initiatives */
export const InitiativeInput = z.object({ ...fields, host: InitiativeHostInput.default({ type: "member" }) });
export type InitiativeInput = z.input<typeof InitiativeInput>;
export type InitiativeInputParsed = z.output<typeof InitiativeInput>;

/** PATCH /initiatives/:id — any field; roles and milestones replace the lists (ids keep existing ones). The host can't change. */
export const UpdateInitiativeInput = z
  .object({
    title: fields.title.optional(),
    summary: fields.summary.optional(),
    description: z.string().trim().max(INITIATIVE_DESCRIPTION_MAX).optional(),
    themeId: z.string().uuid().nullable().optional(),
    countryCode: z.string().length(2).toUpperCase().nullable().optional(),
    status: InitiativeEditableStatus.optional(),
    coverFileId: z.string().uuid().nullable().optional(),
    roles: fields.roles.optional(),
    milestones: fields.milestones.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");
export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeInput>;

/** POST /initiatives/:id/join-requests */
export const JoinInitiativeInput = z.object({
  roleId: z.string().uuid().nullish().transform((v) => v ?? null),
  skills: optionalText(200),
  note: z
    .string()
    .trim()
    .min(JOIN_NOTE_MIN, `Write at least ${JOIN_NOTE_MIN} characters so the organisers know how you can help`)
    .max(JOIN_NOTE_MAX, `At most ${JOIN_NOTE_MAX} characters`),
});
export type JoinInitiativeInput = z.infer<typeof JoinInitiativeInput>;

/** POST /initiatives/:id/join-requests/:rid/decision */
export const DecideJoinRequestInput = z.object({
  decision: z.enum(["accept", "decline"]),
  /** Shown to the member with the decision. */
  message: optionalText(300),
});
export type DecideJoinRequestInput = z.infer<typeof DecideJoinRequestInput>;

/** PATCH /initiatives/:id/team/:userId */
export const UpdateTeamMemberInput = z
  .object({
    role: z.string().trim().max(80).nullable().optional(),
    organiser: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.organiser !== undefined, "Nothing to change");
export type UpdateTeamMemberInput = z.infer<typeof UpdateTeamMemberInput>;
