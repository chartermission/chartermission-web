"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { CreateAppealInput, type AppealView } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { FormAlert, retryMessage } from "@/components/auth/fields";

const MIN = 20;
const MAX = 2000;

/** POST /appeals — one appeal per action (CM-ADM-06), reviewed by a different moderator. */
export function AppealForm({ actionId }: { actionId: string }) {
  const id = useId();
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = statement.trim().length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = CreateAppealInput.safeParse({ actionId, statement });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      (event.currentTarget.elements.namedItem("statement") as HTMLTextAreaElement | null)?.focus();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api<AppealView>("/appeals", { method: "POST", body: parsed.data });
      router.refresh();
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "CONFLICT")) {
        router.refresh();
        setFormError(e.message);
      } else if (isApiError(e) && e.fields?.statement) setError(e.fields.statement);
      else if (isApiError(e, "RATE_LIMITED")) setFormError(retryMessage(e.retryAfter));
      else setFormError(isApiError(e) ? e.message : "Your appeal wasn’t sent. Please try again.");
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${id}-statement`} className="text-sm font-medium text-ink">
            Why should we reconsider?
          </label>
          <span
            id={`${id}-count`}
            aria-live="polite"
            className={cn(
              "text-xs",
              length > MAX ? "text-error" : length > 0 && length < MIN ? "text-warning" : "text-secondary",
            )}
          >
            {length}/{MAX}
            {length > 0 && length < MIN ? ` · ${MIN - length} more needed` : ""}
          </span>
        </div>
        <textarea
          id={`${id}-statement`}
          name="statement"
          rows={7}
          value={statement}
          onChange={(e) => {
            setStatement(e.target.value);
            setError(undefined);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-hint`, `${id}-count`, error && `${id}-error`].filter(Boolean).join(" ")}
          className={cn(
            "w-full rounded-lg border bg-card px-3.5 py-3 text-sm text-ink placeholder:text-disabled focus:ring-[0.5px] focus:outline-none",
            error
              ? "border-error focus:ring-error"
              : "border-line hover:border-line-strong focus:border-primary focus:ring-primary",
          )}
          placeholder="Explain what happened and why you think the decision was wrong. Include any context the moderator may have missed."
        />
        {error && (
          <p id={`${id}-error`} className="text-xs text-error">
            {error}
          </p>
        )}
        <p id={`${id}-hint`} className="text-xs text-secondary">
          You can appeal each decision once. A different moderator from the one who made it will review your appeal, and we’ll
          notify you of the outcome.
        </p>
      </div>
      <Button type="submit" className="self-start" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Sending…" : "Submit appeal"}
      </Button>
    </form>
  );
}
