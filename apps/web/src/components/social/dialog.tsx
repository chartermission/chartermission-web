"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Divider, Icon, cn } from "@chartermission/ui";

/**
 * Native modal <dialog>: the page behind is inert, Escape and the backdrop close it,
 * and focus returns to the element that opened it. Mount it to open; it calls onClose
 * when dismissed.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 520,
  initialFocus,
  className,
  flush = false,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** CSS selector inside the dialog to focus first (default: first focusable). */
  initialFocus?: string;
  className?: string;
  /** No padding around the body: for lists that run edge to edge. */
  flush?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    opener.current = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const target = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
    target?.focus();
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClose={() => onCloseRef.current()}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      style={{ width }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-card p-0 text-ink shadow-[0px_24px_48px_0px_rgba(0,0,0,0.25)] backdrop:bg-primary-dark/55",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`${id}-title`} className="text-h3 text-ink">
            {title}
          </h2>
          {description && (
            <div id={`${id}-description`} className="text-sm text-secondary">
              {description}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="shrink-0 rounded-md p-0.5 text-secondary hover:bg-muted hover:text-ink"
        >
          <Icon name="x" size={22} />
        </button>
      </div>
      <Divider />
      {children && <div className={flush ? "flex flex-col" : "flex flex-col gap-4 p-5"}>{children}</div>}
      {footer && (
        <>
          <Divider />
          <div className="flex flex-wrap items-center justify-end gap-2.5 px-5 py-3.5">{footer}</div>
        </>
      )}
    </dialog>
  );
}

/** Close the nearest open dialog from inside it (e.g. a Cancel button). */
export function closeDialog(from: HTMLElement | null) {
  from?.closest("dialog")?.close();
}
