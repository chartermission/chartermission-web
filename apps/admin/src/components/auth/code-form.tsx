"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Icon } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { ApiError, errorMessage, retryText } from "@/lib/api/client";

/**
 * Six-digit authenticator code form used by MFA setup and verification. `onSubmit` calls the API;
 * wrong codes, rate limits (429 with retryAfter) and other errors are shown under the field.
 */
export function CodeForm({
  submitLabel,
  busyLabel,
  onSubmit,
}: {
  submitLabel: string;
  busyLabel: string;
  onSubmit: (code: string) => Promise<void>;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState<number | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (e) {
      setBusy(false);
      setCode("");
      if (e instanceof ApiError && e.status === 429) {
        setLockedFor(e.retryAfter ?? null);
        setError(`Too many wrong codes. ${e.retryAfter ? retryText(e.retryAfter) : "Try again later."}`);
      } else if (e instanceof ApiError && e.code === "INVALID_MFA_CODE") {
        setError("That code didn’t work. Codes change every 30 seconds — enter the latest one.");
      } else {
        setError(errorMessage(e));
      }
      inputRef.current?.focus();
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-code`} className="text-label text-ink">
          6-digit code
        </label>
        <input
          ref={inputRef}
          id={`${id}-code`}
          name="code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            if (error && !lockedFor) setError(null);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          autoFocus
          placeholder="123456"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={inputClasses(!!error, "text-center font-mono text-h3 tracking-[0.4em] placeholder:tracking-[0.4em]")}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
            <Icon name="alert" size={14} className="shrink-0" />
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-xs text-secondary">
            Open your authenticator app and enter the code shown for Charter Mission.
          </p>
        )}
      </div>
      <Button type="submit" block disabled={busy} aria-busy={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
    </form>
  );
}
