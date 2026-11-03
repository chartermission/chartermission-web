import type { AdminReportDetail, ModerationActionKind, ReportTargetType } from "@chartermission/contracts";
import type { ConfirmTone } from "@/components/reason-dialog";

export type ActionStyle = "primary" | "secondary" | "danger" | "ghost";

export type DurationOption = { value: string; label: string };

export type ModerationActionDef = {
  kind: ModerationActionKind;
  label: string;
  style: ActionStyle;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  confirmTone: ConfirmTone;
  /** Duration picker in the confirmation; values are hours, "" = indefinite. */
  durations?: readonly DurationOption[];
  defaultDuration?: string;
};

const RESTRICTION_LENGTHS: DurationOption[] = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

const SUSPENSION_LENGTHS: DurationOption[] = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
  { value: "", label: "Indefinitely (until lifted or appealed)" },
];

const TOPIC_LENGTHS: DurationOption[] = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
  { value: "", label: "Until restored" },
];

const noun = (type: ReportTargetType) => (type === "hashtag" ? "topic" : type);

/** Confirmation copy and styling per action, phrased for the target type. */
export function actionDef(kind: ModerationActionKind, type: ReportTargetType): ModerationActionDef {
  const n = noun(type);
  switch (kind) {
    case "hide":
      return type === "hashtag"
        ? {
            kind,
            label: "Suppress topic",
            style: "primary",
            confirmTitle: "Suppress this topic?",
            confirmDescription: "The topic leaves trending everywhere for the chosen period. Posts using it stay visible.",
            confirmLabel: "Suppress topic",
            confirmTone: "primary",
            durations: TOPIC_LENGTHS,
            defaultDuration: "168",
          }
        : {
            kind,
            label: `Hide ${n}`,
            style: "primary",
            confirmTitle: `Hide this ${n}?`,
            confirmDescription:
              "It leaves feeds, topic pages, trending and search within 60 seconds. The author is notified and can appeal once.",
            confirmLabel: `Hide ${n}`,
            confirmTone: "primary",
          };
    case "remove":
      return {
        kind,
        label: `Remove ${n}`,
        style: "danger",
        confirmTitle: `Remove this ${n}?`,
        confirmDescription:
          "Removal is for clear policy breaches. The content is taken down for everyone; a copy is kept for appeals and legal holds. The author can appeal once.",
        confirmLabel: `Remove ${n}`,
        confirmTone: "danger",
      };
    case "restore":
      return {
        kind,
        label: type === "hashtag" ? "Restore topic" : `Restore ${n}`,
        style: "secondary",
        confirmTitle: type === "hashtag" ? "Restore this topic to trending?" : `Restore this ${n}?`,
        confirmDescription:
          type === "hashtag"
            ? "The topic can trend again at the next run if it meets the trending rules."
            : "It returns to feeds, topic pages and search within 60 seconds and the author is notified.",
        confirmLabel: "Restore",
        confirmTone: "primary",
      };
    case "warn":
      return {
        kind,
        label: "Warn author",
        style: "secondary",
        confirmTitle: type === "member" ? "Warn this member?" : "Send the author a warning?",
        confirmDescription: "Nothing is taken down. The member receives a policy warning that counts toward future enforcement.",
        confirmLabel: "Send warning",
        confirmTone: "primary",
      };
    case "restrict_posting":
      return {
        kind,
        label: "Restrict posting",
        style: "secondary",
        confirmTitle: "Restrict posting?",
        confirmDescription: "The member can still sign in and read, but can’t post or comment until the restriction ends.",
        confirmLabel: "Restrict posting",
        confirmTone: "primary",
        durations: RESTRICTION_LENGTHS,
        defaultDuration: "168",
      };
    case "restrict_connecting":
      return {
        kind,
        label: "Restrict connecting",
        style: "secondary",
        confirmTitle: "Restrict connecting?",
        confirmDescription: "The member can’t send connection requests or follow people until the restriction ends.",
        confirmLabel: "Restrict connecting",
        confirmTone: "primary",
        durations: RESTRICTION_LENGTHS,
        defaultDuration: "168",
      };
    case "suspend":
      return {
        kind,
        label: "Suspend account",
        style: "danger",
        confirmTitle: "Suspend this account?",
        confirmDescription:
          "The member is signed out everywhere, can’t post, comment or connect, and their content is hidden while suspended. They can appeal once.",
        confirmLabel: "Suspend account",
        confirmTone: "danger",
        durations: SUSPENSION_LENGTHS,
        defaultDuration: "168",
      };
    case "escalate":
      return {
        kind,
        label: "Escalate",
        style: "ghost",
        confirmTitle: "Escalate this report?",
        confirmDescription: "The case stays open, moves to high priority and is flagged for a Platform Admin.",
        confirmLabel: "Escalate",
        confirmTone: "primary",
      };
    case "dismiss":
      return {
        kind,
        label: "Dismiss report",
        style: "ghost",
        confirmTitle: "Dismiss this report?",
        confirmDescription: "No action is taken. Reporters are told the content doesn’t break the Community Guidelines.",
        confirmLabel: "Dismiss report",
        confirmTone: "primary",
      };
  }
}

/** Actions that make sense for this case right now (the API re-validates every one). */
export function availableActions(detail: AdminReportDetail): ModerationActionKind[] {
  const open = detail.status === "open" || detail.status === "in_review";
  const type = detail.target.type;
  const state = detail.content.moderationState;
  const kinds: ModerationActionKind[] = [];
  if (type === "post" || type === "comment") {
    if (state === "visible") kinds.push("hide", "remove");
    if (state === "hidden") kinds.push("remove", "restore");
    if (state === "removed") kinds.push("restore");
  }
  if (type === "hashtag") kinds.push(state === "hidden" ? "restore" : "hide");
  if (type !== "hashtag" && detail.author) kinds.push("warn", "restrict_posting", "restrict_connecting", "suspend");
  if (open) kinds.push("escalate", "dismiss");
  return kinds;
}
