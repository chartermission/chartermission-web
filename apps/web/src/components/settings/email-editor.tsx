"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChangeEmailInput, type EmailChangeResult } from "@chartermission/contracts";
import { Button, Chip, Icon } from "@chartermission/ui";
import { Field, FormAlert, PasswordInput, describedBy, inputClasses, retryMessage } from "@/components/auth/fields";
import { ResendVerification } from "@/components/auth/resend-verification";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";

/** Opening /settings#change-email (from the "wrong email?" banner) starts with the form open. */
export const CHANGE_EMAIL_ANCHOR = "change-email";
/** Fired by that banner link, for when Settings is already open (a same-page hash link doesn't remount it). */
export const CHANGE_EMAIL_EVENT = "cm:change-email";

/**
 * The account's email in Settings: change it (new address + password), and while a change waits for
 * its link, resend or cancel it. Confirmed accounts keep their current address until the link sent
 * to the new one is opened; unconfirmed accounts (a typo at sign-up) switch straight away.
 */
export function EmailEditor({ email, emailVerified, pendingEmail }: { email: string; emailVerified: boolean; pendingEmail: string | null }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingBusy, setPendingBusy] = useState<"resend" | "cancel" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function open() {
    setEditing(true);
    requestAnimationFrame(() => input.current?.focus());
  }

  useEffect(() => {
    const start = () => {
      open();
      document.getElementById(CHANGE_EMAIL_ANCHOR)?.scrollIntoView({ block: "center" });
    };
    if (window.location.hash === `#${CHANGE_EMAIL_ANCHOR}`) start();
    window.addEventListener(CHANGE_EMAIL_EVENT, start);
    return () => window.removeEventListener(CHANGE_EMAIL_EVENT, start);
  }, []);

  function close() {
    setEditing(false);
    setValue("");
    setPassword("");
    setErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = ChangeEmailInput.safeParse({ email: value, password });
    if (!parsed.success) {
      const fields: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        fields[key] ??= issue.message;
      }
      setErrors(fields);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const result = await api<EmailChangeResult>("/me/email", { method: "POST", body: parsed.data });
      close();
      toast.success(
        result.status === "pending"
          ? t("Check {email} and open the link to confirm it.", { email: result.email })
          : t("Your email is now {email}. We sent a verification link there.", { email: result.email }),
      );
      router.refresh();
    } catch (e) {
      if (isApiError(e, "RATE_LIMITED")) setFormError(retryMessage(t, e.retryAfter));
      else if (isApiError(e) && (e.fields?.email || e.fields?.password)) setErrors({ email: e.fields.email, password: e.fields.password });
      else setFormError(isApiError(e) ? e.message : t("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function pendingAction(kind: "resend" | "cancel") {
    if (pendingBusy) return;
    setPendingBusy(kind);
    try {
      if (kind === "resend") {
        await api("/me/email/resend", { method: "POST" });
        toast.success(t("We sent the link to {email} again.", { email: pendingEmail ?? "" }));
      } else {
        await api("/me/email", { method: "DELETE" });
        toast.success(t("Email change cancelled"));
        router.refresh();
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setPendingBusy(null);
    }
  }

  return (
    <li id={CHANGE_EMAIL_ANCHOR} className="flex scroll-mt-24 flex-col gap-3 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">Email</span>
          <span className="text-sm break-all text-body" dir="ltr">
            {email}
          </span>
          {!emailVerified && <span className="text-xs text-secondary">We sent a verification link to this address.</span>}
        </div>
        <div className="flex flex-col items-end gap-2 max-sm:items-start">
          <div className="flex items-center gap-2">
            {emailVerified ? <Chip tone="success">Verified</Chip> : <Chip tone="warning">Not verified</Chip>}
            {!editing && (
              <Button variant="secondary" size="small" onClick={open}>
                Change
              </Button>
            )}
          </div>
          {!emailVerified && !editing && <ResendVerification size="small" label="Resend email" className="items-end max-sm:items-start" />}
        </div>
      </div>

      {pendingEmail && !editing && (
        <div className="flex flex-col gap-2 rounded-lg border border-info/30 bg-info-light p-3.5" role="status">
          <p className="flex items-start gap-2 text-sm text-body">
            <Icon name="mail" size={16} className="mt-0.5 shrink-0 text-info" />
            <span>
              {t("Waiting for you to confirm {email}. Open the link we sent there; until then, keep signing in with {current}.", {
                email: pendingEmail,
                current: email,
              })}
            </span>
          </p>
          <div className="flex flex-wrap gap-2 ps-6">
            <Button variant="secondary" size="small" onClick={() => void pendingAction("resend")} disabled={!!pendingBusy} aria-busy={pendingBusy === "resend"}>
              Send the link again
            </Button>
            <Button variant="ghost" size="small" onClick={() => void pendingAction("cancel")} disabled={!!pendingBusy} aria-busy={pendingBusy === "cancel"}>
              Cancel the change
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-sm text-secondary">
            {emailVerified
              ? "We’ll send a link to the new address. Your current email keeps working until you open it."
              : "Your email isn’t confirmed yet, so it changes straight away and we send the verification link to the new address."}
          </p>
          {formError && <FormAlert tone="error">{formError}</FormAlert>}
          <Field id={`${id}-email`} label="New email" error={errors.email}>
            <input
              ref={input}
              id={`${id}-email`}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              aria-invalid={!!errors.email}
              aria-describedby={describedBy(errors.email && `${id}-email-error`)}
              className={inputClasses(!!errors.email)}
            />
          </Field>
          <Field id={`${id}-password`} label="Your password" error={errors.password}>
            <PasswordInput
              id={`${id}-password`}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              invalid={!!errors.password}
              aria-describedby={describedBy(errors.password && `${id}-password-error`)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="small" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="small" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Working…" : emailVerified ? "Send confirmation link" : "Change email"}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
