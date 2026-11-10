"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { SessionUser } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { destinationFor } from "./destinations";
import { Field, FormAlert, describedBy, inputClasses, retryMessage, textLinkClasses } from "./fields";
import { useT } from "@/i18n/client";

/** Second sign-in step for members who turned on two-step verification (POST /auth/mfa/verify). */
export function MfaVerifyForm({ next }: { next: string | null }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      await api("/auth/mfa/verify", { method: "POST", body: { code: digits } });
      const me = await api<SessionUser>("/me");
      router.replace(destinationFor(me, next));
      router.refresh();
    } catch (e) {
      setSubmitting(false);
      setCode("");
      if (isApiError(e, "RATE_LIMITED")) setError(retryMessage(t, e.retryAfter, "Too many incorrect codes."));
      else if (isApiError(e) && e.status === 401) router.replace("/signin?notice=expired");
      else if (isApiError(e)) setError(e.code === "VALIDATION_FAILED" ? "That code isn’t right. Try the current one." : e.message);
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
          Two-step verification
        </h1>
        <p className="text-md text-secondary">Enter the 6-digit code from your authenticator app to finish signing in.</p>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}

      <Field id={`${id}-code`} label="Verification code">
        <input
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          autoFocus
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && `${id}-code-error`)}
          className={inputClasses(!!error, "tracking-[0.3em] tabular-nums")}
        />
      </Field>

      <Button type="submit" block disabled={submitting} aria-busy={submitting || undefined}>
        {submitting ? "Checking…" : "Verify and continue"}
      </Button>

      <p className="text-center text-sm text-secondary">
        Not you?{" "}
        <button type="button" onClick={useAnotherAccount} className={textLinkClasses}>
          Use a different account
        </button>
      </p>
    </form>
  );
}
