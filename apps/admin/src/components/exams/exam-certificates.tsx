"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  AdminExamCertificate,
  AdminExamCertificatesPage,
  AdminExamCertificatesQuery,
  AdminExamCertificatesSummary,
  AdminExamDetail,
  ExamCertificateDifference,
  ExamCertificateIssuedWith,
  ReissueExamCertificatesInput,
  ReissueExamCertificatesResult,
} from "@chartermission/contracts";
import { Avatar, Button, Chip, FilterSelect, Icon, chipClasses, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { useIntlTag, useT } from "@/i18n/client";

type Status = AdminExamCertificatesQuery["status"];
type Scope = ReissueExamCertificatesInput["scope"];
type Confirm = { kind: "bulk"; scope: Scope } | { kind: "one"; certificate: AdminExamCertificate };

const PAGE_SIZE = 50;
const POLL_MS = 15_000;

const DIFFERENCE_LABEL: Record<ExamCertificateDifference, string> = {
  title: "Title",
  issuer: "Issuer",
  dates: "Dates",
  signature: "Signature",
  name: "Name",
};

const STATUS_LABEL = { issued: "Issued", pending: "Certificate on its way", failed: "No certificate yet" } as const;

/** The replacement stopped trying: replacing it again retries. */
const replacementFailed = (c: AdminExamCertificate) => !!c.replacement?.gaveUp;
/** A replacement asked for and not arrived yet: the old certificate stays until it does. */
const replacing = (c: AdminExamCertificate) => c.replacement !== null && !replacementFailed(c);

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border px-4 py-3", tone === "warning" ? "border-warning bg-warning-light" : "border-line bg-card")}>
      <span className={cn("text-xs", tone === "warning" ? "text-warning" : "text-secondary")}>{label}</span>
      <span className="text-h2 text-ink tabular-nums">{value}</span>
    </div>
  );
}

const linkClasses = "inline-flex items-center gap-1 font-medium text-primary hover:underline";

/** What Charter Center was sent: the course title first, the rest on a quieter line. */
function IssuedWith({ issuedWith, differences }: { issuedWith: ExamCertificateIssuedWith | null; differences: ExamCertificateDifference[] }) {
  const t = useT();
  const tag = useIntlTag();
  if (!issuedWith) return <span className="text-secondary">Not sent to Charter Center yet</span>;
  // Plain calendar dates: shown as written, never moved by the admin's time zone.
  const day = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(`${value}T00:00:00Z`, "UTC", tag) : value);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <bdi className="font-medium text-ink">{issuedWith.courseTitle}</bdi>
      <span className="text-xs text-secondary">
        <bdi>{issuedWith.studentName}</bdi> · {t("Signed by {name}", { name: issuedWith.issuerName })} · {day(issuedWith.startDate)} – {day(issuedWith.endDate)}
      </span>
      {differences.length > 0 && (
        <span className="mt-1 flex flex-wrap items-center gap-1" title={t("Differs from the current settings")}>
          <span className="sr-only">Differs from the current settings:</span>
          {differences.map((d) => (
            <Chip key={d} tone="warning" className="px-2! py-0.5! text-xs!">
              {DIFFERENCE_LABEL[d]}
            </Chip>
          ))}
        </span>
      )}
    </span>
  );
}

/** Where the certificate stands: issued, still coming, failed, or being replaced. */
function CertificateStatus({ c }: { c: AdminExamCertificate }) {
  const t = useT();
  const tag = useIntlTag();
  let state: ReactNode;
  if (c.replacement && replacementFailed(c)) {
    state = (
      <>
        <span className="flex items-center gap-1 text-error">
          <Icon name="alert" size={12} />
          Replacement failed
        </span>
        <span className="text-secondary">
          {c.replacement.lastError ?? ""}{c.replacement.lastError && c.replacement.tries > 0 ? " · " : ""}
          {c.replacement.tries > 0 && t("{count} tries", { count: c.replacement.tries })}
        </span>
        <span className="text-secondary">The member still has their current certificate.</span>
      </>
    );
  } else if (c.replacement) {
    const { tries, lastError } = c.replacement;
    state = (
      <>
        <span className="flex items-center gap-1 text-info">
          <Icon name="clock" size={12} />
          Replacement on its way
        </span>
        <span className="text-secondary">{t("Asked {time}", { time: formatDateTime(c.replacement.requestedAt, undefined, tag) })}</span>
        {lastError && (
          <span className="text-error">
            {t("Last try failed: {error}", { error: lastError })}
            {tries > 0 && <> · {t("{count} tries", { count: tries })}</>}
          </span>
        )}
      </>
    );
  } else {
    const tone = c.status === "issued" ? "text-success" : c.status === "failed" ? "text-error" : "text-secondary";
    state = (
      <>
        <span className={`flex items-center gap-1 ${tone}`}>
          <Icon name={c.status === "issued" ? "check" : c.status === "failed" ? "alert" : "clock"} size={12} />
          {STATUS_LABEL[c.status]}
        </span>
        {c.lastError && <span className="text-secondary">{c.lastError}</span>}
      </>
    );
  }
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      {state}
      {c.replacedCount > 0 && <span className="text-secondary">{c.replacedCount === 1 ? "Replaced once" : t("Replaced {count} times", { count: c.replacedCount })}</span>}
    </span>
  );
}

/**
 * The Certificates tab (GET /admin/exams/:id/certificates): every certificate issued for the exam,
 * what it was issued with, and replacing those issued with details that have since changed (one at
 * a time, the outdated ones, or all of them). Lists refresh themselves while replacements are on
 * their way.
 */
export function ExamCertificates({ exam, onSummary }: { exam: AdminExamDetail; onSummary?: (summary: AdminExamCertificatesSummary) => void }) {
  const t = useT();
  const ids = useId();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [outdated, setOutdated] = useState(false);
  const [rows, setRows] = useState<AdminExamCertificate[] | null>(null);
  const [summary, setSummary] = useState<AdminExamCertificatesSummary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const request = useRef(0);
  const loaded = useRef(0);
  const canReplace = exam.certificate !== null;
  const filtered = q.trim() !== "" || status !== "all" || outdated;

  const query = useCallback(
    (extra: { cursor?: string; limit?: number } = {}) => ({
      q: q.trim() || undefined,
      status,
      outdated: outdated ? "true" : undefined,
      limit: extra.limit ?? PAGE_SIZE,
      cursor: extra.cursor,
    }),
    [q, status, outdated],
  );

  const take = useCallback(
    (page: AdminExamCertificatesPage) => {
      setRows(page.items);
      setCursor(page.nextCursor);
      setSummary(page.summary);
      loaded.current = page.items.length;
      onSummary?.(page.summary);
    },
    [onSummary],
  );

  /** The first page for the filters; `quiet` keeps what's on screen (and as many rows) while it loads. */
  const load = useCallback(
    async (quiet = false) => {
      const mine = ++request.current;
      if (!quiet) setError(null);
      try {
        const limit = quiet ? Math.min(100, Math.max(PAGE_SIZE, loaded.current)) : PAGE_SIZE;
        const page = await api<AdminExamCertificatesPage>(`/admin/exams/${exam.id}/certificates`, { query: query({ limit }) });
        if (mine !== request.current) return;
        take(page);
      } catch (e) {
        if (mine !== request.current) return;
        if (quiet) return;
        setError(errorMessage(e));
      }
    },
    [exam.id, query, take],
  );

  // Typing waits a moment before searching; a filter change applies at once.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [q, status, outdated, load]);

  // While replacements are on their way, look again every 15 seconds (not while the tab is hidden).
  const waiting = rows?.some(replacing) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    const mine = request.current;
    try {
      const page = await api<AdminExamCertificatesPage>(`/admin/exams/${exam.id}/certificates`, { query: query({ cursor }) });
      if (mine !== request.current) return;
      setRows((list) => {
        const next = [...(list ?? []), ...page.items.filter((c) => !list?.some((o) => o.id === c.id))];
        loaded.current = next.length;
        return next;
      });
      setCursor(page.nextCursor);
      setSummary(page.summary);
      onSummary?.(page.summary);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function askAgain(c: AdminExamCertificate) {
    setBusyId(c.id);
    try {
      await api(`/admin/exam-certificates/${c.id}/retry`, { method: "POST" });
      toast(t("Asked Charter Center again for {name}’s certificate.", { name: c.member.name }));
      await load(true);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function replaceOne(c: AdminExamCertificate) {
    const next = await api<AdminExamCertificate>(`/admin/exam-certificates/${c.id}/reissue`, { method: "POST" });
    setRows((list) => list?.map((row) => (row.id === next.id ? next : row)) ?? list);
    toast(t("Replacing {name}’s certificate. It changes when Charter Center sends the new one.", { name: c.member.name }));
    setConfirm(null);
    void load(true); // also drops a list request already on its way, which would bring back the old row
  }

  async function replaceMany(scope: Scope) {
    const body: ReissueExamCertificatesInput = { scope };
    const result = await api<ReissueExamCertificatesResult>(`/admin/exams/${exam.id}/certificates/reissue`, { method: "POST", body });
    toast(t("{count} replacements queued", { count: result.queued }));
    setConfirm(null);
    await load(true);
  }

  const howItWorks =
    "Members keep their current certificate until the new one arrives from Charter Center. Then it replaces the old one on their account and on their certificate post, and they get an email.";

  return (
    <section className="flex flex-col gap-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={t("Issued")} value={summary.issued} />
          <Stat label={t("Outdated")} value={summary.outdated} tone={summary.outdated > 0 ? "warning" : undefined} />
          <Stat label={t("Being replaced")} value={summary.replacing} />
          <Stat label={t("Pending")} value={summary.pending} />
          <Stat label={t("Failed")} value={summary.failed} />
        </div>
      )}

      {!canReplace && summary && summary.issued > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-info-light p-3 text-sm text-body">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-info" />
          <span>This exam has no certificate settings now, so its certificates can’t be replaced. Add them in the Settings tab first.</span>
        </p>
      )}

      {canReplace && summary && summary.outdated > 0 && (
        <div role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-warning-light p-3 text-sm text-body">
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{t("{count} certificates are outdated", { count: summary.outdated })}</span>
              <span>They were issued with details that differ from the current settings, such as the course title. Replace them so members get a corrected certificate.</span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Button size="small" onClick={() => setConfirm({ kind: "bulk", scope: "outdated" })}>
              <Icon name="repeat" size={16} />
              {t("Replace {count} outdated", { count: summary.outdated })}
            </Button>
            <Button variant="secondary" size="small" onClick={() => setConfirm({ kind: "bulk", scope: "all" })}>
              Replace all issued
            </Button>
          </span>
        </div>
      )}

      <div role="group" aria-label={t("Filter certificates")} className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[360px]">
          <label htmlFor={`${ids}-q`} className="sr-only">
            Search by name, handle, email or certificate number
          </label>
          <Icon name="search" size={16} className="pointer-events-none absolute start-2.5 text-secondary" />
          <input
            id={`${ids}-q`}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, handle, email or certificate number"
            className={inputClasses(false, "py-1.5 ps-8 pe-3")}
          />
        </div>
        <FilterSelect
          label={t("Status")}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          options={[
            { value: "all", label: t("All certificates") },
            { value: "issued", label: t("Issued") },
            { value: "pending", label: t("Pending") },
            { value: "failed", label: t("Failed") },
          ]}
        />
        <button
          type="button"
          aria-pressed={outdated}
          onClick={() => setOutdated((v) => !v)}
          className={chipClasses(outdated ? "active" : "filter", "gap-1.5 py-1! hover:border-line-strong")}
        >
          {outdated && <Icon name="check" size={14} />}
          Outdated only
        </button>
        <span className="flex-1" />
        {canReplace && summary && summary.outdated === 0 && summary.issued > 0 && (
          <Button variant="ghost" size="small" onClick={() => setConfirm({ kind: "bulk", scope: "all" })}>
            <Icon name="repeat" size={16} />
            Replace all issued
          </Button>
        )}
      </div>

      {error ? (
        <div className="rounded-card border border-line bg-card">
          <ErrorState message={error} />
        </div>
      ) : rows === null ? (
        <SkeletonTable label="Loading certificates" rows={5} />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-card">
          {rows.length === 0 ? (
            filtered ? (
              <EmptyState icon="search" title="No certificates match">
                Try a different search or filter.
              </EmptyState>
            ) : (
              <EmptyState icon="file" title="No certificates yet">
                {canReplace ? "Certificates appear here as members pass the exam." : "This exam doesn’t award a certificate. Add certificate settings in the Settings tab."}
              </EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-start">
                <caption className="sr-only">Certificates issued for this exam, newest first</caption>
                <thead className="bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="w-[240px] py-3 ps-4 pe-3 text-start font-semibold">Member</th>
                    <th scope="col" className="w-[150px] py-3 pe-3 text-start font-semibold">Certificate</th>
                    <th scope="col" className="py-3 pe-3 text-start font-semibold">Issued with</th>
                    <th scope="col" className="w-[210px] py-3 pe-3 text-start font-semibold">Status</th>
                    <th scope="col" className="w-[150px] py-3 pe-4 text-start font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => {
                    const busy = busyId === c.id;
                    const showReplace = canReplace && c.status === "issued" && !replacing(c);
                    const showAskAgain = c.status !== "issued";
                    return (
                      <tr key={c.id} className="align-top text-sm text-body">
                        <td className="py-3 ps-4 pe-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <Avatar name={c.member.name} src={c.member.avatarUrl ?? undefined} size={32} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium text-ink">{c.member.name}</span>
                              <span className="truncate text-xs text-secondary">
                                @{c.member.handle} · {c.member.email}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3 pe-3">
                          <span className="flex flex-col gap-0.5">
                            {c.certificateId ? <span className="font-medium break-all text-ink tabular-nums">{c.certificateId}</span> : <span className="text-secondary">—</span>}
                            {c.issuedAt && <DateTime iso={c.issuedAt} dateOnly className="text-xs text-secondary" />}
                          </span>
                        </td>
                        <td className="py-3 pe-3">
                          <IssuedWith issuedWith={c.issuedWith} differences={c.differences} />
                        </td>
                        <td className="py-3 pe-3">
                          <CertificateStatus c={c} />
                        </td>
                        <td className="py-3 pe-4">
                          <span className="flex flex-col items-start gap-1.5 text-xs">
                            {showReplace && (
                              <Button variant="secondary" size="small" className="px-2.5!" disabled={busy} onClick={() => setConfirm({ kind: "one", certificate: c })}>
                                <span className="sr-only">{c.member.name}: </span>
                                Replace
                              </Button>
                            )}
                            {showAskAgain && (
                              <Button variant="secondary" size="small" className="px-2.5!" disabled={busy} aria-busy={busy} onClick={() => void askAgain(c)}>
                                <span className="sr-only">{c.member.name}: </span>
                                Ask again
                              </Button>
                            )}
                            {c.imageUrl && (
                              <a href={c.imageUrl} target="_blank" rel="noopener noreferrer" className={linkClasses}>
                                View image
                                <Icon name="external" size={12} />
                              </a>
                            )}
                            {c.downloadUrl && (
                              <a href={c.downloadUrl} target="_blank" rel="noopener noreferrer" className={linkClasses}>
                                Download PDF
                                <Icon name="download" size={12} />
                              </a>
                            )}
                            {c.postId && (
                              <a href={webHref(`/posts/${c.postId}`)} target="_blank" rel="noopener noreferrer" className={linkClasses}>
                                View post
                                <Icon name="external" size={12} />
                              </a>
                            )}
                          </span>
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
                {loadingMore ? "Loading…" : "Load more certificates"}
              </Button>
            </div>
          )}
        </div>
      )}

      {confirm?.kind === "bulk" && confirm.scope === "outdated" && summary && (
        <ReasonDialog
          title="Replace the outdated certificates?"
          description={
            <span className="flex flex-col gap-2">
              <span>{t("{count} members get a new certificate built from the current settings.", { count: summary.outdated })}</span>
              <span>{howItWorks}</span>
            </span>
          }
          confirmLabel={t("Replace {count} outdated", { count: summary.outdated })}
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => replaceMany("outdated")}
        />
      )}
      {confirm?.kind === "bulk" && confirm.scope === "all" && summary && (
        <ReasonDialog
          title="Replace all issued certificates?"
          description={
            <span className="flex flex-col gap-2">
              <span>{t("All {count} issued certificates are replaced with new ones built from the current settings, including those already up to date.", { count: summary.issued })}</span>
              <span>{howItWorks}</span>
            </span>
          }
          confirmLabel="Replace all issued"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => replaceMany("all")}
        />
      )}
      {confirm?.kind === "one" && (
        <ReasonDialog
          title="Replace this certificate?"
          description={t(
            "{name} gets a new certificate built from the current settings. They keep their current one until the new one arrives from Charter Center. Then it replaces the old one on their account and on their certificate post, and they get an email.",
            { name: confirm.certificate.member.name },
          )}
          confirmLabel="Replace"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={() => replaceOne(confirm.certificate)}
        />
      )}
    </section>
  );
}
