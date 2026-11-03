"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminHiddenRow, DirectActionInput, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonCard } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { ACTION_LABELS, APPEAL_STATUS_CHIP, POLICY_REF_LABELS } from "@/lib/labels";
import { webHref } from "@/lib/navigation";

export type HiddenType = "all" | "post" | "comment";

const TYPES: { value: HiddenType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "comment", label: "Comments" },
];

type More = { base: string | null; rows: AdminHiddenRow[]; cursor: string | null };

/** Hidden and removed posts and comments (GET /admin/hidden), each restorable with a reason. */
export function HiddenList({
  type,
  initialRows,
  initialCursor,
  viewerId,
  canAct,
}: {
  type: HiddenType;
  initialRows: AdminHiddenRow[];
  initialCursor: string | null;
  viewerId: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<AdminHiddenRow | null>(null);
  const [restored, setRestored] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const extra = more && more.base === initialCursor ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const seen = new Set<string>();
  const rows = [...initialRows, ...(extra?.rows ?? [])].filter((r) =>
    restored.has(r.target.id) || seen.has(r.target.id) ? false : (seen.add(r.target.id), true),
  );

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AdminHiddenRow>>("/admin/hidden", {
        query: { targetType: type === "all" ? undefined : type, cursor, limit: 25 },
      });
      setMore({ base: initialCursor, rows: [...(extra?.rows ?? []), ...page.items], cursor: page.nextCursor });
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
    setNotice(
      `${restoring.target.type === "post" ? "Post" : "Comment"} by ${restoring.author?.name ?? "unknown author"} restored. It returns to feeds within 60 seconds.`,
    );
    setRestoring(null);
    startNavigation(() => router.refresh());
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Content type"
          items={TYPES}
          value={type}
          onChange={(value) =>
            startNavigation(() => router.push(value === "all" ? "/moderation/hidden" : `/moderation/hidden?type=${value}`, { scroll: false }))
          }
        />
        <p className="text-xs text-secondary">Newest first. Restoring notifies the author.</p>
      </div>

      {notice && <FormNotice tone="success">{notice}</FormNotice>}

      <div className={cn("flex flex-col gap-3 transition-opacity", navigating && "opacity-70")} aria-busy={navigating}>
        {rows.length === 0 ? (
          <div className="rounded-card border border-line bg-card">
            <EmptyState icon="eye" title="Nothing is hidden">
              Posts and comments that moderators hide or remove appear here so they can be reviewed and restored.
            </EmptyState>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.target.id} className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
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
                      <span className="sr-only"> {row.target.type} by {row.author?.name ?? "unknown author"}</span>
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


      {restoring && (
        <ReasonDialog
          title={`Restore this ${restoring.target.type}?`}
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
