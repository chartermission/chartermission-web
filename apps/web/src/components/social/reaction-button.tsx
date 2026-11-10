"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactionKind, ReactionState } from "@chartermission/contracts";
import { Icon, cn, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { burst, pop } from "@/components/motion";
import { reactionKinds, reactionMeta } from "./reaction-meta";
import { toast } from "./toast";
import { useT } from "@/i18n/client";

export { reactionKinds, reactionMeta };

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

/** How long the pointer rests on the button before the reactions float up, and lingers after leaving. */
const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 280;
const LONG_PRESS_MS = 420;

/**
 * Like button with floating reactions (like / insightful / support). A click or tap likes straight
 * away; resting the pointer on the button, a long press on touch screens, or keyboard focus floats
 * the three reactions above it. Counts update optimistically and roll back if PUT/DELETE /reactions fails.
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A long press opened the picker, so the click that follows must not also toggle the like. */
  const pressed = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (next: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => clear, []);

  // Tapping elsewhere or pressing Escape puts the reactions away.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  function choose(kind: ReactionKind) {
    clear();
    setOpen(false);
    void set(state.reaction === kind ? null : kind);
  }

  const chosen = state.reaction ? reactionMeta[state.reaction] : null;
  const current = chosen && primary && state.reaction === primary.kind ? { ...chosen, label: primary.activeLabel, icon: primary.icon ?? chosen.icon } : chosen;
  const idle = primary ? { label: primary.label, icon: primary.icon ?? reactionMeta[primary.kind].icon } : { label: "Like", icon: "like" as IconName };
  const base = compact
    ? "flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium"
    : "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium";

  return (
    <div
      ref={wrapRef}
      className="relative flex items-center"
      onPointerEnter={(event) => event.pointerType === "mouse" && later(true, OPEN_DELAY_MS)}
      onPointerLeave={(event) => event.pointerType === "mouse" && later(false, CLOSE_DELAY_MS)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && later(false, 0)}
    >
      <button
        type="button"
        aria-pressed={!!state.reaction}
        aria-describedby={open ? undefined : `${targetId}-reactions-hint`}
        onClick={() => {
          if (pressed.current) {
            pressed.current = false;
            return;
          }
          clear();
          setOpen(false);
          void set(state.reaction ? null : (primary?.kind ?? "like"));
        }}
        onFocus={(event) => event.currentTarget.matches(":focus-visible") && setOpen(true)}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          pressed.current = false;
          clear();
          timer.current = setTimeout(() => {
            pressed.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={(event) => event.pointerType !== "mouse" && !pressed.current && clear()}
        onPointerCancel={clear}
        onContextMenu={(event) => pressed.current && event.preventDefault()}
        className={cn(base, "touch-manipulation select-none hover:bg-muted", current ? current.color : "text-secondary hover:text-primary")}
      >
        <span ref={iconRef} className="flex">
          <Icon name={current?.icon ?? idle.icon} size={compact ? 14 : 18} />
        </span>
        {current?.label ?? idle.label}
        <span className="sr-only"> {subject}</span>
      </button>
      <span id={`${targetId}-reactions-hint`} className="sr-only">
        Press Tab for more reactions
      </span>

      {open && (
        <div
          role="group"
          aria-label={t("React to {subject}", { subject })}
          className={cn(
            "reaction-float absolute bottom-full start-0 z-30 flex items-center rounded-full border border-line bg-card shadow-[0_8px_24px_rgb(15_42_42/0.16)]",
            compact ? "mb-1.5 gap-1 p-1" : "mb-2 gap-1.5 p-1.5",
          )}
        >
          {reactionKinds.map((kind, index) => {
            const meta = reactionMeta[kind];
            const active = state.reaction === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                aria-label={active ? t("Remove {label}", { label: meta.label }) : meta.label}
                onClick={() => choose(kind)}
                style={{ animationDelay: `${index * 45}ms` }}
                className={cn(
                  "reaction-float-item group/reaction relative flex items-center justify-center rounded-full text-inverse outline-offset-2 transition-transform duration-150 ease-out hover:z-10 hover:-translate-y-1.5 hover:scale-125 focus-visible:-translate-y-1.5 focus-visible:scale-125",
                  compact ? "size-8" : "size-10",
                  reactionFill[kind],
                  active && "ring-2 ring-ink/70 ring-offset-2 ring-offset-card",
                )}
              >
                <Icon name={meta.icon} size={compact ? 16 : 20} />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-inverse opacity-0 transition-opacity duration-100 group-hover/reaction:opacity-100 group-focus-visible/reaction:opacity-100"
                >
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {compact && <KindSummary state={state} />}
    </div>
  );
}

/** Fill of each floating reaction. */
const reactionFill: Record<ReactionKind, string> = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" };

const kindDot: Record<ReactionKind, string> = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" };

/** Small stacked icons for the kinds used on a comment, e.g. 2 like · 1 insightful. */
function KindSummary({ state }: { state: ReactionSnapshot }) {
  const { breakdown } = state;
  if (!breakdown || state.total < 1) return null;
  const used = reactionKinds.filter((kind) => breakdown[kind] > 0);
  if (!used.length) return null;
  const text = used.map((kind) => `${breakdown[kind]} ${reactionMeta[kind].label.toLowerCase()}`).join(", ");
  return (
    <span className="ms-1 flex items-center" title={text}>
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
