"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { UnsubscribeResult } from "@chartermission/contracts";
import { Button, buttonClasses } from "@chartermission/ui";
import { AuthStatus } from "@/components/auth/auth-shell";
import { FormAlert, retryMessage } from "@/components/auth/fields";
import { api, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";

type State = { kind: "ready" } | { kind: "working" } | { kind: "done" } | { kind: "invalid" } | { kind: "error"; message: string };

/**
 * /unsubscribe?t= — the link in Charter Mission's bulk emails. Nothing happens until the reader presses
 * Unsubscribe (link scanners open the page too); mail apps' one-click unsubscribe goes straight to the API.
 */
export function Unsubscribe({ token }: { token: string | null }) {
  const t = useT();
  const valid = !!token && token.length >= 10 && token.length <= 500;
  const [state, setState] = useState<State>(valid ? { kind: "ready" } : { kind: "invalid" });
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // Move focus to the new heading when the outcome replaces the question (not on arrival).
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.kind !== "working") heading.current?.focus();
  }, [state.kind]);

  async function unsubscribe() {
    if (!valid || state.kind === "working") return;
    setState({ kind: "working" });
    try {
      await api<UnsubscribeResult>("/notifications/unsubscribe", { method: "POST", body: { token } });
      setState({ kind: "done" });
    } catch (error) {
      if (isApiError(error, "INVALID_TOKEN") || isApiError(error, "VALIDATION_FAILED") || isApiError(error, "NOT_FOUND")) {
        setState({ kind: "invalid" });
      } else if (isApiError(error, "RATE_LIMITED")) {
        setState({ kind: "error", message: retryMessage(t, error.retryAfter) });
      } else {
        setState({ kind: "error", message: isApiError(error) ? error.message : "Something went wrong. Please try again." });
      }
    }
  }

  const settingsLink = (
    <Link href="/settings/notifications" className={buttonClasses({ variant: "secondary", className: "self-start" })}>
      Notification settings
    </Link>
  );

  if (state.kind === "done") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="check" tone="success" title="You’re unsubscribed" headingRef={heading}>
          <p className="text-md text-secondary">
            You won’t get announcement emails from Charter Mission anymore. Important notices about your account still reach you.
          </p>
        </AuthStatus>
        {settingsLink}
      </div>
    );
  }

  if (state.kind === "invalid") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="alert" tone="warning" title="This unsubscribe link isn’t valid" headingRef={heading}>
          <p className="text-md text-secondary">You can turn announcement emails off in your notification settings.</p>
        </AuthStatus>
        {settingsLink}
      </div>
    );
  }

  const working = state.kind === "working";
  return (
    <div className="flex flex-col gap-[18px]">
      <AuthStatus icon="mail" tone="info" title="Unsubscribe from Charter Mission announcements?" headingRef={heading}>
        <p className="text-md text-secondary">You’ll stop getting announcement emails. Important notices about your account still reach you.</p>
      </AuthStatus>
      {state.kind === "error" && <FormAlert tone="error">{state.message}</FormAlert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void unsubscribe()} disabled={working} aria-busy={working}>
          {working ? "Unsubscribing…" : state.kind === "error" ? "Try again" : "Unsubscribe"}
        </Button>
        <Link href="/settings/notifications" className="text-sm font-medium text-primary-light underline-offset-2 hover:underline">
          Notification settings
        </Link>
      </div>
    </div>
  );
}
