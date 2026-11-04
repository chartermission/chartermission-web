"use client";

import { useRef, useState } from "react";
import type { ReactionKind, ReactionState } from "@chartermission/contracts";
import { Icon, cn, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { TickNumber, burst, pop } from "@/components/motion";
import { Menu } from "./menu";
import { toast } from "./toast";

/** `color` is the text class of the chosen button; `tone` the same colour for motion effects. */
export const reactionMeta: Record<ReactionKind, { label: string; icon: IconName; color: string; tone: string }> = {
  like: { label: "Like", icon: "like", color: "text-primary-light", tone: "var(--color-primary-light)" },
  insightful: { label: "Insightful", icon: "lightbulb", color: "text-warning", tone: "var(--color-warning)" },
  support: { label: "Support", icon: "users", color: "text-success", tone: "var(--color-success)" },
};

export const reactionKinds = Object.keys(reactionMeta) as ReactionKind[];

export type ReactionSnapshot = {
  reaction: ReactionKind | null;
  total: number;
  breakdown: Record<ReactionKind, number> | null;
};

/** Apply a reaction change locally (optimistic update). */
function applyLocal(state: ReactionSnapshot, next: ReactionKind | null): ReactionSnapshot {
  const breakdown = state.breakdown ? { ...state.breakdown } : null;
  let total = state.total;
  if (state.reaction) {
    total -= 1;
    if (breakdown) breakdown[state.reaction] = Math.max(0, breakdown[state.reaction] - 1);
  }
  if (next) {
    total += 1;
    if (breakdown) breakdown[next] += 1;
  }
  return { reaction: next, total, breakdown };
}

/**
 * Like button with a reaction picker (like / insightful / support). Counts update
 * optimistically and roll back if PUT/DELETE /reactions fails.
 */
export function ReactionButton({
  targetType,
  targetId,
  state,
  onChange,
  compact = false,
  subject,
  primary,
  onReacted,
}: {
  targetType: "post" | "comment";
  targetId: string;
  state: ReactionSnapshot;
  onChange: (state: ReactionSnapshot) => void;
  compact?: boolean;
  /** For screen readers, e.g. "Amara Okafor's post". */
  subject: string;
  /** Main button action other than "Like", e.g. celebrations: "Congratulate" (support). */
  primary?: { kind: ReactionKind; label: string; activeLabel: string; icon?: IconName };
  /** The viewer added or switched to `kind` (not called on removal), e.g. for confetti. */
  onReacted?: (kind: ReactionKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);

  async function set(next: ReactionKind | null) {
    if (busy) return;
    const previous = state;
    onChange(applyLocal(state, next));
    if (next && next !== previous.reaction) {
      // Decorative only: both are no-ops under prefers-reduced-motion.
      pop(iconRef.current);
      burst(iconRef.current, compact ? { colors: [reactionMeta[next].tone], count: 6, radius: 15, size: 3 } : { colors: [reactionMeta[next].tone] });
      onReacted?.(next);
    }
    setBusy(true);
    try {
      const result = await api<ReactionState>("/reactions", {
        method: next ? "PUT" : "DELETE",
        body: { targetType, targetId, kind: next ?? "like" },
      });
      onChange({ reaction: result.reaction, total: result.reactions, breakdown: result.breakdown ?? previous.breakdown });
    } catch (e) {
      onChange(previous);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const chosen = state.reaction ? reactionMeta[state.reaction] : null;
  const current = chosen && primary && state.reaction === primary.kind ? { ...chosen, label: primary.activeLabel, icon: primary.icon ?? chosen.icon } : chosen;
  const idle = primary ? { label: primary.label, icon: primary.icon ?? reactionMeta[primary.kind].icon } : { label: "Like", icon: "like" as IconName };
  const base = compact
    ? "flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium"
    : "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium";

  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-pressed={!!state.reaction}
        onClick={() => set(state.reaction ? null : (primary?.kind ?? "like"))}
        className={cn(base, "hover:bg-muted", current ? current.color : "text-secondary hover:text-primary")}
      >
        <span ref={iconRef} className="flex">
          <Icon name={current?.icon ?? idle.icon} size={compact ? 14 : 18} />
        </span>
        {current?.label ?? idle.label}
        <span className="sr-only"> {subject}</span>
        {compact && state.total > 0 && (
          <span className="text-secondary">
            · <TickNumber value={state.total} />
          </span>
        )}
      </button>
      <Menu
        label={`Choose a reaction for ${subject}`}
        align="start"
        trigger={<Icon name="chevron-down" size={compact ? 12 : 14} />}
        items={reactionKinds.map((kind) => ({
          label: state.reaction === kind ? `${reactionMeta[kind].label} (remove)` : reactionMeta[kind].label,
          icon: reactionMeta[kind].icon,
          onSelect: () => set(state.reaction === kind ? null : kind),
        }))}
      />
      {compact && <KindSummary state={state} />}
    </div>
  );
}

const kindDot: Record<ReactionKind, string> = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" };

/** Small stacked icons for the kinds used on a comment, e.g. 2 like · 1 insightful. */
function KindSummary({ state }: { state: ReactionSnapshot }) {
  const { breakdown } = state;
  if (!breakdown || state.total < 1) return null;
  const used = reactionKinds.filter((kind) => breakdown[kind] > 0);
  if (!used.length) return null;
  const text = used.map((kind) => `${breakdown[kind]} ${reactionMeta[kind].label.toLowerCase()}`).join(", ");
  return (
    <span className="ml-1 flex items-center" title={text}>
      <span className="flex -space-x-1" aria-hidden="true">
        {used.map((kind) => (
          <span key={kind} className={cn("flex size-4 items-center justify-center rounded-full border border-card text-inverse", kindDot[kind])}>
            <Icon name={reactionMeta[kind].icon} size={9} />
          </span>
        ))}
      </span>
      <span className="sr-only">Reactions: {text}</span>
    </span>
  );
}
