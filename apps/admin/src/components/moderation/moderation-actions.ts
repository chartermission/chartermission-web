import type { ReportStatus } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";
import type { QueueTab } from "@/lib/mock/moderation";
import type { ConfirmTone } from "@/components/reason-dialog";

export type ActionStyle = "primary" | "secondary" | "danger" | "ghost";

export type ModerationAction = {
  id: string;
  label: string;
  style: ActionStyle;
  /** Status the case moves to once confirmed. */
  result: ReportStatus;
  /** Past-tense outcome shown in the queue's status column. */
  outcome: string;
  outcomeTone: ChipTone;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  confirmTone: ConfirmTone;
  /** Optional duration picker shown in the confirmation. */
  durations?: readonly { value: string; label: string }[];
};

const suspensionLengths = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "permanent", label: "Permanent (until appeal)" },
] as const;

const suspend: ModerationAction = {
  id: "suspend",
  label: "Suspend account",
  style: "danger",
  result: "actioned",
  outcome: "Suspended",
  outcomeTone: "error",
  confirmTitle: "Suspend this account?",
  confirmDescription:
    "The author is signed out, cannot post, comment or message, and their content is hidden while suspended. They can appeal once.",
  confirmLabel: "Suspend account",
  confirmTone: "danger",
  durations: suspensionLengths,
};

/** Actions available per queue (Figma "ACTION" group, node 12:1766). */
export const moderationActions: Record<QueueTab, ModerationAction[]> = {
  reports: [
    {
      id: "hide",
      label: "Hide content",
      style: "primary",
      result: "actioned",
      outcome: "Hidden",
      outcomeTone: "info",
      confirmTitle: "Hide this content?",
      confirmDescription:
        "It leaves feeds, topic pages, trending and search within 60 seconds. The author is notified and can appeal once.",
      confirmLabel: "Hide content",
      confirmTone: "primary",
    },
    {
      id: "warn",
      label: "Warn author",
      style: "secondary",
      result: "actioned",
      outcome: "Warned",
      outcomeTone: "warning",
      confirmTitle: "Send the author a warning?",
      confirmDescription:
        "The content stays up. The author receives a policy warning that counts toward future enforcement.",
      confirmLabel: "Send warning",
      confirmTone: "primary",
    },
    suspend,
    {
      id: "dismiss",
      label: "Dismiss report",
      style: "ghost",
      result: "dismissed",
      outcome: "Dismissed",
      outcomeTone: "neutral",
      confirmTitle: "Dismiss this report?",
      confirmDescription: "No action is taken on the content. Reporters are told the content does not break the guidelines.",
      confirmLabel: "Dismiss report",
      confirmTone: "primary",
    },
  ],
  hidden: [
    {
      id: "restore",
      label: "Restore content",
      style: "primary",
      result: "overturned",
      outcome: "Restored",
      outcomeTone: "success",
      confirmTitle: "Restore this content?",
      confirmDescription: "It returns to feeds, topic pages and search within 60 seconds and the author is notified.",
      confirmLabel: "Restore content",
      confirmTone: "primary",
    },
    {
      id: "remove",
      label: "Remove permanently",
      style: "danger",
      result: "actioned",
      outcome: "Removed",
      outcomeTone: "error",
      confirmTitle: "Remove this content permanently?",
      confirmDescription: "The content is deleted for everyone. A copy is kept for 90 days for legal holds and appeals.",
      confirmLabel: "Remove permanently",
      confirmTone: "danger",
    },
    { ...suspend },
  ],
  appeals: [
    {
      id: "uphold",
      label: "Uphold decision",
      style: "primary",
      result: "upheld",
      outcome: "Upheld",
      outcomeTone: "neutral",
      confirmTitle: "Uphold the original decision?",
      confirmDescription: "The original action stays in place. This is the member's only appeal, so the decision is final.",
      confirmLabel: "Uphold decision",
      confirmTone: "primary",
    },
    {
      id: "overturn",
      label: "Overturn and restore",
      style: "secondary",
      result: "overturned",
      outcome: "Overturned",
      outcomeTone: "success",
      confirmTitle: "Overturn the original decision?",
      confirmDescription: "The original action is reversed, any hidden content is restored and the strike is removed.",
      confirmLabel: "Overturn decision",
      confirmTone: "primary",
    },
  ],
  uploads: [
    {
      id: "keep-blocked",
      label: "Keep blocked",
      style: "primary",
      result: "actioned",
      outcome: "Blocked",
      outcomeTone: "error",
      confirmTitle: "Keep this upload blocked?",
      confirmDescription: "The file is deleted and the post is published without the attachment.",
      confirmLabel: "Keep blocked",
      confirmTone: "primary",
    },
    { ...suspend },
    {
      id: "release",
      label: "Release upload",
      style: "ghost",
      result: "dismissed",
      outcome: "Released",
      outcomeTone: "success",
      confirmTitle: "Release this upload?",
      confirmDescription: "The file is re-scanned and, if clean, attached to the post for members to download.",
      confirmLabel: "Release upload",
      confirmTone: "danger",
    },
  ],
};

/** Policy note under the actions (Figma node 12:1778). */
export const queueNotes: Record<QueueTab, string> = {
  reports:
    "Hidden content leaves feeds, topic pages, trending and search within 60 seconds. The author can appeal once.",
  hidden: "Restored content returns to feeds, topic pages and search within 60 seconds.",
  appeals: "Appeals must be decided by a different reviewer from the one who took the original action.",
  uploads: "Blocked uploads never reach members. Released files are scanned again before they are attached.",
};

export const reasonsHeading: Record<QueueTab, string> = {
  reports: "Reporter reasons",
  hidden: "Reporter reasons",
  appeals: "Original report",
  uploads: "Detection",
};
