"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ResetPasswordInput } from "@chartermission/contracts";
import { Button, buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { AuthStatus } from "./auth-shell";
import { Field, FormAlert, PasswordInput, describedBy, retryMessage, textLinkClasses } from "./fields";
import { PasswordRules, StrengthMeter, passwordRules } from "./password-rules";

type FieldName = "password" | "confirm";

/** /reset-password?token= — choose a new password (POST /auth/password/reset); success signs out everywhere. */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const id = useId();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(!token || token.length < 16);
  const [submitting, setSubmitting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (invalid) heading.current?.focus();
  }, [invalid]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !token) return;
    setFormError(null);
    const next: Partial<Record<FieldName, string>> = {};
    const parsed = ResetPasswordInput.safeParse({ token, password });
    if (!parsed.success) next.password = parsed.error.issues.find((i) => i.path[0] === "password")?.message;
    if (!confirm) next.confirm = "Enter the new password again";
    else if (confirm !== password) next.confirm = "The passwords don’t match";
    if (next.password || next.confirm) {
      setErrors(next);
      const field = next.password ? "password" : "confirm";
      (event.currentTarget.elements.namedItem(field) as HTMLInputElement | null)?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, password } });
      setPassword("");
      setConfirm("");
      setSubmitting(false);
      router.replace("/signin?notice=reset");
    } catch (error) {
      setSubmitting(false);
      if (isApiError(error, "INVALID_TOKEN")) setInvalid(true);
      else if (isApiError(error) && error.fields?.password) setErrors({ password: error.fields.password });
      else if (isApiError(error, "RATE_LIMITED")) setFormError(retryMessage(error.retryAfter));
      else setFormError(isApiError(error) ? error.message : "Something went wrong. Please try again.");
    }
  }

  if (invalid) {
    return (
      <div className="flex flex-col gap-[18px]">
        <AuthStatus icon="alert" tone="warning" title="This reset link has expired or was already used" headingRef={heading}>
          <p className="text-md text-secondary">
            Reset links work once and expire after 60 minutes. Request a new one and use the latest email.
          </p>
        </AuthStatus>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/forgot-password" className={buttonClasses()}>
            Request a new link
          </Link>
          <Link href="/signin" className={`px-1 py-2.5 text-sm ${textLinkClasses}`}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby={`${id}-title`} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Choose a new password
        </h1>
        <p className="text-md text-secondary">After you save it, every device signed in to your account is signed out.</p>
      </div>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id={`${id}-password`} label="New password" error={errors.password}>
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          invalid={!!errors.password}
          aria-describedby={describedBy(
            `${id}-password-rules`,
            password.length >= 12 && `${id}-password-strength`,
            errors.password && `${id}-password-error`,
          )}
        />
        <StrengthMeter id={`${id}-password-strength`} password={password} />
        <PasswordRules id={`${id}-password-rules`} rules={passwordRules(password, {})} />
      </Field>
      <Field id={`${id}-confirm`} label="Confirm new password" error={errors.confirm}>
        <PasswordInput
          id={`${id}-confirm`}
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErrors((prev) => ({ ...prev, confirm: undefined }));
          }}
          invalid={!!errors.confirm}
          aria-describedby={describedBy(errors.confirm && `${id}-confirm-error`)}
        />
      </Field>
      <Button type="submit" block disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
