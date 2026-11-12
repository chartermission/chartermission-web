"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AdminExamAttempt, AdminExamAttemptsQuery, AdminExamDetail, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, FilterSelect, Icon } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { csvRows, downloadText } from "@/lib/exam-csv";
import { useT } from "@/i18n/client";
import { attemptOutcome, formatDuration } from "./exam-labels";

type Result = AdminExamAttemptsQuery["result"];
const EXPORT_LIMIT = 5000;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card px-4 py-3">
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-h2 text-ink tabular-nums">{value}</span>
    </div>
  );
}

const CERTIFICATE_LABEL = { issued: "Certificate issued", pending: "Certificate on its way", failed: "No certificate yet" } as const;

/** A passing attempt's Charter Center certificate: where it stands, and asking again when it hasn't come. */
function CertificateState({ certificate, onRetry }: { certificate: NonNullable<AdminExamAttempt["certificate"]>; onRetry: () => void }) {
  const tone = certificate.status === "issued" ? "text-success" : certificate.status === "failed" ? "text-error" : "text-secondary";
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className={`flex items-center gap-1 ${tone}`} title={certificate.lastError ?? undefined}>
        <Icon name={certificate.status === "issued" ? "check" : certificate.status === "failed" ? "alert" : "clock"} size={12} />
        {CERTIFICATE_LABEL[certificate.status]}
      </span>
      {(certificate.status !== "issued" || certificate.lastError) && (
        <button type="button" onClick={onRetry} className="font-medium text-primary hover:underline">
          Ask again
        </button>
      )}
    </span>
  );
}

/** The Results tab (GET /admin/exams/:id/attempts): who took the exam and how they did, newest first. */
export function ExamResults({ exam, onChange }: { exam: AdminExamDetail; onChange: (exam: AdminExamDetail) => void }) {
  const t = useT();
  const ids = useId();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result>("all");
  const [rows, setRows] = useState<AdminExamAttempt[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const request = useRef(0);
  const refreshed = useRef(false);
  const stats = exam.stats;

  const load = useCallback(
    async (query: string, filter: Result) => {
      const mine = ++request.current;
      setError(null);
      try {
        const page = await api<Page<AdminExamAttempt>>(`/admin/exams/${exam.id}/attempts`, { query: { q: query.trim() || undefined, result: filter, limit: 50 } });
        if (mine !== request.current) return;
        setRows(page.items);
        setCursor(page.nextCursor);
      } catch (e) {
        if (mine === request.current) setError(errorMessage(e));
      }
    },
    [exam.id],
  );

  // Typing waits a moment before searching; a filter change applies at once.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(q, result), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [q, result, load]);

  // The numbers above the table may be older than the list: bring the exam up to date once.
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    api<AdminExamDetail>(`/admin/exams/${exam.id}`).then(onChange, () => undefined);
  }, [exam.id, onChange]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<AdminExamAttempt>>(`/admin/exams/${exam.id}/attempts`, { query: { q: q.trim() || undefined, result, limit: 50, cursor } });
      setRows((list) => [...(list ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function retryCertificate(a: AdminExamAttempt) {
    if (!a.certificate) return;
    try {
      await api(`/admin/exam-certificates/${a.certificate.id}/retry`, { method: "POST" });
      toast(t("Asked Charter Center again for {name}’s certificate.", { name: a.member.name }));
      void load(q, result);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const all: AdminExamAttempt[] = [];
      let next: string | null = null;
      do {
        const page: Page<AdminExamAttempt> = await api<Page<AdminExamAttempt>>(`/admin/exams/${exam.id}/attempts`, { query: { result: "all", limit: 100, cursor: next } });
        all.push(...page.items);
        next = page.nextCursor;
      } while (next && all.length < EXPORT_LIMIT);
      const header = ["name", "handle", "email", "country", "attempt", "status", "result", "correct", "total", "percent", "answered", "timed_out", "started_at", "submitted_at", "duration_seconds", "certificate"];
      const lines = all.map((a) => [
        a.member.name,
        a.member.handle,
        a.member.email,
        a.member.countryCode,
        a.number,
        a.status,
        a.status === "submitted" ? (a.passed ? "passed" : "failed") : "",
        a.status === "submitted" ? a.correct : "",
        a.total,
        a.status === "submitted" ? a.percent : "",
        a.answered,
        a.timedOut ? "yes" : "no",
        a.startedAt,
        a.submittedAt,
        a.durationSeconds,
        a.certificate?.status ?? "",
      ]);
      downloadText(`${exam.slug}-results.csv`, csvRows([header, ...lines]));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Finished attempts")} value={String(stats.attempts)} />
        <Stat label={t("Members")} value={String(stats.participants)} />
        <Stat label={t("Members who passed")} value={stats.participants ? `${stats.passedMembers} (${Math.round((stats.passedMembers * 100) / stats.participants)}%)` : "0"} />
        <Stat label={t("Average score")} value={stats.averagePercent === null ? "—" : `${stats.averagePercent}%`} />
        <Stat label={t("In progress now")} value={String(stats.inProgress)} />
      </div>

      <div role="group" aria-label="Filter results" className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[320px]">
          <label htmlFor={`${ids}-q`} className="sr-only">
            Search by name, handle or email
          </label>
          <Icon name="search" size={16} className="pointer-events-none absolute start-2.5 text-secondary" />
          <input id={`${ids}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, handle or email" className={inputClasses(false, "py-1.5 ps-8 pe-3")} />
        </div>
        <FilterSelect
          label={t("Result")}
          value={result}
          onChange={(e) => setResult(e.target.value as Result)}
          options={[
            { value: "all", label: t("All attempts") },
            { value: "passed", label: t("Passed") },
            { value: "failed", label: t("Failed") },
            { value: "in_progress", label: t("In progress") },
          ]}
        />
        <span className="flex-1" />
        <Button variant="secondary" size="small" disabled={exporting || stats.attempts + stats.inProgress === 0} aria-busy={exporting} onClick={() => void exportCsv()}>
          {exporting ? "Exporting…" : "Export results (CSV)"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-card border border-line bg-card">
          <ErrorState message={error} />
        </div>
      ) : rows === null ? (
        <SkeletonTable label="Loading results" rows={5} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-card">
          {rows.length === 0 ? (
            <EmptyState icon="clipboard" title={q || result !== "all" ? "No attempts match" : "Nobody has taken this exam yet"}>
              {q || result !== "all" ? "Try a different search or filter." : exam.status === "published" ? "Results appear here as members take it." : "Publish the exam so members can take it."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-start">
                <caption className="sr-only">Members’ attempts at this exam, newest first</caption>
                <thead className="bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="py-3 ps-4 pe-3 text-start font-semibold">Member</th>
                    <th scope="col" className="w-[90px] py-3 pe-3 text-start font-semibold">Attempt</th>
                    <th scope="col" className="w-[130px] py-3 pe-3 text-start font-semibold">Score</th>
                    <th scope="col" className="w-[190px] py-3 pe-3 text-start font-semibold">Result</th>
                    <th scope="col" className="w-[100px] py-3 pe-3 text-start font-semibold">Time taken</th>
                    <th scope="col" className="w-[170px] py-3 pe-4 text-start font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((a) => {
                    const outcome = attemptOutcome(a);
                    const done = a.status === "submitted";
                    return (
                      <tr key={a.id} className="align-middle text-sm text-body">
                        <td className="py-3 ps-4 pe-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <Avatar name={a.member.name} src={a.member.avatarUrl ?? undefined} size={32} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium text-ink">{a.member.name}</span>
                              <span className="truncate text-xs text-secondary">
                                @{a.member.handle} · {a.member.email}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3 pe-3 tabular-nums">#{a.number}</td>
                        <td className="py-3 pe-3 tabular-nums">
                          {done ? (
                            <>
                              <span className="font-medium text-ink">{a.percent}%</span>{" "}
                              <span className="text-secondary">
                                ({a.correct}/{a.total})
                              </span>
                            </>
                          ) : (
                            <span className="text-secondary">{t("{answered} of {total} answered", { answered: a.answered, total: a.total })}</span>
                          )}
                        </td>
                        <td className="py-3 pe-3">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Chip tone={outcome.tone} className="px-2! py-0.5! text-xs!">
                              {outcome.label}
                            </Chip>
                            {a.timedOut && <span className="text-xs text-secondary">Time ran out</span>}
                          </span>
                          {a.certificate && <CertificateState certificate={a.certificate} onRetry={() => void retryCertificate(a)} />}
                        </td>
                        <td className="py-3 pe-3 tabular-nums">{formatDuration(a.durationSeconds)}</td>
                        <td className="py-3 pe-4">
                          <DateTime iso={a.submittedAt ?? a.startedAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {cursor && (
            <div className="flex justify-center border-t border-line px-4 py-3">
              <Button variant="secondary" size="small" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void more()}>
                {loadingMore ? "Loading…" : "Load more results"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
