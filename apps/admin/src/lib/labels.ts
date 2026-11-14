import {
  POLICY_REF_LABELS,
  REPORT_REASON_LABELS,
  type ModerationActionKind,
  type PolicyRef,
  type ReportPriority,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";

export { POLICY_REF_LABELS, REPORT_REASON_LABELS };

export const TARGET_LABELS: Record<ReportTargetType, string> = {
  post: "Post",
  comment: "Comment",
  member: "Member",
  hashtag: "Topic",
  story: "Story",
  opportunity: "Opportunity",
  message: "Message",
  initiative: "Initiative",
};

export const PRIORITY_CHIP: Record<ReportPriority, { label: string; tone: ChipTone }> = {
  high: { label: "High", tone: "error" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};

export const STATUS_CHIP: Record<ReportStatus, { label: string; tone: ChipTone }> = {
  open: { label: "Open", tone: "info" },
  in_review: { label: "In review", tone: "warning" },
  actioned: { label: "Actioned", tone: "error" },
  dismissed: { label: "Dismissed", tone: "neutral" },
  appealed: { label: "Appealed", tone: "warning" },
  upheld: { label: "Upheld", tone: "neutral" },
  overturned: { label: "Overturned", tone: "success" },
};

/** Past-tense outcome of a moderation action, for history lists. */
export const ACTION_LABELS: Record<ModerationActionKind, string> = {
  hide: "Hidden",
  remove: "Removed",
  warn: "Warned",
  restrict_posting: "Posting restricted",
  restrict_connecting: "Connecting restricted",
  suspend: "Suspended",
  escalate: "Escalated",
  dismiss: "Dismissed",
  restore: "Restored",
};

export const ACTION_TONES: Record<ModerationActionKind, ChipTone> = {
  hide: "info",
  remove: "error",
  warn: "warning",
  restrict_posting: "warning",
  restrict_connecting: "warning",
  suspend: "error",
  escalate: "warning",
  dismiss: "neutral",
  restore: "success",
};

export const APPEAL_STATUS_CHIP: Record<"open" | "in_review" | "upheld" | "overturned", { label: string; tone: ChipTone }> = {
  open: { label: "Appeal open", tone: "info" },
  in_review: { label: "Appeal in review", tone: "warning" },
  upheld: { label: "Appeal upheld", tone: "neutral" },
  overturned: { label: "Appeal overturned", tone: "success" },
};

/** The guideline most reports with this reason fall under; preselected in the action dialog. */
export const POLICY_FOR_REASON: Record<ReportReason, PolicyRef> = {
  spam: "guidelines.spam",
  scam: "guidelines.scams",
  harassment: "guidelines.harassment",
  hate: "guidelines.discrimination",
  misinformation: "guidelines.misinformation",
  impersonation: "guidelines.impersonation",
  sexual_content: "guidelines.sexual_content",
  violence: "guidelines.violence",
  self_harm: "guidelines.violence",
  copyright: "guidelines.ip",
  trend_manipulation: "guidelines.platform_integrity",
  other: "guidelines.respect",
};

export const POLICY_OPTIONS = (Object.keys(POLICY_REF_LABELS) as PolicyRef[]).map((value) => ({
  value,
  label: POLICY_REF_LABELS[value],
}));

export const REASON_OPTIONS = (Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((value) => ({
  value,
  label: REPORT_REASON_LABELS[value],
}));
