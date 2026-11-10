"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { MfaSetupResponse, SessionUser } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { destinationFor } from "./destinations";
import { Field, FormAlert, describedBy, inputClasses, retryMessage, textLinkClasses } from "./fields";
import { useT } from "@/i18n/client";

const groupSecret = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Required two-step verification setup for staff accounts signing in to the member app
 * (POST /auth/mfa/setup once per visit, then POST /auth/mfa/enable with the first code).
 */
export function MfaSetupForm({ email, next }: { email: string; next: string | null }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  function load() {
    setLoadError(null);
    api<MfaSetupResponse>("/auth/mfa/setup", { method: "POST" })
      .then(setSetup)
      .catch((e: unknown) => setLoadError(isApiError(e) ? e.message : "Something went wrong. Please try again."));
  }

  useEffect(() => {
    // Each setup call issues a new secret: start exactly once per visit.
    if (started.current) return;
    started.current = true;
    load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api("/auth/mfa/enable", { method: "POST", body: { code: digits } });
      const me = await api<SessionUser>("/me");
      router.replace(destinationFor(me, next));
      router.refresh();
    } catch (e) {
      setSubmitting(false);
      setCode("");
      if (isApiError(e, "RATE_LIMITED")) setError(retryMessage(t, e.retryAfter, "Too many incorrect codes."));
      else if (isApiError(e) && e.status === 401) router.replace("/signin?notice=expired");
      else if (isApiError(e)) setError(e.code === "INVALID_MFA_CODE" ? "That code isn’t right. Try the current one." : e.message);
      else setError("Something went wrong. Please try again.");
    }
  }

  async function useAnotherAccount() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/signin");
    router.refresh();
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby={`${id}-title`} className="flex w-full flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Set up two-step verification
        </h1>
        <p className="text-md text-secondary">
          Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar) to sign in, here and
          in the admin console. Account: <span className="font-medium text-ink">{email}</span>
        </p>
      </div>

      <div aria-live="polite" className="flex flex-col items-center gap-3">
        {!setup && !loadError && (
          <span role="status" className="flex size-[200px] items-center justify-center rounded-lg bg-muted text-sm text-secondary">
            Preparing your code…
          </span>
        )}
        {loadError && (
          <div className="flex w-full flex-col gap-3">
            <FormAlert tone="error">{loadError}</FormAlert>
            <Button variant="secondary" size="small" onClick={load}>
              Try again
            </Button>
          </div>
        )}
        {setup && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR code SVG from the API, shown as an image */}
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
              alt="QR code to add this account to your authenticator app"
              width={200}
              height={200}
              className="size-[200px] rounded-lg border border-line bg-card p-2"
            />
            <div className="flex w-full flex-col gap-1 rounded-lg bg-muted p-3">
              <p className="text-xs text-secondary">Can’t scan? Enter this key in your app (time-based, 6 digits):</p>
              <code className="font-mono text-sm break-all text-ink" aria-label="Setup key">
                {groupSecret(setup.secret)}
              </code>
            </div>
          </>
        )}
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}

      <Field id={`${id}-code`} label="Code from your app">
        <input
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          placeholder="123456"
          value={code}
          disabled={!setup}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && `${id}-code-error`)}
          className={inputClasses(!!error, "tracking-[0.3em] tabular-nums")}
        />
      </Field>

      <Button type="submit" block disabled={submitting || !setup} aria-busy={submitting || undefined}>
        {submitting ? "Checking…" : "Turn on and continue"}
      </Button>

      <p className="text-center text-sm text-secondary">
        Not you?{" "}
        <button type="button" onClick={useAnotherAccount} className={textLinkClasses}>
          Use another account
        </button>
      </p>
    </form>
  );
}
