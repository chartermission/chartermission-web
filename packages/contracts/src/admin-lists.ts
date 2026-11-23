import { z } from "zod";
import { BulkIds } from "./admin-ops.js";
import { InviteKind } from "./invites.js";
import { AdminMembersFilters, AdminMembersSort, type AdminMemberRow } from "./catalogue.js";
import type { MemberRef } from "./common.js";
import type { AuditEntry } from "./moderation.js";

/* ================================ Members ================================ */

/** Changes the Members page can make to many members at once (roles, official and suspensions stay one at a time). */
export const AdminMembersBulkAction = z.enum([
  "verify",
  "unverify",
  "feature",
  "unfeature",
  "award_badge",
  "remove_badge",
  "claude_on",
  "claude_off",
]);
export type AdminMembersBulkAction = z.infer<typeof AdminMembersBulkAction>;

/** POST /admin/members/bulk (members.manage) → BulkResult. award_badge and remove_badge need badgeId. */
export const AdminMembersBulkInput = z
  .object({
    ids: BulkIds,
    action: AdminMembersBulkAction,
    badgeId: z.string().uuid().optional(),
    /** Note for the audit log, with award_badge. */
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "award_badge" || v.action === "remove_badge") && !v.badgeId)
      ctx.addIssue({ code: "custom", path: ["badgeId"], message: "Choose a badge" });
  });
export type AdminMembersBulkInput = z.infer<typeof AdminMembersBulkInput>;

/** Most rows one members CSV export holds. */
export const MEMBERS_EXPORT_MAX = 50_000;

/**
 * GET /admin/members/export.csv (members.manage): the list's filters, or `ids` (comma-separated, at
 * most 500) to export just the picked members. Columns: name, handle, email, country, status,
 * joined, email_confirmed, verified, roles, badges, two_step.
 */
export const AdminMembersExportQuery = AdminMembersFilters.extend({
  ids: z
    .string()
    .max(500 * 37)
    .transform((v) => v.split(",").map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid("Use member ids")).max(500, "Export up to 500 picked members at a time"))
    .optional(),
});
export type AdminMembersExportQuery = z.infer<typeof AdminMembersExportQuery>;

/**
 * POST /admin/members/export.csv (members.manage): the picked members as CSV, for picks too long for
 * a link. Same columns as the GET export.
 */
export const AdminMembersExportInput = z.object({
  ids: z.array(z.string().uuid("Use member ids")).min(1, "Choose at least one").max(500, "Export up to 500 picked members at a time"),
  sort: AdminMembersSort.default("newest"),
});
export type AdminMembersExportInput = z.infer<typeof AdminMembersExportInput>;

/** A report about the member that is still open. */
export type AdminMemberOpenReport = {
  id: string;
  /** What was reported: the member, or one of their posts, comments… */
  targetType: string;
  reasonCode: string;
  status: string;
  createdAt: string;
};

/** GET /admin/members/{id}/overview (members.manage): everything the member detail panel shows. */
export type AdminMemberOverview = {
  member: AdminMemberRow;
  city: string | null;
  /** Chapters they follow or hold a role in. */
  chapters: { id: string; slug: string; name: string }[];
  counts: { posts: number; connections: number; followers: number };
  /** Who invited them, when they joined through an invitation. */
  invitedBy: MemberRef | null;
  /** People who joined through their invitations: how many, and the latest ten. */
  invited: { total: number; recent: MemberRef[] };
  /** Open reports about them or their content: how many, and the latest five. */
  openReports: { total: number; recent: AdminMemberOpenReport[] };
  /** The latest ten audit entries about their account. */
  audit: AuditEntry[];
};

/* ---------------- Referrals, topics, chapters, moderation ---------------- */

/** A calendar day, YYYY-MM-DD (UTC). */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-23");

/** How far back "Top inviters" counts. */
export const ReferralPeriod = z.enum(["30d", "90d", "all"]);
export type ReferralPeriod = z.infer<typeof ReferralPeriod>;

/** Filters for the sign-ups through invitations (GET /admin/referrals and its CSV export). */
export const AdminReferralsFilters = z.object({
  /** Invitee or inviter: name, @handle or email. */
  q: z.string().trim().max(100).optional(),
  kind: InviteKind.optional(),
  /** The inviter's user id (set by picking a top inviter). */
  inviter: z.string().uuid().optional(),
  /** Joined on or after this day. */
  from: Day.optional(),
  /** Joined on or before this day. */
  to: Day.optional(),
  /** Whether the new member has confirmed their email. */
  confirmed: z.enum(["yes", "no"]).optional(),
});
export type AdminReferralsFilters = z.infer<typeof AdminReferralsFilters>;

/** GET /admin/referrals (members.manage) */
export const AdminReferralsQuery = AdminReferralsFilters.extend({
  period: ReferralPeriod.default("30d"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminReferralsQuery = z.infer<typeof AdminReferralsQuery>;

/** GET /admin/referrals/export.csv (members.manage, audited) */
export const AdminReferralsExportQuery = AdminReferralsFilters;
export type AdminReferralsExportQuery = AdminReferralsFilters;

/** POST /admin/topics/bulk (trending.manage) */
export const AdminTopicsBulkInput = z.object({
  ids: BulkIds,
  action: z.enum(["feature", "unfeature", "activate", "deactivate", "delete"]),
});
export type AdminTopicsBulkInput = z.infer<typeof AdminTopicsBulkInput>;

/** Most rows one topic import may carry (the request body is capped at 256 KB). */
export const TOPIC_IMPORT_MAX = 500;

/** One spreadsheet row of a topic import; `row` is its row number in the file (the header is row 1). */
export const AdminTopicImportRow = z.object({
  row: z.number().int().min(1),
  tag: z.string().trim().max(200),
  /** Empty leaves the description as it is. */
  description: z.string().trim().max(1000).optional(),
  /** yes / no (also true/false, 1/0); empty leaves it as it is. */
  featured: z.string().trim().max(20).optional(),
  /** active / inactive (or disabled); empty leaves it as it is (new topics start active). */
  status: z.string().trim().max(20).optional(),
});
export type AdminTopicImportRow = z.infer<typeof AdminTopicImportRow>;

/** POST /admin/topics/import (trending.manage): add or update topics from a CSV file. Returns CsvImportResult. */
export const AdminTopicsImportInput = z.object({
  rows: z.array(AdminTopicImportRow).min(1, "The file has no rows").max(TOPIC_IMPORT_MAX, `Import up to ${TOPIC_IMPORT_MAX} topics at a time`),
  dryRun: z.boolean().default(false),
});
export type AdminTopicsImportInput = z.infer<typeof AdminTopicsImportInput>;

/** POST /admin/chapters/bulk (chapters.admin). posts_* set the chapter's rule for members' posts. */
export const AdminChaptersBulkInput = z.object({
  ids: BulkIds,
  action: z.enum(["activate", "deactivate", "posts_direct", "posts_review", "posts_platform", "delete"]),
});
export type AdminChaptersBulkInput = z.infer<typeof AdminChaptersBulkInput>;

/**
 * POST /admin/queue/bulk (moderation.act). `ids` are report ids as listed in the queue (one per
 * reported item). Dismiss needs a reason; it is recorded for each case, as a single dismiss is.
 */
export const AdminQueueBulkInput = z
  .object({
    ids: BulkIds,
    action: z.enum(["assign", "unassign", "dismiss"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "dismiss" && (v.reason ?? "").length < 5) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason of at least 5 characters" });
    }
  });
export type AdminQueueBulkInput = z.infer<typeof AdminQueueBulkInput>;
