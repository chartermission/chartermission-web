"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminActionInput,
  AdminReportDetail,
  AdminReportRow,
  ModerationActionKind,
  Page,
  PolicyRef,
} from "@chartermission/contracts";
import { Avatar, Button, Chip, cn } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { DialogSelect, ReasonDialog } from "@/components/reason-dialog";
import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { ACTION_LABELS, POLICY_FOR_REASON, POLICY_OPTIONS, PRIORITY_CHIP, REPORT_REASON_LABELS, STATUS_CHIP, TARGET_LABELS } from "@/lib/labels";
import { queueApiQuery, queueSearch, type QueueFilters } from "@/lib/queue-filters";
import { actionDef } from "./moderation-actions";
import { QueueFilterBar } from "./queue-filter-bar";
import { ReportDetail } from "./report-detail";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

type More = { base: string | null; rows: AdminReportRow[]; cursor: string | null };

function statusChip(t: Translate, row: AdminReportRow) {
  if (row.status === "open") return PRIORITY_CHIP[row.priority];
  if (row.status === "in_review") return { label: t("In review · {label}", { label: t(PRIORITY_CHIP[row.priority].label) }), tone: PRIORITY_CHIP[row.priority].tone };
  return STATUS_CHIP[row.status];
}

/**
 * Moderation queue: filters, case table and detail panel (Figma nodes 12:1665 – 12:1731).
 * Filters and the selected case live in the URL; the server renders the first page and the case.
 * Every action goes through a confirmation that requires a reason for the audit log.
 */
export function ModerationWorkspace({
  filters,
  initialRows,
  initialCursor,
  selectedId,
  detail,
  detailError,
  viewerId,
  canAct,
}: {
  filters: QueueFilters;
  initialRows: AdminReportRow[];
  initialCursor: string | null;
  selectedId: string | null;
  detail: AdminReportDetail | null;
  detailError: string | null;
  viewerId: string;
  canAct: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const [navigating, startNavigation] = useTransition();
  const [optimisticSelected, setOptimisticSelected] = useOptimistic(selectedId);
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ModerationActionKind | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const lastDetailId = useRef<string | null>(detail?.id ?? null);

  // Extra pages only apply to the first page they continued from (a refresh starts over).
  const extra = more && more.base === initialCursor ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const seen = new Set<string>();
  const rows = [...initialRows, ...(extra?.rows ?? [])].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  // On narrow screens the detail sits under the table: bring it into view when a new case loads.
  useEffect(() => {
    const id = detail?.id ?? null;
    if (id && id !== lastDetailId.current && window.matchMedia("(max-width: 1279px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastDetailId.current = id;
  }, [detail?.id]);

  function navigate(next: QueueFilters, report?: string | null) {
    startNavigation(() => {
      if (report !== undefined) setOptimisticSelected(report);
      router.push(`/moderation${queueSearch(next, report)}`, { scroll: false });
    });
  }

  function select(id: string) {
    if (id === optimisticSelected && detail?.id === id) return;
    navigate(filters, id);
  }

  /** Re-render server data, keeping the case just worked on selected (it may have left the filtered list). */
  function refresh(keepId?: string) {
    setMore(null);
    startNavigation(() => {
      if (keepId && keepId !== selectedId) router.replace(`/moderation${queueSearch(filters, keepId)}`, { scroll: false });
      else router.refresh();
    });
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AdminReportRow>>("/admin/reports", { query: queueApiQuery(filters, cursor) });
      setMore({ base: initialCursor, rows: [...(extra?.rows ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function assign(assignee: "me" | "none") {
    if (!detail) return;
    setAssigning(true);
    setNotice(null);
    try {
      await api(`/admin/reports/${detail.id}/assign`, { method: "POST", body: { assignee } });
      setNotice({ tone: "success", text: assignee === "me" ? "Report assigned to you." : "Report released to the queue." });
      refresh(detail.id);
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setAssigning(false);
    }
  }

  async function confirmAction(reason: string, data: FormData) {
    if (!detail || !pending) return;
    const def = actionDef(pending, detail.target.type);
    const duration = String(data.get("duration") ?? "");
    const policyRef = String(data.get("policyRef") ?? "") as PolicyRef | "";
    const body: AdminActionInput = {
      action: pending,
      reason,
      policyRef: policyRef || undefined,
      durationHours: def.durations && duration ? Number(duration) : undefined,
    };
    const open = detail.status === "open" || detail.status === "in_review";
    if (open) {
      await api(`/admin/reports/${detail.id}/actions`, { method: "POST", body });
    } else {
      await api("/admin/moderation-actions", {
        method: "POST",
        body: { ...body, targetType: detail.target.type, targetId: detail.target.id },
      });
    }
    const durationLabel = def.durations?.find((d) => d.value === duration)?.label;
    setPending(null);
    setNotice({
      tone: "success",
      text: t("{action}: {target} by {name}. Reason recorded in the audit log.", {
        action: `${t(ACTION_LABELS[pending])}${durationLabel ? ` (${t(durationLabel).toLowerCase()})` : ""}`,
        target: t(TARGET_LABELS[detail.target.type]).toLowerCase(),
        name: detail.author?.name ?? t("unknown author"),
      }),
    });
    refresh(detail.id);
  }

  const pendingDef = pending && detail ? actionDef(pending, detail.target.type) : null;
  const detailBusy = navigating && optimisticSelected !== detail?.id;

  return (
    <>
      <QueueFilterBar filters={filters} onChange={(next) => navigate(next, null)} busy={navigating} />

      {notice && (
        <div className="flex items-start gap-2">
          <FormNotice tone={notice.tone} className="flex-1">
            {notice.text}
          </FormNotice>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-md px-2 py-2.5 text-xs font-medium text-secondary hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-5", (rows.length > 0 || detail || detailError) && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className={cn("relative overflow-hidden rounded-card border border-line bg-card transition-opacity", navigating && "opacity-80")}>
            {rows.length === 0 ? (
              <EmptyState icon="check" title={filters.status === "open" ? "The queue is clear" : "No reports match these filters"}>
                {filters.status === "open"
                  ? "New reports from members appear here, highest priority first."
                  : "Try a different status or clear the filters."}
              </EmptyState>
            ) : (
              <>
                <table className="hidden w-full table-fixed border-collapse text-left md:table">
                  <caption className="sr-only">Reports. Select a row to review it.</caption>
                  <colgroup>
                    <col />
                    <col className="w-[150px]" />
                    <col className="w-[72px]" />
                    <col className="w-[132px]" />
                    <col className="w-[72px]" />
                    <col className="w-[64px]" />
                  </colgroup>
                  <thead className="bg-muted text-label text-secondary uppercase">
                    <tr>
                      <th scope="col" className="py-3 pr-3 pl-4 font-semibold">Content</th>
                      <th scope="col" className="py-3 pr-3 font-semibold">Reason</th>
                      <th scope="col" className="py-3 pr-3 font-semibold">Reports</th>
                      <th scope="col" className="py-3 pr-3 font-semibold">Status</th>
                      <th scope="col" className="py-3 pr-3 font-semibold">
                        Owner
                      </th>
                      <th scope="col" className="py-3 pr-4 font-semibold">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isSelected = row.id === optimisticSelected;
                      const chip = statusChip(t, row);
                      return (
                        <tr
                          key={row.id}
                          onClick={() => select(row.id)}
                          className={cn(
                            "cursor-pointer border-t border-line text-sm transition-colors first:border-t-0",
                            isSelected ? "bg-primary-tint-2" : "hover:bg-surface",
                          )}
                        >
                          <td className="py-3 pr-3 pl-4">
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              aria-controls={`${ids}-detail`}
                              onClick={(event) => {
                                event.stopPropagation();
                                select(row.id);
                              }}
                              className="flex w-full min-w-0 flex-col rounded-sm text-left"
                            >
                              <span className="text-xs text-secondary">{TARGET_LABELS[row.target.type]}</span>
                              <span className="truncate font-medium text-ink">{row.target.preview}</span>
                            </button>
                          </td>
                          <td className="py-3 pr-3 text-body">{REPORT_REASON_LABELS[row.reason]}</td>
                          <td className="py-3 pr-3 text-body">{row.reportCount}</td>
                          <td className="py-3 pr-3">
                            <Chip tone={chip.tone} className="max-w-full truncate">
                              {chip.label}
                            </Chip>
                          </td>
                          <td className="py-3 pr-3">
                            {row.assignedTo ? (
                              <span title={t("Assigned to {name}", { name: row.assignedTo.name })}>
                                <Avatar
                                  name={row.assignedTo.id === viewerId ? "You" : row.assignedTo.name}
                                  size={24}
                                  tone={row.assignedTo.tone}
                                  src={row.assignedTo.avatarUrl ?? undefined}
                                />
                              </span>
                            ) : (
                              <span className="text-disabled" aria-label="Unassigned">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-secondary">
                            <Age iso={row.createdAt} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <ul className="flex flex-col md:hidden" aria-label="Reports">
                  {rows.map((row) => {
                    const isSelected = row.id === optimisticSelected;
                    const chip = statusChip(t, row);
                    return (
                      <li key={row.id} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          aria-controls={`${ids}-detail`}
                          onClick={() => select(row.id)}
                          className={cn(
                            "flex w-full flex-col gap-1.5 px-4 py-3 text-left",
                            isSelected ? "bg-primary-tint-2" : "hover:bg-surface",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2 text-xs text-secondary">
                            <span>
                              {TARGET_LABELS[row.target.type]} · {REPORT_REASON_LABELS[row.reason]} · {row.reportCount}{" "}
                              {row.reportCount === 1 ? "report" : "reports"}
                            </span>
                            <Age iso={row.createdAt} />
                          </span>
                          <span className="line-clamp-2 text-sm font-medium text-ink">{row.target.preview}</span>
                          <span className="flex items-center gap-2">
                            <Chip tone={chip.tone} className="px-2! py-0.5! text-xs!">
                              {chip.label}
                            </Chip>
                            {row.assignedTo && (
                              <span className="text-xs text-secondary">
                                {row.assignedTo.id === viewerId ? "Assigned to you" : t("Assigned to {name}", { name: row.assignedTo.name })}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
          {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? "Loading…" : "Load more reports"}
              </Button>
            </div>
          )}
        </div>

        <div ref={detailRef} className="scroll-mt-20 xl:sticky xl:top-[80px]">
          {detail ? (
            <ReportDetail
              id={`${ids}-detail`}
              detail={detail}
              viewerId={viewerId}
              canAct={canAct}
              busy={detailBusy}
              assigning={assigning}
              onAction={setPending}
              onAssign={assign}
            />
          ) : detailError ? (
            <div id={`${ids}-detail`} className="rounded-card border border-line bg-card">
              <EmptyState icon="alert" title="This report couldn’t be opened">
                {detailError}
              </EmptyState>
            </div>
          ) : rows.length > 0 ? (
            <div id={`${ids}-detail`} className="rounded-card border border-line bg-card">
              <EmptyState icon="flag" title="Select a report">
                Choose a report to see the content, reporter reasons, author history and previous actions.
              </EmptyState>
            </div>
          ) : null}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {navigating ? "Loading" : ""}
      </p>

      {pendingDef && detail && (
        <ReasonDialog
          title={pendingDef.confirmTitle}
          description={
            <>
              <p className="mb-1 line-clamp-2 font-medium text-ink">
                {TARGET_LABELS[detail.target.type]} · {detail.target.preview}
              </p>
              <p>{pendingDef.confirmDescription}</p>
            </>
          }
          confirmLabel={pendingDef.confirmLabel}
          tone={pendingDef.confirmTone}
          onConfirm={confirmAction}
          onClose={() => setPending(null)}
        >
          {pendingDef.kind !== "dismiss" && (
            <DialogSelect
              label="Policy"
              name="policyRef"
              options={POLICY_OPTIONS}
              defaultValue={POLICY_FOR_REASON[detail.reason]}
            />
          )}
          {pendingDef.durations && (
            <DialogSelect
              label="Duration"
              name="duration"
              options={pendingDef.durations}
              defaultValue={pendingDef.defaultDuration ?? pendingDef.durations[0]?.value}
            />
          )}
        </ReasonDialog>
      )}
    </>
  );
}

export function ModerationWorkspaceSkeleton() {
  return (
    <>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonBar key={i} className="h-8 w-32 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <SkeletonTable label="Loading reports" />
        <SkeletonCard lines={8} className="hidden xl:flex" />
      </div>
    </>
  );
}
