"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, cn } from "@chartermission/ui";

/**
 * Modal on the native <dialog>: showModal() traps focus, makes the page inert and closes on Escape.
 * Focus returns to the element that opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      opener.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] max-w-[480px] overflow-y-auto rounded-card border border-line bg-card p-0 text-ink shadow-[0px_12px_40px_0px_rgba(26,32,44,0.18)] backdrop:bg-ink/40",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-h3 text-ink">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="text-sm text-secondary">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-light"
          >
            <Icon name="x" size={20} />
          </button>
        </header>
        {open && children}
      </div>
    </dialog>
  );
}

export const dangerButtonClasses =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-error px-[18px] py-[10px] text-md font-medium whitespace-nowrap text-inverse transition-colors hover:bg-error/90 disabled:pointer-events-none disabled:opacity-50";
