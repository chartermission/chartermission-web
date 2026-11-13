"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXAM_MAX_QUESTIONS, type AdminExamDetail, type AdminExamSummary, type ExamLanguage } from "@chartermission/contracts";
import { Button, Chip, Icon, buttonClasses } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { FormNotice, TextField } from "@/components/form-field";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { CsvPicker, type ParsedCsv } from "./csv-picker";
import { LANGUAGE_OPTIONS, STATUS_CHIP, examFacts } from "./exam-labels";
import { Select } from "./select";

/** Exams (GET /admin/exams): every exam with its status and results at a glance; create a new one. */
export function ExamsConsole({ initial }: { initial: AdminExamSummary[] }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="small" onClick={() => setImporting(true)}>
          Import from CSV
        </Button>
        <Button size="small" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          New exam
        </Button>
      </div>
      <div className="rounded-card border border-line bg-card">
        {initial.length === 0 ? (
          <EmptyState icon="clipboard" title="No exams yet">
            Create an exam, add its questions, then publish it for members.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {initial.map((exam) => {
              const chip = STATUS_CHIP[exam.status];
              return (
                <li key={exam.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                  <div className="flex min-w-[260px] flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/exams/${exam.id}`} className="text-md font-medium text-ink hover:underline">
                        {exam.title}
                      </Link>
                      <Chip tone={chip.tone} className="px-2! py-0.5! text-xs!">
                        {chip.label}
                      </Chip>
                    </div>
                    {exam.titleAlt && (
                      <span className="text-sm text-secondary">
                        <bdi>{exam.titleAlt}</bdi>
                      </span>
                    )}
                    <span className="text-sm text-secondary">{examFacts(t, exam)}</span>
                  </div>
                  <div className="flex min-w-[180px] flex-col gap-0.5 text-sm">
                    <span className="text-body">
                      {exam.stats.participants > 0
                        ? t("{count} members took it · {passed} passed", { count: exam.stats.participants, passed: exam.stats.passedMembers })
                        : t("Not taken yet")}
                    </span>
                    <span className="text-xs text-secondary">
                      Updated <DateTime iso={exam.updatedAt} dateOnly />
                    </span>
                  </div>
                  <Link href={`/exams/${exam.id}`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                    Open
                    <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {creating && <NewExamForm onClose={() => setCreating(false)} />}
      {importing && <ImportExamForm onClose={() => setImporting(false)} />}
    </section>
  );
}

function NewExamForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <FormModal
      title="New exam"
      description="The exam starts as a draft. Add its questions on the next screen, then publish it."
      submitLabel="Create exam"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        setFields({});
        const second = String(data.get("secondLanguage") ?? "");
        try {
          const exam = await api<AdminExamDetail>("/admin/exams", {
            method: "POST",
            body: { title: String(data.get("title") ?? "").trim(), language: String(data.get("language")), secondLanguage: second || null },
          });
          toast("Exam created. Add its questions next.");
          // Close first: an open modal left behind on the list would keep the next page inert.
          onClose();
          router.push(`/exams/${exam.id}`);
        } catch (e) {
          if (e instanceof ApiError && e.fields) setFields(e.fields);
          else setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <TextField label="Title" name="title" required maxLength={160} error={fields.title} placeholder="CAPM practice exam" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Language">{(id) => <SelectBox id={id} name="language" defaultValue="en" options={LANGUAGE_OPTIONS} />}</Field>
        <Field label="Second language" error={fields.secondLanguage} hint="Write each question in two languages side by side; members choose which to read.">
          {(id, describedBy) => (
            <SelectBox id={id} name="secondLanguage" defaultValue="" describedBy={describedBy} invalid={!!fields.secondLanguage} options={[{ value: "", label: "None" }, ...LANGUAGE_OPTIONS]} />
          )}
        </Field>
      </div>
    </FormModal>
  );
}

const ARABIC = /[\u0600-\u06FF]/;

/** A whole exam from one CSV file (POST /admin/exams/import): the sections come from the file's "section" column. */
function ImportExamForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [language, setLanguage] = useState<ExamLanguage>("en");
  const [second, setSecond] = useState<ExamLanguage | "">("");
  const ready = parsed?.questions.length ?? 0;
  const altTexts = (parsed?.questions ?? []).flatMap((q) => [q.promptAlt, q.explanationAlt, ...q.options.map((o) => o.textAlt)]).filter((x): x is string => !!x);

  return (
    <FormModal
      wide
      title="Import an exam from CSV"
      description="Creates a new draft exam with every question in the file. Prepare the questions in Excel or Google Sheets, one row per question, and save the sheet as CSV. The time limit, pass mark and other rules are set on the exam’s Settings tab afterwards."
      submitLabel={ready ? t("Import {count} questions", { count: ready }) : "Import"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        const title = String(data.get("title") ?? "").trim();
        setFields({});
        if (title.length < 3) return setFields({ title: t("Give the exam a title") });
        if (!parsed || !ready) return setError(t("Choose a CSV file with at least one question."));
        if (ready > EXAM_MAX_QUESTIONS) return setError(t("An exam can have up to {max} questions; the file has {count}.", { max: EXAM_MAX_QUESTIONS, count: ready }));
        setBusy(true);
        setError(null);
        try {
          const exam = await api<AdminExamDetail>("/admin/exams/import", { method: "POST", body: { title, language, secondLanguage: second || null, questions: parsed.questions } });
          toast(t("Exam imported with {count} questions. Check it, then publish it.", { count: ready }));
          // Close first: an open modal left behind on the list would keep the next page inert.
          onClose();
          router.push(`/exams/${exam.id}`);
        } catch (e) {
          if (e instanceof ApiError && e.fields?.title) setFields({ title: e.fields.title });
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <TextField label="Title" name="title" required maxLength={160} error={fields.title} placeholder="CAPM practice exam" onChange={() => fields.title && setFields({})} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Language">
          {(id) => (
            <Select
              id={id}
              value={language}
              onChange={(v) => {
                setLanguage(v as ExamLanguage);
                if (v === second) setSecond("");
              }}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Second language" hint="The language of the “_alt” columns, if the file has them.">
          {(id, describedBy) => (
            <Select id={id} value={second} describedBy={describedBy} onChange={(v) => setSecond(v as ExamLanguage | "")}>
              <option value="">None</option>
              {LANGUAGE_OPTIONS.filter((o) => o.value !== language).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <CsvPicker
        onParsed={(next) => {
          setParsed(next);
          setError(null);
          // Arabic in the second-language columns: choose it for them.
          if (next && language !== "ar" && next.questions.some((q) => ARABIC.test(`${q.promptAlt ?? ""}${q.options.map((o) => o.textAlt ?? "").join("")}`))) setSecond("ar");
        }}
      />
      {altTexts.length > 0 && !second && (
        <FormNotice tone="warning">The file has text in the “_alt” columns. Choose the second language above, or members won’t see that text.</FormNotice>
      )}
    </FormModal>
  );
}
