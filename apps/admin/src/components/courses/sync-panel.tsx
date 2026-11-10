"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LEARNING_LINK_CHECK_INTERVAL_DAYS,
  LEARNING_SYNC_INTERVAL_HOURS,
  type Page,
  type SyncRunKind,
  type SyncRunView,
} from "@chartermission/contracts";
import { Button, Chip, Icon, cn } from "@chartermission/ui";
import { DateTime, Relative } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

const POLL_MS = 2000;
/** Stop polling after this long; the run carries on in the background and shows on the next visit. */
const POLL_LIMIT_MS = 3 * 60_000;

const KIND_LABEL: Record<SyncRunKind, string> = { sync: "Catalogue sync", link_check: "Link check" };

function runCounts(t: Translate, run: SyncRunView): string {
  if (run.kind === "link_check") return t("{checked} checked · {broken} broken", { checked: run.checked, broken: run.broken });
  return t("{created} new · {updated} updated · {removed} removed", { created: run.created, updated: run.updated, removed: run.removed });
}

function statusChip(run: SyncRunView) {
  if (run.status === "running") return <Chip tone="info" className="px-2! py-0.5! text-xs!">Running…</Chip>;
  if (run.status === "failed") return <Chip tone="error" className="px-2! py-0.5! text-xs!">Failed</Chip>;
  return <Chip tone="success" className="px-2! py-0.5! text-xs!">Succeeded</Chip>;
}

function doneMessage(t: Translate, run: SyncRunView) {
  if (run.status === "failed") return run.error ? t("{label} failed: {error}", { label: t(KIND_LABEL[run.kind]), error: run.error }) : t("{label} failed.", { label: t(KIND_LABEL[run.kind]) });
  return t("{label} finished: {counts}.", { label: t(KIND_LABEL[run.kind]), counts: runCounts(t, run) });
}

function LastRun({ kind, run, schedule }: { kind: SyncRunKind; run: SyncRunView | undefined; schedule: string }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[10px] border border-line p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{KIND_LABEL[kind]}</h3>
        {run && statusChip(run)}
      </div>
      {run ? (
        <>
          <p className="text-xs text-secondary">
            {run.status === "running" ? "Started " : "Last run "}
            <Relative iso={run.finishedAt ?? run.startedAt} />
            {" · "}
            {run.trigger === "admin" ? t("by {name}", { name: run.triggeredBy ?? t("an admin") }) : "scheduled"}
          </p>
          <p className="text-sm text-body">{run.status === "running" ? "In progress…" : runCounts(t, run)}</p>
          {run.error && <p className="text-xs break-words text-error">{run.error}</p>}
        </>
      ) : (
        <p className="text-sm text-secondary">Never run.</p>
      )}
      <p className="text-xs text-secondary">{schedule}</p>
    </div>
  );
}

/**
 * Charter Center sync status: the latest catalogue sync and link check, "Sync now" / "Check links
 * now" (202, or 409 when one is already running), and the run history. While a run is going it
 * polls the history, then refreshes the catalogue below.
 */
export function SyncPanel({ initialRuns }: { initialRuns: SyncRunView[] }) {
  const t = useT();
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [starting, setStarting] = useState<SyncRunKind | null>(null);
  const [polling, setPolling] = useState(() => initialRuns.some((r) => r.status === "running"));
  const [, startRefresh] = useTransition();
  const watched = useRef(new Set(initialRuns.filter((r) => r.status === "running").map((r) => r.id)));
  const pollStarted = useRef<number | null>(null);

  const running = runs.filter((r) => r.status === "running");
  const latest = (kind: SyncRunKind) => runs.find((r) => r.kind === kind);

  const poll = useCallback(async () => {
    try {
      const page = await api<Page<SyncRunView>>("/admin/learning/sync-runs", { query: { limit: 20 } });
      setRuns(page.items);
      let finished = false;
      for (const run of page.items) {
        if (watched.current.has(run.id) && run.status !== "running") {
          watched.current.delete(run.id);
          finished = true;
          toast(doneMessage(t, run), run.status === "failed" ? "error" : "success");
        }
      }
      if (finished) startRefresh(() => router.refresh());
      const stillRunning = page.items.some((r) => r.status === "running");
      pollStarted.current ??= Date.now();
      if (!stillRunning || Date.now() - pollStarted.current > POLL_LIMIT_MS) {
        if (stillRunning) toast("Still running. The results will show here when you come back.", "info");
        setPolling(false);
      }
    } catch (e) {
      setPolling(false);
      toast(t("Couldn’t check the run’s progress. {errorMessage}", { errorMessage: errorMessage(e) }), "error");
    }
  }, [router]);

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, poll]);

  async function start(kind: SyncRunKind) {
    setStarting(kind);
    try {
      const run = await api<SyncRunView>(kind === "sync" ? "/admin/learning/sync" : "/admin/learning/link-check", { method: "POST" });
      watched.current.add(run.id);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      toast(t("{label} started.", { label: KIND_LABEL[kind] }), "info");
    } catch (e) {
      if (!isApiError(e, "CONFLICT")) {
        toast(
          isApiError(e, "FORBIDDEN") ? "Your role can’t run syncs. Ask a Platform Admin." : t("{label} didn’t start. {errorMessage}", { label: KIND_LABEL[kind], errorMessage: errorMessage(e) }),
          "error",
        );
        return;
      }
      toast(t("{errorMessage} Showing its progress.", { errorMessage: errorMessage(e) }), "info");
      // Watch whatever is running now.
      const page = await api<Page<SyncRunView>>("/admin/learning/sync-runs", { query: { limit: 20 } }).catch(() => null);
      if (page) {
        setRuns(page.items);
        for (const r of page.items) if (r.status === "running") watched.current.add(r.id);
      }
    } finally {
      setStarting(null);
    }
    pollStarted.current = Date.now();
    setPolling(true);
  }

  const busy = starting !== null || running.length > 0;

  return (
    <section aria-labelledby="sync-heading" className="flex flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="sync-heading" className="text-h3 text-ink">
            Charter Center sync
          </h2>
          <p className="text-sm text-secondary">Courses and learning paths are pulled from Charter Center; members never see a half-finished sync.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => void start("link_check")}
            disabled={busy}
            aria-busy={starting === "link_check"}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="link" size={16} />
              {starting === "link_check" ? "Starting…" : "Check links now"}
            </span>
          </Button>
          <Button variant="primary" size="small" onClick={() => void start("sync")} disabled={busy} aria-busy={starting === "sync"}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="repeat" size={16} />
              {starting === "sync" ? "Starting…" : "Sync now"}
            </span>
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm", running.length > 0 ? "text-body" : "sr-only")}>
        {running.length > 0 ? (
          <span className="inline-flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-info" aria-hidden="true" />
            {running.map((r) => KIND_LABEL[r.kind]).join(" and ")} running. This page updates when it finishes.
          </span>
        ) : (
          ""
        )}
      </p>

      <div className="flex flex-col gap-3 md:flex-row">
        <LastRun kind="sync" run={latest("sync")} schedule={t("Runs automatically every {LEARNINGSYNCINTERVALHOURS} hours.", { LEARNINGSYNCINTERVALHOURS: LEARNING_SYNC_INTERVAL_HOURS })} />
        <LastRun
          kind="link_check"
          run={latest("link_check")}
          schedule={t("Checks every course link every {LEARNINGLINKCHECKINTERVALDAYS} days.", { LEARNINGLINKCHECKINTERVALDAYS: LEARNING_LINK_CHECK_INTERVAL_DAYS })}
        />
      </div>

      <details className="group rounded-[10px] border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[10px] px-3.5 py-2.5 text-sm font-medium text-ink hover:bg-surface">
          Run history ({runs.length})
          <Icon name="chevron-down" size={16} className="text-secondary transition-transform group-open:rotate-180" />
        </summary>
        {runs.length === 0 ? (
          <p className="border-t border-line px-3.5 py-3 text-sm text-secondary">No runs yet.</p>
        ) : (
          <table className="w-full border-collapse border-t border-line text-left text-sm">
            <caption className="sr-only">Sync and link-check runs, newest first</caption>
            <thead className="bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 pl-3.5 font-semibold">Run</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Started</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                <th scope="col" className="py-2 pr-3.5 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 pl-3.5">
                    <span className="block text-ink">{KIND_LABEL[run.kind]}</span>
                    <span className="block text-xs text-secondary">
                      {run.trigger === "admin" ? t("by {name}", { name: run.triggeredBy ?? t("an admin") }) : "Scheduled"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-body">
                    <DateTime iso={run.startedAt} />
                  </td>
                  <td className="py-2 pr-3">{statusChip(run)}</td>
                  <td className="py-2 pr-3.5 text-body">
                    {run.status === "running" ? "—" : runCounts(t, run)}
                    {run.error && <span className="block text-xs break-words text-error">{run.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </section>
  );
}
