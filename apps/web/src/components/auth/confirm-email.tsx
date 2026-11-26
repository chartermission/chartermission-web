"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { AuthStatus } from "./auth-shell";
import { FormAlert, retryMessage } from "./fields";
import { useT } from "@/i18n/client";

type State =
  | { kind: "working" }
  | { kind: "done"; viewer: SessionUser | null }
  | { kind: "invalid"; signedIn: boolean }
  | { kind: "error"; message: string };

async function currentViewer(): Promise<SessionUser | null> {
  try {
    return await api<SessionUser>("/me");
  } catch {
    return null;
  }
}

/** /confirm-email?token= — the link sent to a new address (Settings → Email): makes it the account's email. */
export function ConfirmEmail({ token }: { token: string | null }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Single-use token: guard against the development double-invoke of effects.
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (!token || token.length < 16) {
        setState({ kind: "invalid", signedIn: !!(await currentViewer()) });
        return;
      }
      try {
        await api("/auth/email/confirm", { method: "POST", body: { token } });
        setState({ kind: "done", viewer: await currentViewer() });
      } catch (error) {
        if (isApiError(error, "INVALID_TOKEN")) setState({ kind: "invalid", signedIn: !!(await currentViewer()) });
        else if (isApiError(error, "RATE_LIMITED")) setState({ kind: "error", message: retryMessage(t, error.retryAfter) });
        else if (isApiError(error) && error.fields?.token) setState({ kind: "error", message: error.fields.token });
        else setState({ kind: "error", message: isApiError(error) ? error.message : t("Something went wrong. Please try again.") });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.kind !== "working") heading.current?.focus();
  }, [state.kind]);

  if (state.kind === "working") {
    return (
      <div role="status" className="flex flex-col items-start gap-[18px]">
        <span className="size-12 animate-pulse rounded-full bg-info-light" aria-hidden="true" />
        <h1 className="text-h1 text-ink">Confirming your new email…</h1>
        <p className="text-md text-secondary">This only takes a moment.</p>
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="check" tone="success" title="Your email is changed" headingRef={heading}>
          <p className="text-md text-secondary">
            {state.viewer
              ? t("Your account’s email is now {email}. Use it to sign in from now on.", { email: state.viewer.email })
              : "Use your new email to sign in from now on."}
          </p>
        </AuthStatus>
        <Link href={state.viewer ? "/settings" : "/signin"} className={`self-start ${buttonClasses({ variant: "primary" })}`}>
          {state.viewer ? "Back to settings" : "Sign in"}
        </Link>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="alert" tone="error" title="We couldn’t change your email" headingRef={heading} />
        <FormAlert tone="error">{state.message}</FormAlert>
        <Link href="/settings" className={`self-start ${buttonClasses({ variant: "secondary" })}`}>
          Go to settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <AuthStatus icon="alert" tone="warning" title="This link has expired or was already used" headingRef={heading}>
        <p className="text-md text-secondary">
          Links to confirm a new email work once and expire after 24 hours. You can send a new one, or change the address, from Settings.
        </p>
      </AuthStatus>
      <Link href={state.signedIn ? "/settings" : "/signin?next=/settings"} className={`self-start ${buttonClasses({ variant: "primary" })}`}>
        {state.signedIn ? "Go to settings" : "Sign in"}
      </Link>
    </div>
  );
}
