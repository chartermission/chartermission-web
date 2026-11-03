"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminTrendingResponse,
  AdminTrendingRow,
  ChapterRef,
  Country,
  TrendingOverrideInput,
} from "@chartermission/contracts";
import { Chip, FilterSelect, Icon, SegmentedControl, buttonClasses, cn, type ChipTone } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { DialogSelect, ReasonDialog } from "@/components/reason-dialog";
import { SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { api } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { trendingSearch, type TrendingView } from "@/lib/trending-view";
import { TrendingRulesPanel } from "./trending-rules";
import { TrendingRunStatus } from "./trending-run-status";

type Status = AdminTrendingRow["status"];
type Pending =
  | { kind: "pin" | "suppress"; tag: string }
  | { kind: "unpin" | "restore"; tag: string; overrideId: string };

const STATUS_CHIP: Record<Status, { label: string; tone: ChipTone }> = {
  trending: { label: "Trending", tone: "success" },
  pinned: { label: "Pinned", tone: "info" },
  suppressed: { label: "Suppressed", tone: "error" },
  below_threshold: { label: "Below threshold", tone: "neutral" },
};

const SCOPES = [
  { value: "global", label: "Global" },
  { value: "country", label: "Country" },
  { value: "chapter", label: "Chapter" },
] as const;

const WINDOWS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

const EXPIRY_OPTIONS = [
  { value: "", label: "No expiry (until revoked)" },
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

const DIALOG_COPY = {
  pin: {
    title: "Pin this topic?",
    confirm: "Pin topic",
    describe: (tag: string, scope: string) =>
      `#${tag} stays in the ${scope} trending list whatever its score until the pin is revoked or expires.`,
  },
  suppress: {
    title: "Suppress this topic?",
    confirm: "Suppress topic",
    describe: (tag: string, scope: string) =>
      `#${tag} leaves the ${scope} trending list at the next run and can’t re-enter until the suppression ends. Posts using it stay visible in feeds.`,
  },
  unpin: {
    title: "Unpin this topic?",
    confirm: "Unpin topic",
    describe: (tag: string, scope: string) => `#${tag} returns to its computed position in ${scope} at the next run.`,
  },
  restore: {
    title: "Restore this topic?",
    confirm: "Restore topic",
    describe: (tag: string, scope: string) => `#${tag} can trend in ${scope} again at the next run if it meets the rules.`,
  },
} as const;

const cleanTag = (tag: string) => tag.trim().replace(/^#/, "");
const ghostSmall = buttonClasses({ variant: "ghost", size: "small" });
const secondarySmall = buttonClasses({ variant: "secondary", size: "small" });

/**
 * Live ranking per scope and window with pin / suppress / revoke, the rules and the run status
 * (Figma nodes 20:3590 – 20:3736). Every control asks for a reason and is audited.
 */
export function TrendingConsole({
  view,
  data,
  countries,
  chapters,
  canManage,
  canEditRules,
  viewerId,
}: {
  view: TrendingView;
  data: AdminTrendingResponse | null;
  countries: Country[];
  chapters: ChapterRef[];
  canManage: boolean;
  canEditRules: boolean;
  viewerId: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [navigating, startNavigation] = useTransition();
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const tagRef = useRef<HTMLInputElement>(null);

  const scopeName =
    view.scope === "global"
      ? "global"
      : view.scope === "country"
        ? (countries.find((c) => c.code === view.scopeId)?.name ?? "this country")
        : (chapters.find((c) => c.id === view.scopeId || c.slug === view.scopeId)?.name ?? "this chapter");

  function go(next: TrendingView) {
    startNavigation(() => router.push(`/trending${trendingSearch(next)}`, { scroll: false }));
  }

  const rows = data?.rows ?? [];
  const pinned = rows.filter((r) => r.status === "pinned" && r.override);
  const suppressed = rows.filter((r) => r.status === "suppressed" && r.override);

  async function confirm(reason: string, form: FormData) {
    if (!pending) return;
    const tag = pending.tag;
    if (pending.kind === "pin" || pending.kind === "suppress") {
      const hours = String(form.get("expires") ?? "");
      const body: TrendingOverrideInput = {
        tag,
        action: pending.kind,
        scope: view.scope,
        scopeId: view.scope === "global" ? undefined : view.scopeId,
        reason,
        expiresAt: hours ? new Date(Date.now() + Number(hours) * 3_600_000).toISOString() : undefined,
      };
      await api("/admin/trending/overrides", { method: "POST", body });
    } else if ("overrideId" in pending) {
      await api(`/admin/trending/overrides/${pending.overrideId}`, { method: "DELETE", body: { reason } });
    }
    const verb = { pin: "pinned", suppress: "suppressed", unpin: "unpinned", restore: "restored" }[pending.kind];
    setNotice(`#${tag} ${verb} in ${scopeName === "global" ? "global trending" : scopeName}. Reason recorded in the audit log.`);
    setPending(null);
    if (tagRef.current && cleanTag(tagRef.current.value).toLowerCase() === tag.toLowerCase()) tagRef.current.value = "";
    startNavigation(() => router.refresh());
  }

  function controlTopic(kind: "pin" | "suppress") {
    const tag = cleanTag(tagRef.current?.value ?? "");
    if (!/^[A-Za-z0-9_]{2,50}$/.test(tag)) {
      setTagError("Enter a topic of 2–50 letters, numbers or underscores, e.g. #AfCFTA");
      return;
    }
    setTagError(null);
    setPending({ kind, tag });
  }

  const scopeSelect =
    view.scope === "country" ? (
      <FilterSelect
        label="Country"
        value={view.scopeId ?? ""}
        onChange={(e) => go({ ...view, scopeId: e.target.value || undefined })}
        options={[{ value: "", label: "Choose a country" }, ...countries.map((c) => ({ value: c.code, label: c.name }))]}
      />
    ) : view.scope === "chapter" ? (
      <FilterSelect
        label="Chapter"
        value={view.scopeId ?? ""}
        onChange={(e) => go({ ...view, scopeId: e.target.value || undefined })}
        options={[{ value: "", label: "Choose a chapter" }, ...chapters.map((c) => ({ value: c.id, label: c.name }))]}
      />
    ) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ranking scope and window" aria-busy={navigating}>
          <SegmentedControl
            label="Scope"
            items={SCOPES}
            value={view.scope}
            onChange={(scope) => go({ scope, window: view.window })}
          />
          {scopeSelect}
          <SegmentedControl label="Window" items={WINDOWS} value={view.window} onChange={(window) => go({ ...view, window })} />
        </div>
        {data && <TrendingRunStatus computedAt={data.computedAt} recomputeMinutes={data.rules.recomputeMinutes} />}
      </div>

      {data && <TrendingRulesPanel rules={data.rules} canEdit={canEditRules} />}

      {notice && <FormNotice tone="success">{notice}</FormNotice>}

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-5 transition-opacity xl:grid-cols-[minmax(0,1fr)_340px]", navigating && "opacity-70")}>
        <section aria-labelledby={`${ids}-ranking`} className="relative min-w-0 overflow-hidden rounded-card border border-line bg-card">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <h2 id={`${ids}-ranking`} className="text-h3 text-ink">
              Live ranking
            </h2>
            <Chip tone="neutral">
              {scopeName === "global" ? "Global" : scopeName} · {view.window}
            </Chip>
          </div>
          {!data ? (
            <EmptyState icon="globe" title={`Choose a ${view.scope} to see its ranking`} className="border-t border-line" />
          ) : rows.length === 0 ? (
            <EmptyState icon="trending" title="Nothing is trending here yet" className="border-t border-line">
              Topics appear once enough distinct members post about them in this window.
            </EmptyState>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
                <caption className="sr-only">
                  Topics in the {scopeName} ranking over the last {view.window === "24h" ? "24 hours" : "7 days"}
                </caption>
                <colgroup>
                  <col className="w-[56px]" />
                  <col />
                  <col className="w-[72px]" />
                  <col className="w-[80px]" />
                  <col className="w-[92px]" />
                  <col className="w-[136px]" />
                  <col className="w-[156px]" />
                </colgroup>
                <thead className="border-y border-line bg-muted text-label text-secondary uppercase">
                  <tr>
                    <th scope="col" className="py-2.5 pr-2.5 pl-4 font-semibold">
                      #<span className="sr-only">Rank</span>
                    </th>
                    <th scope="col" className="py-2.5 pr-2.5 font-semibold">Topic</th>
                    <th scope="col" className="py-2.5 pr-2.5 font-semibold">Posts</th>
                    <th scope="col" className="py-2.5 pr-2.5 font-semibold">Authors</th>
                    <th scope="col" className="py-2.5 pr-2.5 font-semibold">Velocity</th>
                    <th scope="col" className="py-2.5 pr-2.5 font-semibold">Status</th>
                    <th scope="col" className="py-2.5 pr-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const chip = STATUS_CHIP[row.status];
                    const isSuppressed = row.status === "suppressed";
                    const tag = cleanTag(row.tag);
                    return (
                      <tr key={row.tag} className={cn("border-t border-line first:border-t-0", isSuppressed && "bg-error-light")}>
                        <td className="py-3 pr-2.5 pl-4 font-medium text-secondary">
                          {row.rank ??
                            (row.status === "pinned" ? (
                              <Icon name="pin" size={16} label="Pinned" className="text-info" />
                            ) : (
                              <span aria-label="Not ranked">—</span>
                            ))}
                        </td>
                        <th scope="row" className="truncate py-3 pr-2.5 font-medium text-ink">
                          #{tag}
                        </th>
                        <td className="py-3 pr-2.5 text-body">{formatCount(row.posts)}</td>
                        <td className={cn("py-3 pr-2.5", isSuppressed ? "text-error" : "text-body")}>{formatCount(row.authors)}</td>
                        <td
                          className={cn(
                            "py-3 pr-2.5 font-medium",
                            isSuppressed ? "text-error" : row.velocityPct > 0 ? "text-success" : "text-secondary",
                          )}
                        >
                          {row.velocityPct > 0 ? "+" : ""}
                          {formatCount(row.velocityPct)}%
                        </td>
                        <td className="py-3 pr-2.5">
                          <Chip tone={chip.tone} className="px-2.5! text-xs!">
                            {chip.label}
                          </Chip>
                        </td>
                        <td className="py-3 pr-4">
                          {canManage ? (
                            <div className="flex gap-1">
                              {(row.status === "trending" || row.status === "below_threshold") && (
                                <>
                                  <button type="button" className={ghostSmall} onClick={() => setPending({ kind: "pin", tag })}>
                                    Pin<span className="sr-only"> #{tag}</span>
                                  </button>
                                  <button type="button" className={ghostSmall} onClick={() => setPending({ kind: "suppress", tag })}>
                                    Suppress<span className="sr-only"> #{tag}</span>
                                  </button>
                                </>
                              )}
                              {row.status === "pinned" && row.override && (
                                <button
                                  type="button"
                                  className={secondarySmall}
                                  onClick={() => setPending({ kind: "unpin", tag, overrideId: row.override!.id })}
                                >
                                  Unpin<span className="sr-only"> #{tag}</span>
                                </button>
                              )}
                              {isSuppressed && row.override && (
                                <button
                                  type="button"
                                  className={secondarySmall}
                                  onClick={() => setPending({ kind: "restore", tag, overrideId: row.override!.id })}
                                >
                                  Restore<span className="sr-only"> #{tag}</span>
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-secondary">View only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {canManage && data && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                controlTopic("pin");
              }}
              className="flex flex-col gap-3 rounded-card border border-line bg-card p-5"
              aria-labelledby={`${ids}-control`}
            >
              <h2 id={`${ids}-control`} className="text-h3 text-ink">
                Control a topic
              </h2>
              <p className="text-xs text-secondary">For topics not in the list yet, e.g. to stop coordinated spam before it trends.</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-tag`} className="text-label text-ink">
                  Topic
                </label>
                <input
                  ref={tagRef}
                  id={`${ids}-tag`}
                  name="tag"
                  placeholder="#topic"
                  autoComplete="off"
                  aria-invalid={tagError ? true : undefined}
                  aria-describedby={tagError ? `${ids}-tag-error` : undefined}
                  onChange={() => tagError && setTagError(null)}
                  className={inputClasses(!!tagError)}
                />
                {tagError && (
                  <p id={`${ids}-tag-error`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
                    <Icon name="alert" size={14} />
                    {tagError}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button type="submit" className={secondarySmall}>
                  Pin
                </button>
                <button
                  type="button"
                  className={buttonClasses({ variant: "secondary", size: "small", className: "text-error!" })}
                  onClick={() => controlTopic("suppress")}
                >
                  Suppress
                </button>
              </div>
            </form>
          )}
          <ControlList
            title="Suppressed topics"
            empty="No topics are suppressed here."
            tone="bg-error-light"
            rows={suppressed}
            verb="Suppressed"
            viewerId={viewerId}
          />
          <ControlList title="Pinned topics" empty="No topics are pinned here." tone="bg-info-light" rows={pinned} verb="Pinned" viewerId={viewerId} />
          <p className="flex items-center gap-2 rounded-[10px] bg-muted p-3 text-xs text-body">
            <Icon name="clock" size={16} className="shrink-0 text-secondary" />
            Global pins and suppressions apply in every scope. Every change is written to the audit log with a reason.
          </p>
        </div>
      </div>


      {pending && (
        <ReasonDialog
          title={DIALOG_COPY[pending.kind].title}
          description={DIALOG_COPY[pending.kind].describe(pending.tag, scopeName === "global" ? "global" : scopeName)}
          confirmLabel={DIALOG_COPY[pending.kind].confirm}
          tone={pending.kind === "suppress" ? "danger" : "primary"}
          reasonPlaceholder={
            pending.kind === "pin" ? "e.g. Fellowship applications close on 30 Nov" : "Explain the decision for the audit log"
          }
          onConfirm={confirm}
          onClose={() => setPending(null)}
        >
          {(pending.kind === "pin" || pending.kind === "suppress") && (
            <DialogSelect
              label={pending.kind === "pin" ? "Pin for" : "Suppress for"}
              name="expires"
              options={EXPIRY_OPTIONS}
              defaultValue="168"
            />
          )}
        </ReasonDialog>
      )}
    </>
  );
}

function ControlList({
  title,
  empty,
  tone,
  rows,
  verb,
  viewerId,
}: {
  title: string;
  empty: string;
  tone: string;
  rows: AdminTrendingRow[];
  verb: string;
  viewerId: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
      <h2 className="text-h3 text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.tag} className={cn("flex flex-col gap-1 rounded-[10px] p-3.5", tone)}>
              <p className="text-sm font-medium text-ink">#{cleanTag(row.tag)}</p>
              <p className="text-xs text-body">“{row.override!.reason}”</p>
              <p className="text-xs text-secondary">
                {verb} by {row.override!.actor.id === viewerId ? "you" : row.override!.actor.name} ·{" "}
                <DateTime iso={row.override!.createdAt} />
                {row.override!.expiresAt ? (
                  <>
                    {" "}
                    · until <DateTime iso={row.override!.expiresAt} />
                  </>
                ) : (
                  " · no expiry"
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TrendingSkeleton() {
  return (
    <>
      <SkeletonCard lines={2} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SkeletonTable label="Loading trending topics" rows={8} />
        <SkeletonCard lines={4} className="hidden xl:flex" />
      </div>
    </>
  );
}
