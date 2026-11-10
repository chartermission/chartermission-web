"use client";

import type React from "react";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminAppealRow, AppealDecisionInput, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, Divider, Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { ActionHistoryItem } from "@/components/moderation/report-detail";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age, DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { ACTION_LABELS, APPEAL_STATUS_CHIP, TARGET_LABELS } from "@/lib/labels";
import { webHref } from "@/lib/navigation";
import { T, useT } from "@/i18n/client";

export type AppealsTab = "open" | "decided";
type Decision = AppealDecisionInput["decision"];
type More = { base: string | null; rows: AdminAppealRow[]; cursor: string | null };

const TABS: { value: AppealsTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "decided", label: "Decided" },
];

const isDecided = (a: AdminAppealRow) => a.status === "upheld" || a.status === "overturned";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-label text-secondary uppercase">{children}</h3>;
}

/** Why the viewer can't decide this appeal, or null when they can. */
function blockedReason(appeal: AdminAppealRow, viewerId: string, hasPermission: boolean): string | null {
  if (appeal.canDecide) return null;
  if (isDecided(appeal)) return null;
  if (!hasPermission) return "Your role can review appeals but not decide them.";
  if (appeal.action.moderator.id === viewerId) {
    return "You took the original action, so a different moderator must decide this appeal. Ask another moderator to review it.";
  }
  if (appeal.appellant.id === viewerId) return "You can’t decide your own appeal.";
  return "A different moderator from the one who took the original action must decide this appeal.";
}

/** Appeals list and detail with uphold / overturn (POST /admin/appeals/{id}/decide). */
export function AppealsWorkspace({
  tab,
  initialRows,
  initialCursor,
  initialSelected,
  viewerId,
  canDecidePermission,
}: {
  tab: AppealsTab;
  initialRows: AdminAppealRow[];
  initialCursor: string | null;
  initialSelected: string | null;
  viewerId: string;
  canDecidePermission: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const [navigating, startNavigation] = useTransition();
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [decided, setDecided] = useState<Record<string, AdminAppealRow>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const extra = more && more.base === initialCursor ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const seen = new Set<string>();
  const all = [...initialRows, ...(extra?.rows ?? [])]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => decided[r.id] ?? r);
  // Appeals decided here stay visible on the Open tab until the next visit, showing the outcome.
  const rows = tab === "open" ? all.filter((r) => !isDecided(r) || decided[r.id]) : all;
  const current = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AdminAppealRow>>("/admin/appeals", {
        query: { status: tab, cursor, limit: 50 },
      });
      setMore({ base: initialCursor, rows: [...(extra?.rows ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function decide(reason: string) {
    if (!current || !deciding) return;
    const body: AppealDecisionInput = { decision: deciding, reason };
    const row = await api<AdminAppealRow>(`/admin/appeals/${current.id}/decide`, { method: "POST", body });
    setDecided((prev) => ({ ...prev, [row.id]: row }));
    setNotice(
      deciding === "upheld"
        ? t("Appeal upheld. The original action stays in place and {name} has been told.", { name: current.appellant.name })
        : t("Appeal overturned. The original action was reversed and {name} has been told.", { name: current.appellant.name }),
    );
    setDeciding(null);
    startNavigation(() => router.refresh());
  }

  const blocked = current ? blockedReason(current, viewerId, canDecidePermission) : null;
  const postHref = current?.target.type === "post" ? webHref(`/posts/${current.target.id}`) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Appeal status"
          items={TABS}
          value={tab}
          onChange={(value) => startNavigation(() => router.push(value === "open" ? "/appeals" : "/appeals?status=decided"))}
        />
        <p className="text-xs text-secondary">Oldest first. Each member gets one appeal per action.</p>
      </div>

      {notice && <FormNotice tone="success">{notice}</FormNotice>}

      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] items-start gap-5 transition-opacity",
          rows.length > 0 && "xl:grid-cols-[minmax(0,1fr)_440px]",
          navigating && "opacity-70",
        )}
        aria-busy={navigating}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative overflow-hidden rounded-card border border-line bg-card">
            {rows.length === 0 ? (
              <EmptyState icon="flag" title={tab === "open" ? "No open appeals" : "No decided appeals yet"}>
                {tab === "open"
                  ? "When a member appeals a moderation action it appears here for a different moderator to decide."
                  : "Upheld and overturned appeals appear here."}
              </EmptyState>
            ) : (
              <ul aria-label={tab === "open" ? "Open appeals" : "Decided appeals"}>
                {rows.map((row) => {
                  const selected = row.id === current?.id;
                  const status = APPEAL_STATUS_CHIP[row.status];
                  return (
                    <li key={row.id} className="border-t border-line first:border-t-0">
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-controls={`${ids}-detail`}
                        onClick={() => setSelectedId(row.id)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
                          selected ? "bg-primary-tint-2" : "hover:bg-surface",
                        )}
                      >
                        <Avatar name={row.appellant.name} size={32} tone={row.appellant.tone} src={row.appellant.avatarUrl ?? undefined} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
                            <span>
                              <span className="font-medium text-ink">{row.appellant.name}</span> · appeal of{" "}
                              {ACTION_LABELS[row.action.action].toLowerCase()} {TARGET_LABELS[row.target.type].toLowerCase()}
                            </span>
                            <Age iso={row.createdAt} />
                          </span>
                          <span className="line-clamp-2 text-sm text-ink">“{row.statement}”</span>
                          <span className="flex flex-wrap items-center gap-2">
                            <Chip tone={status.tone} className="px-2! py-0.5! text-xs!">
                              {status.label}
                            </Chip>
                            {!row.canDecide && !isDecided(row) && row.action.moderator.id === viewerId && (
                              <span className="text-xs text-secondary">Your action · another moderator decides</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? "Loading…" : "Load more appeals"}
              </Button>
            </div>
          )}
        </div>

        {current && (
          <section
            id={`${ids}-detail`}
            aria-label="Appeal detail"
            className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5 xl:sticky xl:top-[80px]"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-h3 text-ink"><T vars={{ name: current.appellant.name }}>{"Appeal from {name}"}</T></h2>
                <p className="text-xs text-secondary">
                  @{current.appellant.handle} · submitted <DateTime iso={current.createdAt} />
                </p>
              </div>
              <Chip tone={APPEAL_STATUS_CHIP[current.status].tone}>{APPEAL_STATUS_CHIP[current.status].label}</Chip>
            </div>

            <div className="flex flex-col gap-1.5">
              <SectionLabel>Member’s appeal</SectionLabel>
              <blockquote className="rounded-[10px] border border-line bg-surface p-3.5 text-sm break-words whitespace-pre-wrap text-ink">
                {current.statement}
              </blockquote>
            </div>

            <div className="flex flex-col gap-1.5">
              <SectionLabel>Original action</SectionLabel>
              <ul>
                <ActionHistoryItem action={current.action} current={current.target} />
              </ul>
            </div>

            <div className="flex flex-col gap-1.5">
              <SectionLabel><T vars={{ lowerCase: TARGET_LABELS[current.target.type].toLowerCase() }}>{"Affected {lowerCase}"}</T></SectionLabel>
              <p className="text-sm break-words text-body">{current.target.preview ?? "This content is no longer available."}</p>
              {postHref && (
                <a
                  href={postHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary hover:underline"
                >
                  View on site
                  <Icon name="external" size={14} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </div>

            <Divider />

            <div className="flex flex-col gap-2.5">
              <SectionLabel>Decision</SectionLabel>
              {isDecided(current) ? (
                <p className="text-sm text-body">
                  {current.status === "upheld"
                    ? "Upheld: the original action stays in place. This was the member’s only appeal."
                    : "Overturned: the original action was reversed."}
                </p>
              ) : blocked ? (
                <p className="flex items-start gap-2 rounded-lg bg-warning-light p-3 text-sm text-body">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
                  {blocked}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClasses({ variant: "primary", size: "small" })} onClick={() => setDeciding("upheld")}>
                    Uphold decision
                  </button>
                  <button
                    type="button"
                    className={buttonClasses({ variant: "secondary", size: "small" })}
                    onClick={() => setDeciding("overturned")}
                  >
                    Overturn and reverse
                  </button>
                </div>
              )}
            </div>

            <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
              <Icon name="alert" size={16} className="shrink-0 text-info" />
              Appeals must be decided by a different moderator from the one who took the original action.
            </p>
          </section>
        )}
      </div>


      {deciding && current && (
        <ReasonDialog
          title={deciding === "upheld" ? "Uphold the original decision?" : "Overturn the original decision?"}
          description={
            deciding === "upheld"
              ? "The original action stays in place. This is the member’s only appeal, so the decision is final."
              : "The original action is reversed: hidden content is restored and any restriction or suspension is lifted."
          }
          confirmLabel={deciding === "upheld" ? "Uphold decision" : "Overturn decision"}
          reasonLabel="Decision note"
          reasonPlaceholder="Explain the decision for the audit log. The member is told the outcome in general terms."
          onConfirm={decide}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}

export function AppealsSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <SkeletonTable label="Loading appeals" rows={4} />
      <SkeletonCard lines={6} className="hidden xl:flex" />
    </div>
  );
}
