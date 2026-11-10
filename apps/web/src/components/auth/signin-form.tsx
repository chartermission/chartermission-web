"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { SignInInput, type SessionUser, type SignInResult } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, PasswordInput, describedBy, inputClasses, retryMessage, textLinkClasses } from "./fields";
import { destinationFor } from "./destinations";
import { useT } from "@/i18n/client";

export type SignInNotice = "reset" | "deleted" | "signedout" | "verified" | "expired";

const noticeCopy: Record<SignInNotice, { tone: "success" | "info"; text: string }> = {
  reset: { tone: "success", text: "Your password was changed and every device was signed out. Sign in with your new password." },
  deleted: {
    tone: "info",
    text: "We’ve received your deletion request and signed you out everywhere. Your data will be erased within 30 days.",
  },
  signedout: { tone: "info", text: "You’ve been signed out." },
  verified: { tone: "success", text: "Your email is verified. Sign in to continue." },
  expired: { tone: "info", text: "Your session ended. Sign in again to continue." },
};

type FieldName = "email" | "password";

/** Sign in — POST /auth/login with the member audience, then route by onboarding and policy state. */
export function SignInForm({ next, notice }: { next: string | null; notice: SignInNotice | null }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<{ text: string; locked: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const parsed = SignInInput.safeParse({ email, password, audience: "member" });
    if (!parsed.success) {
      const errors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      const first = (["email", "password"] as const).find((field) => errors[field]);
      const control = first ? formRef.current?.elements.namedItem(first) : null;
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await api<SignInResult>("/auth/login", { method: "POST", body: parsed.data });
      if (result.status === "mfa_required" || result.status === "mfa_setup_required") {
        const step = result.status === "mfa_required" ? "/signin/mfa" : "/signin/mfa-setup";
        setPassword("");
        setSubmitting(false);
        router.replace(next ? `${step}?next=${encodeURIComponent(next)}` : step);
        return;
      }
      const me = await api<SessionUser>("/me");
      // The router may keep this screen mounted (hidden) for back navigation: don't keep the password.
      setPassword("");
      setSubmitting(false);
      router.replace(destinationFor(me, next));
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      if (isApiError(error, "RATE_LIMITED")) {
        setFormError({
          text: retryMessage(t, error.retryAfter, "Sign-in is paused for this account after too many failed attempts."),
          locked: true,
        });
      } else if (isApiError(error, "VALIDATION_FAILED") && error.fields) {
        setFieldErrors(error.fields as Partial<Record<FieldName, string>>);
      } else if (isApiError(error, "INVALID_CREDENTIALS")) {
        setFormError({ text: "That email and password don’t match. Check them and try again.", locked: false });
        setPassword("");
      } else {
        setFormError({ text: isApiError(error) ? error.message : "Something went wrong. Please try again.", locked: false });
      }
    }
  }

  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={`${id}-title`}
      className="flex w-full flex-col gap-[18px]"
    >
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Sign in
        </h1>
        <p className="text-md text-secondary">Welcome back. Pick up where you left off.</p>
      </div>

      {notice && !formError && <FormAlert tone={noticeCopy[notice].tone}>{noticeCopy[notice].text}</FormAlert>}

      {formError && (
        <FormAlert tone="error">
          <p>{formError.text}</p>
          {formError.locked && (
            <p className="mt-1">
              <Link href="/forgot-password" className={textLinkClasses}>
                Reset your password
              </Link>{" "}
              to sign in straight away.
            </p>
          )}
        </FormAlert>
      )}

      <Field id={`${id}-email`} label="Email" error={emailError}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy(emailError && `${id}-email-error`)}
          className={inputClasses(!!emailError)}
        />
      </Field>

      <Field
        id={`${id}-password`}
        label="Password"
        error={passwordError}
        hint={
          <Link href="/forgot-password" className={`text-sm ${textLinkClasses}`}>
            Forgot password?
          </Link>
        }
      >
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          invalid={!!passwordError}
          aria-describedby={describedBy(passwordError && `${id}-password-error`)}
        />
      </Field>

      <Button type="submit" block disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-secondary">
        New to Charter Mission?{" "}
        <Link href="/signup" className={textLinkClasses}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
