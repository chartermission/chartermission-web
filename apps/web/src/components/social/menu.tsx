"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";

export type MenuItem = {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * Keyboard-operable menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown opens,
 * arrows move, Home/End jump, Escape and Tab close, focus returns to the button.
 */
export function Menu({
  label,
  items,
  trigger,
  align = "end",
  className,
}: {
  /** Accessible name of the button, e.g. "More options for Amara's post". */
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const enabled = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])")?.focus();
    function onPointer(event: PointerEvent) {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function focusItem(step: number | "first" | "last") {
    const nodes = Array.from(list.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? []);
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    const next = step === "first" ? 0 : step === "last" ? nodes.length - 1 : (current + step + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && enabled.length) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="rounded-md p-0.5 text-secondary hover:bg-muted hover:text-ink"
      >
        {trigger ?? <Icon name="more" size={20} />}
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") focusItem(1);
            else if (event.key === "ArrowUp") focusItem(-1);
            else if (event.key === "Home") focusItem("first");
            else if (event.key === "End") focusItem("last");
            else if (event.key === "Escape") close();
            else if (event.key === "Tab") return close(false);
            else return;
            event.preventDefault();
          }}
          className={cn(
            "absolute top-full z-20 mt-1 flex min-w-[200px] flex-col rounded-[10px] border border-line bg-card py-1 shadow-[0px_8px_20px_0px_rgba(0,0,0,0.1)]",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <li
              key={item.label}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.onSelect();
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !item.disabled) {
                  event.preventDefault();
                  close();
                  item.onSelect();
                }
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm outline-none focus:bg-primary-tint-2 hover:bg-primary-tint-2",
                item.danger ? "text-error" : "text-ink",
                item.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {item.icon && <Icon name={item.icon} size={16} className={item.danger ? "text-error" : "text-secondary"} />}
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
