import { EXAM_MAX_OPTIONS, EXAM_MIN_OPTIONS, type AdminExamDetail } from "@chartermission/contracts";

/*
 * Questions as a spreadsheet (CSV), for writing a whole exam in Excel or Google Sheets and
 * importing it in one go. One row per question:
 *
 *   section, section_alt, reference, tag, question, question_alt,
 *   option_a, option_a_alt … option_f, option_f_alt, correct, explanation, explanation_alt
 *
 * "correct" is the letter of the right answer (A–F). The *_alt columns hold the second language and
 * may be left empty. Commas, semicolons or tabs as separators; quotes as in any CSV.
 */

/** One question as POST /admin/exams/:id/questions/import takes it (ExamImportQuestion). */
export type ImportQuestionInput = {
  section: string | null;
  sectionAlt: string | null;
  reference: string | null;
  tag: string | null;
  prompt: string;
  promptAlt: string | null;
  options: { text: string; textAlt: string | null }[];
  correctIndex: number;
  explanation: string;
  explanationAlt: string | null;
};

const LETTERS = ["a", "b", "c", "d", "e", "f"].slice(0, EXAM_MAX_OPTIONS);
export const CSV_COLUMNS = [
  "section",
  "section_alt",
  "reference",
  "tag",
  "question",
  "question_alt",
  ...LETTERS.flatMap((l) => [`option_${l}`, `option_${l}_alt`]),
  "correct",
  "explanation",
  "explanation_alt",
] as const;

/** Splits CSV text into rows of cells (RFC 4180 quoting; the separator is detected from the header row). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const separator = count("\t") > count(",") && count("\t") >= count(";") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type CsvProblem = { row: number; message: "no_question" | "few_options" | "no_correct" | "bad_correct" | "gap" };
export type CsvResult = {
  questions: ImportQuestionInput[];
  problems: CsvProblem[];
  missingColumns: string[];
  /** Section titles named in the file, in the order they first appear. */
  sections: string[];
};

const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** Reads question rows from CSV text. Rows with a problem are reported (by spreadsheet row number) and left out. */
export function questionsFromCsv(text: string): CsvResult {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map(headerKey);
  const missingColumns = ["question", "option_a", "option_b", "correct"].filter((c) => !header.includes(c));
  if (missingColumns.length) return { questions: [], problems: [], missingColumns, sections: [] };
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? "" : (r[i] ?? "").trim();
  };
  const questions: ImportQuestionInput[] = [];
  const problems: CsvProblem[] = [];
  rows.slice(1).forEach((r, index) => {
    const row = index + 2;
    const prompt = col(r, "question");
    if (!prompt) return void problems.push({ row, message: "no_question" });
    const given = LETTERS.map((l) => ({ letter: l, text: col(r, `option_${l}`), textAlt: col(r, `option_${l}_alt`) }));
    const lastFilled = given.reduce((last, o, i) => (o.text ? i : last), -1);
    if (lastFilled + 1 < EXAM_MIN_OPTIONS) return void problems.push({ row, message: "few_options" });
    const options = given.slice(0, lastFilled + 1);
    if (options.some((o) => !o.text)) return void problems.push({ row, message: "gap" });
    const correct = col(r, "correct").toLowerCase().replace(/[^a-f]/g, "");
    if (!correct) return void problems.push({ row, message: "no_correct" });
    const correctIndex = options.findIndex((o) => o.letter === correct[0]);
    if (correctIndex === -1) return void problems.push({ row, message: "bad_correct" });
    questions.push({
      section: col(r, "section") || null,
      sectionAlt: col(r, "section_alt") || null,
      reference: col(r, "reference") || null,
      tag: col(r, "tag") || null,
      prompt,
      promptAlt: col(r, "question_alt") || null,
      options: options.map((o) => ({ text: o.text, textAlt: o.textAlt || null })),
      correctIndex,
      explanation: col(r, "explanation"),
      explanationAlt: col(r, "explanation_alt") || null,
    });
  });
  const sections = [...new Map(questions.filter((q) => q.section).map((q) => [q.section!.toLowerCase(), q.section!])).values()];
  return { questions, problems, missingColumns: [], sections };
}

const cellOut = (value: string | null | undefined) => {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const toCsv = (rows: (string | null | undefined)[][]) => `﻿${rows.map((r) => r.map(cellOut).join(",")).join("\r\n")}\r\n`;

/** An exam's questions in the import format, to edit in a spreadsheet and bring back. */
export function questionsToCsv(exam: Pick<AdminExamDetail, "questions" | "sections">): string {
  const sections = new Map(exam.sections.map((s) => [s.id, s]));
  const rows = exam.questions.map((q) => {
    const section = q.sectionId ? sections.get(q.sectionId) : undefined;
    const options = LETTERS.flatMap((_, i) => [q.options[i]?.text ?? "", q.options[i]?.textAlt ?? ""]);
    const correct = q.options.findIndex((o) => o.id === q.correctOptionId);
    return [section?.title, section?.titleAlt, q.reference, q.tag, q.prompt, q.promptAlt, ...options, LETTERS[correct]?.toUpperCase() ?? "", q.explanation, q.explanationAlt];
  });
  return toCsv([[...CSV_COLUMNS], ...rows]);
}

/** A two-row example to start a spreadsheet from. */
export function csvTemplate(): string {
  const blank = (n: number) => Array.from({ length: n }, () => "");
  return toCsv([
    [...CSV_COLUMNS],
    ["Domain I — Fundamentals", "الأساسيات", "ECO 1.1", "", "Which of the following is a project?", "أي مما يلي يُعد مشروعًا؟", "Processing the monthly payroll", "معالجة رواتب كل شهر", "Building a new training center", "إنشاء مركز تدريب جديد", "Daily help-desk support", "دعم فني يومي", "Weekly office cleaning", "تنظيف المكتب أسبوعيًا", ...blank(4), "B", "Temporary + unique result → project.", "مؤقت وله نتيجة فريدة = مشروع."],
    ["Domain I — Fundamentals", "", "", "", "A question with two answers and no second language", "", "True", "", "False", "", ...blank(8), "A", "", ""],
  ]);
}

/** The full specimen exam (50 questions, two languages) as CSV text. */
export async function specimenCsv(): Promise<string> {
  const { SPECIMEN_ROWS } = await import("./exam-csv-specimen");
  return toCsv([[...CSV_COLUMNS], ...SPECIMEN_ROWS]);
}

export function csvRows(rows: (string | number | null | undefined)[][]): string {
  return toCsv(rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))));
}

/** Saves text as a file from the browser. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
