"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MfaSetupResponse } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { api, errorMessage } from "@/lib/api/client";
import { CodeForm } from "./code-form";

type SetupState =
  | { kind: "loading" }
  | { kind: "ready"; setup: MfaSetupResponse }
  | { kind: "error"; message: string };

/** The QR code SVG from the API, shown as an image (never injected as markup). */
function qrDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** "JBSW Y3DP EHPK 3PXP" — easier to type into an authenticator by hand. */
function groupSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * First admin sign-in: privileged roles must turn on TOTP (CM-AUTH-09). Starts setup once
 * (POST /auth/mfa/setup), shows the QR code and the secret for manual entry, then confirms a code
 * (POST /auth/mfa/enable), which also verifies this session.
 */
export function MfaSetup({ email, next }: { email: string; next: string }) {
  const router = useRouter();
  const [state, setState] = useState<SetupState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const request = useCallback(() => {
    api<MfaSetupResponse>("/auth/mfa/setup", { method: "POST", authFlow: true })
      .then((setup) => setState({ kind: "ready", setup }))
      .catch((e: unknown) => setState({ kind: "error", message: errorMessage(e) }));
  }, []);

  function retry() {
    setState({ kind: "loading" });
    request();
  }

  useEffect(() => {
    // Each setup call issues a new secret; start exactly once per visit.
    if (started.current) return;
    started.current = true;
    request();
  }, [request]);

  async function enable(code: string) {
    await api("/auth/mfa/enable", { method: "POST", body: { code }, authFlow: true });
    router.replace(next);
    router.refresh();
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Set up two-step verification</h1>
        <p className="text-sm text-secondary">
          Your role needs an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar) for{" "}
          <span className="font-medium text-ink">{email}</span>.
        </p>
      </div>

      <ol className="flex flex-col gap-5">
        <li className="flex flex-col gap-3">
          <h2 className="text-label text-secondary uppercase">1 · Scan this code</h2>
          <div aria-live="polite" className="flex flex-col items-center gap-3">
            {state.kind === "loading" && (
              <span role="status" className="flex size-[200px] items-center justify-center rounded-lg bg-muted text-sm text-secondary">
                Preparing your code…
              </span>
            )}
            {state.kind === "error" && (
              <div className="flex w-full flex-col gap-3">
                <FormNotice tone="error">{state.message}</FormNotice>
                <Button variant="secondary" size="small" onClick={retry}>
                  Try again
                </Button>
              </div>
            )}
            {state.kind === "ready" && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl(state.setup.qrSvg)}
                  alt="QR code for your authenticator app"
                  width={200}
                  height={200}
                  className="size-[200px] rounded-lg border border-line bg-card p-2"
                />
                <div className="flex w-full flex-col gap-1.5 rounded-lg bg-muted p-3">
                  <p className="text-xs text-secondary">Can’t scan? Enter this key in your app (time-based, 6 digits):</p>
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-sm break-all text-ink" aria-label="Setup key">
                      {groupSecret(state.setup.secret)}
                    </code>
                    <button
                      type="button"
                      onClick={() => copySecret(state.setup.secret)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-tint-2"
                    >
                      <Icon name={copied ? "check" : "link"} size={14} />
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </li>
        <li className="flex flex-col gap-3">
          <h2 className="text-label text-secondary uppercase">2 · Enter the code it shows</h2>
          <CodeForm submitLabel="Turn on and continue" busyLabel="Checking…" onSubmit={enable} />
        </li>
      </ol>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm text-secondary">
        <span>Not you?</span>
        <SignOutButton tone="light" />
      </div>
    </>
  );
}
