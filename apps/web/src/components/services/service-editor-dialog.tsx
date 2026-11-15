"use client";

import { useId, useState, type FormEvent } from "react";
import {
  CONSULTATION_DURATIONS,
  CONSULTATION_MODE_LABELS,
  ConsultationMode,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_MAX_SKILLS,
  SERVICE_RATE_NOTE_MAX,
  SERVICE_TITLE_MAX,
  ServiceInput,
  type ServiceHostInput,
  type ServiceView,
} from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { Field, inputClasses } from "@/components/auth/fields";
import { Switch } from "@/components/settings/controls";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { api, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { durationLabel } from "./format";

const selectClasses = (invalid: boolean) => inputClasses(invalid, "cursor-pointer appearance-none");
const textareaClasses = (invalid: boolean) => cn(inputClasses(invalid), "h-auto resize-y py-2.5");

type Draft = {
  title: string;
  description: string;
  skills: string;
  rateNote: string;
  bookable: boolean;
  durationMinutes: string;
  mode: string;
  locationHint: string;
  meetingDetails: string;
  noticeHours: string;
  windowDays: string;
  active: boolean;
};

function draftOf(service?: ServiceView | null): Draft {
  return {
    title: service?.title ?? "",
    description: service?.description ?? "",
    skills: service?.skills.join(", ") ?? "",
    rateNote: service?.rateNote ?? "",
    bookable: service?.bookable ?? false,
    durationMinutes: service?.durationMinutes ? String(service.durationMinutes) : "30",
    mode: service?.mode ?? "video",
    locationHint: service?.locationHint ?? "",
    meetingDetails: service?.meetingDetails ?? "",
    noticeHours: String(service?.noticeHours ?? 12),
    windowDays: String(service?.windowDays ?? 30),
    active: service?.active ?? true,
  };
}

const wholeNumber = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);

/**
 * Add or edit a service (POST /services, PATCH /services/{id}: the whole service each time). The
 * host comes from `host`. Turning on "People can book a free consultation" reveals the length, how
 * you meet, a public hint about the place, the private meeting details, notice and how far ahead.
 */
export function ServiceEditorDialog({
  host,
  service,
  position,
  onClose,
  onSaved,
}: {
  host: ServiceHostInput;
  service?: ServiceView | null;
  /** Where a new service goes in the list (defaults to the end, decided by the API). */
  position?: number;
  onClose: () => void;
  onSaved: (service: ServiceView) => void;
}) {
  const t = useT();
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(service));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fid = (key: string) => `${uid}-${key}`;
  const err = (key: string) => errors[key];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const skills = draft.skills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pageHost = host.type === "page";

  function body() {
    return {
      host,
      title: draft.title,
      description: draft.description,
      skills,
      rateNote: draft.rateNote.trim() || null,
      bookable: draft.bookable,
      durationMinutes: draft.bookable ? Number(draft.durationMinutes) : null,
      mode: draft.bookable ? (draft.mode as ConsultationMode) : null,
      locationHint: draft.bookable ? draft.locationHint.trim() || null : null,
      meetingDetails: draft.bookable ? draft.meetingDetails.trim() || null : null,
      noticeHours: wholeNumber(draft.noticeHours),
      windowDays: wholeNumber(draft.windowDays),
      active: draft.active,
      ...(service ? { position: service.position } : position !== undefined ? { position } : {}),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const payload = body();
    const next: Record<string, string> = {};
    if (skills.length > SERVICE_MAX_SKILLS) next.skills = t("Up to {count} skills", { count: SERVICE_MAX_SKILLS });
    else if (skills.some((s) => s.length > 40)) next.skills = t("Keep each skill under 40 characters");
    if (draft.bookable) {
      if (!(payload.noticeHours >= 0 && payload.noticeHours <= 168)) next.noticeHours = t("Enter a number of hours from 0 to 168");
      if (!(payload.windowDays >= 1 && payload.windowDays <= 90)) next.windowDays = t("Enter a number of days from 1 to 90");
    } else {
      // Not shown when booking is off: keep whatever is valid, or the defaults.
      if (!(payload.noticeHours >= 0 && payload.noticeHours <= 168)) payload.noticeHours = 12;
      if (!(payload.windowDays >= 1 && payload.windowDays <= 90)) payload.windowDays = 30;
    }
    const parsed = ServiceInput.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "skills" ? "skills" : issue.path.join(".");
        if (key && !next[key]) next[key] = issue.message;
      }
    }
    if (Object.keys(next).length) {
      setErrors(next);
      document.getElementById(fid(Object.keys(next)[0]!))?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = service
        ? await api<ServiceView>(`/services/${service.id}`, { method: "PATCH", body: payload })
        : await api<ServiceView>("/services", { method: "POST", body: payload });
      onSaved(saved);
      document.getElementById(fid("form"))?.closest("dialog")?.close();
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields) setErrors(e.fields);
      setServerError(e);
      setBusy(false);
    }
  }

  const counter = (n: number, max: number) => (
    <span className={cn("text-xs", n > max - 20 ? "text-warning" : "text-secondary")}>
      {n} / {max}
    </span>
  );

  return (
    <Dialog
      title={service ? t("Edit service") : t("Add a service")}
      description={pageHost ? "What the page offers. Visitors can book it or send an enquiry." : "What you offer. People can book it or message you about it."}
      onClose={onClose}
      width={620}
      initialFocus="input"
      footer={
        <>
          <Button variant="secondary" onClick={() => document.getElementById(fid("form"))?.closest("dialog")?.close()}>
            Cancel
          </Button>
          <Button type="submit" form={fid("form")} variant="accent" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : service ? "Save changes" : "Add service"}
          </Button>
        </>
      }
    >
      <form id={fid("form")} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field id={fid("title")} label="Name" hint={counter(draft.title.length, SERVICE_TITLE_MAX)} error={err("title")}>
          <input
            id={fid("title")}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={SERVICE_TITLE_MAX}
            placeholder="e.g. Export readiness review"
            aria-invalid={!!err("title") || undefined}
            aria-describedby={err("title") ? `${fid("title")}-error` : undefined}
            className={inputClasses(!!err("title"))}
          />
        </Field>

        <Field id={fid("description")} label="What it covers" hint={counter(draft.description.length, SERVICE_DESCRIPTION_MAX)} error={err("description")}>
          <textarea
            id={fid("description")}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={SERVICE_DESCRIPTION_MAX}
            rows={5}
            placeholder="Who it’s for, what you do and what people come away with."
            aria-invalid={!!err("description") || undefined}
            aria-describedby={err("description") ? `${fid("description")}-error` : undefined}
            className={textareaClasses(!!err("description"))}
          />
        </Field>

        <Field
          id={fid("skills")}
          label="Skills, separated by commas (optional)"
          hint={<span className="text-xs text-secondary">{t("{count} of {max}", { count: skills.length, max: SERVICE_MAX_SKILLS })}</span>}
          error={err("skills")}
        >
          <input
            id={fid("skills")}
            value={draft.skills}
            onChange={(e) => set("skills", e.target.value)}
            placeholder="e.g. Trade finance, Logistics"
            aria-invalid={!!err("skills") || undefined}
            aria-describedby={err("skills") ? `${fid("skills")}-error` : undefined}
            className={inputClasses(!!err("skills"))}
          />
        </Field>

        <Field id={fid("rateNote")} label="Rates (optional)" hint={counter(draft.rateNote.length, SERVICE_RATE_NOTE_MAX)} error={err("rateNote")}>
          <input
            id={fid("rateNote")}
            value={draft.rateNote}
            onChange={(e) => set("rateNote", e.target.value)}
            maxLength={SERVICE_RATE_NOTE_MAX}
            placeholder="e.g. Projects quoted after a first call"
            aria-invalid={!!err("rateNote") || undefined}
            aria-describedby={`${fid("rateNote")}-hint${err("rateNote") ? ` ${fid("rateNote")}-error` : ""}`}
            className={inputClasses(!!err("rateNote"))}
          />
          <p id={`${fid("rateNote")}-hint`} className="text-xs text-secondary">
            Consultations booked here are always free.
          </p>
        </Field>

        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-4">
          <div className="flex items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id={fid("bookable-label")} className="text-sm font-medium text-ink">
                People can book a free consultation
              </span>
              <span id={fid("bookable-hint")} className="text-xs text-secondary">
                They pick an open time from your availability. You get a notification for each booking.
              </span>
            </div>
            <Switch id={fid("bookable")} checked={draft.bookable} onChange={(v) => set("bookable", v)} label={t("People can book a free consultation")} describedBy={fid("bookable-hint")} />
          </div>

          {draft.bookable && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id={fid("durationMinutes")} label="Length" error={err("durationMinutes")}>
                  <select id={fid("durationMinutes")} value={draft.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} className={selectClasses(!!err("durationMinutes"))}>
                    {CONSULTATION_DURATIONS.map((m) => (
                      <option key={m} value={m}>
                        {durationLabel(t, m)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={fid("mode")} label="How you meet" error={err("mode")}>
                  <select id={fid("mode")} value={draft.mode} onChange={(e) => set("mode", e.target.value)} className={selectClasses(!!err("mode"))}>
                    {ConsultationMode.options.map((m) => (
                      <option key={m} value={m}>
                        {CONSULTATION_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field id={fid("locationHint")} label="Where, in a few words (optional)" error={err("locationHint")}>
                <input
                  id={fid("locationHint")}
                  value={draft.locationHint}
                  onChange={(e) => set("locationHint", e.target.value)}
                  maxLength={80}
                  placeholder={draft.mode === "in_person" ? "e.g. Accra, Osu" : draft.mode === "phone" ? "e.g. WhatsApp call" : "e.g. Google Meet"}
                  aria-describedby={`${fid("locationHint")}-hint`}
                  className={inputClasses(!!err("locationHint"))}
                />
                <p id={`${fid("locationHint")}-hint`} className="text-xs text-secondary">
                  Everyone sees this.
                </p>
              </Field>

              <Field id={fid("meetingDetails")} label="Meeting details" error={err("meetingDetails")}>
                <textarea
                  id={fid("meetingDetails")}
                  value={draft.meetingDetails}
                  onChange={(e) => set("meetingDetails", e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder={draft.mode === "in_person" ? "The full address" : draft.mode === "phone" ? "The number to call" : "https://meet.google.com/…"}
                  aria-invalid={!!err("meetingDetails") || undefined}
                  aria-describedby={`${fid("meetingDetails")}-hint${err("meetingDetails") ? ` ${fid("meetingDetails")}-error` : ""}`}
                  className={textareaClasses(!!err("meetingDetails"))}
                />
                <p id={`${fid("meetingDetails")}-hint`} className="text-xs text-secondary">
                  Only people who book see this.
                </p>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id={fid("noticeHours")} label="Notice needed, in hours" error={err("noticeHours")}>
                  <input
                    id={fid("noticeHours")}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={168}
                    value={draft.noticeHours}
                    onChange={(e) => set("noticeHours", e.target.value)}
                    aria-invalid={!!err("noticeHours") || undefined}
                    aria-describedby={`${fid("noticeHours")}-hint${err("noticeHours") ? ` ${fid("noticeHours")}-error` : ""}`}
                    className={inputClasses(!!err("noticeHours"))}
                  />
                  <p id={`${fid("noticeHours")}-hint`} className="text-xs text-secondary">
                    Nobody can book a time sooner than this.
                  </p>
                </Field>
                <Field id={fid("windowDays")} label="How far ahead, in days" error={err("windowDays")}>
                  <input
                    id={fid("windowDays")}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    value={draft.windowDays}
                    onChange={(e) => set("windowDays", e.target.value)}
                    aria-invalid={!!err("windowDays") || undefined}
                    aria-describedby={`${fid("windowDays")}-hint${err("windowDays") ? ` ${fid("windowDays")}-error` : ""}`}
                    className={inputClasses(!!err("windowDays"))}
                  />
                  <p id={`${fid("windowDays")}-hint`} className="text-xs text-secondary">
                    Times further out stay closed.
                  </p>
                </Field>
              </div>
            </>
          )}
        </div>

        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">{pageHost ? "Show on the page" : "Show on your profile"}</span>
            <span id={fid("active-hint")} className="text-xs text-secondary">
              Turn this off to hide it while you work on it.
            </span>
          </div>
          <Switch
            id={fid("active")}
            checked={draft.active}
            onChange={(v) => set("active", v)}
            label={pageHost ? t("Show on the page") : t("Show on your profile")}
            describedBy={fid("active-hint")}
          />
        </div>

        {serverError && !Object.keys(errors).length ? <ErrorNotice error={serverError} /> : null}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-error">
            Check the highlighted fields.
          </p>
        )}
      </form>
    </Dialog>
  );
}
