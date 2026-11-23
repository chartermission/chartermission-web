"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminHiddenRow, DirectActionInput, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, FilterSelect, Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { FormNotice, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonCard } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { hiddenApiQuery, hiddenSearch, type HiddenBy, type HiddenFilters, type HiddenSince, type HiddenType } from "@/lib/hidden-filters";
import { ACTION_LABELS, APPEAL_STATUS_CHIP, POLICY_REF_LABELS } from "@/lib/labels";
import { webHref } from "@/lib/navigation";
import { T, useT } from "@/i18n/client";

const TYPES: { value: HiddenType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "comment", label: "Comments" },
];
const SINCE_OPTIONS: { value: HiddenSince; label: string }[] = [
  { value: "", label: "Hidden any time" },
  { value: "7d", label: "Hidden in the last 7 days" },
  { value: "30d", label: "Hidden in the last 30 days" },
];
const BY_OPTIONS: { value: HiddenBy; label: string }[] = [
  { value: "", label: "Hidden by anyone" },
  { value: "moderator", label: "Hidden by a moderator" },
  { value: "automatic", label: "Hidden automatically" },
];

/** Rows loaded after the first page, for the search (q) and first page (base) they continue. */
type More = { base: string | null; q: string; rows: AdminHiddenRow[]; cursor: string | null };

/** Hidden and removed posts and comments (GET /admin/hidden), each restorable with a reason, one at a time or in a batch. */
export function HiddenList({
  filters,
  initialRows,
  initialCursor,
  viewerId,
  canAct,
}: {
  filters: HiddenFilters;
  initialRows: AdminHiddenRow[];
  initialCursor: string | null;
  viewerId: string;
  canAct: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<AdminHiddenRow | null>(null);
  const [restored, setRestored] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState(filters.q);
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const selection = useSelection();

  const extra = more && more.base === initialCursor && more.q === filters.q ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const seen = new Set<string>();
  const rows = [...initialRows, ...(extra?.rows ?? [])].filter((r) =>
    restored.has(r.target.id) || seen.has(r.target.id) ? false : (seen.add(r.target.id), true),
  );
  const visibleIds = rows.map((r) => r.target.id);
  const filtered = filters.type !== "all" || !!filters.since || !!filters.by || !!filters.q;

  function go(next: Partial<HiddenFilters>) {
    startNavigation(() => router.push(`/moderation/hidden${hiddenSearch({ ...filters, ...next })}`, { scroll: false }));
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const timer = setTimeout(() => go({ q: q.trim() }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go reads the current filters
  }, [q]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AdminHiddenRow>>("/admin/hidden", {
        query: { ...hiddenApiQuery(filters), cursor, limit: 25 },
      });
      setMore({ base: initialCursor, q: filters.q, rows: [...(extra?.rows ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(reason: string) {
    if (!restoring) return;
    const body: DirectActionInput = {
      action: "restore",
      reason,
      targetType: restoring.target.type,
      targetId: restoring.target.id,
      policyRef: restoring.action?.policyRef ?? undefined,
    };
    await api("/admin/moderation-actions", { method: "POST", body });
    setRestored((prev) => new Set(prev).add(restoring.target.id));
    selection.remove([restoring.target.id]);
    setNotice(
      t(restoring.target.type === "post" ? "Post by {name} restored. It returns to feeds within 60 seconds." : "Comment by {name} restored. It returns to feeds within 60 seconds.", {
        name: restoring.author?.name ?? t("unknown author"),
      }),
    );
    setRestoring(null);
    startNavigation(() => router.refresh());
  }

  async function restoreAll(reason: string) {
    setBulkBusy(true);
    try {
      const result = await runBulk("/admin/hidden/bulk", { ids: selection.list, action: "restore", reason }, t, "{count} restored. They return to feeds within 60 seconds.");
      if (result) {
        setRestored((prev) => new Set([...prev, ...result.done]));
        selection.remove(result.done);
        setNotice(null);
        startNavigation(() => router.refresh());
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="Content type" items={TYPES} value={filters.type} onChange={(value) => go({ type: value })} />
        <FilterSelect label="When it was hidden" options={SINCE_OPTIONS} value={filters.since} onChange={(e) => go({ since: e.target.value as HiddenSince })} />
        <FilterSelect label="Who hid it" options={BY_OPTIONS} value={filters.by} onChange={(e) => go({ by: e.target.value as HiddenBy })} />
        <label className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
          <span className="sr-only">Search hidden posts and comments</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the text" className={inputClasses(false, "ps-9")} />
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              go({ type: "all", since: "", by: "", q: "" });
            }}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2"
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canAct && rows.length > 0 ? (
          <span className="flex items-center gap-2 text-sm text-secondary">
            <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} />
            Select all items shown
          </span>
        ) : (
          <span />
        )}
        <p className="text-xs text-secondary">Newest first. Restoring notifies the author.</p>
      </div>

      {notice && <FormNotice tone="success">{notice}</FormNotice>}

      <div className={cn("flex flex-col gap-3 transition-opacity", navigating && "opacity-70")} aria-busy={navigating}>
        {rows.length === 0 ? (
          <div className="rounded-card border border-line bg-card">
            {filtered ? (
              <EmptyState icon="eye" title="No hidden content matches these filters">
                Try a different filter or clear them.
              </EmptyState>
            ) : (
              <EmptyState icon="eye" title="Nothing is hidden">
                Posts and comments that moderators hide or remove appear here so they can be reviewed and restored.
              </EmptyState>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.target.id}
                className={cn("flex flex-col gap-3 rounded-card border bg-card p-4 sm:p-5", selection.has(row.target.id) ? "border-primary" : "border-line")}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                  {canAct && (
                    <SelectBox
                      checked={selection.has(row.target.id)}
                      label={t(row.target.type === "post" ? "Select post by {name}" : "Select comment by {name}", { name: row.author?.name ?? t("unknown author") })}
                      onChange={(on) => selection.toggle(row.target.id, on)}
                    />
                  )}
                  <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
                    {row.target.type === "post" ? "Post" : "Comment"}
                  </Chip>
                  <Chip tone={row.moderationState === "removed" ? "error" : "info"} className="px-2! py-0.5! text-xs!">
                    {row.moderationState === "removed" ? "Removed" : "Hidden"}
                  </Chip>
                  {row.author && (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={row.author.name} size={24} tone={row.author.tone} src={row.author.avatarUrl ?? undefined} />
                      <span className="font-medium text-ink">{row.author.name}</span>@{row.author.handle}
                    </span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {row.moderationState === "removed" ? "Removed" : "Hidden"} <DateTime iso={row.hiddenAt} />
                  </span>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap text-ink">{row.target.preview}</p>
                {row.action ? (
                  <div className="flex flex-col gap-1 rounded-[10px] bg-surface p-3 text-sm">
                    <p className="text-xs text-secondary">
                      {ACTION_LABELS[row.action.action]} by{" "}
                      <span className="text-body">{row.action.moderator.id === viewerId ? "you" : row.action.moderator.name}</span>
                      {row.action.policyRef && <> · {POLICY_REF_LABELS[row.action.policyRef]}</>}
                      {row.action.appealStatus && <> · {APPEAL_STATUS_CHIP[row.action.appealStatus].label}</>}
                    </p>
                    <p className="text-body">“{row.action.reason}”</p>
                  </div>
                ) : (
                  <p className="text-xs text-secondary">Hidden automatically (no moderator action on record).</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={webHref(row.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline"
                  >
                    View on site
                    <Icon name="external" size={14} />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  {canAct && (
                    <button
                      type="button"
                      className={buttonClasses({ variant: "secondary", size: "small" })}
                      onClick={() => setRestoring(row)}
                    >
                      Restore
                      <span className="sr-only"> <T vars={{ type: row.target.type, count: row.author?.name ?? "unknown author" }}>{"{type} by {count}"}</T></span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
        {cursor && (
          <div className="flex justify-center">
            <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {canAct && (
        <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
          <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => setBulkRestoring(true)}>
            Restore
          </Button>
        </BulkBar>
      )}

      {bulkRestoring && (
        <ReasonDialog
          title={t("Restore {count} items?", { count: selection.count })}
          description="They return to feeds, topic pages and search within 60 seconds, and each author is notified."
          confirmLabel="Restore"
          reasonLabel="Reason"
          reasonHint="The same reason is recorded for each one in the audit log."
          onConfirm={async (reason) => {
            setBulkRestoring(false);
            await restoreAll(reason);
          }}
          onClose={() => setBulkRestoring(false)}
        />
      )}
      {restoring && (
        <ReasonDialog
          title={t("Restore this {type}?", { type: restoring.target.type })}
          description={
            <>
              <p className="mb-1 line-clamp-2 font-medium text-ink">{restoring.target.preview}</p>
              <p>It returns to feeds, topic pages and search within 60 seconds and the author is notified.</p>
            </>
          }
          confirmLabel="Restore"
          onConfirm={restore}
          onClose={() => setRestoring(null)}
        />
      )}
    </>
  );
}

export function HiddenListSkeleton() {
  return (
    <div role="status" aria-label="Loading hidden content" className="flex flex-col gap-3">
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </div>
  );
}
