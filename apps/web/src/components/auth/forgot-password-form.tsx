"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ForgotPasswordInput } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { AuthStatus } from "./auth-shell";
import { DevMailbox } from "./dev-mailbox";
import { Field, FormAlert, describedBy, inputClasses, retryMessage, textLinkClasses } from "./fields";

const isDev = process.env.NODE_ENV === "development";

/**
 * POST /auth/password/forgot. The confirmation is the same whether or not the address has an
 * account (enumeration safety); only a 429 is shown differently.
 */
export function ForgotPasswordForm() {
  const id = useId();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sentTo) heading.current?.focus();
  }, [sentTo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const parsed = ForgotPasswordInput.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      (event.currentTarget.elements.namedItem("email") as HTMLInputElement | null)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api("/auth/password/forgot", { method: "POST", body: parsed.data });
      setSentTo(parsed.data.email);
    } catch (error) {
      if (isApiError(error, "RATE_LIMITED")) {
        setFormError(retryMessage(error.retryAfter, "You’ve asked for several reset links in the last hour."));
      } else if (isApiError(error) && error.fields?.email) {
        setEmailError(error.fields.email);
      } else {
        setFormError(isApiError(error) ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="mail" title="Check your email" headingRef={heading}>
          <p className="text-md text-secondary">
            If an account exists for <strong className="font-medium break-all text-ink">{sentTo}</strong>, we’ve sent a link to
            choose a new password. It works once and expires in 60 minutes.
          </p>
        </AuthStatus>
        {isDev && <DevMailbox email={sentTo} kind="reset" />}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/signin" className={`text-sm ${textLinkClasses}`}>
            Back to sign in
          </Link>
          <span aria-hidden="true" className="text-disabled">
            ·
          </span>
          <button type="button" onClick={() => setSentTo(null)} className={`text-sm ${textLinkClasses}`}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby={`${id}-title`} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Reset your password
        </h1>
        <p className="text-md text-secondary">Enter the email you signed up with and we’ll send you a reset link.</p>
      </div>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id={`${id}-email`} label="Email" error={emailError}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(undefined);
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy(emailError && `${id}-email-error`)}
          className={inputClasses(!!emailError)}
        />
      </Field>
      <Button type="submit" block disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-secondary">
        Remembered it?{" "}
        <Link href="/signin" className={textLinkClasses}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
