"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { CorrectEmailInput } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, PasswordInput, describedBy, inputClasses, retryMessage, textLinkClasses } from "./fields";
import { useT } from "@/i18n/client";

type Errors = Partial<Record<"email" | "password" | "newEmail", string>>;

/**
 * "Entered the wrong email?" on the check-your-email page after sign-up: the address they typed and
 * their password prove it's their new account, and the verification link goes to the right address
 * instead (POST /auth/email/correct). Only works until the address has been confirmed.
 */
export function CorrectEmail({ email: signedUpWith }: { email: string | null }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(signedUpWith ?? "");
  const [password, setPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = CorrectEmailInput.safeParse({ email, password, newEmail });
    if (!parsed.success) {
      const fields: Errors = {};
      for (const issue of parsed.error.issues) fields[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(fields);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api("/auth/email/correct", { method: "POST", body: parsed.data });
      setOpen(false);
      setPassword("");
      setNewEmail("");
      setEmail(parsed.data.newEmail);
      router.replace(`/check-email?email=${encodeURIComponent(parsed.data.newEmail)}`);
    } catch (e) {
      if (isApiError(e, "RATE_LIMITED")) setFormError(retryMessage(t, e.retryAfter));
      else if (isApiError(e) && e.fields && (e.fields.email || e.fields.password || e.fields.newEmail))
        setErrors({ email: e.fields.email, password: e.fields.password, newEmail: e.fields.newEmail });
      else setFormError(isApiError(e) ? e.message : t("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`self-start px-1 py-2.5 text-sm ${textLinkClasses}`}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => first.current?.focus());
        }}
      >
        Entered the wrong email? Fix it
      </button>
    );
  }

  const set = (key: keyof Errors, setter: (v: string) => void) => (value: string) => {
    setter(value);
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg border border-line p-4" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-md font-semibold text-ink">
        Fix your email address
      </h2>
      <p className="text-sm text-secondary">Enter the password you just chose and the right address. We’ll send the verification link there instead.</p>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      {!signedUpWith && (
        <Field id={`${id}-email`} label="Email you signed up with" error={errors.email}>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            dir="ltr"
            value={email}
            onChange={(e) => set("email", setEmail)(e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={describedBy(errors.email && `${id}-email-error`)}
            className={inputClasses(!!errors.email)}
          />
        </Field>
      )}
      <Field id={`${id}-new`} label="Correct email" error={errors.newEmail}>
        <input
          ref={first}
          id={`${id}-new`}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          value={newEmail}
          onChange={(e) => set("newEmail", setNewEmail)(e.target.value)}
          aria-invalid={!!errors.newEmail}
          aria-describedby={describedBy(errors.newEmail && `${id}-new-error`)}
          className={inputClasses(!!errors.newEmail)}
        />
      </Field>
      <Field id={`${id}-password`} label="Your password" error={errors.password}>
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => set("password", setPassword)(e.target.value)}
          invalid={!!errors.password}
          aria-describedby={describedBy(errors.password && `${id}-password-error`)}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : "Send the link there"}
        </Button>
      </div>
    </form>
  );
}
