"use client";

import { useRef, type KeyboardEvent } from "react";
import type { PostType } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { postTypeMeta, postTypes } from "@/components/social/post-types/meta";

/**
 * Segmented radio group for the kind of post. Arrow keys move and select (roving
 * tabindex), so the group is a single Tab stop.
 */
export function PostTypeSwitcher({
  value,
  onChange,
  disabled = [],
  describedBy,
}: {
  value: PostType;
  onChange: (type: PostType) => void;
  /** Types that can't be chosen right now (e.g. a quote post must stay standard). */
  disabled?: PostType[];
  describedBy?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = postTypes.filter((type) => !disabled.includes(type));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = enabled.indexOf(value);
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: PostType | undefined;
    if (event.key in keys) next = enabled[(index + keys[event.key]! + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next);
    refs.current[postTypes.indexOf(next)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Kind of post"
      aria-describedby={describedBy}
      className="grid grid-cols-5 gap-1 rounded-[10px] bg-muted p-1 max-sm:gap-0.5"
    >
      {postTypes.map((type, index) => {
        const meta = postTypeMeta[type];
        const checked = type === value;
        const off = disabled.includes(type);
        return (
          <button
            key={type}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={off || undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => !off && onChange(type)}
            onKeyDown={onKeyDown}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-sm transition-colors max-sm:flex-col max-sm:gap-0.5 max-sm:px-0 max-sm:py-1.5 max-sm:text-[11px] max-sm:leading-4 max-sm:tracking-tight",
              checked ? "bg-card font-medium text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
              off && "cursor-not-allowed opacity-50 hover:text-secondary",
            )}
          >
            <Icon name={meta.icon} size={16} className={cn("shrink-0", checked ? "text-accent" : undefined)} />
            <span className="truncate max-sm:max-w-full">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
