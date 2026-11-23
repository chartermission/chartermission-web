"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, cn } from "@chartermission/ui";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  /** Red text, for removing or suspending. */
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
};

/**
 * "More actions" (⋯) button with a short menu, for rows with more actions than fit in a line.
 * Keyboard: arrows move, Enter picks, Esc closes and returns focus to the button.
 */
export function RowMenu({ label, items, align = "end" }: { label: string; items: RowMenuItem[]; align?: "start" | "end" }) {
  const shown = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  /** Where the menu goes: under the button, or above it near the bottom of the window. Fixed, so a scrolling table never clips it. */
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const at = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const rtl = document.documentElement.dir === "rtl";
      const end = (align === "end") !== rtl;
      const below = window.innerHeight - r.bottom > 260 || r.top < 260;
      setPlace({
        ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
        ...(end ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    };
    at();
    // Follow the button when the page or a table scrolls; close once it leaves the window.
    const follow = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false);
      else at();
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open || !place) return;
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, place]);

  if (shown.length === 0) return null;

  const move = (delta: number) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-secondary hover:bg-muted hover:text-ink"
      >
        <Icon name="more" size={18} />
      </button>
      {open && place && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              button.current?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
          style={{ position: "fixed", ...place }}
          className="z-50 flex min-w-[200px] flex-col rounded-lg border border-line bg-card py-1 shadow-[0_8px_28px_rgba(25,37,80,0.18)]"
        >
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "px-3 py-2 text-start text-sm hover:bg-muted focus:bg-muted focus:outline-none disabled:opacity-50",
                item.danger ? "text-error" : "text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
