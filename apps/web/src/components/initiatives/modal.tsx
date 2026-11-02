"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, cn } from "@chartermission/ui";

/**
 * Modal built on the native <dialog> element: showModal() gives focus
 * trapping, inert background and Escape-to-close for free.
 */
export function Modal({
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
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) closes the modal.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "fixed inset-0 m-auto h-fit max-h-[calc(100vh-48px)] w-[calc(100%-32px)] max-w-[520px] overflow-y-auto rounded-card border border-line bg-card p-0 text-ink shadow-[0px_12px_40px_0px_rgba(26,32,44,0.18)] backdrop:bg-ink/40",
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
              <p id={descriptionId} className="text-sm text-secondary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name="x" size={20} />
          </button>
        </header>
        {open && children}
      </div>
    </dialog>
  );
}
