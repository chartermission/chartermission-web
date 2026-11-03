"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { errorMessage, isStandingError, isVerifyError } from "./error-message";

export { errorMessage, isStandingError, isVerifyError };

/** "Verify your email" with a resend button (POST /auth/resend uses the session). */
export function VerifyEmailPrompt({ message, compact = false }: { message?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    try {
      await api("/auth/resend", { method: "POST", body: {} });
      setState("sent");
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "text-xs" : "text-sm")}>
      <p className="text-ink">{message ?? "Verify your email address to do this. Check your inbox for the link."}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-live="polite">
        {state === "sent" ? (
          <span className="flex items-center gap-1 font-medium text-success">
            <Icon name="check" size={14} />
            We sent a new link. Check your inbox.
          </span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={state === "sending"}
            className="rounded-sm font-medium text-primary-light underline-offset-2 hover:underline disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Resend verification email"}
          </button>
        )}
        {state === "error" && error && <span className="text-error">{error}</span>}
      </p>
    </div>
  );
}

/**
 * Inline error box for forms and dialogs, following the brief: verify prompt for
 * EMAIL_NOT_VERIFIED, a link to /settings/moderation for restrictions and suspensions,
 * "Try again in N minutes" for 429, otherwise the API's own message.
 */
export function ErrorNotice({ error, className, onRetry }: { error: unknown; className?: string; onRetry?: () => void }) {
  if (!error) return null;
  const box = cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", className);
  if (isVerifyError(error)) {
    return (
      <div role="alert" className={cn(box, "border-warning/40 bg-warning-light")}>
        <Icon name="mail" size={18} className="mt-0.5 shrink-0 text-warning" />
        <VerifyEmailPrompt message={errorMessage(error)} />
      </div>
    );
  }
  if (isStandingError(error)) {
    return (
      <div role="alert" className={cn(box, "border-error/30 bg-error-light")}>
        <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-error" />
        <p className="text-ink">
          {errorMessage(error)}.{" "}
          <Link href="/settings/moderation" className="font-medium text-primary-light hover:underline">
            See why and how to appeal
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className={cn(box, "border-error/30 bg-error-light")}>
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-error" />
      <p className="flex-1 text-ink">{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-sm font-medium text-primary-light hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}
