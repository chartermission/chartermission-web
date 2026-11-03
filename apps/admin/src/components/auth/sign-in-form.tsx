"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SignInResult } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { FormNotice, TextField } from "@/components/form-field";
import { ApiError, api, errorMessage, retryText } from "@/lib/api/client";
import { HOME_PATH, safeNext } from "@/lib/navigation";

type FieldErrors = { email?: string; password?: string };

/** Admin sign-in (email + password, admin audience). The API answers with the MFA step to take next. */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const expired = params.get("expired") === "1";
  const signedOut = params.get("signedout") === "1";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const local: FieldErrors = {};
    if (!email) local.email = "Enter your email address";
    else if (!/^\S+@\S+\.\S+$/.test(email)) local.email = "Enter a valid email address";
    if (!password) local.password = "Enter your password";
    setFields(local);
    setError(null);
    if (local.email) return emailRef.current?.focus();
    if (local.password) return passwordRef.current?.focus();

    setBusy(true);
    try {
      const result = await api<SignInResult>("/auth/login", {
        method: "POST",
        body: { email, password, audience: "admin" },
        authFlow: true,
      });
      const q = next ? `?next=${encodeURIComponent(next)}` : "";
      if (result.status === "mfa_setup_required") router.push(`/signin/mfa-setup${q}`);
      else if (result.status === "mfa_required") router.push(`/signin/mfa${q}`);
      else router.push(next ?? HOME_PATH);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 429) {
        setError(
          `Too many sign-in attempts. ${e.retryAfter ? retryText(e.retryAfter) : "Try again later."} You can reset your password from the member site.`,
        );
      } else if (e instanceof ApiError && e.code === "VALIDATION_FAILED" && e.fields) {
        setFields({ email: e.fields.email, password: e.fields.password });
      } else if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") {
        // Same message for wrong passwords, unknown emails and non-staff accounts.
        setError("That email and password don’t match a staff account.");
        passwordRef.current?.focus();
      } else {
        setError(errorMessage(e));
      }
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Sign in to the admin console</h1>
        <p className="text-sm text-secondary">Moderators and administrators only. You’ll confirm with your authenticator app next.</p>
      </div>
      {expired && !error && (
        <FormNotice tone="warning">
          Your session expired after 30 minutes without activity. Sign in again to continue.
        </FormNotice>
      )}
      {signedOut && !expired && !error && <FormNotice tone="success">You’ve signed out of the admin console.</FormNotice>}
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          required
          error={fields.email}
          onChange={() => fields.email && setFields((f) => ({ ...f, email: undefined }))}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          error={fields.password}
          onChange={() => fields.password && setFields((f) => ({ ...f, password: undefined }))}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-tint-2"
            >
              {showPassword ? "Hide" : "Show"}
              <span className="sr-only"> password</span>
            </button>
          }
        />
        <Button type="submit" block disabled={busy} aria-busy={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p aria-live="polite" className="sr-only">
        {busy ? "Signing in" : ""}
      </p>
    </>
  );
}

export function SignInFormSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <span className="block h-8 w-3/4 animate-pulse rounded-md bg-muted" />
      <span className="block h-4 w-full animate-pulse rounded-md bg-muted" />
      <span className="block h-10 w-full animate-pulse rounded-lg bg-muted" />
      <span className="block h-10 w-full animate-pulse rounded-lg bg-muted" />
      <span className="block h-11 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
