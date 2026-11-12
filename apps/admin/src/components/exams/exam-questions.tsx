"use client";

import { useId, useState } from "react";
import {
  EXAM_LANGUAGE_NAMES,
  EXAM_MAX_OPTIONS,
  EXAM_MAX_QUESTIONS,
  EXAM_MAX_SECTIONS,
  EXAM_MIN_OPTIONS,
  type AdminExamDetail,
  type AdminExamQuestion,
} from "@chartermission/contracts";
import { Button, Chip, Icon, cn } from "@chartermission/ui";
import { Field, FormModal, selectClasses } from "@/components/ambassadors/modal";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { csvTemplate, downloadText, questionsFromCsv, questionsToCsv, type CsvProblem, type CsvResult } from "@/lib/exam-csv";
import { useT } from "@/i18n/client";
import { dirOf } from "./exam-labels";

const LETTERS = "ABCDEF";
type Props = { exam: AdminExamDetail; onChange: (exam: AdminExamDetail) => void };

/** The Questions tab: sections, the question list in exam order, and adding, editing, importing and exporting questions. */
export function ExamQuestions({ exam, taken, onChange }: Props & { taken: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState<AdminExamQuestion | "new" | null>(null);
  const [removing, setRemoving] = useState<AdminExamQuestion | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sections = new Map(exam.sections.map((s) => [s.id, s]));
  const altDir = dirOf(exam.secondLanguage);
  const full = exam.questions.length >= EXAM_MAX_QUESTIONS;

  async function move(index: number, by: -1 | 1) {
    const ids = exam.questions.map((q) => q.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setBusyId(exam.questions[index]!.id);
    try {
      onChange(await api<AdminExamDetail>(`/admin/exams/${exam.id}/questions/order`, { method: "PUT", body: { ids } }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {taken && (
        <FormNotice tone="warning">
          Members have already taken this exam. Changes to the questions apply to new attempts; finished attempts keep the score they got.
        </FormNotice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul aria-label="Sections" className="flex flex-wrap items-center gap-2">
          {exam.sections.map((s) => (
            <li key={s.id}>
              <Chip tone="neutral" className="gap-1.5">
                <span dir="auto">{s.title}</span>
                <span className="font-normal text-secondary">· {s.questionCount}</span>
              </Chip>
            </li>
          ))}
          <li>
            <Button variant="ghost" size="small" onClick={() => setSectionsOpen(true)}>
              {exam.sections.length ? "Edit sections" : "Add sections"}
            </Button>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          {exam.questions.length > 0 && (
            <Button variant="secondary" size="small" onClick={() => downloadText(`${exam.slug}-questions.csv`, questionsToCsv(exam))}>
              Export CSV
            </Button>
          )}
          <Button variant="secondary" size="small" disabled={full} onClick={() => setImporting(true)}>
            Import questions
          </Button>
          <Button size="small" disabled={full} onClick={() => setEditing("new")}>
            <Icon name="plus" size={16} />
            Add question
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-card">
        {exam.questions.length === 0 ? (
          <EmptyState icon="clipboard" title="No questions yet">
            Add questions one at a time, or import a whole exam from a spreadsheet.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {exam.questions.map((q, index) => {
              const section = q.sectionId ? sections.get(q.sectionId) : undefined;
              const busy = busyId === q.id;
              return (
                <li key={q.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-inverse tabular-nums">Q{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-secondary">
                      {[section?.title, q.reference].filter(Boolean).join(" · ")}
                      {q.tag && <span className="ms-2 rounded-full border border-accent/50 px-2 py-0.5 text-accent-hover">{q.tag}</span>}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button type="button" disabled={busy || index === 0} onClick={() => void move(index, -1)} className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-40">
                        <Icon name="chevron-down" size={16} className="rotate-180" label={t("Move question {number} up", { number: index + 1 })} />
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === exam.questions.length - 1}
                        onClick={() => void move(index, 1)}
                        className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-40"
                      >
                        <Icon name="chevron-down" size={16} label={t("Move question {number} down", { number: index + 1 })} />
                      </button>
                      <Button variant="ghost" size="small" disabled={busy} onClick={() => setEditing(q)}>
                        Edit
                      </Button>
                      <button type="button" disabled={busy} onClick={() => setRemoving(q)} className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-40">
                        <Icon name="x" size={16} label={t("Delete question {number}", { number: index + 1 })} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p dir="auto" className="text-md font-medium text-ink">
                      {q.prompt}
                    </p>
                    {q.promptAlt && (
                      <p dir={altDir} className="text-md text-body">
                        {q.promptAlt}
                      </p>
                    )}
                  </div>
                  <ul className="grid gap-1.5 lg:grid-cols-2">
                    {q.options.map((o, i) => {
                      const correct = o.id === q.correctOptionId;
                      return (
                        <li
                          key={o.id}
                          className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", correct ? "border-success/50 bg-success-light text-ink" : "border-line bg-surface text-body")}
                        >
                          <span className={cn("w-4 shrink-0 font-semibold", correct ? "text-success" : "text-primary")}>{LETTERS[i]}</span>
                          <span className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-4 gap-y-0.5">
                            <span dir="auto">{o.text}</span>
                            {o.textAlt && <span dir={altDir}>{o.textAlt}</span>}
                          </span>
                          {correct && <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success" label="Correct answer" />}
                        </li>
                      );
                    })}
                  </ul>
                  {(q.explanation || q.explanationAlt) && (
                    <div className="flex flex-col gap-0.5 border-s-2 border-primary ps-3 text-sm">
                      <span className="text-xs font-semibold text-primary">Explanation</span>
                      {q.explanation && <span dir="auto" className="text-ink">{q.explanation}</span>}
                      {q.explanationAlt && <span dir={altDir} className="text-body">{q.explanationAlt}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {editing && (
        <QuestionForm
          exam={exam}
          question={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            onChange(next);
            setEditing(null);
            toast(editing === "new" ? "Question added." : "Question saved.");
          }}
        />
      )}
      {sectionsOpen && (
        <SectionsForm
          exam={exam}
          onClose={() => setSectionsOpen(false)}
          onSaved={(next) => {
            onChange(next);
            setSectionsOpen(false);
            toast("Sections saved.");
          }}
        />
      )}
      {importing && (
        <ImportForm
          exam={exam}
          onClose={() => setImporting(false)}
          onSaved={(next, count) => {
            onChange(next);
            setImporting(false);
            toast(t("{count} questions imported.", { count }));
          }}
        />
      )}
      {removing && (
        <ReasonDialog
          title="Delete this question?"
          description={removing.prompt}
          confirmLabel="Delete question"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            onChange(await api<AdminExamDetail>(`/admin/exams/${exam.id}/questions/${removing.id}`, { method: "DELETE" }));
            toast("Question deleted.");
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

/* ---------------- Add / edit a question ---------------- */

type OptionDraft = { key: number; id?: string; text: string; textAlt: string };

function QuestionForm({ exam, question, onSaved, onClose }: { exam: AdminExamDetail; question: AdminExamQuestion | null; onSaved: (exam: AdminExamDetail) => void; onClose: () => void }) {
  const t = useT();
  const ids = useId();
  const second = exam.secondLanguage;
  const secondName = second ? EXAM_LANGUAGE_NAMES[second] : "";
  const altDir = dirOf(second);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState(question?.sectionId ?? "");
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    question
      ? question.options.map((o, key) => ({ key, id: o.id, text: o.text, textAlt: o.textAlt ?? "" }))
      : [0, 1, 2, 3].map((key) => ({ key, text: "", textAlt: "" })),
  );
  const [correct, setCorrect] = useState(() => (question ? question.options.findIndex((o) => o.id === question.correctOptionId) : -1));
  const [nextKey, setNextKey] = useState(options.length);

  const setOption = (index: number, patch: Partial<OptionDraft>) => setOptions((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  function removeOption(index: number) {
    setOptions((list) => list.filter((_, i) => i !== index));
    setCorrect((c) => (c === index ? -1 : c > index ? c - 1 : c));
  }

  return (
    <FormModal
      wide
      title={question ? "Edit question" : "Add question"}
      submitLabel={question ? "Save question" : "Add question"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        const text = (name: string) => String(data.get(name) ?? "").trim();
        if (!text("prompt")) return setError(t("Write the question"));
        if (options.some((o) => !o.text.trim())) return setError(t("Fill in every answer, or remove the empty ones."));
        if (correct < 0) return setError(t("Mark one of the answers as correct"));
        setBusy(true);
        setError(null);
        const body = {
          sectionId: sectionId || null,
          reference: text("reference") || null,
          tag: text("tag") || null,
          prompt: text("prompt"),
          promptAlt: text("promptAlt") || null,
          options: options.map((o) => ({ id: o.id, text: o.text.trim(), textAlt: o.textAlt.trim() || null })),
          correctIndex: correct,
          explanation: text("explanation"),
          explanationAlt: text("explanationAlt") || null,
        };
        try {
          onSaved(
            await api<AdminExamDetail>(question ? `/admin/exams/${exam.id}/questions/${question.id}` : `/admin/exams/${exam.id}/questions`, {
              method: question ? "PATCH" : "POST",
              body,
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Section">
          {(id) => (
            <span className="relative">
              <select id={id} value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectClasses()}>
                <option value="">No section</option>
                {exam.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={14} className="pointer-events-none absolute inset-y-0 end-3 my-auto h-fit text-secondary" />
            </span>
          )}
        </Field>
        <TextField label="Reference" name="reference" maxLength={60} defaultValue={question?.reference ?? ""} placeholder="ECO 1.1" />
        <TextField label="Label" name="tag" maxLength={40} defaultValue={question?.tag ?? ""} placeholder="Calculation" />
      </div>

      <Field label="Question">
        {(id) => <textarea id={id} name="prompt" rows={2} maxLength={2000} required dir="auto" defaultValue={question?.prompt ?? ""} className={inputClasses(false, "resize-y")} />}
      </Field>
      {second && (
        <Field label={t("Question in {language}", { language: secondName })}>
          {(id) => <textarea id={id} name="promptAlt" rows={2} maxLength={2000} dir={altDir} lang={second} defaultValue={question?.promptAlt ?? ""} className={inputClasses(false, "resize-y")} />}
        </Field>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-label text-ink">Answers</legend>
        <p className="text-xs text-secondary">Select the circle beside the correct answer.</p>
        {options.map((o, index) => (
          <div key={o.key} className="flex items-start gap-2">
            <label className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name={`${ids}-correct`}
                checked={correct === index}
                onChange={() => setCorrect(index)}
                className="size-4 accent-primary"
                aria-label={t("Answer {letter} is correct", { letter: LETTERS[index]! })}
              />
              <span className="w-4 text-sm font-semibold text-primary">{LETTERS[index]}</span>
            </label>
            <div className={cn("grid min-w-0 flex-1 gap-2", second && "sm:grid-cols-2")}>
              <input
                value={o.text}
                onChange={(e) => setOption(index, { text: e.target.value })}
                maxLength={500}
                dir="auto"
                aria-label={t("Answer {letter}", { letter: LETTERS[index]! })}
                className={inputClasses(false)}
              />
              {second && (
                <input
                  value={o.textAlt}
                  onChange={(e) => setOption(index, { textAlt: e.target.value })}
                  maxLength={500}
                  dir={altDir}
                  lang={second}
                  aria-label={t("Answer {letter} in {language}", { letter: LETTERS[index]!, language: secondName })}
                  className={inputClasses(false)}
                />
              )}
            </div>
            <button
              type="button"
              disabled={options.length <= EXAM_MIN_OPTIONS}
              onClick={() => removeOption(index)}
              className="mt-1.5 rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-40"
            >
              <Icon name="x" size={16} label={t("Remove answer {letter}", { letter: LETTERS[index]! })} />
            </button>
          </div>
        ))}
        {options.length < EXAM_MAX_OPTIONS && (
          <Button
            variant="ghost"
            size="small"
            className="self-start"
            onClick={() => {
              setOptions((list) => [...list, { key: nextKey, text: "", textAlt: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            <Icon name="plus" size={16} />
            Add answer
          </Button>
        )}
      </fieldset>

      <Field label="Explanation" hint="Shown with the correct answer after the member finishes the exam.">
        {(id, describedBy) => (
          <textarea id={id} name="explanation" rows={2} maxLength={2000} dir="auto" aria-describedby={describedBy} defaultValue={question?.explanation ?? ""} className={inputClasses(false, "resize-y")} />
        )}
      </Field>
      {second && (
        <Field label={t("Explanation in {language}", { language: secondName })}>
          {(id) => (
            <textarea id={id} name="explanationAlt" rows={2} maxLength={2000} dir={altDir} lang={second} defaultValue={question?.explanationAlt ?? ""} className={inputClasses(false, "resize-y")} />
          )}
        </Field>
      )}
    </FormModal>
  );
}

/* ---------------- Sections ---------------- */

type SectionDraft = { key: number; id?: string; title: string; titleAlt: string };

function SectionsForm({ exam, onSaved, onClose }: { exam: AdminExamDetail; onSaved: (exam: AdminExamDetail) => void; onClose: () => void }) {
  const t = useT();
  const second = exam.secondLanguage;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SectionDraft[]>(() =>
    exam.sections.length ? exam.sections.map((s, key) => ({ key, id: s.id, title: s.title, titleAlt: s.titleAlt ?? "" })) : [{ key: 0, title: "", titleAlt: "" }],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const setRow = (index: number, patch: Partial<SectionDraft>) => setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  function move(index: number, by: -1 | 1) {
    setRows((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <FormModal
      wide
      title="Sections"
      description="Group the questions, for example by exam domain. Members see their score for each section. Removing a section keeps its questions."
      submitLabel="Save sections"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const filled = rows.filter((r) => r.title.trim() || r.id);
        if (filled.some((r) => !r.title.trim())) return setError(t("Name the section"));
        setBusy(true);
        setError(null);
        try {
          onSaved(
            await api<AdminExamDetail>(`/admin/exams/${exam.id}/sections`, {
              method: "PUT",
              body: { sections: filled.map((r) => ({ id: r.id, title: r.title.trim(), titleAlt: r.titleAlt.trim() || null })) },
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r, index) => (
          <li key={r.key} className="flex items-start gap-2">
            <span className="flex h-[38px] w-5 shrink-0 items-center text-sm text-secondary tabular-nums">{index + 1}</span>
            <div className={cn("grid min-w-0 flex-1 gap-2", second && "sm:grid-cols-2")}>
              <input
                value={r.title}
                onChange={(e) => setRow(index, { title: e.target.value })}
                maxLength={160}
                dir="auto"
                placeholder="Section name"
                aria-label={t("Section {number} name", { number: index + 1 })}
                className={inputClasses(false)}
              />
              {second && (
                <input
                  value={r.titleAlt}
                  onChange={(e) => setRow(index, { titleAlt: e.target.value })}
                  maxLength={160}
                  dir={dirOf(second)}
                  lang={second}
                  placeholder={EXAM_LANGUAGE_NAMES[second]}
                  aria-label={t("Section {number} name in {language}", { number: index + 1, language: EXAM_LANGUAGE_NAMES[second] })}
                  className={inputClasses(false)}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-0.5">
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-40">
                <Icon name="chevron-down" size={16} className="rotate-180" label={t("Move section {number} up", { number: index + 1 })} />
              </button>
              <button type="button" disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:opacity-40">
                <Icon name="chevron-down" size={16} label={t("Move section {number} down", { number: index + 1 })} />
              </button>
              <button type="button" onClick={() => setRows((list) => list.filter((_, i) => i !== index))} className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error">
                <Icon name="x" size={16} label={t("Remove section {number}", { number: index + 1 })} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length < EXAM_MAX_SECTIONS && (
        <Button
          variant="ghost"
          size="small"
          className="self-start"
          onClick={() => {
            setRows((list) => [...list, { key: nextKey, title: "", titleAlt: "" }]);
            setNextKey((k) => k + 1);
          }}
        >
          <Icon name="plus" size={16} />
          Add section
        </Button>
      )}
    </FormModal>
  );
}

/* ---------------- Import from a spreadsheet ---------------- */

const PROBLEM_TEXT: Record<CsvProblem["message"], string> = {
  no_question: "Row {row}: the question is empty.",
  few_options: "Row {row}: it needs at least two answers (option_a and option_b).",
  gap: "Row {row}: an answer is empty between two others.",
  no_correct: "Row {row}: the “correct” column is empty.",
  bad_correct: "Row {row}: “correct” must be the letter of one of the row’s answers.",
};

function ImportForm({ exam, onSaved, onClose }: { exam: AdminExamDetail; onSaved: (exam: AdminExamDetail, count: number) => void; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<(CsvResult & { name: string }) | null>(null);
  const room = EXAM_MAX_QUESTIONS - exam.questions.length;

  async function read(file: File | undefined) {
    setError(null);
    setParsed(null);
    if (!file) return;
    if (file.size > 5_000_000) return setError(t("That file is too large. Keep it under 5 MB."));
    try {
      setParsed({ ...questionsFromCsv(await file.text()), name: file.name });
    } catch {
      setError(t("That file couldn’t be read. Save the spreadsheet as CSV (UTF-8) and try again."));
    }
  }

  const ready = parsed?.questions.length ?? 0;
  return (
    <FormModal
      wide
      title="Import questions"
      description="Write the questions in Excel or Google Sheets, one row per question, save the sheet as CSV and choose the file here. They are added after the questions the exam already has."
      submitLabel={ready ? t("Import {count} questions", { count: ready }) : "Import"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!parsed || !ready) return setError(t("Choose a CSV file with at least one question."));
        if (ready > room) return setError(t("This exam has room for {room} more questions; the file has {count}.", { room, count: ready }));
        setBusy(true);
        setError(null);
        try {
          onSaved(await api<AdminExamDetail>(`/admin/exams/${exam.id}/questions/import`, { method: "POST", body: { questions: parsed.questions } }), ready);
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-3 text-sm text-body">
        <span className="min-w-0 flex-1">
          Columns: section, reference, tag, question, option_a to option_f, correct (the letter of the right answer) and explanation. Add “_alt” columns for the second
          language.
        </span>
        <Button variant="secondary" size="small" onClick={() => downloadText("exam-questions-template.csv", csvTemplate())}>
          Download template
        </Button>
      </div>
      <Field label="CSV file">
        {(id) => (
          <input
            id={id}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={(e) => void read(e.target.files?.[0])}
            className="text-sm text-body file:me-3 file:rounded-lg file:border file:border-line-strong file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-muted"
          />
        )}
      </Field>
      {parsed && parsed.missingColumns.length > 0 && (
        <FormNotice tone="error">{t("The first row must name these columns: {columns}.", { columns: parsed.missingColumns.join(", ") })}</FormNotice>
      )}
      {parsed && parsed.missingColumns.length === 0 && (
        <FormNotice tone={ready ? "success" : "warning"}>{t("{count} questions ready to import from {name}.", { count: ready, name: parsed.name })}</FormNotice>
      )}
      {parsed && parsed.problems.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-warning-light p-3 text-sm text-body">
          <span className="font-medium text-ink">{t("{count} rows will be skipped:", { count: parsed.problems.length })}</span>
          <ul className="flex max-h-40 list-disc flex-col gap-0.5 overflow-y-auto ps-5">
            {parsed.problems.slice(0, 50).map((p) => (
              <li key={p.row}>{t(PROBLEM_TEXT[p.message], { row: p.row })}</li>
            ))}
          </ul>
        </div>
      )}
    </FormModal>
  );
}
