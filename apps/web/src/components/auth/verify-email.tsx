"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { AuthStatus } from "./auth-shell";
import { destinationFor } from "./destinations";
import { FormAlert, retryMessage } from "./fields";
import { ResendVerification } from "./resend-verification";

type State =
  | { kind: "verifying" }
  | { kind: "verified"; viewer: SessionUser | null }
  | { kind: "already"; viewer: SessionUser }
  | { kind: "invalid"; viewer: SessionUser | null }
  | { kind: "error"; message: string };

async function currentViewer(): Promise<SessionUser | null> {
  try {
    return await api<SessionUser>("/me");
  } catch {
    return null;
  }
}

/** /verify-email?token= — POST /auth/verify once on arrival, then continue or offer a new link. */
export function VerifyEmail({ token }: { token: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "verifying" });
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  async function run() {
    setState({ kind: "verifying" });
    if (!token || token.length < 16) {
      const viewer = await currentViewer();
      setState(viewer?.emailVerified ? { kind: "already", viewer } : { kind: "invalid", viewer });
      return;
    }
    try {
      await api("/auth/verify", { method: "POST", body: { token } });
      setState({ kind: "verified", viewer: await currentViewer() });
    } catch (error) {
      if (isApiError(error, "INVALID_TOKEN") || isApiError(error, "VALIDATION_FAILED")) {
        const viewer = await currentViewer();
        setState(viewer?.emailVerified ? { kind: "already", viewer } : { kind: "invalid", viewer });
      } else if (isApiError(error, "RATE_LIMITED")) {
        setState({ kind: "error", message: retryMessage(error.retryAfter) });
      } else {
        setState({ kind: "error", message: isApiError(error) ? error.message : "Something went wrong. Please try again." });
      }
    }
  }

  useEffect(() => {
    // Single-use token: guard against the development double-invoke of effects.
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.kind !== "verifying") heading.current?.focus();
  }, [state.kind]);

  function continueOn(viewer: SessionUser | null) {
    if (!viewer) {
      router.push("/signin?notice=verified");
      return;
    }
    router.push(destinationFor(viewer));
    router.refresh();
  }

  if (state.kind === "verifying") {
    return (
      <div role="status" className="flex flex-col items-start gap-[18px]">
        <span className="size-12 animate-pulse rounded-full bg-info-light" aria-hidden="true" />
        <h1 className="text-h1 text-ink">Verifying your email…</h1>
        <p className="text-md text-secondary">This only takes a moment.</p>
      </div>
    );
  }

  if (state.kind === "verified" || state.kind === "already") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus
          icon="check"
          tone="success"
          title={state.kind === "verified" ? "Your email is verified" : "Your email is already verified"}
          headingRef={heading}
        >
          <p className="text-md text-secondary">
            {state.viewer
              ? "You can now post, comment, react and connect with other members."
              : "Sign in to start posting, commenting and connecting with other members."}
          </p>
        </AuthStatus>
        <Button onClick={() => continueOn(state.viewer)} className="self-start">
          {state.viewer ? "Continue" : "Continue to sign in"}
        </Button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="alert" tone="error" title="We couldn’t verify your email" headingRef={heading} />
        <FormAlert tone="error">{state.message}</FormAlert>
        <Button variant="secondary" onClick={() => void run()} className="self-start">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <AuthStatus icon="alert" tone="warning" title="This link has expired or was already used" headingRef={heading}>
        <p className="text-md text-secondary">
          Verification links work once and expire after 24 hours.{" "}
          {state.viewer ? "Send yourself a new one below." : "Enter your email and we’ll send a new one."}
        </p>
      </AuthStatus>
      {state.viewer ? (
        <ResendVerification label="Send a new link" variant="primary" />
      ) : (
        <ResendVerification askEmail label="Send a new link" variant="primary" />
      )}
    </div>
  );
}
