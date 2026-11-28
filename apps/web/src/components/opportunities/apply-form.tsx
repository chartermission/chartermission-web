"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  OPPORTUNITY_LIMITS,
  UPLOAD_LIMITS,
  type ApplicationCv,
  type ApplicationCvFromResume,
  type ApplyInput,
  type MyApplication,
  type OpportunityDetail,
  type OwnProfile,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Field, FieldError, inputClasses } from "@/components/auth/fields";
import { ErrorNotice } from "@/components/social/errors";
import { formatBytes } from "@/components/social/format";
import { api, isApiError } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

type FieldName = "note" | "phone" | "cvFileId" | "link";
type FieldErrors = Partial<Record<FieldName, string>>;
const FIELD_ORDER: FieldName[] = ["note", "phone", "cvFileId", "link"];
const FIELD_INPUT: Record<FieldName, string> = { note: "apply-note", phone: "apply-phone", cvFileId: "apply-cv-upload", link: "apply-link" };

/** Same rules as ApplyInput (contracts), checked before sending so the member sees them at once. */
const PHONE = /^\+?[0-9 ()\-.]{6,30}$/;
const LINK = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

/** A CV, opened from the media endpoint (applicant, poster and reviewing staff only). */
export const cvHref = (cv: ApplicationCv) => `/api/v1/media/${cv.id}`;

/**
 * Who reads an application: the Charter Mission team for listings staff imported (reviewed in the
 * admin console), the page's team for listings posted as a page, otherwise the member who posted it.
 */
export type Recipient = { kind: "team" } | { kind: "page"; name: string } | { kind: "member"; name: string };

export function applicationRecipient(o: Pick<OpportunityDetail, "source" | "page" | "poster">): Recipient {
  if (o.source === "import") return { kind: "team" };
  if (o.page) return { kind: "page", name: o.page.name };
  return { kind: "member", name: o.poster.name };
}

/** "Apply with your Charter Mission profile and a short note. Only … sees your application." */
export function onlyRecipientSees(t: Translate, r: Recipient): string {
  if (r.kind === "team") return t("Apply with your Charter Mission profile and a short note. Only the Charter Mission team sees your application.");
  if (r.kind === "page") return t("Apply with your Charter Mission profile and a short note. Only {name}’s team sees your application.", { name: r.name });
  return t("Apply with your Charter Mission profile and a short note. Only {name} sees your application.", { name: r.name });
}

function sharedWith(t: Translate, r: Recipient): string {
  if (r.kind === "team") return t("Your name, profile and email go to the Charter Mission team with this application.");
  if (r.kind === "page") return t("Your name, profile and email go to {name}’s team with this application.", { name: r.name });
  return t("Your name, profile and email go to {name} with this application.", { name: r.name });
}

/** The PDF tile used for a CV in the form, in the applicant's own view and in the poster's review. */
export function CvTile({ cv, className }: { cv: ApplicationCv; className?: string }) {
  return (
    <a
      href={cvHref(cv)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("flex min-w-0 items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-muted", className)}
    >
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md bg-error-light text-[10px] font-bold text-error">PDF</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-sm font-medium text-ink">
          {cv.name}
        </span>
        <span className="text-xs text-secondary">{formatBytes(cv.sizeBytes)}</span>
      </span>
      <Icon name="external" size={16} className="shrink-0 text-secondary" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

type CvBusy = { step: "uploading" | "processing" | "copying"; progress: number } | null;

/**
 * The application form for listings that take applications in Charter Mission: a cover note
 * (required), and optionally a phone number, a CV (PDF up to 5 MB, uploaded as application_cv or
 * copied from the résumé on the member's profile) and a link. `previous` pre-fills the form when a
 * member applies again after withdrawing.
 */
export function ApplyForm({
  opportunity: o,
  previous,
  onApplied,
  onCancel,
}: {
  opportunity: OpportunityDetail;
  previous: MyApplication | null;
  onApplied: (next: OpportunityDetail) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const recipient = applicationRecipient(o);
  const [note, setNote] = useState(previous?.note ?? "");
  const [phone, setPhone] = useState(previous?.phone ?? "");
  const [link, setLink] = useState(previous?.link ?? "");
  const [cv, setCv] = useState<ApplicationCv | null>(previous?.cv ?? null);
  const [cvBusy, setCvBusy] = useState<CvBusy>(null);
  const [cvError, setCvError] = useState<unknown>(null);
  const [profileResume, setProfileResume] = useState<OwnProfile["resume"]>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.getElementById("apply-note")?.focus();
    // Offer the résumé on their profile, when there is one (a failure just leaves the option out).
    void api<OwnProfile>("/me/profile")
      .then((profile) => setProfileResume(profile.resume))
      .catch(() => undefined);
  }, []);

  const clear = (field: FieldName) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  function focusFirst(found: FieldErrors) {
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) document.getElementById(FIELD_INPUT[first])?.focus();
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setCvError(null);
    clear("cvFileId");
    setCvBusy({ step: "uploading", progress: 0 });
    try {
      const uploaded = await uploadFile(file, "application_cv", (fraction) => setCvBusy({ step: fraction >= 1 ? "processing" : "uploading", progress: fraction }));
      setCv({ id: uploaded.id, name: file.name || "CV.pdf", sizeBytes: file.size });
    } catch (e) {
      setCvError(e);
    } finally {
      setCvBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function attachProfileResume() {
    setCvError(null);
    clear("cvFileId");
    setCvBusy({ step: "copying", progress: 1 });
    try {
      setCv(await api<ApplicationCvFromResume>("/me/application-cv/from-resume", { method: "POST", body: {} }));
    } catch (e) {
      setCvError(e);
    } finally {
      setCvBusy(null);
    }
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (note.trim().length < OPPORTUNITY_LIMITS.noteMin) {
      found.note = t("Tell the poster why you’re a fit in at least {noteMin} characters", { noteMin: OPPORTUNITY_LIMITS.noteMin });
    }
    if (phone.trim() && !PHONE.test(phone.trim())) found.phone = t("Enter a phone number with digits, like +234 803 555 0199");
    if (link.trim() && !LINK.test(link.trim())) found.link = t("Enter a full link starting with https://");
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cvBusy) return;
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      focusFirst(found);
      return;
    }
    setBusy(true);
    setError(null);
    const body: ApplyInput = { note: note.trim(), phone: phone.trim() || null, link: link.trim() || null, cvFileId: cv?.id ?? null };
    try {
      onApplied(await api<OpportunityDetail>(`/opportunities/${o.id}/applications`, { method: "POST", body }));
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) {
        const fromApi: FieldErrors = {};
        for (const f of FIELD_ORDER) if (e.fields[f]) fromApi[f] = e.fields[f];
        setErrors(fromApi);
        // Anything the form can't point at is shown above the buttons.
        if (Object.keys(e.fields).some((k) => !(FIELD_ORDER as string[]).includes(k)) || !Object.keys(fromApi).length) setError(e);
        focusFirst(fromApi);
      } else {
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const cvStatus = !cvBusy
    ? null
    : cvBusy.step === "uploading"
      ? t("Uploading… {percent}%", { percent: Math.round(cvBusy.progress * 100) })
      : cvBusy.step === "processing"
        ? t("Checking the file…")
        : t("Adding the résumé from your profile…");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label={t("Application form")}>
      <Field id="apply-note" label={t("Cover note")} error={undefined}>
        <textarea
          id="apply-note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            clear("note");
          }}
          maxLength={OPPORTUNITY_LIMITS.note}
          rows={6}
          required
          aria-invalid={!!errors.note}
          aria-describedby="apply-note-help"
          placeholder="Why you’re a good fit, and anything they should know."
          className={cn(inputClasses(!!errors.note), "h-auto py-2.5")}
        />
        <p id="apply-note-help" className={cn("flex items-start gap-1 text-xs", errors.note ? "text-error" : "text-secondary")}>
          {errors.note && <Icon name="alert" size={14} className="mt-px shrink-0" />}
          {errors.note ?? t("Your profile goes with your note. {count} / {note}", { count: note.length, note: OPPORTUNITY_LIMITS.note })}
        </p>
      </Field>

      <Field id="apply-phone" label={t("Phone number (optional)")} error={errors.phone}>
        <input
          id="apply-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          value={phone}
          maxLength={30}
          onChange={(e) => {
            setPhone(e.target.value);
            clear("phone");
          }}
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? "apply-phone-error" : undefined}
          placeholder="+234 803 555 0199"
          className={inputClasses(!!errors.phone, "rtl:text-right")}
        />
      </Field>

      <div className="flex flex-col gap-1.5" role="group" aria-labelledby="apply-cv-label">
        <span id="apply-cv-label" className="text-sm font-medium text-ink">
          {t("CV (optional)")}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void chooseFile(e.target.files?.[0])}
        />
        {cv ? (
          <div className="flex flex-col gap-2">
            <CvTile cv={cv} />
            <div className="flex flex-wrap gap-2">
              <Button id="apply-cv-upload" type="button" variant="secondary" size="small" disabled={!!cvBusy} onClick={() => fileInput.current?.click()}>
                <Icon name="paperclip" size={16} />
                {t("Replace")}
              </Button>
              <Button type="button" variant="ghost" size="small" disabled={!!cvBusy} onClick={() => setCv(null)}>
                {t("Remove")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              id="apply-cv-upload"
              type="button"
              variant="secondary"
              size="small"
              disabled={!!cvBusy}
              aria-describedby="apply-cv-help"
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="paperclip" size={16} />
              {t("Upload a PDF")}
            </Button>
            {profileResume && (
              <Button type="button" variant="ghost" size="small" disabled={!!cvBusy} onClick={() => void attachProfileResume()}>
                {t("Use the résumé on my profile")}
              </Button>
            )}
          </div>
        )}
        <p id="apply-cv-help" className="text-xs text-secondary">
          {t("A PDF up to {size} MB.", { size: Math.round(UPLOAD_LIMITS.application_cv.maxBytes / 1024 / 1024) })}
        </p>
        {cvStatus && (
          <p role="status" className="flex items-center gap-2 text-sm text-body">
            <span className="block size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
            {cvStatus}
          </p>
        )}
        {cvError ? <ErrorNotice error={cvError} /> : null}
        <FieldError id="apply-cv-error" message={errors.cvFileId} />
      </div>

      <Field
        id="apply-link"
        label={t("Link (optional)")}
        hint={<span className="text-xs text-secondary">{t("Portfolio, LinkedIn or website")}</span>}
        error={errors.link}
      >
        <input
          id="apply-link"
          type="url"
          inputMode="url"
          autoComplete="url"
          dir="ltr"
          value={link}
          maxLength={2000}
          onChange={(e) => {
            setLink(e.target.value);
            clear("link");
          }}
          aria-invalid={!!errors.link}
          aria-describedby={errors.link ? "apply-link-error" : undefined}
          placeholder="https://"
          className={inputClasses(!!errors.link, "rtl:text-right")}
        />
      </Field>

      <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-body">
        <Icon name="info" size={14} className="mt-px shrink-0 text-secondary" />
        {sharedWith(t, recipient)}
      </p>

      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={busy || !!cvBusy}>
          {busy ? t("Sending…") : t("Send application")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}
