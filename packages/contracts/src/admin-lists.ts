import { z } from "zod";
import { BulkIds } from "./admin-ops.js";
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
