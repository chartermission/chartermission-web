"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Button, buttonClasses } from "@chartermission/ui";
import { Dialog } from "./dialog";
import { ErrorNotice } from "./errors";

/** Yes/no confirmation that runs an async action and shows its error in place. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Resolve to close the dialog; throw to keep it open and show the error. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      cancelRef.current?.closest("dialog")?.close();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={440}
      initialFocus="[data-cancel]"
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            data-cancel
            className={buttonClasses({ variant: "secondary" })}
            onClick={() => cancelRef.current?.closest("dialog")?.close()}
          >
            Cancel
          </button>
          <Button
            onClick={confirm}
            disabled={busy}
            className={danger ? "bg-error hover:bg-error/90" : undefined}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="text-sm text-body">{children}</div>}
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </Dialog>
  );
}

/** Block confirmations: where to undo it later. */
export function UnblockHint() {
  return (
    <>
      You can unblock them any time in{" "}
      <Link href="/settings/blocked" className="font-medium text-primary-light hover:underline">
        Settings → Blocked &amp; muted
      </Link>
      .
    </>
  );
}
