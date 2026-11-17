"use client";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@chartermission/ui";

/**
 * A list that shows its first `limit` items and a "Show all" button that opens the rest in place.
 * The items (<li>) can come from a server component. Once opened, focus moves to the first item
 * that was hidden, so keyboard and screen reader users carry on from where the button was.
 */
export function ExpandableList({
  limit,
  showAllLabel,
  className,
  children,
}: {
  limit: number;
  /** e.g. "Show all 7 licenses & certifications", already translated. */
  showAllLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = listRef.current?.children[limit];
    if (first instanceof HTMLElement) {
      first.tabIndex = -1;
      first.focus();
    }
  }, [open, limit]);

  const collapsible = items.length > limit;
  return (
    <>
      <ul id={listId} ref={listRef} className={className}>
        {open || !collapsible ? items : items.slice(0, limit)}
      </ul>
      {collapsible && !open && (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={listId}
          onClick={() => setOpen(true)}
          className="flex items-center justify-center gap-1.5 self-stretch border-t border-line pt-3 text-sm font-medium text-secondary hover:text-ink"
        >
          {showAllLabel}
          <Icon name="chevron-down" size={16} />
        </button>
      )}
    </>
  );
}
