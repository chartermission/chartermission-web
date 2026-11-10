"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@chartermission/ui";
import { isApiError } from "@/lib/api/client";
import { Field, FormAlert, PasswordInput, describedBy, retryMessage } from "@/components/auth/fields";
import { Dialog, dangerButtonClasses } from "./dialog";
import { useT } from "@/i18n/client";

/**
 * Sensitive account actions re-check the password (deactivate, reactivate, delete, MFA off).
 * `onConfirm` performs the API call; field errors and 429s are shown inline.
 */
export function PasswordConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Extra fields rendered above the password (e.g. a reason). */
  children?: ReactNode;
  onConfirm: (password: string) => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setPassword("");
    setError(undefined);
    setFormError(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setError("Enter your password");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onConfirm(password);
      setPassword("");
    } catch (e) {
      if (isApiError(e, "RATE_LIMITED")) setFormError(retryMessage(t, e.retryAfter));
      else if (isApiError(e) && e.fields?.password) setError(e.fields.password);
      else setFormError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={title} description={description}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {children}
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field id={`${id}-password`} label="Your password" error={error}>
          <PasswordInput
            id={`${id}-password`}
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(undefined);
            }}
            invalid={!!error}
            aria-describedby={describedBy(error && `${id}-password-error`)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {danger ? (
            <button type="submit" className={dangerButtonClasses} disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Working…" : confirmLabel}
            </button>
          ) : (
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
