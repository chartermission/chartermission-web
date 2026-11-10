import { z } from "zod";
import { MemberRef } from "./common.js";

/*
 * Reports, moderation actions, appeals, trending controls and audit log
 * (spec 4.15 ADM, 8.5, Figma admin moderation and trending screens).
 */

export const ReportStatus = z.enum(["open", "in_review", "actioned", "dismissed", "appealed", "upheld", "overturned"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const ReportTargetType = z.enum(["post", "comment", "member", "hashtag", "story", "opportunity", "message"]);
export type ReportTargetType = z.infer<typeof ReportTargetType>;

export const ReportReason = z.enum([
  "spam",
  "scam",
  "harassment",
  "hate",
  "misinformation",
  "impersonation",
  "sexual_content",
  "violence",
  "self_harm",
  "copyright",
  "trend_manipulation",
  "other",
]);
export type ReportReason = z.infer<typeof ReportReason>;

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  scam: "Scam or fraud",
  harassment: "Harassment or bullying",
  hate: "Hate or discrimination",
  misinformation: "False or misleading information",
  impersonation: "Impersonation",
  sexual_content: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Self-harm",
  copyright: "Copyright",
  trend_manipulation: "Trend manipulation",
  other: "Something else",
};

/** POST /reports */
export const CreateReportInput = z.object({
  targetType: ReportTargetType,
  targetId: z.string().min(1).max(60),
  reason: ReportReason,
  detail: z.string().trim().max(1000).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportInput>;

/** Each report shows the reporter what happens next (spec 8.5). */
export const CreateReportResponse = z.object({ id: z.string().uuid(), status: ReportStatus, nextSteps: z.string() });
export type CreateReportResponse = z.infer<typeof CreateReportResponse>;

export const ModerationActionKind = z.enum([
  "hide",
  "remove",
  "warn",
  "restrict_posting",
  "restrict_connecting",
  "suspend",
  "escalate",
  "dismiss",
  "restore",
]);
export type ModerationActionKind = z.infer<typeof ModerationActionKind>;

export const PolicyRef = z.enum([
  "guidelines.respect",
  "guidelines.harassment",
  "guidelines.spam",
  "guidelines.scams",
  "guidelines.impersonation",
  "guidelines.misinformation",
  "guidelines.discrimination",
  "guidelines.sexual_content",
  "guidelines.violence",
  "guidelines.ip",
  "guidelines.platform_integrity",
]);
export type PolicyRef = z.infer<typeof PolicyRef>;

/* ---------- Member side: actions on my account or content, appeals ---------- */

export const MyModerationAction = z.object({
  id: z.string().uuid(),
  action: ModerationActionKind,
  policyRef: PolicyRef.nullable(),
  /** Member-facing explanation in general terms. */
  summary: z.string(),
  target: z.object({ type: ReportTargetType, id: z.string(), preview: z.string().nullable() }),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  appeal: z.object({ id: z.string().uuid(), status: z.enum(["open", "in_review", "upheld", "overturned"]), decidedAt: z.string().nullable() }).nullable(),
  canAppeal: z.boolean(),
});
export type MyModerationAction = z.infer<typeof MyModerationAction>;

/** POST /appeals — one per action (CM-ADM-06). */
export const CreateAppealInput = z.object({
  actionId: z.string().uuid(),
  statement: z.string().trim().min(20, "Explain in at least 20 characters").max(2000),
});
export type CreateAppealInput = z.infer<typeof CreateAppealInput>;

/* ---------- Admin console ---------- */

export const ReportPriority = z.enum(["high", "medium", "low"]);
export type ReportPriority = z.infer<typeof ReportPriority>;

export const AdminQueueQuery = z.object({
  tab: z.enum(["reports", "hidden", "appeals"]).default("reports"),
  status: z.enum(["open", "in_review", "resolved", "all"]).default("open"),
  priority: ReportPriority.optional(),
  targetType: ReportTargetType.optional(),
  /** Targets with at least one open report for this reason. */
  reason: ReportReason.optional(),
  assignee: z.enum(["me", "unassigned", "any"]).default("any"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminQueueQuery = z.infer<typeof AdminQueueQuery>;

export const QueueStats = z.object({
  openReports: z.number().int(),
  highPriority: z.number().int(),
  medianResolveMinutes: z.number().int().nullable(),
  hiddenContent: z.number().int(),
  openAppeals: z.number().int(),
  blockedUploads: z.number().int(),
});
export type QueueStats = z.infer<typeof QueueStats>;

/** One row per reported target; repeated reports on the same target are grouped. */
export const AdminReportRow = z.object({
  id: z.string().uuid(),
  target: z.object({ type: ReportTargetType, id: z.string(), preview: z.string() }),
  reason: ReportReason,
  reportCount: z.number().int(),
  priority: ReportPriority,
  status: ReportStatus,
  createdAt: z.string(),
  assignedTo: MemberRef.nullable(),
});
export type AdminReportRow = z.infer<typeof AdminReportRow>;

export const AdminActionView = z.object({
  id: z.string().uuid(),
  action: ModerationActionKind,
  reason: z.string(),
  policyRef: PolicyRef.nullable(),
  moderator: MemberRef,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  appealStatus: z.enum(["open", "in_review", "upheld", "overturned"]).nullable(),
  /** What the action was about (so actions on the author's other content are identifiable). */
  targetType: ReportTargetType,
  targetId: z.string(),
  /** Short excerpt of the target (post or comment text, member name, #tag); null when unavailable. */
  targetPreview: z.string().nullable(),
});
export type AdminActionView = z.infer<typeof AdminActionView>;

/** GET /admin/reports/{id} — content, reporter reasons, author history and previous actions (CM-FED acceptance). */
export const AdminReportDetail = AdminReportRow.extend({
  content: z.object({
    body: z.string().nullable(),
    attachmentCount: z.number().int(),
    createdAt: z.string().nullable(),
    moderationState: z.enum(["visible", "hidden", "removed", "deleted"]).nullable(),
    href: z.string().nullable(),
  }),
  author: MemberRef.nullable(),
  reasons: z.array(z.object({ reason: ReportReason, detail: z.string().nullable(), count: z.number().int() })),
  authorHistory: z
    .object({
      joinedAt: z.string(),
      emailVerified: z.boolean(),
      hasAvatar: z.boolean(),
      previousReports: z.number().int(),
      previousActioned: z.number().int(),
      hiddenItems: z.number().int(),
      status: z.string(),
      recentActions: z.array(z.object({ action: ModerationActionKind, createdAt: z.string() })),
    })
    .nullable(),
  previousActions: z.array(AdminActionView),
});
export type AdminReportDetail = z.infer<typeof AdminReportDetail>;

/** POST /admin/reports/{id}/actions and POST /admin/moderation-actions (direct). Reason always required (CM-ADM-05). */
export const AdminActionInput = z.object({
  action: ModerationActionKind,
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(1000),
  policyRef: PolicyRef.optional(),
  /** For restrict_* and suspend; omit for indefinite suspension. */
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type AdminActionInput = z.infer<typeof AdminActionInput>;

export const DirectActionInput = AdminActionInput.extend({ targetType: ReportTargetType, targetId: z.string().min(1).max(60) });
export type DirectActionInput = z.infer<typeof DirectActionInput>;

/** POST /admin/reports/{id}/assign */
export const AssignInput = z.object({ assignee: z.enum(["me", "none"]) });

export const AdminAppealRow = z.object({
  id: z.string().uuid(),
  appellant: MemberRef,
  statement: z.string(),
  status: z.enum(["open", "in_review", "upheld", "overturned"]),
  createdAt: z.string(),
  action: AdminActionView,
  target: z.object({ type: ReportTargetType, id: z.string(), preview: z.string().nullable() }),
  /** False when the viewer took the original action (a different moderator must review). */
  canDecide: z.boolean(),
});
export type AdminAppealRow = z.infer<typeof AdminAppealRow>;

/** POST /admin/appeals/{id}/decide — "overturned" reverses the original action. */
export const AppealDecisionInput = z.object({
  decision: z.enum(["upheld", "overturned"]),
  reason: z.string().trim().min(5).max(1000),
});
export type AppealDecisionInput = z.infer<typeof AppealDecisionInput>;

/* ---------- Trending controls ---------- */

export const TrendingRules = z.object({
  minDistinctAuthors: z.number().int().min(1).max(1000),
  maxPostsPerAuthorPerHour: z.number().int().min(1).max(100),
  baselineDays: z.number().int().min(3).max(60),
  recomputeMinutes: z.number().int().min(1).max(60),
});
export type TrendingRules = z.infer<typeof TrendingRules>;

export const AdminTrendingRow = z.object({
  rank: z.number().int().nullable(),
  tag: z.string(),
  posts: z.number().int(),
  authors: z.number().int(),
  velocityPct: z.number().int(),
  status: z.enum(["trending", "pinned", "suppressed", "below_threshold"]),
  override: z
    .object({ id: z.string().uuid(), action: z.enum(["pin", "suppress"]), reason: z.string(), actor: MemberRef, createdAt: z.string(), expiresAt: z.string().nullable() })
    .nullable(),
});
export type AdminTrendingRow = z.infer<typeof AdminTrendingRow>;

/** GET /admin/trending?scope=&scopeId=&window= */
export const AdminTrendingResponse = z.object({
  computedAt: z.string().nullable(),
  rules: TrendingRules,
  rows: z.array(AdminTrendingRow),
});
export type AdminTrendingResponse = z.infer<typeof AdminTrendingResponse>;

/** POST /admin/trending/overrides */
export const TrendingOverrideInput = z.object({
  tag: z.string().regex(/^[A-Za-z0-9_]{2,50}$/),
  action: z.enum(["pin", "suppress"]),
  scope: z.enum(["global", "country", "chapter"]).default("global"),
  scopeId: z.string().optional(),
  reason: z.string().trim().min(5).max(500),
  expiresAt: z.string().datetime().optional(),
});
export type TrendingOverrideInput = z.infer<typeof TrendingOverrideInput>;

/** DELETE /admin/trending/overrides/{id} with a reason (restore or unpin). */
export const RevokeOverrideInput = z.object({ reason: z.string().trim().min(5).max(500) });

/* ---------- Audit log (CM-ADM-09) ---------- */

export const AuditEntry = z.object({
  id: z.string(),
  actor: MemberRef.nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  summary: z.string(),
  createdAt: z.string(),
  /** Salted hash of the request IP; null for system entries or when unknown. */
  ipHash: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditQuery = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  /** Inclusive lower bound (ISO datetime). */
  from: z.string().datetime({ offset: true }).optional(),
  /** Exclusive upper bound (ISO datetime). */
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/* ---------- Additions (moderation workstream) ---------- */

/** Member-facing names for policy references, used in notices and appeal pages. */
export const POLICY_REF_LABELS: Record<PolicyRef, string> = {
  "guidelines.respect": "Be respectful",
  "guidelines.harassment": "Harassment and bullying",
  "guidelines.spam": "Spam",
  "guidelines.scams": "Scams and fraud",
  "guidelines.impersonation": "Impersonation",
  "guidelines.misinformation": "False or misleading information",
  "guidelines.discrimination": "Hate and discrimination",
  "guidelines.sexual_content": "Sexual content",
  "guidelines.violence": "Violence and threats",
  "guidelines.ip": "Intellectual property",
  "guidelines.platform_integrity": "Platform integrity",
};

/** Report status as the reporter sees it: general terms only (spec 4.15). */
export const MyReportStatus = z.enum(["received", "in_review", "action_taken", "no_action"]);
export type MyReportStatus = z.infer<typeof MyReportStatus>;

/** GET /me/reports — reports I made, newest first. */
export const MyReport = z.object({
  id: z.string().uuid(),
  targetType: ReportTargetType,
  reason: ReportReason,
  status: MyReportStatus,
  /** One plain sentence about where the report stands. Never names the other member's outcome in detail. */
  summary: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type MyReport = z.infer<typeof MyReport>;

/** POST /appeals response. */
export const AppealView = z.object({
  id: z.string().uuid(),
  actionId: z.string().uuid(),
  status: z.enum(["open", "in_review", "upheld", "overturned"]),
  createdAt: z.string(),
});
export type AppealView = z.infer<typeof AppealView>;

/** GET /admin/hidden?targetType=&cursor= */
export const AdminHiddenQuery = z.object({
  targetType: z.enum(["post", "comment"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminHiddenQuery = z.infer<typeof AdminHiddenQuery>;

/** Hidden or removed posts and comments, with the action that hid them. */
export const AdminHiddenRow = z.object({
  target: z.object({ type: z.enum(["post", "comment"]), id: z.string().uuid(), preview: z.string() }),
  moderationState: z.enum(["hidden", "removed"]),
  author: MemberRef.nullable(),
  href: z.string(),
  hiddenAt: z.string(),
  action: AdminActionView.nullable(),
});
export type AdminHiddenRow = z.infer<typeof AdminHiddenRow>;

/** GET /admin/appeals?status= ("open" includes in_review; "decided" is upheld + overturned). */
export const AdminAppealsQuery = z.object({
  status: z.enum(["open", "in_review", "upheld", "overturned", "decided", "all"]).default("open"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminAppealsQuery = z.infer<typeof AdminAppealsQuery>;

/** GET /admin/trending query. */
export const AdminTrendingQuery = z.object({
  scope: z.enum(["global", "country", "chapter"]).default("global"),
  scopeId: z.string().max(60).optional(),
  window: z.enum(["24h", "7d"]).default("24h"),
});
export type AdminTrendingQuery = z.infer<typeof AdminTrendingQuery>;

/** POST /admin/trending/overrides response. */
export const TrendingOverrideView = z.object({
  id: z.string().uuid(),
  tag: z.string(),
  action: z.enum(["pin", "suppress"]),
  scope: z.enum(["global", "country", "chapter"]),
  scopeId: z.string().nullable(),
  reason: z.string(),
  actor: MemberRef,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type TrendingOverrideView = z.infer<typeof TrendingOverrideView>;

/** GET /admin/audit/export.csv — same filters as the viewer, no paging. */
export const AuditExportQuery = AuditQuery.omit({ cursor: true, limit: true });
export type AuditExportQuery = z.infer<typeof AuditExportQuery>;
