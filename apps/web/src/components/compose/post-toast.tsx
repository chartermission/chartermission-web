"use client";

import { useEffect } from "react";
import { Icon } from "@chartermission/ui";

/**
 * Confirmation toast shown after posting. The live region stays mounted so
 * screen readers announce the message; it hides itself after a few seconds.
 */
export function PostToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {message && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-card bg-primary-dark py-3 pl-4 pr-3 text-sm text-inverse shadow-[0px_12px_24px_0px_rgba(0,0,0,0.2)]">
          <span className="flex size-6 items-center justify-center rounded-full bg-success">
            <Icon name="check" size={14} />
          </span>
          {message}
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-md p-1 text-inverse/80 hover:bg-primary-light hover:text-inverse">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
