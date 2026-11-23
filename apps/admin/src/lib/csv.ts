/*
 * CSV for the console's imports and exports. Files are read with the separator the header row
 * uses (comma, semicolon or tab) and written as UTF-8 with a BOM so Excel opens accents correctly.
 */
export { parseCsv, csvRows, downloadText } from "./exam-csv";
import { parseCsv } from "./exam-csv";

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
      if (h) values[h] = (cells[i] ?? "").trim();
    });
    return { row: index + 2, values };
  });
  return { header, records };
}

/** Today's date for file names: "members-2026-11-23.csv". */
export const datedFileName = (stem: string, ext = "csv") => `${stem}-${new Date().toISOString().slice(0, 10)}.${ext}`;
