"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { hideForToday, unhide, useHiddenToday } from "./hidden-today";

/**
 * Shell for a community moment woven into the feed: a quiet tinted header strip with the
 * brand pattern, an icon and label ("Member spotlight · Community"), and a "Hide for today"
 * button that leaves an Undo row behind. Reads as the platform's own card, not a post or an ad.
 * Renders nothing until it knows (on the device) whether it was hidden today.
 */
export function MomentCard({
  id,
  label,
  icon,
  iconTone,
  className,
  style,
  children,
}: {
  /** Moment id, e.g. "spotlight:2026-11-05"; remembers the dismissal. */
  id: string;
  label: string;
  icon: IconName;
  /** Text colour class for the header icon. */
  iconTone: string;
  className?: string;
  style?: CSSProperties;
  /** Card body; give its main heading the id passed in. */
  children: (headingId: string) => ReactNode;
}) {
  const headingId = useId();
  const hidden = useHiddenToday(id);
  /** Set when hidden in this page view (so the Undo row shows); "restored" moves focus back. */
  const [focus, setFocus] = useState<"undo" | "restored" | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focus === "undo" && hidden) undoRef.current?.focus();
    if (focus === "restored" && hidden === false) dismissRef.current?.focus();
  }, [focus, hidden]);

  if (hidden === null) return null;
  if (hidden) {
    if (!focus) return null;
    return (
      <div role="status" className="flex items-center justify-between gap-3 rounded-card border border-dashed border-line-strong bg-card px-5 py-3 max-sm:px-4">
        <p className="flex items-center gap-2 text-sm text-secondary">
          <Icon name="eye-off" size={16} className="shrink-0" />
          {label} hidden until tomorrow.
        </p>
        <button
          ref={undoRef}
          type="button"
          onClick={() => {
            unhide(id);
            setFocus("restored");
          }}
          className="rounded-sm text-sm font-medium text-primary-light hover:underline"
        >
          Undo<span className="sr-only"> and show the {label.toLowerCase()} again</span>
        </button>
      </div>
    );
  }

  return (
    <article aria-labelledby={headingId} className={cn("motion-fade-up overflow-hidden rounded-card border border-line bg-card", className)} style={style}>
      <header className="relative flex items-center gap-2 overflow-hidden border-b border-line bg-primary-tint-2 py-1.5 pe-2 ps-5 max-sm:ps-4">
        <BrandPattern fade="left" opacity={0.09} size={72} />
        <span className={cn("relative flex size-6 shrink-0 items-center justify-center rounded-full bg-card", iconTone)} aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        <p className="relative min-w-0 flex-1 truncate text-label text-primary">
          {label}
          <span className="font-normal text-secondary"> · Community</span>
        </p>
        <button
          ref={dismissRef}
          type="button"
          onClick={() => {
            hideForToday(id);
            setFocus("undo");
          }}
          title="Hide for today"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-card hover:text-ink"
        >
          <Icon name="x" size={16} />
          <span className="sr-only">Hide the {label.toLowerCase()} for today</span>
        </button>
      </header>
      <div className="flex flex-col gap-4 p-5 max-sm:px-4">{children(headingId)}</div>
    </article>
  );
}
