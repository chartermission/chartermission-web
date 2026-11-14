import type { ModerationActionKind, MyModerationAction, MyReportStatus, ReportTargetType } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";
import { formatDateTime } from "./format";

/* Member-facing names for moderation actions, targets, appeal and report states. */

export const ACTION_LABELS: Record<ModerationActionKind, string> = {
  hide: "Content hidden",
  remove: "Content removed",
  warn: "Warning",
  restrict_posting: "Posting restricted",
  restrict_connecting: "Connection requests restricted",
  suspend: "Account suspended",
  escalate: "Escalated for review",
  dismiss: "Report dismissed",
  restore: "Content restored",
};

export const TARGET_LABELS: Record<ReportTargetType, string> = {
  post: "Post",
  comment: "Comment",
  member: "Your account",
  hashtag: "Hashtag",
  story: "Story",
  opportunity: "Opportunity",
  message: "Message",
  initiative: "Initiative",
};

export const APPEAL_STATUS: Record<NonNullable<MyModerationAction["appeal"]>["status"], { label: string; tone: ChipTone }> = {
  open: { label: "Appeal received", tone: "info" },
  in_review: { label: "Appeal in review", tone: "info" },
  upheld: { label: "Appeal decided: decision stands", tone: "neutral" },
  overturned: { label: "Appeal successful: decision reversed", tone: "success" },
};

export const REPORTED_LABELS: Record<ReportTargetType, string> = {
  post: "Post",
  comment: "Comment",
  member: "Member",
  hashtag: "Hashtag",
  story: "Story",
  opportunity: "Opportunity",
  message: "Message",
  initiative: "Initiative",
};

export const REPORT_STATUS: Record<MyReportStatus, { label: string; tone: ChipTone }> = {
  received: { label: "Received", tone: "neutral" },
  in_review: { label: "Being reviewed", tone: "info" },
  action_taken: { label: "Action taken", tone: "success" },
  no_action: { label: "No action needed", tone: "neutral" },
};

/** "Until 3 Nov 2026, 14:05 UTC", "Ended …" or "No end date" for the action's effect. */
export function expiryText(action: Pick<MyModerationAction, "action" | "expiresAt">): string | null {
  const timed = ["restrict_posting", "restrict_connecting", "suspend"].includes(action.action);
  if (!timed) return null;
  if (!action.expiresAt) return "No end date";
  return new Date(action.expiresAt).getTime() > Date.now()
    ? `Until ${formatDateTime(action.expiresAt)}`
    : `Ended ${formatDateTime(action.expiresAt)}`;
}
