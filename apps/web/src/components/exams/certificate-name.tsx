"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CertificateName, type ExamCertificateView } from "@chartermission/contracts";
import { Button, Icon, Panel, buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, describedBy, inputClasses } from "@/components/auth/fields";
import { toast } from "@/components/social/toast";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

type NameCheck = NonNullable<ExamCertificateView["nameCheck"]>;

/** How the API stores a name: trimmed, with runs of spaces made one (as CertificateName does). */
const normalise = (name: string) => name.trim().replace(/\s+/g, " ");

/** Stands in for a variable while the sentence is translated, so the value can be put in as an element. */
export const SLOT = "\u2063";

/**
 * A translated sentence with something the member or an admin wrote in it, isolated for the text
 * direction and left untranslated (a name like "Chad" is not the country).
 */
export function Sentence({ text, value }: { text: string; value: string }) {
  const [before, ...rest] = text.split(SLOT);
  return (
    <>
      {before}
      <NoTranslate>
        <bdi className="font-medium text-ink">{value}</bdi>
      </NoTranslate>
      {rest.join(value)}
    </>
  );
}

/**
 * Asks the member to confirm the name Charter Center prints on their certificate (status awaiting),
 * or says a name they asked for is being checked (status review), with a way to change it.
 * A name that matches their profile is sent straight away; any other is checked by the team first.
 */
export function NameCheckPanel({ examId, check, onChange }: { examId: string; check: NameCheck; onChange: (next: ExamCertificateView) => void }) {
  const router = useRouter();
  const t = useT();
  const id = useId();
  const inputId = `${id}-name`;
  const [editing, setEditing] = useState(check.status === "awaiting");
  const [value, setValue] = useState(check.status === "review" && check.proposedName ? check.proposedName : check.suggestedName);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  // Focus moves into the form when "Change it" opens it, and back to that button when it's closed again.
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    if (editing) input.current?.focus();
    else changeButton.current?.focus();
  }, [editing]);

  function openForm() {
    moved.current = true;
    setValue(check.proposedName ?? check.suggestedName);
    setError(undefined);
    setFormError(null);
    setEditing(true);
  }

  function closeForm() {
    moved.current = true;
    setEditing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const parsed = CertificateName.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter your name as it should appear on your certificate");
      input.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const next = await api<ExamCertificateView>(`/exams/${examId}/certificate/name`, { method: "POST", body: { name: parsed.data } });
      if (!next.nameCheck) toast.success(check.replacing ? "Name confirmed" : "Name confirmed. Your certificate is on its way.");
      // The same name asked for again keeps this panel (its key), so close the form here.
      moved.current = false;
      setEditing(next.nameCheck?.status === "awaiting");
      onChange(next);
      // The status chip at the top of the page comes from the server.
      router.refresh();
    } catch (e) {
      if (isApiError(e) && e.fields?.name) {
        setError(e.fields.name);
        input.current?.focus();
      } else if (isApiError(e) && e.status === 409) {
        // Nothing to confirm any more (an admin acted, or another tab did): show where things stand.
        toast.error(e);
        const latest = await api<ExamCertificateView | null>(`/exams/${examId}/certificate`).catch(() => null);
        if (latest) onChange(latest);
      } else {
        setFormError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing && check.status === "review" && check.proposedName) {
    return (
      <Panel role="status" aria-labelledby={`${id}-title`} className="flex items-start gap-3 p-5 max-sm:p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
          <Icon name="clock" size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="text-md font-semibold text-ink">
              We’re checking your name
            </h2>
            <p className="text-sm text-body">
              <Sentence
                value={check.proposedName}
                text={
                  check.replacing
                    ? t("You asked for “{name}” on your certificate. Our team checks names that differ from your profile; we’ll replace your certificate as soon as it’s approved.", { name: SLOT })
                    : t("You asked for “{name}” on your certificate. Our team checks names that differ from your profile; we’ll send your certificate as soon as it’s approved.", { name: SLOT })
                }
              />
            </p>
          </div>
          <div>
            <button ref={changeButton} type="button" onClick={openForm} className={buttonClasses({ variant: "secondary", size: "small" })}>
              <Icon name="edit" size={16} />
              Change it
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  const typed = normalise(value);
  const differs = typed !== normalise(check.profileName);
  const hintId = `${id}-hint`;

  return (
    <Panel aria-labelledby={`${id}-title`} className="flex flex-col gap-4 border-s-4 border-s-warning p-5 max-sm:p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-light text-warning">
          <Icon name="user" size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`${id}-title`} className="text-md font-semibold text-ink">
            Confirm the name on your certificate
          </h2>
          <p className="text-sm text-body">
            {check.replacing
              ? "Check your name as it should be printed. If it changes, you’ll get a new certificate that replaces this one."
              : "Charter Center prints this name on your certificate exactly as you write it."}
          </p>
        </div>
      </div>

      {check.declinedReason && (
        <FormAlert tone="warning">
          <p className="font-medium text-ink">The name you asked for wasn’t approved.</p>
          <p>
            <Sentence text={t("Reason: {reason}", { reason: SLOT })} value={check.declinedReason} />
          </p>
        </FormAlert>
      )}

      <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field id={inputId} label="Name on your certificate" error={error}>
          <input
            ref={input}
            id={inputId}
            name="name"
            type="text"
            dir="auto"
            autoComplete="name"
            maxLength={120}
            value={value}
            readOnly={submitting}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(error && `${inputId}-error`, typed && hintId)}
            className={inputClasses(!!error, "text-start")}
          />
          {typed && <NameHint id={hintId} differs={differs} profileName={check.profileName} />}
        </Field>
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          <Button type="submit" disabled={submitting} aria-busy={submitting || undefined} className="max-sm:w-full">
            <Icon name="check" size={18} />
            {submitting ? t("Confirming…") : t("Confirm name")}
          </Button>
          {check.status === "review" && (
            <Button variant="secondary" disabled={submitting} onClick={closeForm} className="max-sm:w-full">
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function NameHint({ id, differs, profileName }: { id: string; differs: boolean; profileName: string }) {
  const t = useT();
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs text-secondary">
      <Icon name={differs ? "info" : "check"} size={14} className="mt-px shrink-0" />
      <span>
        {differs ? (
          <Sentence text={t("This isn’t the name on your profile ({name}), so our team checks it before your certificate is sent.", { name: SLOT })} value={profileName} />
        ) : (
          "This is the name on your profile."
        )}
      </span>
    </p>
  );
}
