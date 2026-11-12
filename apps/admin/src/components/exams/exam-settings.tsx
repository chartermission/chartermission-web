"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { EXAM_LANGUAGE_NAMES, type AdminExamDetail, type ExamAccess, type ExamLanguage, type ExamReview, type UpdateExamInput } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { Field } from "@/components/ambassadors/modal";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";
import { LANGUAGE_OPTIONS, dirOf } from "./exam-labels";
import { Select } from "./select";

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
  access: ExamAccess;
  credit: string;
  charterCenterCourseId: string;
  shareCertificates: boolean;
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
  access: e.access,
  credit: e.credit ?? "",
  charterCenterCourseId: e.charterCenterCourseId ?? "",
  shareCertificates: e.shareCertificates,
});

/** The Settings tab (PATCH /admin/exams/:id): what the exam is called, its rules, and who can take it. */
export function ExamSettings({ exam, onChange }: { exam: AdminExamDetail; onChange: (exam: AdminExamDetail) => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(() => draftOf(exam));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const second = d.secondLanguage || null;
  const secondName = second ? EXAM_LANGUAGE_NAMES[second] : "";

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
    if (d.title.trim().length < 3) errors.title = t("Give the exam a title");
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
      access: d.access,
      credit: d.credit.trim() || null,
      charterCenterCourseId: d.charterCenterCourseId.trim() || null,
      shareCertificates: d.shareCertificates,
    };
    setBusy(true);
    try {
      const next = await api<AdminExamDetail>(`/admin/exams/${exam.id}`, { method: "PATCH", body });
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
    <form noValidate onSubmit={onSubmit} className="flex max-w-[860px] flex-col gap-5">
      <Group title="About the exam">
        <div className={cn("grid gap-4", second && "sm:grid-cols-2")}>
          <TextField label="Title" value={d.title} maxLength={160} required dir="auto" error={fields.title} onChange={(e) => set("title", e.target.value)} />
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
          <Field label="Who can take it" hint="E-learning access rules are set under E-learning access.">
            {(id, describedBy) => (
              <Select id={id} value={d.access} describedBy={describedBy} onChange={(v) => set("access", v as ExamAccess)}>
                <option value="members">Every signed-in member</option>
                <option value="learning">Only members who have unlocked Learning</option>
              </Select>
            )}
          </Field>
        </div>
      </Group>

      <Group title="Charter Center certificate">
        <TextField
          label="Charter Center course ID"
          value={d.charterCenterCourseId}
          maxLength={100}
          dir="ltr"
          placeholder="e.g. capm-101"
          hint="When a member passes, Charter Mission asks Charter Center for their certificate for this course (their email and this ID). Leave empty for an exam without a certificate."
          error={fields.charterCenterCourseId}
          onChange={(e) => set("charterCenterCourseId", e.target.value)}
        />
        {exam.charterCenterCourseId && exam.charterCenterCourseId === d.charterCenterCourseId.trim() && (
          <p className="text-xs text-secondary">
            {exam.charterCenterCourse
              ? t("Matches the Charter Center course “{title}” in Learning.", { title: exam.charterCenterCourse.title })
              : "No course with this ID is in Learning yet. That’s fine if Charter Center hasn’t listed it; check the ID with them."}
          </p>
        )}
        <Checkbox
          checked={d.shareCertificates}
          onChange={(v) => set("shareCertificates", v)}
          label="Share certificates on the feed"
          note="Posts the certificate as the member (a Certification celebration) that every member sees, also listed on Charter Center’s page. Members can delete the post."
        />
      </Group>

      {saved && <FormNotice tone="success">Saved.</FormNotice>}
      {error && <FormNotice tone="error">{error}</FormNotice>}
      <div className="flex justify-end">
        <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
