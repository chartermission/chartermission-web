"use client";

import { useState } from "react";
import type { CsvImportResult } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { FormModal } from "@/components/ambassadors/modal";
import { FormNotice } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api/client";
import { csvRecords, csvRows, downloadText } from "@/lib/csv";
import { useT } from "@/i18n/client";

/**
 * Import from a spreadsheet (CSV), in two steps: choose a file and see what it would do (the API
 * runs the import with dryRun and writes nothing), then import. The API validates every row again;
 * rows it can't use are listed by spreadsheet row number and skipped.
 *
 * `toBody` turns the file's records into the request body (without dryRun); return a string to
 * stop with that message (for example a missing column).
 */
export function CsvImportDialog({
  title,
  description,
  endpoint,
  columns,
  template,
  templateName,
  toBody,
  onImported,
  onClose,
}: {
  title: string;
  description: string;
  endpoint: string;
  /** Column names shown in the help text, required ones first. */
  columns: string;
  /** Rows of the downloadable template, header first. */
  template: (string | number)[][];
  templateName: string;
  toBody: (records: { row: number; values: Record<string, string> }[], header: string[]) => Record<string, unknown> | string;
  onImported: (result: CsvImportResult) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(file: File | undefined) {
    setError(null);
    setPreview(null);
    setBody(null);
    if (!file) return;
    if (file.size > 5_000_000) return setError(t("That file is too large. Keep it under 5 MB."));
    let next: Record<string, unknown> | string;
    try {
      const { header, records } = csvRecords(await file.text());
      if (records.length === 0) return setError(t("The file has no rows under the header."));
      next = toBody(records, header);
    } catch {
      return setError(t("That file couldn’t be read. Save the spreadsheet as CSV (UTF-8) and try again."));
    }
    if (typeof next === "string") return setError(next);
    setBusy(true);
    try {
      setPreview(await api<CsvImportResult>(endpoint, { method: "POST", body: { ...next, dryRun: true } }));
      setBody(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const writes = preview ? preview.created + preview.updated : 0;
  return (
    <FormModal
      title={title}
      description={description}
      submitLabel={preview ? t("Import {count} rows", { count: writes }) : "Import"}
      busy={busy}
      error={error}
      wide
      onClose={onClose}
      onSubmit={async () => {
        if (!body || !preview) return setError(t("Choose a CSV file first."));
        if (writes === 0) return setError(t("Nothing in this file would change anything."));
        setBusy(true);
        setError(null);
        try {
          onImported(await api<CsvImportResult>(endpoint, { method: "POST", body: { ...body, dryRun: false } }));
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-3 rounded-lg bg-surface px-3 py-3 text-sm text-body">
        <span>{columns}</span>
        <div>
          <Button variant="secondary" size="small" onClick={() => downloadText(templateName, csvRows(template))}>
            Download template
          </Button>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv,text/tab-separated-values,.tsv,.txt"
          disabled={busy}
          onChange={(e) => void read(e.target.files?.[0])}
          className="text-sm file:me-3 file:rounded-lg file:border file:border-line-strong file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </label>
      {preview && (
        <FormNotice tone={preview.problems.length ? "warning" : "info"}>
          <span className="flex flex-col gap-1">
            <span>
              {t("{created} new, {updated} updated, {unchanged} already up to date.", {
                created: preview.created,
                updated: preview.updated,
                unchanged: preview.unchanged,
              })}
            </span>
            {preview.problems.length > 0 && (
              <>
                <span>{t("{count} rows will be skipped:", { count: preview.problems.length })}</span>
                <ul className="max-h-40 list-disc overflow-y-auto ps-5 text-xs">
                  {preview.problems.slice(0, 50).map((p) => (
                    <li key={`${p.row}-${p.message}`}>{t("Row {row}: {message}", { row: p.row, message: p.message })}</li>
                  ))}
                </ul>
              </>
            )}
          </span>
        </FormNotice>
      )}
    </FormModal>
  );
}
