"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  OPPORTUNITY_TYPE_LABELS,
  REMOTE_MODE_LABELS,
  type Country,
  type OpportunityCsvColumn,
  type OpportunityImportErrorKey,
  type OpportunityImportResult,
  type OpportunityImportRowResult,
  type PageRef,
  type TaxonomyItem,
} from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { SelectBox as CheckBox } from "@/components/bulk/select-box";
import { FormNotice, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { csvRows, downloadText } from "@/lib/csv";
import { webHref } from "@/lib/navigation";
import { applyHost, buildPrompt, readImportCsv, templateRows } from "@/lib/opportunity-import";
import { useT } from "@/i18n/client";
import { DayDate } from "./opportunities-console";
import { CreateOrganisationDialog } from "./create-organisation-dialog";
import { ImportRowEditor, type ReviewRow } from "./import-row-editor";
import { PageMark, PostAsButton, PostAsDialog, nameKey } from "./post-as-picker";

const STORAGE_KEY = "cm-admin:opportunity-import:v1";
const CLAUDE_URL = "https://claude.ai/new";

type Saved = { text: string; csv: string; csvName: string | null; rows: ReviewRow[]; pageId: string; shareToFeed: boolean };
const EMPTY: Saved = { text: "", csv: "", csvName: null, rows: [], pageId: "", shareToFeed: true };

/** Copies text, falling back to a hidden textarea where the Clipboard API isn't allowed. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function Step({ n, title, description, done, children }: { n: number; title: string; description?: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <Panel className="flex flex-col gap-4 p-5" aria-labelledby={`import-step-${n}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            done ? "bg-success text-inverse" : "bg-primary-tint text-primary",
          )}
        >
          {done ? <Icon name="check" size={16} /> : n}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`import-step-${n}`} className="text-h3 text-ink">
            {title}
          </h2>
          {description && <div className="text-sm text-secondary">{description}</div>}
        </div>
      </div>
      {children}
    </Panel>
  );
}

/** A small label/value chip on a review card. */
function Fact({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-body">
      <Icon name={icon} size={12} className="text-secondary" />
      {children}
    </span>
  );
}

const COLUMN_LABEL: Record<OpportunityImportErrorKey, string> = {
  row: "Row",
  page: "Post as",
  type: "Type",
  title: "Title",
  organisation: "Organisation",
  summary: "Summary",
  description: "Description",
  remote_mode: "Work mode",
  country: "Country",
  city: "City",
  sector: "Sector",
  deadline: "Deadline",
  compensation: "Compensation",
  apply_link: "Apply link",
  more_info_url: "More information link",
};

/**
 * Import opportunities from pasted text, in four steps on one page: paste the messages and copy a
 * prompt for Claude; bring back the CSV Claude writes; review every row (the API checks them with
 * dryRun; edit or drop rows, choose the page each is posted as); post the chosen rows. Rows are
 * posted as the default official page (Charter Mission) unless a row has its own "Post as": an
 * organisation page the team runs, which can be created on the spot. Rows without an apply link take
 * applications in Charter Mission. Work in progress is kept in sessionStorage, so a reload doesn't
 * lose it.
 */
export function ImportFlow({ pages: initialPages, sectors, countries }: { pages: PageRef[]; sectors: TaxonomyItem[]; countries: Country[] }) {
  const t = useT();
  const [pages, setPages] = useState(initialPages);
  const [state, setState] = useState<Saved>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ result: OpportunityImportResult; sent: ReviewRow[]; page: PageRef | null; shared: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [creating, setCreating] = useState<{ row: number; name: string } | null>(null);
  const [sameOrg, setSameOrg] = useState<{ page: PageRef; organisation: string; rows: number[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  // Restore work in progress, then keep it saved.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after hydration
      if (raw) setState({ ...EMPTY, ...(JSON.parse(raw) as Partial<Saved>) });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (state === EMPTY) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: the work just isn't kept across reloads */
    }
  }, [state, loaded]);

  const patch = (next: Partial<Saved>) => setState((s) => ({ ...s, ...next }));
  const sectorNames = useMemo(() => sectors.map((s) => s.name), [sectors]);
  const prompt = useMemo(() => buildPrompt(state.text, sectorNames), [state.text, sectorNames]);
  const countryName = useMemo(() => new Map(countries.map((c) => [c.code, c.name])), [countries]);
  const sectorName = useMemo(() => new Map(sectors.map((s) => [s.id, s.name])), [sectors]);
  const officialPages = useMemo(() => pages.filter((p) => p.official), [pages]);
  const orgPages = useMemo(() => pages.filter((p) => !p.official), [pages]);
  const pageId = officialPages.some((p) => p.id === state.pageId) ? state.pageId : (officialPages[0]?.id ?? "");
  const page = officialPages.find((p) => p.id === pageId) ?? null;
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  /** The page a row will be posted as: its own, or the default. */
  const pageOf = (r: ReviewRow) => (r.pageId ? (pageById.get(r.pageId) ?? null) : page);

  const rows = state.rows;
  const valid = rows.filter((r) => r.result?.input);
  const withErrors = rows.filter((r) => r.result && !r.result.input);
  const toCheck = valid.filter((r) => r.result!.warnings.length || r.result!.duplicates.length || r.result!.duplicateOfRow);
  const chosen = valid.filter((r) => r.checked);

  /** Sends rows through the API's dry run and merges the results (valid rows picked, broken ones not). */
  async function check(next: ReviewRow[]): Promise<ReviewRow[] | null> {
    setChecking(true);
    try {
      const res = await api<OpportunityImportResult>("/admin/opportunities/import", {
        method: "POST",
        body: { dryRun: true, rows: next.map((r) => ({ row: r.row, values: r.values, pageId: r.pageId ?? null })) },
      });
      const byRow = new Map(res.rows.map((r) => [r.row, r]));
      const merged = next.map((r) => {
        const result = byRow.get(r.row) ?? null;
        const wasValid = !!r.result?.input;
        const isValid = !!result?.input;
        return { ...r, result, checked: isValid && (wasValid ? r.checked : true) };
      });
      patch({ rows: merged });
      return merged;
    } catch (e) {
      toast(errorMessage(e), "error");
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function copyPrompt() {
    if (!state.text.trim()) return;
    if (await copyText(prompt)) toast(t("Prompt copied. Paste it into Claude."));
    else toast(t("The prompt couldn’t be copied. Open the preview and copy it from there."), "error");
  }

  async function readCsv(text: string, name: string | null) {
    setCsvError(null);
    setIgnored([]);
    patch({ csv: text, csvName: name });
    const read = readImportCsv(text);
    if (!read.ok) {
      setCsvError(t(read.error, read.vars));
      return;
    }
    setIgnored(read.ignored);
    const merged = await check(read.records.map((r) => ({ ...r, result: null, checked: false })));
    if (merged) window.setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setCsvError(t("That file is too large. Keep it under 2 MB."));
      return;
    }
    await readCsv(await file.text(), file.name);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function saveRow(rowNumber: number, values: Record<OpportunityCsvColumn, string>): Promise<OpportunityImportRowResult | null> {
    const next = rows.map((r) => (r.row === rowNumber ? { ...r, values } : r));
    const merged = await check(next);
    return merged?.find((r) => r.row === rowNumber)?.result ?? null;
  }

  async function removeRow(rowNumber: number) {
    const next = rows.filter((r) => r.row !== rowNumber);
    if (next.length) await check(next);
    else patch({ rows: [] });
  }

  /** Sets the page rows are posted as (null: the default); rows that had a page problem are checked again. */
  async function setRowPages(rowNumbers: number[], pageIdForRows: string | null) {
    const next = rows.map((r) => (rowNumbers.includes(r.row) ? { ...r, pageId: pageIdForRows && pageIdForRows !== pageId ? pageIdForRows : null } : r));
    if (next.some((r) => rowNumbers.includes(r.row) && r.result?.errors.page)) await check(next);
    else patch({ rows: next });
  }

  function organisationCreated(created: PageRef, rowNumber: number) {
    setPages((list) => [...list, created].sort((a, b) => Number(b.official) - Number(a.official) || (a.official ? 0 : a.name.localeCompare(b.name))));
    setCreating(null);
    const row = rows.find((r) => r.row === rowNumber);
    const organisation = row?.result?.input?.organisation || row?.values.organisation || "";
    const key = nameKey(organisation);
    const others = key ? rows.filter((r) => r.row !== rowNumber && !r.pageId && nameKey(r.result?.input?.organisation || r.values.organisation) === key).map((r) => r.row) : [];
    void setRowPages([rowNumber], created.id);
    toast(t("{page} created. Row {row} will be posted as it.", { page: created.name, row: rowNumber }));
    if (others.length) setSameOrg({ page: created, organisation, rows: others });
  }

  const setChecked = (rowNumber: number, on: boolean) => patch({ rows: rows.map((r) => (r.row === rowNumber ? { ...r, checked: on && !!r.result?.input } : r)) });
  const allValidChecked = valid.length > 0 && valid.every((r) => r.checked);

  async function post() {
    if (!page || !chosen.length) return;
    setPosting(true);
    try {
      const result = await api<OpportunityImportResult>("/admin/opportunities/import", {
        method: "POST",
        body: { dryRun: false, pageId: page.id, shareToFeed: state.shareToFeed, rows: chosen.map((r) => ({ row: r.row, values: r.values, pageId: r.pageId ?? null })) },
      });
      setOutcome({ result, sent: chosen, page, shared: state.shareToFeed });
      if (result.created.length) {
        toast(t("{count} opportunities posted.", { count: result.created.length }));
        const failedRows = new Set(result.rows.filter((r) => !r.input).map((r) => r.row));
        // Keep only what wasn't posted (failed rows and rows left unpicked) for another go.
        const left = rows.filter((r) => failedRows.has(r.row) || !chosen.some((c) => c.row === r.row));
        setState(left.length ? { ...state, rows: left.map((r) => ({ ...r, checked: false })) } : EMPTY);
      } else toast(t("Nothing was posted. Check the reasons below."), "error");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPosting(false);
    }
  }

  function startOver() {
    setState(EMPTY);
    setOutcome(null);
    setCsvError(null);
    setIgnored([]);
    sessionStorage.removeItem(STORAGE_KEY);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** An organisation page whose name is the row's organisation, when the row isn't posted as it yet. */
  function suggestionFor(r: ReviewRow): PageRef | null {
    const key = nameKey(r.result?.input?.organisation || r.values.organisation);
    if (!key) return null;
    const match = orgPages.find((p) => nameKey(p.name) === key);
    return match && match.id !== r.pageId ? match : null;
  }

  /* ------------------------------ Results ------------------------------ */

  if (outcome) {
    const { result, sent } = outcome;
    const failed = result.rows.filter((r) => !r.input);
    const titleOf = (row: number) => sent.find((r) => r.row === row)?.values.title || t("Row {row}", { row });
    const usedPages = [...new Set(result.created.map((c) => c.pageId))].map((id) => pageById.get(id)).filter((p): p is PageRef => !!p);
    const inApp = new Set(sent.filter((r) => r.result?.input && !r.result.input.applyUrl).map((r) => r.row));
    return (
      <div className="flex flex-col gap-4">
        <Panel className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", result.created.length ? "bg-success-light text-success" : "bg-error-light text-error")}>
              <Icon name={result.created.length ? "check" : "alert"} size={18} />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-h3 text-ink">{t("{count} opportunities posted", { count: result.created.length })}</h2>
              <p className="text-sm text-secondary">
                {usedPages.length === 1 ? t("Posted as {page}.", { page: usedPages[0]!.name }) : usedPages.length > 1 ? t("Posted as {pages}.", { pages: usedPages.map((p) => p.name).join(", ") }) : null}{" "}
                {outcome.shared ? t("Each one is also a post in every member’s feed.") : t("They weren’t shared to the feed.")}
              </p>
            </div>
          </div>
          {result.created.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {result.created.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name="check" size={14} className="shrink-0 text-success" />
                    <span className="truncate font-medium text-ink" dir="auto">
                      {c.title}
                    </span>
                    {usedPages.length > 1 && pageById.get(c.pageId) && (
                      <span className="shrink-0 text-xs text-secondary" dir="auto">
                        · {pageById.get(c.pageId)!.name}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    {inApp.has(c.row) && (
                      <Link href={`/opportunities/${c.id}/applications`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        <Icon name="users" size={14} />
                        Applications
                      </Link>
                    )}
                    <a href={webHref(`/opportunities/${c.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      View on site
                      <Icon name="external" size={14} />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-error">{t("{count} couldn’t be posted", { count: failed.length })}</h3>
              <ul className="flex flex-col gap-1.5 rounded-lg border border-error/30 bg-error-light/40 p-3 text-sm">
                {failed.map((r) => (
                  <li key={r.row}>
                    <span className="font-medium text-ink" dir="auto">
                      {titleOf(r.row)}
                    </span>
                    <span className="text-error">
                      {" "}
                      ·{" "}
                      {Object.entries(r.errors)
                        .map(([c, m]) => `${t(COLUMN_LABEL[c as OpportunityCsvColumn])}: ${m}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {state.rows.length > 0 ? (
              <Button variant="primary" size="small" onClick={() => setOutcome(null)}>
                {t("Back to the {count} rows not posted", { count: state.rows.length })}
              </Button>
            ) : (
              <Button variant="primary" size="small" onClick={startOver}>
                <Icon name="plus" size={16} />
                Import more
              </Button>
            )}
            {state.rows.length > 0 && (
              <Button variant="secondary" size="small" onClick={startOver}>
                Import more
              </Button>
            )}
            <Link href="/opportunities" className={buttonClasses({ variant: "secondary", size: "small" })}>
              All opportunities
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  /* ------------------------------ Steps ------------------------------ */

  return (
    <div className="flex flex-col gap-4">
      {(state.text || rows.length > 0) && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setConfirmReset(true)} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Start over
          </button>
        </div>
      )}

      <Step n={1} title="Paste the messages" description="WhatsApp group messages or forum posts: one or many opportunities, chatter included. Copy the prompt, paste it into Claude, and bring back the CSV it gives you." done={!!state.csv && rows.length > 0}>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Paste the messages</span>
          <textarea
            value={state.text}
            onChange={(e) => patch({ text: e.target.value })}
            rows={10}
            placeholder={t("Paste the messages here")}
            className={inputClasses(false, "min-h-[200px] font-mono text-[13px] leading-relaxed")}
            dir="auto"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="small" disabled={!state.text.trim()} onClick={() => void copyPrompt()}>
            <Icon name="copy" size={16} />
            Copy prompt for Claude
          </Button>
          <a href={CLAUDE_URL} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "small" })}>
            Open Claude
            <Icon name="external" size={14} />
          </a>
          <Button variant="ghost" size="small" onClick={() => downloadText("opportunities-template.csv", csvRows(templateRows()))}>
            <Icon name="download" size={16} />
            Download CSV template
          </Button>
          {state.text && <span className="ms-auto text-xs text-secondary tabular-nums">{t("{count} characters", { count: state.text.length })}</span>}
        </div>
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-ink select-none">
            <Icon name="chevron-right" size={16} className="text-secondary transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" />
            Preview the prompt
          </summary>
          <pre className="max-h-[420px] overflow-auto border-t border-line bg-muted px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-body" dir="ltr">
            {prompt}
          </pre>
        </details>
      </Step>

      <Step n={2} title="Bring back the CSV" description="Paste Claude’s reply (the code block is fine as it is) or choose the CSV file you saved." done={rows.length > 0}>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Paste the CSV</span>
          <textarea
            value={state.csv}
            onChange={(e) => {
              patch({ csv: e.target.value, csvName: null });
              setCsvError(null);
            }}
            rows={6}
            placeholder={t("type,title,organisation,summary,…")}
            className={inputClasses(!!csvError, "font-mono text-[13px]")}
            dir="ltr"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="small" disabled={!state.csv.trim() || checking} aria-busy={checking} onClick={() => void readCsv(state.csv, state.csvName)}>
            {checking ? "Checking…" : "Check the rows"}
          </Button>
          <span className="text-sm text-secondary">or</span>
          <label className={cn(buttonClasses({ variant: "secondary", size: "small" }), "cursor-pointer")}>
            <Icon name="paperclip" size={16} />
            Choose a CSV file
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {state.csvName && (
            <span className="text-sm text-secondary" dir="auto">
              {state.csvName}
            </span>
          )}
        </div>
        {csvError && <FormNotice tone="error">{csvError}</FormNotice>}
        {ignored.length > 0 && <FormNotice tone="info">{t("These columns aren’t used and were left out: {columns}.", { columns: ignored.join(", ") })}</FormNotice>}
      </Step>

      {rows.length > 0 && (
        <div ref={reviewRef} className="scroll-mt-24">
          <Step
            n={3}
            title="Review"
            description="Each row as it will be posted. Fix rows with problems, check the warnings, and untick anything you don’t want to post."
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="font-medium text-ink">{t("{count} rows", { count: rows.length })}</span>
              <span className="flex items-center gap-1 text-success">
                <Icon name="check" size={14} />
                {t("{count} ready", { count: valid.length })}
              </span>
              {withErrors.length > 0 && (
                <span className="flex items-center gap-1 text-error">
                  <Icon name="alert" size={14} />
                  {t("{count} with problems", { count: withErrors.length })}
                </span>
              )}
              {toCheck.length > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <Icon name="info" size={14} />
                  {t("{count} to check", { count: toCheck.length })}
                </span>
              )}
              <Button
                variant="ghost"
                size="small"
                className="ms-auto"
                disabled={!valid.length || checking}
                onClick={() => patch({ rows: rows.map((r) => ({ ...r, checked: !!r.result?.input && !allValidChecked })) })}
              >
                {allValidChecked ? "Clear selection" : "Select all valid"}
              </Button>
            </div>
            <ul className={cn("flex flex-col gap-3", checking && "opacity-70")} aria-busy={checking}>
              {rows.map((r) => (
                <ReviewCard
                  key={r.row}
                  row={r}
                  countryName={countryName}
                  sectorName={sectorName}
                  postAs={pageOf(r)}
                  isDefaultPage={!r.pageId}
                  suggestion={suggestionFor(r)}
                  onPostAs={() => setPicking(r.row)}
                  onUseSuggestion={(p) => void setRowPages([r.row], p.id)}
                  busy={checking || posting}
                  onToggle={(on) => setChecked(r.row, on)}
                  onEdit={() => setEditing(r.row)}
                  onRemove={() => void removeRow(r.row)}
                />
              ))}
            </ul>
          </Step>
        </div>
      )}

      {rows.length > 0 && (
        <Step n={4} title="Post">
          {officialPages.length === 0 ? (
            <FormNotice tone="warning">
              Imported opportunities are posted as one of Charter Mission’s official pages, and there isn’t one yet. Create an official page under Pages first.
            </FormNotice>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-label text-ink">Post as (default)</span>
                  <span className="relative">
                    <select value={pageId} onChange={(e) => patch({ pageId: e.target.value })} className={inputClasses(false, "appearance-none pe-9")}>
                      {officialPages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron-down" size={14} className="pointer-events-none absolute inset-y-0 end-3 my-auto h-fit text-secondary" />
                  </span>
                  <span className="text-xs text-secondary">Charter Mission’s official pages. To post a row as an organisation’s page instead, use Post as on the row.</span>
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className="text-label text-ink">Feed</span>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong px-3 py-2">
                    <input type="checkbox" role="switch" checked={state.shareToFeed} onChange={(e) => patch({ shareToFeed: e.target.checked })} className="mt-0.5 size-4 accent-primary" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-ink">Share each to the feed</span>
                      <span className="text-xs text-secondary">Each opportunity becomes a post from the page that every member sees. Rows posted as an organisation page are shared from the default page.</span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={!chosen.length || posting || checking || !page} aria-busy={posting} onClick={() => void post()}>
                  {posting ? t("Posting…") : t("Post {count} opportunities", { count: chosen.length })}
                </Button>
                {withErrors.length > 0 && <span className="text-sm text-secondary">{t("Rows with problems aren’t posted until they’re fixed.")}</span>}
              </div>
            </div>
          )}
        </Step>
      )}

      {editing !== null && rows.some((r) => r.row === editing) && (
        <ImportRowEditor
          row={rows.find((r) => r.row === editing)!}
          countries={countries}
          sectors={sectors}
          onSave={(values) => saveRow(editing, values)}
          onClose={() => setEditing(null)}
        />
      )}

      {picking !== null && rows.some((r) => r.row === picking) && (
        <PostAsDialog
          pages={pages}
          value={rows.find((r) => r.row === picking)!.pageId ?? null}
          defaultId={pageId}
          organisation={(() => {
            const r = rows.find((x) => x.row === picking)!;
            return r.result?.input?.organisation || r.values.organisation || "";
          })()}
          onChoose={(id) => void setRowPages([picking], id)}
          onCreate={() => {
            const r = rows.find((x) => x.row === picking)!;
            setCreating({ row: picking, name: r.result?.input?.organisation || r.values.organisation || "" });
          }}
          onClose={() => setPicking(null)}
        />
      )}

      {creating && <CreateOrganisationDialog name={creating.name} countries={countries} onCreated={(p) => organisationCreated(p, creating.row)} onClose={() => setCreating(null)} />}

      {sameOrg && (
        <ReasonDialog
          title={t("Post the other {organisation} rows as {page}?", { organisation: sameOrg.organisation, page: sameOrg.page.name })}
          description={t("{count} other rows are from {organisation}. They’re posted as the default page until you change them.", { count: sameOrg.rows.length, organisation: sameOrg.organisation })}
          confirmLabel={t("Use {page} for them too", { page: sameOrg.page.name })}
          reasonField="none"
          onClose={() => setSameOrg(null)}
          onConfirm={async () => {
            const target = sameOrg;
            setSameOrg(null);
            await setRowPages(target.rows, target.page.id);
          }}
        />
      )}

      {confirmReset && (
        <ReasonDialog
          title={t("Start over?")}
          description="The pasted messages, the CSV and your changes to the rows are cleared."
          confirmLabel="Start over"
          tone="danger"
          reasonField="none"
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            startOver();
          }}
        />
      )}
    </div>
  );
}

/** One row of the CSV as it will be posted, with its problems, warnings and possible duplicates. */
function ReviewCard({
  row,
  countryName,
  sectorName,
  postAs,
  isDefaultPage,
  suggestion,
  onPostAs,
  onUseSuggestion,
  busy,
  onToggle,
  onEdit,
  onRemove,
}: {
  row: ReviewRow;
  countryName: Map<string, string>;
  sectorName: Map<string, string>;
  /** The page the row will be posted as (null when its page is no longer offered). */
  postAs: PageRef | null;
  isDefaultPage: boolean;
  /** An organisation page with the row's organisation name, to offer in one click. */
  suggestion: PageRef | null;
  onPostAs: () => void;
  onUseSuggestion: (page: PageRef) => void;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const result = row.result;
  const input = result?.input ?? null;
  const errors = Object.entries(result?.errors ?? {}) as [OpportunityImportErrorKey, string][];
  const title = input?.title || row.values.title || t("Row {row}", { row: row.row });
  const organisation = input?.organisation || row.values.organisation || "";
  const place = input ? [input.city, input.countryCode ? countryName.get(input.countryCode) : null].filter(Boolean).join(", ") : "";
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        !result ? "border-line" : input ? (row.checked ? "border-primary-light bg-primary-tint-2/30" : "border-line") : "border-error/40 bg-error-light/30",
      )}
    >
      <div className="pt-0.5">
        <CheckBox
          checked={row.checked}
          disabled={!input || busy}
          label={input ? t("Post {title}", { title }) : t("Row {row} can’t be posted until it’s fixed", { row: row.row })}
          onChange={onToggle}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-secondary">{t("Row {row}", { row: row.row })}</span>
            <span className="font-semibold text-ink" dir="auto">
              {title}
            </span>
            {organisation && (
              <span className="text-sm text-body" dir="auto">
                {organisation}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="small" disabled={busy} onClick={onEdit}>
              <Icon name="edit" size={14} />
              Edit
            </Button>
            <Button variant="ghost" size="small" disabled={busy} onClick={onRemove} aria-label={t("Remove row {row}", { row: row.row })}>
              <Icon name="trash" size={14} />
            </Button>
          </div>
        </div>
        {input && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="active" className="px-2! py-0.5! text-xs!">
                {OPPORTUNITY_TYPE_LABELS[input.type]}
              </Chip>
              <Fact icon="map-pin">{place ? `${place} · ${t(REMOTE_MODE_LABELS[input.remoteMode])}` : t(REMOTE_MODE_LABELS[input.remoteMode])}</Fact>
              <Fact icon="calendar">{input.deadline ? <DayDate date={input.deadline} /> : t("No deadline")}</Fact>
              {input.applyUrl && (
                <Fact icon={input.applyUrl.startsWith("mailto:") ? "mail" : "link"}>
                  <span dir="ltr" title={input.applyUrl}>
                    {applyHost(input.applyUrl)}
                  </span>
                </Fact>
              )}
              {input.sectorId && <Fact icon="briefcase">{sectorName.get(input.sectorId) ?? ""}</Fact>}
              {input.compensation && (
                <Fact icon="target">
                  <span dir="auto">{input.compensation}</span>
                </Fact>
              )}
            </div>
            <p className="text-sm text-body" dir="auto">
              {input.summary}
            </p>
            {!input.applyUrl && (
              <p className="flex items-start gap-1.5 rounded-md bg-info-light px-2.5 py-1.5 text-sm text-body">
                <Icon name="users" size={14} className="mt-0.5 shrink-0 text-info" />
                <span>Applications in Charter Mission — they come to the admin console under this opportunity.</span>
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PostAsButton page={postAs} isDefault={isDefaultPage} disabled={busy} onClick={onPostAs} />
          {suggestion && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUseSuggestion(suggestion)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary-light px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2 disabled:opacity-60"
            >
              <PageMark page={suggestion} />
              <span dir="auto">{t("Post as {page}", { page: suggestion.name })}</span>
            </button>
          )}
        </div>
        {errors.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-error" role="list">
            {errors.map(([column, message]) => (
              <li key={column} className="flex items-start gap-1.5">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">{t(COLUMN_LABEL[column])}:</span> {message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {result && (result.warnings.length > 0 || result.duplicates.length > 0) && (
          <ul className="flex flex-col gap-1 text-sm text-body" role="list">
            {result.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5">
                <Icon name="info" size={14} className="mt-0.5 shrink-0 text-warning" />
                <span>{w}</span>
              </li>
            ))}
            {result.duplicates.map((d) => (
              <li key={d.id} className="flex items-start gap-1.5 ps-5">
                <a href={webHref(`/opportunities/${d.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" dir="auto">
                  {d.title} · {d.organisation}
                  <Icon name="external" size={12} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
