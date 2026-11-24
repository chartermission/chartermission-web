import { z } from "zod";
import { BulkIds } from "./admin-ops.js";
import { ChapterRef, CountryCode, GroupRef, MemberRef, PageRef } from "./common.js";
import type { AuditEntry, ReportReason, ReportStatus } from "./moderation.js";
import { Relationship } from "./profile.js";

/*
 * Groups: communities members join around a shared interest (decided Nov 2026).
 *  - Owned by a member, a page (its admins run it with the group's own admins) or a chapter (its
 *    team runs it likewise).
 *  - Public: anyone (signed-in members; visitors too) sees the group and its posts; members join at once.
 *  - Private: listed in search and on profiles (name, description, member count, admins), but posts
 *    and the member list are seen only by members. People ask to join (answering the join question,
 *    if any) or are invited; owner, admins and moderators approve.
 *  - Group posts show in the group and in the home feed of its members.
 *  - Any member can create a group unless staff limit it (GroupsSettings.whoCanCreate).
 */

export const GROUP_NAME_MAX = 80;
export const GROUP_ABOUT_MAX = 2000;
export const GROUP_RULES_MAX = 3000;
/** How many groups one member may own (member-run groups only). */
export const GROUPS_OWNED_MAX = 20;

export const GroupVisibility = z.enum(["public", "private"]);
export type GroupVisibility = z.infer<typeof GroupVisibility>;

export const GroupOwnerType = z.enum(["member", "page", "chapter"]);
export type GroupOwnerType = z.infer<typeof GroupOwnerType>;

/** owner > admin > moderator > member. Moderators review posts and requests; admins also manage members, roles and settings. */
export const GroupRole = z.enum(["owner", "admin", "moderator", "member"]);
export type GroupRole = z.infer<typeof GroupRole>;

export const GroupMemberStatus = z.enum(["active", "pending", "invited", "banned"]);
export type GroupMemberStatus = z.infer<typeof GroupMemberStatus>;

export const GroupStatus = z.enum(["active", "suspended", "archived"]);
export type GroupStatus = z.infer<typeof GroupStatus>;

export const GroupPostPermission = z.enum(["members", "admins"]);
export type GroupPostPermission = z.infer<typeof GroupPostPermission>;

export const GroupSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, "Use 3 to 60 lowercase letters, numbers and hyphens");

const Hashtag = z
  .string()
  .trim()
  .transform((v) => v.replace(/^#/, ""))
  .pipe(z.string().regex(/^[\p{L}\p{N}_]{2,50}$/u, "Use letters, numbers and _ in hashtags"));

/** POST /groups */
export const GroupInput = z.object({
  name: z.string().trim().min(3, "Give the group a name of at least 3 characters").max(GROUP_NAME_MAX),
  /** Defaults to one made from the name. Can't be changed later. */
  slug: GroupSlug.optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  about: z.string().trim().max(GROUP_ABOUT_MAX).nullable().optional(),
  rules: z.string().trim().max(GROUP_RULES_MAX).nullable().optional(),
  visibility: GroupVisibility,
  /** Who runs it. "page" needs pageId (a live page the creator manages); "chapter" needs chapterId (creator on its team, or staff). */
  ownerType: GroupOwnerType.default("member"),
  pageId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  postPermission: GroupPostPermission.default("members"),
  postApproval: z.boolean().default(false),
  /** Private groups: a question people answer when asking to join. */
  joinQuestion: z.string().trim().max(300).nullable().optional(),
  countryCode: CountryCode.nullable().optional(),
  hashtags: z.array(Hashtag).max(5).default([]),
  /** Clean group_logo / group_cover uploads owned by the caller; null removes the picture. */
  logoFileId: z.string().uuid().nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});
export type GroupInput = z.infer<typeof GroupInput>;

/** PATCH /groups/{slug} (owner and admins). Owner type, page and chapter can't change; the slug stays. */
export const GroupUpdateInput = GroupInput.omit({ slug: true, ownerType: true, pageId: true, chapterId: true })
  .partial()
  .extend({
    /** Owner only: archive (read-only, still listed) or bring back. */
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type GroupUpdateInput = z.infer<typeof GroupUpdateInput>;

/** GET /groups */
export const GroupsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** mine: groups the viewer is in (any role); managed: ones they run; invited / requested: waiting on them / on the group. */
  scope: z.enum(["all", "mine", "managed", "invited", "requested", "suggested"]).default("all"),
  visibility: GroupVisibility.optional(),
  ownerType: GroupOwnerType.optional(),
  /** Groups run by this page (id or slug). */
  page: z.string().trim().min(1).max(80).optional(),
  /** Groups run by this chapter (id or slug). */
  chapter: z.string().trim().min(1).max(80).optional(),
  country: z.string().length(2).optional(),
  sort: z.enum(["active", "members", "newest", "name"]).default("active"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type GroupsQuery = z.infer<typeof GroupsQuery>;

/** The viewer's place in a group. role is null unless status is active (or they run it through its page/chapter). */
export const GroupMembership = z.object({
  status: z.union([GroupMemberStatus, z.literal("none")]),
  role: GroupRole.nullable(),
  /** Runs it through the page or chapter that owns it (page admin, chapter team). */
  viaOwner: z.boolean(),
});
export type GroupMembership = z.infer<typeof GroupMembership>;

/** Cards on /groups, chapter and page profiles, search. Private groups show this much to anyone. */
export const GroupSummary = GroupRef.extend({
  tagline: z.string().nullable(),
  coverUrl: z.string().nullable(),
  ownerType: GroupOwnerType,
  page: PageRef.nullable(),
  chapter: ChapterRef.nullable(),
  country: z.object({ code: z.string(), name: z.string() }).nullable(),
  memberCount: z.number().int(),
  /** Posts in the last 7 days (activity hint); null for viewers who can't see the group's posts. */
  postsThisWeek: z.number().int().nullable(),
  /** Up to 3 members the viewer is connected with (null when the viewer may not see members). */
  connections: z.array(MemberRef).nullable(),
  status: GroupStatus,
  featured: z.boolean(),
  membership: GroupMembership,
  createdAt: z.string(),
});
export type GroupSummary = z.infer<typeof GroupSummary>;

/** What the viewer may do in the group (drives the buttons). */
export const GroupAbilities = z.object({
  seeContent: z.boolean(),
  post: z.boolean(),
  /** Join at once (public), ask (private), accept an invitation, or none. */
  join: z.enum(["join", "ask", "accept", "none"]),
  leave: z.boolean(),
  invite: z.boolean(),
  /** Approve requests and posts, remove posts, mute members. */
  moderate: z.boolean(),
  /** Members, roles, bans, settings. */
  manage: z.boolean(),
  /** Delete the group, transfer ownership. */
  own: z.boolean(),
});
export type GroupAbilities = z.infer<typeof GroupAbilities>;

/** GET /groups/{slug} */
export const GroupDetail = GroupSummary.extend({
  about: z.string().nullable(),
  rules: z.string().nullable(),
  joinQuestion: z.string().nullable(),
  postPermission: GroupPostPermission,
  postApproval: z.boolean(),
  hashtags: z.array(z.string()),
  /** Published posts; null for viewers who can't see the group's posts (private groups they aren't in, suspended groups). */
  postCount: z.number().int().nullable(),
  /** Owner, admins and moderators: always shown, even for private groups. */
  admins: z.array(z.object({ member: MemberRef, role: GroupRole })),
  createdBy: MemberRef.nullable(),
  /** Shown to the group's admins when staff suspended it. */
  statusNote: z.string().nullable(),
  /** For admins and moderators: people waiting to join, posts waiting for approval. */
  pending: z.object({ requests: z.number().int(), posts: z.number().int() }).nullable(),
  abilities: GroupAbilities,
});
export type GroupDetail = z.infer<typeof GroupDetail>;

/** GET /groups/{slug}/members */
export const GroupMembersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** active (default, anyone who may see content); pending / invited / banned: moderators and up. */
  status: GroupMemberStatus.default("active"),
  role: GroupRole.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type GroupMembersQuery = z.infer<typeof GroupMembersQuery>;

export const GroupMemberView = z.object({
  member: MemberRef,
  role: GroupRole,
  status: GroupMemberStatus,
  /** Their answer to the join question (pending requests, seen by moderators and up). */
  requestAnswer: z.string().nullable(),
  invitedBy: MemberRef.nullable(),
  joinedAt: z.string().nullable(),
  /** When they asked, were invited or were banned. */
  since: z.string(),
  /** The viewer's relationship with them, for Connect / Follow in the members list (optional: without it the list links to profiles). */
  relationship: Relationship.optional(),
});
export type GroupMemberView = z.infer<typeof GroupMemberView>;

/** POST /groups/{slug}/join — join a public group, ask to join a private one, or accept an invitation. */
export const GroupJoinInput = z.object({ answer: z.string().trim().max(1000).optional() });
export type GroupJoinInput = z.infer<typeof GroupJoinInput>;

/** POST /groups/{slug}/invitations — members invite people (admins, or any member when allowed); invited people accept with /join. */
export const GroupInviteInput = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(50) });
export type GroupInviteInput = z.infer<typeof GroupInviteInput>;

/**
 * POST /groups/{slug}/members/{memberId} — moderators approve or decline requests; admins change roles,
 * remove, ban and unban (owner role only by transfer, by the owner).
 */
export const GroupMemberAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("decline") }),
  z.object({ action: z.literal("cancel_invite") }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("ban") }),
  z.object({ action: z.literal("unban") }),
  z.object({ action: z.literal("set_role"), role: z.enum(["admin", "moderator", "member"]) }),
  z.object({ action: z.literal("transfer_ownership") }),
]);
export type GroupMemberAction = z.infer<typeof GroupMemberAction>;

/** POST /groups/{slug}/members/bulk — the same actions for several people (approve/decline requests, remove, ban). */
export const GroupMembersBulkInput = z.object({
  ids: BulkIds,
  action: z.enum(["approve", "decline", "remove", "ban", "cancel_invite"]),
});
export type GroupMembersBulkInput = z.infer<typeof GroupMembersBulkInput>;

/** POST /groups/{slug}/posts/{postId} — moderators: approve or decline a waiting post, remove one from the group, pin or unpin. */
export const GroupPostAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("decline"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("remove"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("pin") }),
  z.object({ action: z.literal("unpin") }),
]);
export type GroupPostAction = z.infer<typeof GroupPostAction>;

/** GET /groups/{slug}/posts/pending (moderators and up): posts waiting for approval; returns Page<PostView>. */

/* ------------------------------ Admin console ------------------------------ */

/** GET /admin/groups (moderation.view: moderators look, groups.manage acts) */
export const AdminGroupsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "suspended", "archived", "deleted"]).default("all"),
  visibility: GroupVisibility.optional(),
  ownerType: GroupOwnerType.optional(),
  chapter: z.string().uuid().optional(),
  featured: z.enum(["yes", "no"]).optional(),
  /** Groups with open reports (on the group or its posts). */
  reported: z.enum(["yes"]).optional(),
  sort: z.enum(["newest", "members", "activity", "name", "reports"]).default("newest"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminGroupsQuery = z.infer<typeof AdminGroupsQuery>;

export type AdminGroupRow = {
  id: string;
  slug: string;
  name: string;
  visibility: GroupVisibility;
  ownerType: GroupOwnerType;
  page: PageRef | null;
  chapter: ChapterRef | null;
  createdBy: MemberRef | null;
  /** Member-run groups only: page and chapter groups have no member owner. */
  owner: MemberRef | null;
  /** The owner's and creator's emails: only for staff with groups.manage (moderators see names only). */
  ownerEmail?: string | null;
  createdByEmail?: string | null;
  status: GroupStatus | "deleted";
  statusNote: string | null;
  featured: boolean;
  memberCount: number;
  pendingRequests: number;
  postCount: number;
  postsLast30Days: number;
  openReports: number;
  lastPostAt: string | null;
  createdAt: string;
  /** Added with the console's Groups page (optional so older callers still type-check). */
  logoUrl?: string | null;
  tagline?: string | null;
  deletedAt?: string | null;
};

export type AdminGroupsPage = {
  items: AdminGroupRow[];
  nextCursor: string | null;
  counts: { all: number; active: number; suspended: number; archived: number; deleted: number; private: number; public: number };
};

/** One of the last posts in a group, as staff see it (private groups' posts included, marked private). */
export type AdminGroupPost = {
  id: string;
  author: MemberRef | null;
  preview: string;
  /** A private group's post: only its members see it on the member site. */
  private: boolean;
  status: string;
  moderationState: "visible" | "hidden" | "removed";
  deleted: boolean;
  createdAt: string;
  href: string;
};

/** An open report on the group or one of its posts. */
export type AdminGroupReport = {
  /** The report id (open it in the moderation queue: /moderation?report={id}). */
  id: string;
  target: { type: "group" | "post"; id: string; preview: string };
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  reporter: MemberRef | null;
  createdAt: string;
};

/** GET /admin/groups/{id} (moderation.view) */
export type AdminGroupDetail = AdminGroupRow & {
  tagline: string | null;
  about: string | null;
  rules: string | null;
  joinQuestion: string | null;
  postPermission: GroupPostPermission;
  postApproval: boolean;
  hashtags: string[];
  country: { code: string; name: string } | null;
  coverUrl: string | null;
  /** Owner, admins and moderators of the group (people who run it through its page or chapter are not listed). */
  admins: { member: MemberRef; role: GroupRole }[];
  /** The last 20 posts, newest first. */
  recentPosts: AdminGroupPost[];
  /** Open reports on the group and its posts, newest first (up to 20). */
  reports: AdminGroupReport[];
  /** Audit entries about the group, newest first (up to 30). */
  history: AuditEntry[];
};

/** GET /admin/groups/{id}/members (moderation.view) and /admin/groups/{id}/members/export.csv (members.manage or groups.manage; no cursor or limit). */
export const AdminGroupMembersQuery = z.object({
  /** Name, @handle or email. */
  q: z.string().trim().max(100).optional(),
  /** Every status when left out. */
  status: GroupMemberStatus.optional(),
  role: GroupRole.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminGroupMembersQuery = z.infer<typeof AdminGroupMembersQuery>;

export type AdminGroupMember = GroupMemberView & { email: string };

/** POST /admin/groups/{id} (groups.manage) — staff actions on one group. */
export const AdminGroupAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), note: z.string().trim().min(3, "Say why, for the group's admins").max(500) }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("feature") }),
  z.object({ action: z.literal("unfeature") }),
  z.object({ action: z.literal("delete"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("set_owner"), memberId: z.string().uuid() }),
]);
export type AdminGroupAction = z.infer<typeof AdminGroupAction>;

/** POST /admin/groups/bulk (groups.manage) → BulkResult. suspend needs a note. */
export const AdminGroupsBulkInput = z.object({
  ids: BulkIds,
  action: z.enum(["suspend", "restore", "feature", "unfeature", "delete"]),
  note: z.string().trim().max(500).optional(),
});
export type AdminGroupsBulkInput = z.infer<typeof AdminGroupsBulkInput>;

/** GET/PUT /admin/settings/groups (settings.manage) — who can create groups and how many one member may own. */
export const GroupsSettings = z.object({
  whoCanCreate: z.enum(["everyone", "verified", "staff"]),
  maxOwnedPerMember: z.number().int().min(1).max(GROUPS_OWNED_MAX),
});
export type GroupsSettings = z.infer<typeof GroupsSettings>;
