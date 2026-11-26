"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AdminGroupRow, AdminGroupsBulkInput, AdminGroupsPage, AdminGroupsQuery, ChapterRef } from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn } from "@chartermission/ui";
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
import { csvExport, datedFileName, downloadText } from "@/lib/csv";
import { formatCount } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";
import { GROUP_ACTION_LABEL, GROUP_STATUS, groupActions, useGroupActions } from "./group-actions";
import { ChapterFilter } from "@/components/chapter-picker";

type Tab = AdminGroupsQuery["status"];
type Sort = AdminGroupsQuery["sort"];
type BulkAction = AdminGroupsBulkInput["action"];

const TABS: { value: Tab; label: string; count: keyof AdminGroupsPage["counts"] }[] = [
  { value: "all", label: "All", count: "all" },
  { value: "active", label: "Active", count: "active" },
  { value: "suspended", label: "Suspended", count: "suspended" },
  { value: "archived", label: "Archived", count: "archived" },
  { value: "deleted", label: "Deleted", count: "deleted" },
];

const VISIBILITY_OPTIONS = [
  { value: "", label: "Public and private" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];
const OWNER_OPTIONS = [
  { value: "", label: "Run by anyone" },
  { value: "member", label: "Run by a member" },
  { value: "page", label: "Run by a page" },
  { value: "chapter", label: "Run by a chapter" },
];
const FEATURED_OPTIONS = [
  { value: "", label: "Featured or not" },
  { value: "yes", label: "Featured" },
  { value: "no", label: "Not featured" },
];
const REPORTED_OPTIONS = [
  { value: "", label: "Reported or not" },
  { value: "yes", label: "With open reports" },
];
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "members", label: "Most members first" },
  { value: "activity", label: "Latest post first" },
  { value: "reports", label: "Most reports first" },
  { value: "name", label: "Name A–Z" },
];

const BULK_DONE: Record<BulkAction, string> = {
  feature: "{count} groups featured.",
  unfeature: "{count} groups no longer featured.",
  suspend: "{count} groups suspended. Their admins have been told.",
  restore: "{count} groups restored.",
  delete: "{count} groups deleted. Their admins have been told.",
};

type Filters = {
  status: Tab;
  q: string;
  visibility: "" | "public" | "private";
  ownerType: "" | "member" | "page" | "chapter";
  chapter: string;
  featured: "" | "yes" | "no";
  reported: "" | "yes";
  sort: Sort;
};

const START: Filters = { status: "all", q: "", visibility: "", ownerType: "", chapter: "", featured: "", reported: "", sort: "newest" };

function apiQuery(f: Filters) {
  return {
    status: f.status,
    q: f.q.trim() || undefined,
    visibility: f.visibility || undefined,
    ownerType: f.ownerType || undefined,
    chapter: f.chapter || undefined,
    featured: f.featured || undefined,
    reported: f.reported || undefined,
    sort: f.sort,
  };
}

export function GroupLogo({ group, size = 40 }: { group: Pick<AdminGroupRow, "name" | "logoUrl">; size?: number }) {
  if (group.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
    return <img src={group.logoUrl} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-[10px] border border-line object-cover" />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-[10px] bg-primary text-md font-semibold text-inverse">
      {group.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function VisibilityChip({ visibility }: { visibility: "public" | "private" }) {
  return visibility === "private" ? (
    <Chip tone="info" className="gap-1 px-2! py-0.5! text-xs!">
      <Icon name="eye-off" size={12} />
      Private
    </Chip>
  ) : (
    <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
      Public
    </Chip>
  );
}

/** Who runs a group: its owner, page or chapter, linked to the member site. */
export function RunBy({ group }: { group: Pick<AdminGroupRow, "ownerType" | "owner" | "ownerEmail" | "page" | "chapter"> }) {
  const link = (href: string, text: string) => (
    <a href={webHref(href)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline" dir="auto">
      {text}
    </a>
  );
  if (group.ownerType === "page") return group.page ? <span className="flex flex-col"><span className="text-xs text-secondary">Page</span>{link(`/pages/${group.page.slug}`, group.page.name)}</span> : <span className="text-secondary">Page</span>;
  if (group.ownerType === "chapter")
    return group.chapter ? <span className="flex flex-col"><span className="text-xs text-secondary">Chapter</span>{link(`/chapters/${group.chapter.slug}`, group.chapter.name)}</span> : <span className="text-secondary">Chapter</span>;
  return group.owner ? (
    <span className="flex flex-col">
      <span className="text-xs text-secondary">Member</span>
      {link(`/${group.owner.handle}`, group.owner.name)}
      {group.ownerEmail && (
        <span className="text-xs text-secondary" dir="ltr">
          {group.ownerEmail}
        </span>
      )}
    </span>
  ) : (
    <span className="text-secondary">No owner</span>
  );
}

/** Groups (GET /admin/groups): every group with tabs, filters, batch actions and a CSV export. */
export function GroupsConsole({ initial, chapters, canManage }: { initial: AdminGroupsPage; chapters: ChapterRef[]; canManage: boolean }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<Filters>(START);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [bulkConfirm, setBulkConfirm] = useState<"suspend" | "delete" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const selection = useSelection();
  const first = useRef(true);
  const actions = useGroupActions((row) =>
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === row.id ? row : x)) })),
  );

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const visibleIds = data.items.map((g) => g.id);
  const narrowed = !!(filters.q.trim() || filters.visibility || filters.ownerType || filters.chapter || filters.featured || filters.reported);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<AdminGroupsPage>("/admin/groups", { query: { ...apiQuery(filters), limit: 50 }, signal: controller.signal })
        .then((page) => {
          setData(page);
          selection.retain(page.items.map((g) => g.id));
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
      const page = await api<AdminGroupsPage>("/admin/groups", { query: { ...apiQuery(filters), limit: 50, cursor: data.nextCursor } });
      setData((d) => ({ ...page, items: [...d.items, ...page.items.filter((g) => !d.items.some((x) => x.id === g.id))] }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function bulk(action: BulkAction, note?: string) {
    setBulkBusy(true);
    try {
      const result = await runBulk("/admin/groups/bulk", { ids: selection.list, action, note: note || undefined }, t, BULK_DONE[action]);
      if (result) {
        selection.remove(result.done);
        setReload((n) => n + 1);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  /** Every group matching the filters (all pages), as a spreadsheet. */
  async function exportCsv() {
    setExporting(true);
    try {
      const all: AdminGroupRow[] = [];
      let next: string | null = null;
      do {
        const page: AdminGroupsPage = await api<AdminGroupsPage>("/admin/groups", { query: { ...apiQuery(filters), limit: 100, cursor: next ?? undefined } });
        all.push(...page.items);
        next = page.nextCursor;
      } while (next);
      const header = ["Name", "Slug", "Visibility", "Run by", "Owner, page or chapter", "Status", "Featured", "Members", "Requests", "Posts", "Posts (30 days)", "Open reports", "Last post", "Created"];
      const rows = all.map((g) => [
        g.name,
        g.slug,
        g.visibility === "private" ? "Private" : "Public",
        g.ownerType === "page" ? "Page" : g.ownerType === "chapter" ? "Chapter" : "Member",
        g.ownerType === "page" ? (g.page?.name ?? "") : g.ownerType === "chapter" ? (g.chapter?.name ?? "") : (g.owner?.name ?? ""),
        GROUP_STATUS[g.status].label,
        g.featured ? "Yes" : "No",
        g.memberCount,
        g.pendingRequests,
        g.postCount,
        g.postsLast30Days,
        g.openReports,
        g.lastPostAt?.slice(0, 10) ?? "",
        g.createdAt.slice(0, 10),
      ]);
      downloadText(datedFileName("groups"), csvExport([header, ...rows]));
      toast(t("{count} groups exported.", { count: all.length }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t("Groups by status")} className="flex flex-wrap gap-1.5">
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
              <span className={cn("tabular-nums", filters.status === tab.value ? "text-inverse/80" : "text-secondary")}>{formatCount(data.counts[tab.count])}</span>
            </button>
          ))}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="small" disabled={exporting} onClick={() => void exportCsv()}>
            <Icon name="download" size={16} />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <div role="group" aria-label={t("Filter and sort groups")} className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <span className="sr-only">Search groups</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder={t("Name, address or owner’s name or email")} className={inputClasses(false, "ps-9")} />
        </label>
        <FilterSelect label={t("Visibility")} options={VISIBILITY_OPTIONS} value={filters.visibility} onChange={(e) => set("visibility", e.target.value as Filters["visibility"])} />
        <FilterSelect
          label={t("Run by")}
          options={OWNER_OPTIONS}
          value={filters.ownerType}
          onChange={(e) => setFilters((f) => ({ ...f, ownerType: e.target.value as Filters["ownerType"], chapter: e.target.value === "chapter" ? f.chapter : "" }))}
        />
        {filters.ownerType === "chapter" && (
          <ChapterFilter value={filters.chapter || null} onChange={(chapter) => set("chapter", chapter ?? "")} options={chapters.length ? chapters : undefined} className="max-w-56" />
        )}
        <FilterSelect label={t("Featured")} options={FEATURED_OPTIONS} value={filters.featured} onChange={(e) => set("featured", e.target.value as Filters["featured"])} />
        <FilterSelect label={t("Reports")} options={REPORTED_OPTIONS} value={filters.reported} onChange={(e) => set("reported", e.target.value as Filters["reported"])} />
        <FilterSelect label={t("Sort groups")} options={SORT_OPTIONS} value={filters.sort} onChange={(e) => set("sort", e.target.value as Sort)} />
        {(narrowed || filters.sort !== "newest") && (
          <button type="button" onClick={() => setFilters((f) => ({ ...START, status: f.status }))} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Clear filters
          </button>
        )}
      </div>

      <div className={cn("overflow-x-auto rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {data.items.length === 0 ? (
          <EmptyState icon="users" title={narrowed || filters.status !== "all" ? "No groups match these filters" : "No groups yet"}>
            {narrowed || filters.status !== "all" ? "Try another tab, or clear the search and filters." : "Groups members, pages and chapters create appear here."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-start text-sm">
            <caption className="sr-only">Groups</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                {canManage && (
                  <th scope="col" className="w-10 py-2.5 ps-4 pe-2 text-start">
                    <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} disabled={bulkBusy} />
                  </th>
                )}
                <th scope="col" className={cn("py-2.5 pe-3 text-start font-semibold", !canManage && "ps-4")}>
                  Group
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Run by
                </th>
                <th scope="col" className="py-2.5 pe-3 text-end font-semibold">
                  Members
                </th>
                <th scope="col" className="py-2.5 pe-3 text-end font-semibold">
                  Requests
                </th>
                <th scope="col" className="py-2.5 pe-3 text-end font-semibold">
                  Posts (30 days)
                </th>
                <th scope="col" className="py-2.5 pe-3 text-end font-semibold">
                  Reports
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Created
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2.5 pe-4 text-end font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((group) => {
                const kinds = canManage ? groupActions(group) : [];
                const primary = kinds.includes("restore") ? "restore" : null;
                const busy = actions.busyId === group.id;
                const status = GROUP_STATUS[group.status];
                return (
                  <tr key={group.id} className={cn("border-t border-line align-top first:border-t-0", selection.has(group.id) && "bg-primary-tint-2/40")}>
                    {canManage && (
                      <td className="py-3 ps-4 pe-2">
                        <SelectBox checked={selection.has(group.id)} label={t("Select group {name}", { name: group.name })} onChange={(on) => selection.toggle(group.id, on)} disabled={bulkBusy} />
                      </td>
                    )}
                    <td className={cn("max-w-[360px] py-3 pe-3", !canManage && "ps-4")}>
                      <div className="flex items-start gap-3">
                        <GroupLogo group={group} />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Link href={`/groups/${group.id}`} className="truncate font-semibold text-ink hover:underline" dir="auto">
                              {group.name}
                            </Link>
                            <VisibilityChip visibility={group.visibility} />
                            {group.featured && (
                              <Chip tone="warning" className="px-2! py-0.5! text-xs!">
                                Featured
                              </Chip>
                            )}
                          </span>
                          <span className="truncate text-xs text-secondary" dir="ltr">
                            /groups/{group.slug}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pe-3">
                      <RunBy group={group} />
                    </td>
                    <td className="py-3 pe-3 text-end tabular-nums">{formatCount(group.memberCount)}</td>
                    <td className="py-3 pe-3 text-end tabular-nums">{group.pendingRequests ? formatCount(group.pendingRequests) : <span className="text-disabled">0</span>}</td>
                    <td className="py-3 pe-3 text-end tabular-nums">{formatCount(group.postsLast30Days)}</td>
                    <td className={cn("py-3 pe-3 text-end tabular-nums", group.openReports > 0 ? "font-semibold text-error" : "text-disabled")}>{group.openReports}</td>
                    <td className="py-3 pe-3 text-secondary">
                      <DateTime iso={group.createdAt} dateOnly />
                    </td>
                    <td className="py-3 pe-3">
                      <Chip tone={status.tone} className="px-2! py-0.5! text-xs!">
                        {status.label}
                      </Chip>
                    </td>
                    <td className="py-3 pe-4">
                      <div className="flex items-center justify-end gap-1">
                        {primary ? (
                          <Button variant="secondary" size="small" disabled={busy} onClick={() => void actions.start(group, primary)}>
                            Restore
                          </Button>
                        ) : (
                          <Link href={`/groups/${group.id}`} className="rounded-md px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint-2">
                            Open
                          </Link>
                        )}
                        <RowMenu
                          label={t("More actions for group {name}", { name: group.name })}
                          items={[
                            { label: t("View on site ↗"), hidden: group.status === "deleted", onSelect: () => window.open(webHref(`/groups/${group.slug}`), "_blank", "noopener") },
                            ...kinds
                              .filter((k) => k !== primary)
                              .map((k) => ({ label: t(GROUP_ACTION_LABEL[k]), danger: k === "suspend" || k === "delete", disabled: busy, onSelect: () => void actions.start(group, k) })),
                          ]}
                        />
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

      {canManage && (
        <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
          <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("feature")}>
            Feature
          </Button>
          <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("unfeature")}>
            Stop featuring
          </Button>
          <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => setBulkConfirm("suspend")}>
            Suspend
          </Button>
          <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("restore")}>
            Restore
          </Button>
          <Button variant="ghost" size="small" className="text-error!" disabled={bulkBusy} onClick={() => setBulkConfirm("delete")}>
            Delete
          </Button>
        </BulkBar>
      )}

      {bulkConfirm && (
        <ReasonDialog
          title={t(bulkConfirm === "suspend" ? "Suspend {count} groups?" : "Delete {count} groups?", { count: selection.count })}
          description={
            bulkConfirm === "suspend"
              ? "Members can’t open these groups or see their posts. Each group’s admins see your note. Only groups that aren’t suspended yet are changed."
              : "The groups and their posts disappear for everyone, and each group’s admins are told. Staff can still restore them from the Deleted tab."
          }
          confirmLabel={bulkConfirm === "suspend" ? "Suspend groups" : "Delete groups"}
          tone="danger"
          reasonField={bulkConfirm === "suspend" ? "required" : "optional"}
          reasonLabel="Note to the groups’ admins"
          reasonPlaceholder={bulkConfirm === "suspend" ? "Why the groups were suspended" : "Why the groups were deleted"}
          reasonHint="Shown to each group’s admins and recorded in the audit log."
          requiredMessage="Add a note so each group’s admins know why."
          minReasonLength={3}
          onClose={() => setBulkConfirm(null)}
          onConfirm={async (note) => {
            const action = bulkConfirm;
            setBulkConfirm(null);
            await bulk(action, note);
          }}
        />
      )}
      {actions.dialogs}
    </section>
  );
}
