"use client";

import { useEffect, useRef, useState } from "react";
import {
  OPPORTUNITY_TYPE_LABELS,
  type AdminOpportunitiesPage,
  type AdminOpportunitiesQuery,
  type AdminOpportunityActionKind,
  type AdminOpportunityRow,
  type AdminOpportunityState,
  type OpportunityType,
} from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn, type ChipTone } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { RowMenu } from "@/components/row-menu";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatCount, formatDate } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { applyHost } from "@/lib/opportunity-import";
import { useIntlTag, useT } from "@/i18n/client";

type Tab = AdminOpportunitiesQuery["status"];

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "removed", label: "Removed" },
];

const TYPE_OPTIONS = [{ value: "", label: "All types" }, ...Object.entries(OPPORTUNITY_TYPE_LABELS).map(([value, label]) => ({ value, label }))];
const SOURCE_OPTIONS = [
  { value: "", label: "Any source" },
  { value: "member", label: "Posted by members" },
  { value: "import", label: "Imported" },
];
const POSTED_AS_OPTIONS = [
  { value: "", label: "Pages and members" },
  { value: "page", label: "Posted as a page" },
  { value: "member", label: "Posted as a member" },
];

export const OPPORTUNITY_STATE: Record<AdminOpportunityState, { label: string; tone: ChipTone }> = {
  open: { label: "Open", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
  expired: { label: "Deadline passed", tone: "warning" },
  hidden: { label: "Hidden", tone: "warning" },
  removed: { label: "Removed", tone: "error" },
};

const ACTION_LABEL: Record<AdminOpportunityActionKind, string> = { close: "Close", reopen: "Reopen", remove: "Remove", restore: "Restore" };

const ACTION_DONE: Record<AdminOpportunityActionKind, string> = {
  close: "“{title}” is closed.",
  reopen: "“{title}” is open again.",
  remove: "“{title}” is removed. Members no longer see it.",
  restore: "“{title}” is restored.",
};

const BULK_DONE: Record<AdminOpportunityActionKind, string> = {
  close: "{count} opportunities closed.",
  reopen: "{count} opportunities reopened.",
  remove: "{count} opportunities removed.",
  restore: "{count} opportunities restored.",
};

/** What staff can do with a listing in its current state. */
function actionsFor(row: AdminOpportunityRow): AdminOpportunityActionKind[] {
  switch (row.state) {
    case "open":
    case "expired":
      return ["close", "remove"];
    case "closed":
      return ["reopen", "remove"];
    default:
      return ["restore"];
  }
}

type Filters = { status: Tab; q: string; type: "" | OpportunityType; source: "" | "member" | "import"; postedAs: "" | "page" | "member" };
const START: Filters = { status: "all", q: "", type: "", source: "", postedAs: "" };

const apiQuery = (f: Filters) => ({
  status: f.status,
  q: f.q.trim() || undefined,
  type: f.type || undefined,
  source: f.source || undefined,
  postedAs: f.postedAs || undefined,
});

/** A whole-day date ("2026-12-31") shown in the console's language, never shifted by time zones. */
export function DayDate({ date }: { date: string }) {
  const tag = useIntlTag();
  return <time dateTime={date}>{formatDate(`${date}T12:00:00Z`, "UTC", tag)}</time>;
}

/** Who posted it: the page (for page listings) or the member, linked to the member site. */
function PostedBy({ row }: { row: AdminOpportunityRow }) {
  const link = (href: string, text: string) => (
    <a href={webHref(href)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline" dir="auto">
      {text}
    </a>
  );
  if (row.page) {
    return (
      <span className="flex flex-col">
        <span className="text-xs text-secondary">Page</span>
        {link(`/pages/${row.page.slug}`, row.page.name)}
        {row.poster && <span className="text-xs text-secondary" dir="auto">{row.poster.name}</span>}
      </span>
    );
  }
  return row.poster ? (
    <span className="flex flex-col">
      <span className="text-xs text-secondary">Member</span>
      {link(`/${row.poster.handle}`, row.poster.name)}
    </span>
  ) : (
    <span className="text-secondary">Deleted account</span>
  );
}

/** Opportunities (GET /admin/opportunities): every listing, with tabs, filters, row and batch actions. */
export function OpportunitiesConsole({ initial }: { initial: AdminOpportunitiesPage }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<Filters>(START);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "row"; row: AdminOpportunityRow } | { kind: "bulk" } | null>(null);
  const selection = useSelection();
  const first = useRef(true);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const visibleIds = data.items.map((o) => o.id);
  const narrowed = !!(filters.q.trim() || filters.type || filters.source || filters.postedAs);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<AdminOpportunitiesPage>("/admin/opportunities", { query: { ...apiQuery(filters), limit: 50 }, signal: controller.signal })
        .then((page) => {
          setData(page);
          selection.retain(page.items.map((o) => o.id));
        })
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) toast(errorMessage(e), "error");
        })
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection.retain is stable; reload re-runs the same query
  }, [filters, reload]);

  async function more() {
    if (!data.nextCursor) return;
    setLoading(true);
    try {
      const page = await api<AdminOpportunitiesPage>("/admin/opportunities", { query: { ...apiQuery(filters), limit: 50, cursor: data.nextCursor } });
      setData((d) => ({ ...page, items: [...d.items, ...page.items.filter((o) => !d.items.some((x) => x.id === o.id))] }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function act(row: AdminOpportunityRow, action: AdminOpportunityActionKind) {
    setBusyId(row.id);
    try {
      const next = await api<AdminOpportunityRow>(`/admin/opportunities/${row.id}`, { method: "POST", body: { action } });
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === next.id ? next : x)) }));
      toast(t(ACTION_DONE[action], { title: row.title }));
      setReload((n) => n + 1);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function bulk(action: AdminOpportunityActionKind) {
    setBulkBusy(true);
    try {
      const result = await runBulk("/admin/opportunities/bulk", { ids: selection.list, action }, t, BULK_DONE[action]);
      if (result) {
        selection.remove(result.done);
        setReload((n) => n + 1);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("Opportunities by status")} className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={filters.status === tab.value}
            onClick={() => set("status", tab.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
              filters.status === tab.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted",
            )}
          >
            {tab.label}
            <span className={cn("tabular-nums", filters.status === tab.value ? "text-inverse/80" : "text-secondary")}>{formatCount(data.counts[tab.value])}</span>
          </button>
        ))}
      </div>

      <div role="group" aria-label={t("Filter opportunities")} className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <span className="sr-only">Search opportunities</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder={t("Title or organisation")} className={inputClasses(false, "ps-9")} />
        </label>
        <FilterSelect label={t("Type")} options={TYPE_OPTIONS} value={filters.type} onChange={(e) => set("type", e.target.value as Filters["type"])} />
        <FilterSelect label={t("Source")} options={SOURCE_OPTIONS} value={filters.source} onChange={(e) => set("source", e.target.value as Filters["source"])} />
        <FilterSelect label={t("Posted as")} options={POSTED_AS_OPTIONS} value={filters.postedAs} onChange={(e) => set("postedAs", e.target.value as Filters["postedAs"])} />
        {narrowed && (
          <button type="button" onClick={() => setFilters((f) => ({ ...START, status: f.status }))} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Clear filters
          </button>
        )}
      </div>

      <div className={cn("overflow-x-auto rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {data.items.length === 0 ? (
          <EmptyState icon="briefcase" title={narrowed || filters.status !== "all" ? "No opportunities match these filters" : "No opportunities yet"}>
            {narrowed || filters.status !== "all"
              ? "Try another tab, or clear the search and filters."
              : "Opportunities members post, and the ones you import from WhatsApp groups and forums, appear here."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[1120px] border-collapse text-start text-sm">
            <caption className="sr-only">Opportunities</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="w-10 py-2.5 ps-4 pe-2 text-start">
                  <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} disabled={bulkBusy} />
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Opportunity
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Type
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Posted by
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Source
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Deadline
                </th>
                <th scope="col" className="py-2.5 pe-3 text-end font-semibold">
                  Applications
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Created
                </th>
                <th scope="col" className="py-2.5 pe-4 text-end font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const kinds = actionsFor(row);
                const busy = busyId === row.id;
                const state = OPPORTUNITY_STATE[row.state];
                const live = row.state !== "removed" && row.state !== "hidden";
                return (
                  <tr key={row.id} className={cn("border-t border-line align-top first:border-t-0", selection.has(row.id) && "bg-primary-tint-2/40")}>
                    <td className="py-3 ps-4 pe-2">
                      <SelectBox checked={selection.has(row.id)} label={t("Select {title}", { title: row.title })} onChange={(on) => selection.toggle(row.id, on)} disabled={bulkBusy} />
                    </td>
                    <td className="max-w-[340px] py-3 pe-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <a href={webHref(`/opportunities/${row.slug}`)} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline" dir="auto">
                          {row.title}
                        </a>
                        <span className="truncate text-xs text-secondary" dir="auto">
                          {row.organisation}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pe-3 whitespace-nowrap">{OPPORTUNITY_TYPE_LABELS[row.type]}</td>
                    <td className="max-w-[200px] min-w-[150px] py-3 pe-3">
                      <PostedBy row={row} />
                    </td>
                    <td className="py-3 pe-3">
                      {row.source === "import" ? (
                        <Chip tone="info" className="px-2! py-0.5! text-xs!">
                          Imported
                        </Chip>
                      ) : (
                        <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
                          Member
                        </Chip>
                      )}
                    </td>
                    <td className={cn("py-3 pe-3 whitespace-nowrap", row.state === "expired" ? "text-warning" : "text-secondary")}>
                      {row.deadline ? <DayDate date={row.deadline} /> : <span className="text-disabled">None</span>}
                    </td>
                    <td className="py-3 pe-3 text-end tabular-nums">
                      {row.applyUrl ? (
                        <span className="flex flex-col items-end">
                          <span className="text-secondary">External</span>
                          <span className="max-w-[120px] truncate text-xs text-secondary" dir="ltr" title={row.applyUrl}>
                            {applyHost(row.applyUrl)}
                          </span>
                        </span>
                      ) : (
                        formatCount(row.applicationCount)
                      )}
                    </td>
                    <td className="py-3 pe-3">
                      <Chip tone={state.tone} className="px-2! py-0.5! text-xs! whitespace-nowrap">
                        {state.label}
                      </Chip>
                    </td>
                    <td className="py-3 pe-3 whitespace-nowrap text-secondary">
                      <DateTime iso={row.createdAt} dateOnly />
                    </td>
                    <td className="py-3 pe-4">
                      <div className="flex items-center justify-end gap-1">
                        {live ? (
                          <a
                            href={webHref(`/opportunities/${row.slug}`)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-primary hover:bg-primary-tint-2"
                          >
                            View
                            <Icon name="external" size={14} />
                          </a>
                        ) : (
                          <Button variant="secondary" size="small" disabled={busy} onClick={() => void act(row, "restore")}>
                            Restore
                          </Button>
                        )}
                        {live && (
                          <RowMenu
                            label={t("More actions for {title}", { title: row.title })}
                            items={kinds.map((k) => ({
                              label: t(ACTION_LABEL[k]),
                              danger: k === "remove",
                              disabled: busy,
                              onSelect: () => (k === "remove" ? setConfirm({ kind: "row", row }) : void act(row, k)),
                            }))}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data.nextCursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void more()}>
          Load more
        </Button>
      )}

      <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
        <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("close")}>
          Close
        </Button>
        <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("reopen")}>
          Reopen
        </Button>
        <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("restore")}>
          Restore
        </Button>
        <Button variant="ghost" size="small" className="text-error!" disabled={bulkBusy} onClick={() => setConfirm({ kind: "bulk" })}>
          Remove
        </Button>
      </BulkBar>

      {confirm && (
        <ReasonDialog
          title={confirm.kind === "row" ? t("Remove “{title}”?", { title: confirm.row.title }) : t("Remove {count} opportunities?", { count: selection.count })}
          description="Members no longer see removed opportunities, in the list or in the feed. You can restore them from the Removed tab."
          confirmLabel={confirm.kind === "row" ? "Remove opportunity" : "Remove opportunities"}
          tone="danger"
          reasonField="none"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const target = confirm;
            setConfirm(null);
            if (target.kind === "row") await act(target.row, "remove");
            else await bulk("remove");
          }}
        />
      )}
    </section>
  );
}
