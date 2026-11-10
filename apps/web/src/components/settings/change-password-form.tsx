"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ChangePasswordInput } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, PasswordInput, describedBy, retryMessage } from "@/components/auth/fields";
import { PasswordRules, StrengthMeter, passwordRules } from "@/components/auth/password-rules";
import { SettingsCard } from "./settings-card";
import { useT } from "@/i18n/client";

type FieldName = "currentPassword" | "newPassword" | "confirm";

/** POST /me/password — keeps this session, signs out the others, sends a security email. */
export function ChangePasswordForm({ name, email }: { name: string; email: string }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: FieldName, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setStatus(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next: Partial<Record<FieldName, string>> = {};
    const parsed = ChangePasswordInput.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        next[field] ??= field === "currentPassword" ? "Enter your current password" : issue.message;
      }
    }
    if (!next.newPassword && passwordRules(values.newPassword, { name, email }).some((rule) => rule.met === false)) {
      next.newPassword = "Don’t use your name or email address in your password";
    }
    if (!values.confirm) next.confirm = "Enter the new password again";
    else if (values.confirm !== values.newPassword) next.confirm = "The passwords don’t match";
    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      const first = (["currentPassword", "newPassword", "confirm"] as const).find((f) => next[f]);
      (event.currentTarget.elements.namedItem(first!) as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    try {
      await api("/me/password", {
        method: "POST",
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      setValues({ currentPassword: "", newPassword: "", confirm: "" });
      setStatus({
        tone: "success",
        text: "Your password was changed. Other devices were signed out and we emailed you a confirmation.",
      });
      router.refresh();
    } catch (e) {
      if (isApiError(e, "RATE_LIMITED")) setStatus({ tone: "error", text: retryMessage(t, e.retryAfter) });
      else if (isApiError(e) && e.fields) setErrors(e.fields as Partial<Record<FieldName, string>>);
      else setStatus({ tone: "error", text: isApiError(e) ? e.message : "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="password" title="Password" description="Changing it signs out every other device." list={false}>
      <form noValidate onSubmit={submit} className="flex max-w-[420px] flex-col gap-4">
        <Field id={`${id}-current`} label="Current password" error={errors.currentPassword}>
          <PasswordInput
            id={`${id}-current`}
            name="currentPassword"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={(e) => set("currentPassword", e.target.value)}
            invalid={!!errors.currentPassword}
            aria-describedby={describedBy(errors.currentPassword && `${id}-current-error`)}
          />
        </Field>
        <Field id={`${id}-new`} label="New password" error={errors.newPassword}>
          <PasswordInput
            id={`${id}-new`}
            name="newPassword"
            autoComplete="new-password"
            value={values.newPassword}
            onChange={(e) => set("newPassword", e.target.value)}
            invalid={!!errors.newPassword}
            aria-describedby={describedBy(
              `${id}-new-rules`,
              values.newPassword.length >= 12 && `${id}-new-strength`,
              errors.newPassword && `${id}-new-error`,
            )}
          />
          <StrengthMeter id={`${id}-new-strength`} password={values.newPassword} />
          <PasswordRules id={`${id}-new-rules`} rules={passwordRules(values.newPassword, { name, email })} />
        </Field>
        <Field id={`${id}-confirm`} label="Confirm new password" error={errors.confirm}>
          <PasswordInput
            id={`${id}-confirm`}
            name="confirm"
            autoComplete="new-password"
            value={values.confirm}
            onChange={(e) => set("confirm", e.target.value)}
            invalid={!!errors.confirm}
            aria-describedby={describedBy(errors.confirm && `${id}-confirm-error`)}
          />
        </Field>
        <div aria-live="polite">{status && <FormAlert tone={status.tone}>{status.text}</FormAlert>}</div>
        <Button type="submit" className="self-start" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </form>
    </SettingsCard>
  );
}
