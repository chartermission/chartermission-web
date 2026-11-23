"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PROFILE_OPTION_KINDS,
  type ProfileOptionKind,
  type ProfileOptionRow,
  type ProfileOptionsList,
  type ProfileOptionsSummary,
} from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, SegmentedControl, cn } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { CsvImportDialog } from "@/components/csv/csv-import-dialog";
import { inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { RowMenu } from "@/components/row-menu";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { csvRows, datedFileName, downloadText } from "@/lib/csv";
import { useT } from "@/i18n/client";
import { AddOptionsDialog, ImportModeDialog, MergeDialog, RenameDialog } from "./dialogs";
import { KIND_LABELS, optionsPath } from "./kinds";

type StatusFilter = "all" | "active" | "hidden";
type Sort = "position" | "name" | "usage";
type Lists = Partial<Record<ProfileOptionKind, ProfileOptionsList>>;

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Profile options (GET /admin/profile-options/{kind}): one tab per list. Each list is small, so it is
 * loaded whole and searched, filtered and sorted here; every change reloads it from the API.
 */
export function ProfileOptionsConsole({ summary: initialSummary, initial }: { summary: ProfileOptionsSummary; initial: ProfileOptionsList }) {
  const t = useT();
  const [kind, setKind] = useState<ProfileOptionKind>(initial.kind);
  const [summary, setSummary] = useState(initialSummary);
  const [lists, setLists] = useState<Lists>({ [initial.kind]: initial });
  const [loadErrors, setLoadErrors] = useState<Partial<Record<ProfileOptionKind, string>>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("position");
  const [busy, setBusy] = useState(false);
  const selection = useSelection();

  const [adding, setAdding] = useState(false);
  const [importMode, setImportMode] = useState<"choose" | "add" | "upsert" | null>(null);
  const [renaming, setRenaming] = useState<ProfileOptionRow | null>(null);
  const [merging, setMerging] = useState<ProfileOptionRow[] | null>(null);
  const [deleting, setDeleting] = useState<ProfileOptionRow[] | null>(null);
  const [sortingAll, setSortingAll] = useState(false);

  const labels = KIND_LABELS[kind];
  const list = lists[kind];
  const loadError = loadErrors[kind] ?? null;

  const load = useCallback(async (which: ProfileOptionKind) => {
    try {
      const [next, counts] = await Promise.all([
        api<ProfileOptionsList>(optionsPath(which)),
        api<ProfileOptionsSummary>("/admin/profile-options"),
      ]);
      setLists((prev) => ({ ...prev, [which]: next }));
      setSummary(counts);
      setLoadErrors((prev) => ({ ...prev, [which]: undefined }));
    } catch (e) {
      setLoadErrors((prev) => ({ ...prev, [which]: errorMessage(e) }));
    }
  }, []);
  const reload = useCallback(() => load(kind), [load, kind]);

  // A tab's list is loaded the first time it is opened.
  useEffect(() => {
    if (!lists[kind] && !loadErrors[kind]) void load(kind);
  }, [kind, lists, loadErrors, load]);

  const ordered = useMemo(() => [...(list?.items ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)), [list]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = ordered.filter((r) => (status === "all" || r.status === status) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    if (sort === "usage") rows.sort((a, b) => b.usage - a.usage || a.position - b.position);
    return rows;
  }, [ordered, query, status, sort]);
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible]);
  const picked = useMemo(() => ordered.filter((r) => selection.has(r.id)), [ordered, selection]);

  function switchKind(next: ProfileOptionKind) {
    setKind(next);
    setQuery("");
    setLoadErrors((prev) => ({ ...prev, [next]: undefined }));
    selection.clear();
  }

  async function patch(row: ProfileOptionRow, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await api(`${optionsPath(kind)}/${row.id}`, { method: "PATCH", body });
      toast(done);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  /** Moves a row next to its neighbour in the rows shown (the saved order is the whole list). */
  async function move(row: ProfileOptionRow, delta: -1 | 1) {
    const at = visible.findIndex((r) => r.id === row.id);
    const neighbour = visible[at + delta];
    if (!neighbour) return;
    const ids = ordered.map((r) => r.id).filter((id) => id !== row.id);
    const index = ids.indexOf(neighbour.id);
    ids.splice(delta < 0 ? index : index + 1, 0, row.id);
    // Show the new order at once; the reload confirms it.
    setLists((prev) => {
      const current = prev[kind];
      if (!current) return prev;
      const position = new Map(ids.map((id, i) => [id, i]));
      return { ...prev, [kind]: { ...current, items: current.items.map((r) => ({ ...r, position: position.get(r.id) ?? r.position })) } };
    });
    setBusy(true);
    try {
      await api(`${optionsPath(kind)}/reorder`, { method: "POST", body: { ids } });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function bulk(action: "hide" | "show", done: string) {
    setBusy(true);
    const result = await runBulk(`${optionsPath(kind)}/bulk`, { ids: selection.list, action }, t, done);
    if (result) selection.remove(result.done);
    await reload();
    setBusy(false);
  }

  function exportCsv() {
    const rows = ordered.map((r) => [r.name, r.slug, r.position, r.status, r.usage]);
    downloadText(datedFileName(`profile-options-${kind}`), csvRows([["name", "slug", "position", "status", "usage"], ...rows]));
  }

  const canMove = sort === "position";
  const counts = list?.counts ?? summary[kind];

  return (
    <section className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <SegmentedControl
          label="Lists"
          value={kind}
          onChange={switchKind}
          items={PROFILE_OPTION_KINDS.map((k) => ({ value: k, label: t("{label} ({count})", { label: t(KIND_LABELS[k].label), count: summary[k].all }) }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search options</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search options" className={inputClasses(false, "ps-9")} />
        </label>
        <SegmentedControl
          label="Show"
          size="small"
          value={status}
          onChange={setStatus}
          items={[
            { value: "all", label: t("All ({count})", { count: counts.all }) },
            { value: "active", label: t("Shown ({count})", { count: counts.active }) },
            { value: "hidden", label: t("Hidden ({count})", { count: counts.hidden }) },
          ]}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          options={[
            { value: "position", label: t("Order") },
            { value: "name", label: t("A–Z") },
            { value: "usage", label: t("Most used") },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Add options
        </Button>
        <Button variant="secondary" size="small" onClick={() => setImportMode("choose")}>
          Import CSV
        </Button>
        <Button variant="secondary" size="small" disabled={!list} onClick={exportCsv}>
          <Icon name="download" size={16} />
          Export CSV
        </Button>
        <Button variant="ghost" size="small" disabled={!list || busy || ordered.length < 2} onClick={() => setSortingAll(true)}>
          Sort A–Z
        </Button>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        {!list && loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="max-w-md text-sm text-body">{loadError}</p>
            <Button variant="secondary" size="small" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        ) : !list ? (
          <SkeletonTable label="Loading profile options" rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState icon="filter" title={ordered.length === 0 ? "This list is empty" : "No options match"}>
            {ordered.length === 0 ? "Add options one by one or import a CSV file." : "Try another search or show all options."}
          </EmptyState>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-start text-sm">
            <caption className="sr-only">{t(labels.label)}</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="w-10 py-2.5 ps-4 pe-1 text-start">
                  <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} />
                </th>
                <th scope="col" className="w-20 py-2.5 pe-2.5 text-start font-semibold">
                  Order
                </th>
                <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">
                  Name
                </th>
                <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">
                  Slug
                </th>
                <th scope="col" className="py-2.5 pe-2.5 text-end font-semibold">
                  {t(labels.usage)}
                </th>
                <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2.5 pe-4 text-end font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => {
                const shown = row.status === "active";
                return (
                  <tr key={row.id} className={cn("border-t border-line first:border-t-0", !shown && "bg-surface", selection.has(row.id) && "bg-primary-tint-2")}>
                    <td className="py-2.5 ps-4 pe-1">
                      <SelectBox checked={selection.has(row.id)} label={t("Select {name}", { name: row.name })} onChange={(on) => selection.toggle(row.id, on)} />
                    </td>
                    <td className="py-2.5 pe-2.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={!canMove || busy || i === 0}
                          onClick={() => void move(row, -1)}
                          title={canMove ? undefined : t("Sort by Order to move options.")}
                          className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
                        >
                          <Icon name="chevron-down" size={16} className="rotate-180" label={t("Move {name} up", { name: row.name })} />
                        </button>
                        <button
                          type="button"
                          disabled={!canMove || busy || i === visible.length - 1}
                          onClick={() => void move(row, 1)}
                          title={canMove ? undefined : t("Sort by Order to move options.")}
                          className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink disabled:opacity-30"
                        >
                          <Icon name="chevron-down" size={16} label={t("Move {name} down", { name: row.name })} />
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 pe-2.5">
                      <button type="button" onClick={() => setRenaming(row)} className="text-start font-medium text-ink hover:underline">
                        {row.name}
                      </button>
                    </td>
                    <td className="py-2.5 pe-2.5 font-mono text-xs text-secondary">{row.slug}</td>
                    <td className="py-2.5 pe-2.5 text-end text-body tabular-nums">{numberFormat.format(row.usage)}</td>
                    <td className="py-2.5 pe-2.5 whitespace-nowrap">
                      <Chip tone={shown ? "success" : "neutral"}>{shown ? "Shown" : "Hidden"}</Chip>
                    </td>
                    <td className="py-2.5 pe-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void patch(
                              row,
                              { status: shown ? "hidden" : "active" },
                              shown ? t("{name} hidden from pickers.", { name: row.name }) : t("{name} shown in pickers.", { name: row.name }),
                            )
                          }
                        >
                          {shown ? "Hide" : "Show"}
                        </Button>
                        <RowMenu
                          label={t("More actions for {name}", { name: row.name })}
                          items={[
                            { label: t("Rename"), onSelect: () => setRenaming(row) },
                            {
                              label: shown ? t("Hide from pickers") : t("Show in pickers"),
                              onSelect: () =>
                                void patch(
                                  row,
                                  { status: shown ? "hidden" : "active" },
                                  shown ? t("{name} hidden from pickers.", { name: row.name }) : t("{name} shown in pickers.", { name: row.name }),
                                ),
                            },
                            { label: t("Merge into…"), onSelect: () => setMerging([row]), disabled: ordered.length < 2 },
                            {
                              label: row.usage > 0 ? t("Delete (in use: hide or merge it instead)") : t("Delete"),
                              danger: true,
                              disabled: row.usage > 0,
                              onSelect: () => setDeleting([row]),
                            },
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
      {list?.truncated && <p className="text-xs text-secondary">Only the first 5,000 options are shown.</p>}

      <BulkBar count={selection.count} busy={busy} onClear={selection.clear}>
        <Button variant="ghost" size="small" disabled={busy} onClick={() => void bulk("hide", "{count} options hidden from pickers.")}>
          Hide
        </Button>
        <Button variant="ghost" size="small" disabled={busy} onClick={() => void bulk("show", "{count} options shown in pickers.")}>
          Show
        </Button>
        <Button variant="ghost" size="small" disabled={busy || picked.length === 0 || picked.length >= ordered.length} onClick={() => setMerging(picked)}>
          Merge into…
        </Button>
        <Button variant="ghost" size="small" disabled={busy || picked.length === 0} onClick={() => setDeleting(picked)}>
          Delete
        </Button>
      </BulkBar>

      {adding && <AddOptionsDialog kind={kind} onAdded={() => void reload()} onClose={() => setAdding(false)} />}
      {importMode === "choose" && <ImportModeDialog onChoose={setImportMode} onClose={() => setImportMode(null)} />}
      {(importMode === "add" || importMode === "upsert") && (
        <CsvImportDialog
          title={importMode === "add" ? t("Import new {label}", { label: t(labels.label).toLowerCase() }) : t("Import and update {label}", { label: t(labels.label).toLowerCase() })}
          description={
            importMode === "add"
              ? t("Rows are matched by slug, then by name. Options already in the list are left as they are.")
              : t("Rows are matched by slug, then by name. Options already in the list get the name, position and status from the file.")
          }
          endpoint={`${optionsPath(kind)}/import`}
          columns={t("Columns: name (required), slug, position, status (active or hidden).")}
          template={[
            ["name", "slug", "position", "status"],
            ["Public speaking", "public-speaking", 0, "active"],
          ]}
          templateName={`profile-options-${kind}-template.csv`}
          toBody={(records, header) => {
            if (!header.includes("name")) return t("The file needs a name column.");
            return {
              mode: importMode,
              rows: records.map((r) => ({
                row: r.row,
                name: r.values.name ?? "",
                ...(r.values.slug ? { slug: r.values.slug } : {}),
                ...(r.values.position ? { position: r.values.position } : {}),
                ...(r.values.status ? { status: r.values.status } : {}),
              })),
            };
          }}
          onImported={(result) => {
            setImportMode(null);
            toast(t("{created} added, {updated} updated.", { created: result.created, updated: result.updated }));
            void reload();
          }}
          onClose={() => setImportMode(null)}
        />
      )}
      {renaming && (
        <RenameDialog
          kind={kind}
          row={renaming}
          onSaved={(row) => {
            setRenaming(null);
            toast(t("{name} saved.", { name: row.name }));
            void reload();
          }}
          onClose={() => setRenaming(null)}
        />
      )}
      {merging && (
        <MergeDialog
          kind={kind}
          sources={merging}
          candidates={ordered}
          onMerged={(result) => {
            setMerging(null);
            if (result) selection.remove(result.done);
            void reload();
          }}
          onClose={() => setMerging(null)}
        />
      )}
      {deleting && (
        <ReasonDialog
          title={deleting.length === 1 ? t("Delete {name}?", { name: deleting[0]!.name }) : t("Delete {count} options?", { count: deleting.length })}
          description="Only options nobody uses can be deleted. To keep an option on the profiles that have it, hide it from pickers instead."
          confirmLabel="Delete"
          tone="danger"
          reasonField="none"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.length === 1) {
              await api(`${optionsPath(kind)}/${deleting[0]!.id}`, { method: "DELETE" });
              toast(t("{name} deleted.", { name: deleting[0]!.name }));
              selection.remove([deleting[0]!.id]);
            } else {
              const result = await runBulk(`${optionsPath(kind)}/bulk`, { ids: deleting.map((r) => r.id), action: "delete" }, t, "{count} options deleted.");
              if (result) selection.remove(result.done);
            }
            setDeleting(null);
            await reload();
          }}
        />
      )}
      {sortingAll && (
        <ReasonDialog
          title={t("Sort {label} A–Z?", { label: t(labels.label).toLowerCase() })}
          description="Pickers will list these options alphabetically. The order you set by hand is replaced."
          confirmLabel="Sort A–Z"
          reasonField="none"
          onClose={() => setSortingAll(false)}
          onConfirm={async () => {
            await api(`${optionsPath(kind)}/sort-alphabetically`, { method: "POST" });
            toast(t("{label} sorted A–Z.", { label: t(labels.label) }));
            setSortingAll(false);
            setSort("position");
            await reload();
          }}
        />
      )}
    </section>
  );
}
