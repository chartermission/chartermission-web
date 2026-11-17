"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  EXAM_LANGUAGE_NAMES,
  type AdminExamDetail,
  type ExamInstructor,
  type ExamInstructorList,
  type ExamLanguage,
  type ExamReview,
  type UpdateExamInput,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Field } from "@/components/ambassadors/modal";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";
import { LANGUAGE_OPTIONS, dirOf } from "./exam-labels";
import { InstructorDialog, sortInstructors } from "./instructors";
import { Select } from "./select";
import { SignaturePreview } from "./signature-field";

function Checkbox({ checked, onChange, label, note }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; note: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-muted/40">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-secondary">{note}</span>
      </span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <legend className="float-start mb-1 w-full text-h3 text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

type Draft = {
  title: string;
  titleAlt: string;
  description: string;
  descriptionAlt: string;
  language: ExamLanguage;
  secondLanguage: ExamLanguage | "";
  timeLimit: string;
  passPercent: string;
  maxAttempts: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  review: ExamReview;
  credit: string;
  shareCertificates: boolean;
  awardCertificate: boolean;
  certTitle: string;
  /** The instructor who signs ("" until one is chosen). */
  certInstructorId: string;
  certStart: string;
  certEnd: string;
  /** Study hours on the certificate, as typed ("" for none). */
  certHours: string;
};

const draftOf = (e: AdminExamDetail): Draft => ({
  title: e.title,
  titleAlt: e.titleAlt ?? "",
  description: e.description,
  descriptionAlt: e.descriptionAlt ?? "",
  language: e.language,
  secondLanguage: e.secondLanguage ?? "",
  timeLimit: e.timeLimitMinutes === null ? "" : String(e.timeLimitMinutes),
  passPercent: String(e.passPercent),
  maxAttempts: e.maxAttempts === null ? "" : String(e.maxAttempts),
  shuffleQuestions: e.shuffleQuestions,
  shuffleOptions: e.shuffleOptions,
  review: e.review,
  credit: e.credit ?? "",
  shareCertificates: e.shareCertificates,
  awardCertificate: !!e.certificate,
  certTitle: e.certificate?.title ?? "",
  certInstructorId: e.certificate?.instructorId ?? "",
  certStart: e.certificate?.startDate ?? "",
  certEnd: e.certificate?.endDate ?? "",
  certHours: e.certificate?.hours == null ? "" : String(e.certificate.hours),
});

/** What goes on a certificate, to tell whether a save changed it. */
const certificateText = (c: AdminExamDetail["certificate"]) =>
  c ? [c.title, c.instructorId ?? "", c.issuerName, c.signatureFileId ?? "", c.startDate, c.endDate, c.hours ?? ""].join("\u0000") : "";

/** The Settings tab (PATCH /admin/exams/:id): what the exam is called and its rules. Who can take it: whoever opens its invitation link. */
export function ExamSettings({
  exam,
  onChange,
  issuedCertificates = 0,
  onOpenCertificates,
}: {
  exam: AdminExamDetail;
  onChange: (exam: AdminExamDetail) => void;
  /** Certificates already issued for the exam: after their settings change, they can be replaced. */
  issuedCertificates?: number;
  onOpenCertificates?: () => void;
}) {
  const t = useT();
  const [d, setD] = useState<Draft>(() => draftOf(exam));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /** The last save changed what goes on the certificate. */
  const [certificateChanged, setCertificateChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const second = d.secondLanguage || null;
  const secondName = second ? EXAM_LANGUAGE_NAMES[second] : "";
  /** Every instructor (archived ones too, for the one this exam may already have); null while loading. */
  const [instructors, setInstructors] = useState<ExamInstructor[] | null>(null);
  const [instructorsError, setInstructorsError] = useState<string | null>(null);
  const [addingInstructor, setAddingInstructor] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<ExamInstructorList>("/admin/exam-instructors", { query: { includeArchived: "true" }, signal: controller.signal })
      .then((list) => setInstructors(list.items))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setInstructorsError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);

  /** The exam's saved instructor stays listed even when archived; other archived ones aren't offered. */
  const savedInstructorId = exam.certificate?.instructorId ?? null;
  const choices = (instructors ?? []).filter((i) => !i.archived || i.id === savedInstructorId);
  const chosen = choices.find((i) => i.id === d.certInstructorId) ?? null;
  const chosenPreview = chosen?.signatureUrl ?? (d.certInstructorId && d.certInstructorId === exam.certificate?.instructorId ? exam.certificate.signatureUrl : null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    const whole = (raw: string, min: number, max: number) => {
      const n = Number(raw);
      return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const timeLimit = d.timeLimit.trim() === "" ? null : whole(d.timeLimit, 1, 600);
    if (d.timeLimit.trim() !== "" && timeLimit === null) errors.timeLimitMinutes = t("Enter minutes from 1 to 600, or leave it empty for no limit");
    const passPercent = whole(d.passPercent, 1, 100);
    if (passPercent === null) errors.passPercent = t("Enter a whole number from 1 to 100");
    const maxAttempts = d.maxAttempts.trim() === "" ? null : whole(d.maxAttempts, 1, 50);
    if (d.maxAttempts.trim() !== "" && maxAttempts === null) errors.maxAttempts = t("Enter a number from 1 to 50, or leave it empty for no limit");
    const hoursRaw = d.certHours.trim().replace(",", ".");
    const hoursNum = Number(hoursRaw);
    const certHours =
      hoursRaw !== "" && Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= 1000 && Math.abs(hoursNum * 10 - Math.round(hoursNum * 10)) < 1e-9 ? hoursNum : null;
    if (d.title.trim().length < 3) errors.title = t("Give the exam a title");
    if (d.awardCertificate) {
      if (d.certTitle.trim().length < 2) errors["certificate.title"] = t("Write the title for the certificate");
      if (!d.certInstructorId) errors["certificate.instructorId"] = t("Choose the instructor who signs the certificate");
      if (!d.certStart) errors["certificate.startDate"] = t("Choose the start date");
      if (!d.certEnd) errors["certificate.endDate"] = t("Choose the end date");
      else if (d.certStart && d.certEnd < d.certStart) errors["certificate.endDate"] = t("The end date can’t be before the start date");
      if (d.certHours.trim() !== "" && certHours === null) errors["certificate.hours"] = t("Enter the hours as a number up to 1,000, with at most one decimal place");
    }
    setFields(errors);
    setError(null);
    setSaved(false);
    if (Object.keys(errors).length) return;
    const body: UpdateExamInput = {
      title: d.title.trim(),
      titleAlt: second ? d.titleAlt.trim() || null : null,
      description: d.description.trim(),
      descriptionAlt: second ? d.descriptionAlt.trim() || null : null,
      language: d.language,
      secondLanguage: second,
      timeLimitMinutes: timeLimit,
      passPercent: passPercent!,
      maxAttempts,
      shuffleQuestions: d.shuffleQuestions,
      shuffleOptions: d.shuffleOptions,
      review: d.review,
      credit: d.credit.trim() || null,
      shareCertificates: d.shareCertificates,
      certificate: d.awardCertificate
        ? {
            title: d.certTitle.trim(),
            instructorId: d.certInstructorId,
            startDate: d.certStart,
            endDate: d.certEnd,
            hours: certHours,
          }
        : null,
    };
    setBusy(true);
    try {
      const next = await api<AdminExamDetail>(`/admin/exams/${exam.id}`, { method: "PATCH", body });
      setCertificateChanged(!!next.certificate && certificateText(next.certificate) !== certificateText(exam.certificate));
      onChange(next);
      setD(draftOf(next));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form noValidate onSubmit={onSubmit} className="flex max-w-[860px] flex-col gap-5">
        <Group title="About the exam">
          <div className={cn("grid gap-4", second && "sm:grid-cols-2")}>
            <TextField
              label="Title"
              value={d.title}
              maxLength={160}
              required
              dir="auto"
              error={fields.title}
              onChange={(e) => {
                const next = e.target.value;
                // The certificate said the exam's title: renaming the exam renames the certificate too.
                if (d.awardCertificate && d.certTitle.trim() === d.title.trim()) set("certTitle", next);
                set("title", next);
              }}
            />
            {second && (
              <TextField
                label={t("Title in {language}", { language: secondName })}
                value={d.titleAlt}
                maxLength={160}
                dir={dirOf(second)}
                lang={second}
                onChange={(e) => set("titleAlt", e.target.value)}
              />
            )}
          </div>
          <Field label="Description" hint="Shown on the exam’s page before a member starts.">
            {(id, describedBy) => (
              <textarea id={id} rows={3} maxLength={4000} dir="auto" value={d.description} aria-describedby={describedBy} onChange={(e) => set("description", e.target.value)} className={inputClasses(false, "resize-y")} />
            )}
          </Field>
          {second && (
            <Field label={t("Description in {language}", { language: secondName })}>
              {(id) => (
                <textarea id={id} rows={3} maxLength={4000} dir={dirOf(second)} lang={second} value={d.descriptionAlt} onChange={(e) => set("descriptionAlt", e.target.value)} className={inputClasses(false, "resize-y")} />
              )}
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Language">
              {(id) => (
                <Select id={id} value={d.language} onChange={(v) => set("language", v as ExamLanguage)}>
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Second language" error={fields.secondLanguage} hint="Write each question in two languages side by side; members choose which to read.">
              {(id, describedBy) => (
                <Select id={id} value={d.secondLanguage} describedBy={describedBy} onChange={(v) => set("secondLanguage", v as Draft["secondLanguage"])}>
                  <option value="">None</option>
                  {LANGUAGE_OPTIONS.filter((o) => o.value !== d.language).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <TextField
            label="Credit line"
            value={d.credit}
            maxLength={300}
            dir="auto"
            hint="Who wrote the questions, or a disclaimer. Shown under the exam."
            onChange={(e) => set("credit", e.target.value)}
          />
          <p className="text-xs text-secondary">
            Link for members: <span className="break-all font-medium text-body">{webHref(`/exams/${exam.slug}`)}</span>
          </p>
        </Group>

        <Group title="Rules">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Time limit (minutes)"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={d.timeLimit}
              placeholder="No limit"
              hint="Leave empty for no time limit. The exam is handed in automatically when time runs out."
              error={fields.timeLimitMinutes}
              onChange={(e) => set("timeLimit", e.target.value)}
            />
            <TextField
              label="Pass mark (%)"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={d.passPercent}
              hint="Share of questions a member must get right."
              error={fields.passPercent}
              onChange={(e) => set("passPercent", e.target.value)}
            />
            <TextField
              label="Attempts allowed"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={d.maxAttempts}
              placeholder="No limit"
              hint="Leave empty to let members retake it as often as they like."
              error={fields.maxAttempts}
              onChange={(e) => set("maxAttempts", e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox checked={d.shuffleQuestions} onChange={(v) => set("shuffleQuestions", v)} label="Shuffle the questions" note="Each attempt gets the questions in a different order." />
            <Checkbox checked={d.shuffleOptions} onChange={(v) => set("shuffleOptions", v)} label="Shuffle the answers" note="Each attempt gets the answers of every question in a different order." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="After the exam, members see" hint="The correct answers are never sent to a member before they finish.">
              {(id, describedBy) => (
                <Select id={id} value={d.review} describedBy={describedBy} onChange={(v) => set("review", v as ExamReview)}>
                  <option value="full">Their score, the correct answers and explanations</option>
                  <option value="score_only">Their score only</option>
                </Select>
              )}
            </Field>
          </div>
        </Group>

        <Group title="Charter Center certificate">
          <Checkbox
            checked={d.awardCertificate}
            onChange={(v) => {
              set("awardCertificate", v);
              if (v && !d.certTitle) set("certTitle", d.title);
            }}
            label="Award a certificate to members who pass"
            note="When a member passes, Charter Center receives their name with the details below and sends back their certificate."
          />
          {d.awardCertificate && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Title on the certificate"
                  value={d.certTitle}
                  maxLength={200}
                  dir="auto"
                  placeholder="PMP Exam Prep"
                  error={fields["certificate.title"]}
                  hint={
                    d.title.trim() && d.certTitle.trim() !== d.title.trim() ? (
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{t("Not the exam’s title (“{title}”).", { title: d.title.trim() })}</span>
                        <button type="button" onClick={() => set("certTitle", d.title.trim())} className="font-medium text-primary hover:underline">
                          Use the exam’s title
                        </button>
                      </span>
                    ) : (
                      "This is the title new certificates get."
                    )
                  }
                  onChange={(e) => set("certTitle", e.target.value)}
                />
                <TextField
                  label="Start date"
                  type="date"
                  value={d.certStart}
                  error={fields["certificate.startDate"]}
                  onChange={(e) => set("certStart", e.target.value)}
                />
                <TextField
                  label="End date"
                  type="date"
                  value={d.certEnd}
                  min={d.certStart || undefined}
                  error={fields["certificate.endDate"]}
                  onChange={(e) => set("certEnd", e.target.value)}
                />
                <TextField
                  label="Hours"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1000}
                  step={0.5}
                  value={d.certHours}
                  placeholder="35"
                  hint="Study hours printed on the certificate. Leave empty for none."
                  error={fields["certificate.hours"]}
                  onChange={(e) => set("certHours", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-3">
                <Field
                  label="Signed by"
                  error={fields["certificate.instructorId"] ?? instructorsError}
                  hint={
                    exam.certificate && !exam.certificate.instructorId && exam.certificate.issuerName
                      ? t("Saved before instructors: signed by {name}. Choose an instructor to keep awarding certificates.", { name: exam.certificate.issuerName })
                      : "The instructor’s name is printed under their signature. Certificates use the name and signature the instructor has when they’re sent."
                  }
                >
                  {(id, describedBy) => (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      value={d.certInstructorId}
                      onChange={(value) => {
                        set("certInstructorId", value);
                        setFields((prev) => {
                          const next = { ...prev };
                          delete next["certificate.instructorId"];
                          return next;
                        });
                      }}
                    >
                      <option value="">{instructors ? t("Choose an instructor") : t("Loading instructors…")}</option>
                      {choices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.archived ? t("{name} (archived)", { name: i.name }) : i.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex flex-wrap items-center gap-4">
                  {d.certInstructorId && <SignaturePreview url={chosenPreview} alt={t("Signature of {name}", { name: chosen?.name ?? exam.certificate?.issuerName ?? "" })} />}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <Button type="button" variant="secondary" size="small" onClick={() => setAddingInstructor(true)}>
                      <Icon name="plus" size={16} />
                      New instructor
                    </Button>
                    <Link href="/exams/instructors" className="text-sm font-medium text-primary hover:underline">
                      Manage instructors
                    </Link>
                  </div>
                </div>
                {chosen?.archived && (
                  <p className="text-xs text-secondary">This instructor is archived. This exam keeps them, but other exams can’t choose them.</p>
                )}
              </div>
              <Checkbox
                checked={d.shareCertificates}
                onChange={(v) => set("shareCertificates", v)}
                label="Share certificates on the feed"
                note="Posts the certificate as the member (a Certification celebration) that every member sees, also listed on Charter Center’s page. Members can delete the post."
              />
            </>
          )}
        </Group>

        {saved && <FormNotice tone="success">Saved.</FormNotice>}
        {saved && certificateChanged && issuedCertificates > 0 && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
            <Icon name="info" size={14} className="shrink-0 text-info" />
            <span>Certificates already issued keep the old details. Replace them from the Certificates tab.</span>
            {onOpenCertificates && (
              <button type="button" onClick={onOpenCertificates} className="font-medium text-primary hover:underline">
                Open the Certificates tab
              </button>
            )}
          </p>
        )}
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="flex justify-end">
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
      {addingInstructor && (
        <InstructorDialog
          onSaved={(saved) => {
            setInstructors((list) => sortInstructors([...(list ?? []), saved]));
            set("certInstructorId", saved.id);
            setFields((prev) => {
              const next = { ...prev };
              delete next["certificate.instructorId"];
              return next;
            });
            setAddingInstructor(false);
          }}
          onClose={() => setAddingInstructor(false)}
        />
      )}
    </>
  );
}
