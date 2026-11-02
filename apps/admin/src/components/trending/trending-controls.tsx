"use client";

import { useState } from "react";
import { Chip, Icon, buttonClasses, chipClasses, cn } from "@chartermission/ui";
import { DialogSelect, ReasonDialog } from "@/components/reason-dialog";
import { staffViewer } from "@/lib/mock/console";
import {
  controlDurations,
  suppressCategories,
  trendScopes,
  type TrendRow,
  type TrendScope,
  type TrendStatus,
} from "@/lib/mock/trending";

type ControlKind = "pin" | "suppress" | "unpin" | "restore";
type Pending = { scope: TrendScope; tag: string; kind: ControlKind };

const statusChip: Record<TrendStatus, { label: string; tone: "success" | "info" | "error" }> = {
  trending: { label: "Trending", tone: "success" },
  pinned: { label: "Pinned", tone: "info" },
  suppressed: { label: "Suppressed", tone: "error" },
};

const scopeLabel = (scope: TrendScope) => trendScopes.find((s) => s.value === scope)?.label ?? scope;
const formatCount = (value: number) => value.toLocaleString("en-US");

const dialogCopy: Record<ControlKind, { title: string; confirm: string; describe: (tag: string, scope: string) => string }> = {
  pin: {
    title: "Pin this topic?",
    confirm: "Pin topic",
    describe: (tag, scope) =>
      `${tag} stays in the ${scope} trending list whatever its score until the pin lapses. Members see it marked as featured.`,
  },
  suppress: {
    title: "Suppress this topic?",
    confirm: "Suppress topic",
    describe: (tag, scope) =>
      `${tag} leaves the ${scope} trending list within 5 minutes and cannot re-enter until the suppression lapses. Posts using it stay visible in feeds.`,
  },
  unpin: {
    title: "Unpin this topic?",
    confirm: "Unpin topic",
    describe: (tag, scope) => `${tag} returns to its computed position in ${scope} at the next run.`,
  },
  restore: {
    title: "Restore this topic?",
    confirm: "Restore topic",
    describe: (tag, scope) => `${tag} can trend in ${scope} again at the next run if it meets the trending rules.`,
  },
};

const ghostSmall = buttonClasses({ variant: "ghost", size: "small" });
const secondarySmall = buttonClasses({ variant: "secondary", size: "small" });

/**
 * Live ranking with pin / suppress / unpin / restore, plus the pinned and suppressed
 * summaries (Figma nodes 20:3614 and 20:3736). Every control asks for a reason.
 */
export function TrendingControls({ initialRankings }: { initialRankings: Record<TrendScope, TrendRow[]> }) {
  const [rankings, setRankings] = useState(initialRankings);
  const [scope, setScope] = useState<TrendScope>("africa");
  const [pending, setPending] = useState<Pending | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const rows = rankings[scope];
  let rank = 0;
  const ranked = rows.map((row) => ({ row, rank: row.status === "trending" ? ++rank : null }));

  const controlled = (status: TrendStatus) =>
    trendScopes.flatMap(({ value }) =>
      rankings[value].filter((row) => row.status === status).map((row) => ({ scope: value, row })),
    );
  const suppressed = controlled("suppressed");
  const pinned = controlled("pinned");

  function confirm(reason: string, data: FormData) {
    if (!pending) return;
    const { kind, tag } = pending;
    const days = Number(data.get("duration") ?? 7);
    const durationLabel = controlDurations.find((d) => Number(d.value) === days)?.label ?? `${days} days`;
    const until = new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    setRankings((prev) => ({
      ...prev,
      [pending.scope]: prev[pending.scope].map((row): TrendRow => {
        if (row.tag !== tag) return row;
        if (kind === "pin") {
          return { ...row, status: "pinned", control: { by: staffViewer.shortName, when: "just now", reason, term: `until ${until}` } };
        }
        if (kind === "suppress") {
          return {
            ...row,
            status: "suppressed",
            control: {
              by: staffViewer.shortName,
              when: "just now",
              reason,
              term: `expires in ${durationLabel}`,
              category: String(data.get("category") ?? suppressCategories[0]),
            },
          };
        }
        return { ...row, status: "trending", control: undefined };
      }),
    }));
    const verb = { pin: "pinned", suppress: "suppressed", unpin: "unpinned", restore: "restored" }[kind];
    setAnnouncement(`${tag} ${verb} in ${scopeLabel(pending.scope)}. Reason recorded in the audit log.`);
    setPending(null);
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-labelledby="live-ranking" className="overflow-hidden rounded-card border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <h2 id="live-ranking" className="text-h3 text-ink">
              Live ranking
            </h2>
            <Chip tone="neutral">{scopeLabel(scope)} · 24h</Chip>
          </div>
          <div role="group" aria-label="Scope" className="flex gap-1.5">
            {trendScopes.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={s.value === scope}
                onClick={() => setScope(s.value)}
                className={cn(
                  chipClasses(s.value === scope ? "active" : "filter"),
                  s.value !== scope && "hover:border-line-strong hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
            <caption className="sr-only">Trending hashtags in {scopeLabel(scope)} over the last 24 hours</caption>
            <colgroup>
              <col className="w-[62px]" />
              <col className="w-[160px]" />
              <col className="w-[74px]" />
              <col className="w-[74px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col />
            </colgroup>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2.5 pr-2.5 pl-4 font-semibold">
                  #<span className="sr-only">Rank</span>
                </th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Hashtag</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Posts</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Authors</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Velocity</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Status</th>
                <th scope="col" className="py-2.5 pr-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ row, rank: position }) => {
                const isSuppressed = row.status === "suppressed";
                const chip = statusChip[row.status];
                const open = (kind: ControlKind) => setPending({ scope, tag: row.tag, kind });
                return (
                  <tr key={row.tag} className={cn("border-t border-line first:border-t-0", isSuppressed && "bg-error-light")}>
                    <td className="py-3 pr-2.5 pl-4 font-medium text-secondary">
                      {position ?? <span aria-label="Not ranked">—</span>}
                    </td>
                    <th scope="row" className="truncate py-3 pr-2.5 font-medium text-ink">
                      {row.tag}
                    </th>
                    <td className="py-3 pr-2.5 text-body">{formatCount(row.posts)}</td>
                    <td className={cn("py-3 pr-2.5", isSuppressed ? "text-error" : "text-body")}>{formatCount(row.authors)}</td>
                    <td className={cn("py-3 pr-2.5 font-medium", isSuppressed ? "text-error" : "text-success")}>
                      +{formatCount(row.velocity)}%
                    </td>
                    <td className="py-3 pr-2.5">
                      <Chip tone={chip.tone}>{chip.label}</Chip>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1.5">
                        {row.status === "trending" && (
                          <>
                            <button type="button" className={ghostSmall} onClick={() => open("pin")}>
                              Pin<span className="sr-only"> {row.tag}</span>
                            </button>
                            <button type="button" className={ghostSmall} onClick={() => open("suppress")}>
                              Suppress<span className="sr-only"> {row.tag}</span>
                            </button>
                          </>
                        )}
                        {row.status === "pinned" && (
                          <button type="button" className={secondarySmall} onClick={() => open("unpin")}>
                            Unpin<span className="sr-only"> {row.tag}</span>
                          </button>
                        )}
                        {isSuppressed && (
                          <button type="button" className={secondarySmall} onClick={() => open("restore")}>
                            Restore<span className="sr-only"> {row.tag}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <ControlList
          title="Suppressed topics"
          empty="No topics are suppressed."
          tone="bg-error-light"
          items={suppressed.map(({ scope: s, row }) => ({
            key: `${s}-${row.tag}`,
            tag: row.tag,
            detail: `${row.control?.category ?? "Suppressed"} · ${formatCount(row.authors)} authors made ${formatCount(row.posts)} posts`,
            meta: `Suppressed by ${row.control?.by ?? "staff"} · ${row.control?.when ?? ""} · ${row.control?.term ?? ""}`,
          }))}
        />
        <ControlList
          title="Pinned topics"
          empty="No topics are pinned."
          tone="bg-info-light"
          items={pinned.map(({ scope: s, row }) => ({
            key: `${s}-${row.tag}`,
            tag: row.tag,
            detail: `Pinned to ${scopeLabel(s)} · ${row.control?.term ?? ""}${row.control ? ` (${row.control.reason})` : ""}`,
            meta: `Pinned by ${row.control?.by ?? "staff"} · ${row.control?.when ?? ""}`,
          }))}
        />
        <p className="flex items-center gap-2 rounded-[10px] bg-muted p-3 text-xs text-body">
          <Icon name="clock" size={16} className="shrink-0 text-secondary" />
          Every pin, suppress and restore is written to the audit log with a reason.
        </p>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {pending && (
        <ReasonDialog
          title={dialogCopy[pending.kind].title}
          description={dialogCopy[pending.kind].describe(pending.tag, scopeLabel(pending.scope))}
          confirmLabel={dialogCopy[pending.kind].confirm}
          tone={pending.kind === "suppress" ? "danger" : "primary"}
          reasonPlaceholder={
            pending.kind === "pin"
              ? "e.g. Fellowship applications close on 30 Nov"
              : "Explain the decision for the audit log"
          }
          onConfirm={confirm}
          onClose={() => setPending(null)}
        >
          {pending.kind === "suppress" && (
            <DialogSelect
              label="Policy reason"
              name="category"
              options={suppressCategories.map((c) => ({ value: c, label: c }))}
              defaultValue={suppressCategories[0]}
            />
          )}
          {(pending.kind === "pin" || pending.kind === "suppress") && (
            <DialogSelect
              label={pending.kind === "pin" ? "Pin for" : "Suppress for"}
              name="duration"
              options={controlDurations}
              defaultValue="7"
            />
          )}
        </ReasonDialog>
      )}
    </div>
  );
}

function ControlList({
  title,
  empty,
  tone,
  items,
}: {
  title: string;
  empty: string;
  tone: string;
  items: { key: string; tag: string; detail: string; meta: string }[];
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
      <h2 className="text-h3 text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className={cn("flex flex-col gap-1.5 rounded-[10px] p-3.5", tone)}>
              <p className="text-sm font-medium text-ink">{item.tag}</p>
              <p className="text-xs text-body">{item.detail}</p>
              <p className="text-xs text-secondary">{item.meta}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
