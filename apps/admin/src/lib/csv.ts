/*
 * CSV for the console's imports and exports. Files are read with the separator the header row
 * uses (comma, semicolon or tab) and written as UTF-8 with a BOM so Excel opens accents correctly.
 */
export { parseCsv, csvRows, downloadText } from "./exam-csv";
import { csvRows, parseCsv } from "./exam-csv";

/** A cell a spreadsheet would run as a formula (= + - @, or a tab/return in front). */
const FORMULA = /^[=+\-@\t\r]/;

/**
 * CSV for files people download and open in Excel or Sheets. Text members wrote can start like a
 * formula, so such cells get a leading apostrophe (shown as plain text; our imports remove it).
 * Use csvRows only for templates.
 */
export function csvExport(rows: (string | number | null | undefined)[][]): string {
  return csvRows(rows.map((r) => r.map((c) => (typeof c === "string" && FORMULA.test(c) ? `'${c}` : c))));
}

/** Header names compared loosely: "Display Name" and "display_name" are the same column. */
export const csvHeaderKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/**
 * Rows of a CSV file as objects keyed by header (csvHeaderKey), with each object's spreadsheet
 * row number (the header is row 1). Empty rows are skipped.
 */
export function csvRecords(text: string): { header: string[]; records: { row: number; values: Record<string, string> }[] } {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map(csvHeaderKey);
  const records = rows.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    header.forEach((h, i) => {
      // An apostrophe our exports put before formula-like text is not part of the value.
      if (h) values[h] = (cells[i] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
    });
    return { row: index + 2, values };
  });
  return { header, records };
}

/** Today's date for file names: "members-2026-11-23.csv". */
export const datedFileName = (stem: string, ext = "csv") => `${stem}-${new Date().toISOString().slice(0, 10)}.${ext}`;
