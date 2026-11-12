"use client";

import { useState } from "react";
import { Button } from "@chartermission/ui";
import { Field } from "@/components/ambassadors/modal";
import { FormNotice } from "@/components/form-field";
import { toast } from "@/components/toast";
import { csvTemplate, downloadText, questionsFromCsv, specimenCsv, type CsvProblem, type CsvResult } from "@/lib/exam-csv";
import { useT } from "@/i18n/client";

export type ParsedCsv = CsvResult & { name: string };

const PROBLEM_TEXT: Record<CsvProblem["message"], string> = {
  no_question: "Row {row}: the question is empty.",
  few_options: "Row {row}: it needs at least two answers (option_a and option_b).",
  gap: "Row {row}: an answer is empty between two others.",
  no_correct: "Row {row}: the “correct” column is empty.",
  bad_correct: "Row {row}: “correct” must be the letter of one of the row’s answers.",
};

/**
 * Choosing a CSV of questions: what the columns are, a blank template and a full specimen to
 * download, the file field, and what was found in the chosen file (questions ready, rows skipped
 * and why). The parsed result goes to `onParsed`; null while no usable file is chosen.
 */
export function CsvPicker({ onParsed }: { onParsed: (parsed: ParsedCsv | null) => void }) {
  const t = useT();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(file: File | undefined) {
    setError(null);
    setParsed(null);
    onParsed(null);
    if (!file) return;
    if (file.size > 5_000_000) return setError(t("That file is too large. Keep it under 5 MB."));
    try {
      const next = { ...questionsFromCsv(await file.text()), name: file.name };
      setParsed(next);
      onParsed(next);
    } catch {
      setError(t("That file couldn’t be read. Save the spreadsheet as CSV (UTF-8) and try again."));
    }
  }

  const ready = parsed?.questions.length ?? 0;
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg bg-surface px-3 py-3 text-sm text-body">
        <span>
          One row per question. Columns: section, reference, tag, question, option_a to option_f, correct (the letter of the right answer) and explanation. Add “_alt” columns
          for the second language.
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="small" onClick={() => downloadText("exam-import-template.csv", csvTemplate())}>
            Download template
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() =>
              void specimenCsv().then(
                (csv) => downloadText("exam-import-specimen.csv", csv),
                () => toast("The specimen couldn’t be downloaded. Try again.", "error"),
              )
            }
          >
            Download specimen (50 questions)
          </Button>
        </div>
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
      {error && <FormNotice tone="error">{error}</FormNotice>}
      {parsed && parsed.missingColumns.length > 0 && (
        <FormNotice tone="error">{t("The first row must name these columns: {columns}.", { columns: parsed.missingColumns.join(", ") })}</FormNotice>
      )}
      {parsed && parsed.missingColumns.length === 0 && (
        <FormNotice tone={ready ? "success" : "warning"}>
          {t("{count} questions ready to import from {name}.", { count: ready, name: parsed.name })}
          {parsed.sections.length > 0 && ` ${t("Sections: {sections}.", { sections: parsed.sections.join(", ") })}`}
        </FormNotice>
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
    </>
  );
}
