import type { ReactionKind } from "@chartermission/contracts";
import type { IconName } from "@chartermission/ui";

/** `color` is the text class of the chosen button; `tone` the same colour for motion effects. Shared with server components. */
export const reactionMeta: Record<ReactionKind, { label: string; icon: IconName; color: string; tone: string }> = {
  like: { label: "Like", icon: "like", color: "text-primary-light", tone: "var(--color-primary-light)" },
  insightful: { label: "Insightful", icon: "lightbulb", color: "text-warning", tone: "var(--color-warning)" },
  support: { label: "Support", icon: "users", color: "text-success", tone: "var(--color-success)" },
};

export const reactionKinds = Object.keys(reactionMeta) as ReactionKind[];
