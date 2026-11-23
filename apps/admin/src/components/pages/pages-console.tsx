"use client";

import { useEffect, useRef, useState } from "react";
import {
  PAGE_CATEGORY_LABELS,
  PageCategory,
  type AdminPageRow,
  type AdminPagesBulkInput,
  type AdminPageStatusInput,
  type Page,
  type PagesSettings,
  type PageStatus,
} from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn, type ChipTone } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox as PickBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { RowMenu } from "@/components/row-menu";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { csvRows, datedFileName, downloadText } from "@/lib/csv";
import { formatCount } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { T, useT } from "@/i18n/client";

type Filter = "all" | PageStatus;
type Sort = "newest" | "followers" | "name";
type Verified = "" | "yes" | "no";
type BulkAction = AdminPagesBulkInput["action"];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Waiting for review" },
  { value: "active", label: "Live" },
  { value: "rejected", label: "Not approved" },
  { value: "suspended", label: "Suspended" },
];

const STATUS: Record<PageStatus, { label: string; tone: ChipTone }> = {
  pending: { label: "Waiting for review", tone: "warning" },
  active: { label: "Live", tone: "success" },
  rejected: { label: "Not approved", tone: "error" },
  suspended: { label: "Suspended", tone: "error" },
};

const CATEGORY_OPTIONS = [{ value: "", label: "Any kind of page" }, ...PageCategory.options.map((value) => ({ value, label: PAGE_CATEGORY_LABELS[value] }))];
const VERIFIED_OPTIONS = [
  { value: "", label: "Verified or not" },
  { value: "yes", label: "Verified" },
  { value: "no", label: "Not verified" },
];
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest pages first" },
  { value: "followers", label: "Most followed first" },
  { value: "name", label: "Page name A–Z" },
];

const ACTION_COPY: Record<AdminPageStatusInput["action"], { title: string; description: string; confirm: string; done: string; needsNote: boolean }> = {
  approve: { title: "Approve {name}?", description: "The page goes live, its admins are told, and it can start posting.", confirm: "Approve page", done: "{name} approved and live.", needsNote: false },
  reject: {
    title: "Don’t approve {name}?",
    description: "The page stays hidden. Its admins see your note and can edit the page to send it back for review.",
    confirm: "Don’t approve",
    done: "{name} sent back to its admins.",
    needsNote: true,
  },
  suspend: { title: "Suspend {name}?", description: "The page and its posts are hidden from members straight away. Its admins see your note.", confirm: "Suspend page", done: "{name} suspended.", needsNote: true },
  restore: { title: "Restore {name}?", description: "The page and its posts become visible again.", confirm: "Restore page", done: "{name} restored.", needsNote: false },
};

/** Batch actions that ask first (the others run straight away). */
const BULK_CONFIRM: Partial<Record<BulkAction, { title: string; description: string; confirm: string }>> = {
  suspend: {
    title: "Suspend {count} pages?",
    description: "The pages and their posts are hidden from members straight away. Each page’s admins see your note. Only live pages are suspended.",
    confirm: "Suspend pages",
  },
  delete: {
    title: "Delete {count} pages?",
    description: "This deletes the pages with their posts and followers. It can’t be undone. To hide pages and keep their content, suspend them instead.",
    confirm: "Delete pages",
  },
};

const BULK_DONE: Record<BulkAction, string> = {
  verify: "{count} pages verified.",
  unverify: "Verified tick removed from {count} pages.",
  suspend: "{count} pages suspended.",
  restore: "{count} pages restored.",
  delete: "{count} pages deleted.",
};

function Logo({ page }: { page: AdminPageRow }) {
  if (page.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
    return <img src={page.logoUrl} alt="" className="size-11 shrink-0 rounded-[10px] border border-line object-cover" />;
  }
  return (
    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary text-md font-semibold text-inverse">
      {page.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Pages (GET /admin/pages): the review queue first, then every page, with the creation setting above. */
export function PagesConsole({ initial, settings: initialSettings, canChangeSettings }: { initial: Page<AdminPageRow>; settings: PagesSettings; canChangeSettings: boolean }) {
  const t = useT();
  const [pages, setPages] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<"" | PageCategory>("");
  const [verified, setVerified] = useState<Verified>("");
  const [sort, setSort] = useState<Sort>("newest");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editing, setEditing] = useState<AdminPageRow | "new" | null>(null);
  const [acting, setActing] = useState<{ page: AdminPageRow; action: AdminPageStatusInput["action"] } | null>(null);
  const [removing, setRemoving] = useState<AdminPageRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const selection = useSelection();
  const first = useRef(true);

  const query = { status: filter, q: q.trim(), category: category || undefined, verified: verified || undefined, sort };
  const visibleIds = pages.map((p) => p.id);
  const filtered = filter !== "all" || !!category || !!verified || !!q.trim();

  const upsert = (page: AdminPageRow) => setPages((list) => (list.some((x) => x.id === page.id) ? list.map((x) => (x.id === page.id ? page : x)) : [page, ...list]));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<Page<AdminPageRow>>("/admin/pages", { query: { status: filter, q: q.trim(), category: category || undefined, verified: verified || undefined, sort, limit: 100 }, signal: controller.signal })
        .then((page) => {
          setPages(page.items);
          setCursor(page.nextCursor);
          selection.retain(page.items.map((p) => p.id));
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
  }, [filter, q, category, verified, sort, reload]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api<Page<AdminPageRow>>("/admin/pages", { query: { ...query, limit: 100, cursor } });
      setPages((list) => [...list, ...page.items.filter((p) => !list.some((x) => x.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(next: PagesSettings) {
    const previous = settings;
    setSettings(next);
    setSavingSettings(true);
    try {
      setSettings(await api<PagesSettings>("/admin/settings/pages", { method: "PUT", body: next }));
      toast("Page creation setting saved.");
    } catch (e) {
      setSettings(previous);
      toast(errorMessage(e), "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function setTick(page: AdminPageRow, on: boolean) {
    setBusyId(page.id);
    try {
      upsert(await api<AdminPageRow>(`/admin/pages/${page.id}`, { method: "PATCH", body: { verified: on } }));
      toast(on ? t("{name} is verified.", { name: page.name }) : t("Verified tick removed from {name}.", { name: page.name }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  /** Runs a batch action on the picked pages, then reloads the list; pages that failed stay picked. */
  async function bulk(action: BulkAction, note?: string) {
    setBulkBusy(true);
    try {
      const result = await runBulk("/admin/pages/bulk", { ids: selection.list, action, note: note || undefined }, t, BULK_DONE[action]);
      if (result) {
        selection.remove(result.done);
        setReload((n) => n + 1);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  /** Every page matching the current filters (all pages of results), as a spreadsheet. */
  async function exportCsv() {
    setExporting(true);
    try {
      const all: AdminPageRow[] = [];
      let next: string | null | undefined;
      do {
        const page: Page<AdminPageRow> = await api<Page<AdminPageRow>>("/admin/pages", { query: { ...query, limit: 100, cursor: next ?? undefined } });
        all.push(...page.items);
        next = page.nextCursor;
      } while (next);
      const header = ["Name", "Slug", "Type", "Status", "Verified", "Owner", "Owner email", "Admins", "Followers", "Posts", "Created"];
      const rows = all.map((p) => [
        p.name,
        p.slug,
        PAGE_CATEGORY_LABELS[p.category],
        STATUS[p.status].label,
        p.verified ? "Yes" : "No",
        p.owner?.name ?? "",
        p.owner?.email ?? "",
        p.admins,
        p.followers,
        p.posts,
        p.createdAt.slice(0, 10),
      ]);
      downloadText(datedFileName("pages"), csvRows([header, ...rows]));
      toast(t("{count} pages exported.", { count: all.length }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-card border border-line bg-card px-5 py-4">
        <div className="flex min-w-[280px] flex-1 flex-col gap-3">
          <SettingSwitch
            label="Members can create pages"
            hint={settings.memberCreation === "closed" ? "Off: only the team creates pages. Members see no Create a page button." : "Any verified member can create pages for their organisations."}
            checked={settings.memberCreation !== "closed"}
            disabled={!canChangeSettings || savingSettings}
            onChange={(on) => void saveSettings({ ...settings, memberCreation: on ? "open" : "closed" })}
          />
          <SettingSwitch
            label="Pages go live without approval"
            hint={
              settings.memberCreation === "open"
                ? "On (the default): new pages go live straight away. Staff can still suspend or remove any page at any time."
                : "Off: new pages stay hidden under “Waiting for review” until someone approves them."
            }
            checked={settings.memberCreation === "open"}
            disabled={!canChangeSettings || savingSettings || settings.memberCreation === "closed"}
            onChange={(on) => void saveSettings({ ...settings, memberCreation: on ? "open" : "review" })}
          />
          {!canChangeSettings && <p className="text-xs text-secondary">Only Platform Admins can change these.</p>}
        </div>
        <div className="flex w-[180px] flex-col gap-1.5">
          <label htmlFor="pages-max" className="text-label text-ink">
            Pages one member can own
          </label>
          <input
            id="pages-max"
            type="number"
            min={1}
            max={50}
            defaultValue={settings.maxPagesPerMember}
            disabled={!canChangeSettings || savingSettings}
            onBlur={(event) => {
              const value = Math.min(50, Math.max(1, Math.round(Number(event.target.value) || settings.maxPagesPerMember)));
              event.target.value = String(value);
              if (value !== settings.maxPagesPerMember) void saveSettings({ ...settings, maxPagesPerMember: value });
            }}
            className={inputClasses()}
          />
          <p className="text-xs text-secondary">Saved when you leave the field.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter pages" className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium",
                filter === item.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="small" disabled={exporting} onClick={() => void exportCsv()}>
            <Icon name="download" size={16} />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button size="small" onClick={() => setEditing("new")}>
            <Icon name="plus" size={16} />
            New page
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Filter and sort pages" className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <span className="sr-only">Search pages</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name" className={inputClasses(false, "ps-9")} />
        </label>
        <FilterSelect label="Kind of page" options={CATEGORY_OPTIONS} value={category} onChange={(e) => setCategory(e.target.value as "" | PageCategory)} />
        <FilterSelect label="Verified tick" options={VERIFIED_OPTIONS} value={verified} onChange={(e) => setVerified(e.target.value as Verified)} />
        <FilterSelect label="Sort pages" options={SORT_OPTIONS} value={sort} onChange={(e) => setSort(e.target.value as Sort)} />
        {(category || verified || sort !== "newest") && (
          <button
            type="button"
            onClick={() => {
              setCategory("");
              setVerified("");
              setSort("newest");
            }}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className={cn("rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {pages.length === 0 ? (
          <EmptyState icon="building" title={filter === "pending" && !filtered ? "Nothing waiting for review" : filtered ? "No pages match these filters" : "No pages here"} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line bg-muted px-5 py-2 text-label text-secondary uppercase">
              <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} />
              <span>Select all pages shown</span>
            </div>
            <ul className="divide-y divide-line">
              {pages.map((page) => {
                const busy = busyId === page.id;
                const primary =
                  page.status === "pending" || page.status === "rejected"
                    ? { label: "Approve", variant: "primary" as const, onClick: () => setActing({ page, action: "approve" }) }
                    : page.status === "suspended"
                      ? { label: "Restore", variant: "secondary" as const, onClick: () => setActing({ page, action: "restore" }) }
                      : { label: "Edit", variant: "secondary" as const, onClick: () => setEditing(page) };
                return (
                  <li key={page.id} className={cn("flex flex-wrap items-start gap-4 px-5 py-4", selection.has(page.id) && "bg-primary-tint-2/40")}>
                    <PickBox className="mt-3.5" checked={selection.has(page.id)} label={t("Select page {name}", { name: page.name })} onChange={(on) => selection.toggle(page.id, on)} />
                    <Logo page={page} />
                    <div className="flex min-w-[260px] flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={webHref(`/pages/${page.slug}`)} target="_blank" rel="noreferrer" className="text-md font-semibold text-ink hover:underline">
                          {page.name}
                        </a>
                        {page.verified && <Icon name="verified" size={16} className="text-primary-light" label="Verified" />}
                        <Chip tone={STATUS[page.status].tone} className="px-2! py-0.5! text-xs!">
                          {STATUS[page.status].label}
                        </Chip>
                        {page.official && (
                          <Chip tone="info" className="px-2! py-0.5! text-xs!">
                            Official
                          </Chip>
                        )}
                      </div>
                      <p className="text-sm text-secondary">
                        {PAGE_CATEGORY_LABELS[page.category]} · /pages/{page.slug} · created <DateTime iso={page.createdAt} dateOnly />
                      </p>
                      {page.tagline && <p className="text-sm text-body">{page.tagline}</p>}
                      {page.status === "pending" && page.about && <p className="line-clamp-3 text-sm text-body">{page.about}</p>}
                      {page.website && (
                        <a href={page.website} target="_blank" rel="noopener noreferrer nofollow" className="w-fit text-sm text-primary-light hover:underline">
                          {page.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                      {page.reviewNote && page.status !== "active" && <p className="text-sm text-body"><T vars={{ reviewNote: page.reviewNote }}>{"Note to admins: “{reviewNote}”"}</T></p>}
                      <p className="text-xs text-secondary">
                        Owner:{" "}
                        {page.owner ? (
                          <a href={webHref(`/${page.owner.handle}`)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                            {page.owner.name}
                          </a>
                        ) : (
                          "none"
                        )}
                        {page.owner?.email ? ` (${page.owner.email})` : ""} · {page.admins} admin{page.admins === 1 ? "" : "s"} · {formatCount(page.followers)} follower
                        {page.followers === 1 ? "" : "s"} · {formatCount(page.posts)} post{page.posts === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant={primary.variant} size="small" disabled={busy} onClick={primary.onClick}>
                        {primary.label}
                      </Button>
                      <RowMenu
                        label={t("More actions for page {name}", { name: page.name })}
                        items={[
                          { label: "Don’t approve", hidden: page.status !== "pending", disabled: busy, onSelect: () => setActing({ page, action: "reject" }) },
                          { label: "Verify", hidden: page.status !== "active" || page.verified, disabled: busy, onSelect: () => void setTick(page, true) },
                          { label: "Remove tick", hidden: page.status !== "active" || !page.verified, disabled: busy, onSelect: () => void setTick(page, false) },
                          { label: "Edit", hidden: primary.label === "Edit", disabled: busy, onSelect: () => setEditing(page) },
                          { label: "Suspend", hidden: page.status !== "active", danger: true, disabled: busy, onSelect: () => setActing({ page, action: "suspend" }) },
                          { label: "Remove page", danger: true, disabled: busy, onSelect: () => setRemoving(page) },
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {cursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void more()}>
          Load more
        </Button>
      )}

      <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
        <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("verify")}>
          Verify
        </Button>
        <Button variant="secondary" size="small" disabled={bulkBusy} onClick={() => void bulk("unverify")}>
          Remove tick
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

      {bulkConfirm && BULK_CONFIRM[bulkConfirm] && (
        <ReasonDialog
          title={t(BULK_CONFIRM[bulkConfirm].title, { count: selection.count })}
          description={BULK_CONFIRM[bulkConfirm].description}
          confirmLabel={BULK_CONFIRM[bulkConfirm].confirm}
          tone="danger"
          reasonField={bulkConfirm === "suspend" ? "required" : "none"}
          reasonLabel="Note to the pages’ admins"
          reasonPlaceholder="Why the pages were taken down"
          reasonHint="Shown to each page’s admins and recorded in the audit log."
          requiredMessage="Add a note so the page’s admins know what to fix."
          minReasonLength={5}
          onClose={() => setBulkConfirm(null)}
          onConfirm={async (note) => {
            const action = bulkConfirm;
            setBulkConfirm(null);
            await bulk(action, note);
          }}
        />
      )}
      {editing && (
        <PageFormModal
          page={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(page) => {
            upsert(page);
            setEditing(null);
            toast(t("{name} saved.", { name: page.name }));
          }}
        />
      )}
      {acting && (
        <ReasonDialog
          title={t(ACTION_COPY[acting.action].title, { name: acting.page.name })}
          description={ACTION_COPY[acting.action].description}
          confirmLabel={ACTION_COPY[acting.action].confirm}
          tone={acting.action === "approve" || acting.action === "restore" ? "primary" : "danger"}
          reasonField={ACTION_COPY[acting.action].needsNote ? "required" : "none"}
          reasonLabel="Note to the page’s admins"
          reasonPlaceholder="What needs to change, or why the page was taken down"
          reasonHint="Shown to the page’s admins and recorded in the audit log."
          requiredMessage="Add a note so the page’s admins know what to fix."
          minReasonLength={5}
          onClose={() => setActing(null)}
          onConfirm={async (note) => {
            const { page, action } = acting;
            upsert(await api<AdminPageRow>(`/admin/pages/${page.id}/status`, { method: "POST", body: { action, note: note || undefined } }));
            toast(t(ACTION_COPY[action].done, { name: page.name }));
            setActing(null);
          }}
        />
      )}
      {removing && (
        <ReasonDialog
          title={t("Remove {name}?", { name: removing.name })}
          description={t("This deletes the page with its {count} posts and {followers} followers. It can’t be undone. To hide a page and keep its content, suspend it instead.", { count: removing.posts, followers: formatCount(removing.followers) })}
          confirmLabel="Remove page"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/admin/pages/${removing.id}`, { method: "DELETE" });
            setPages((list) => list.filter((x) => x.id !== removing.id));
            selection.remove([removing.id]);
            toast(t("{name} removed.", { name: removing.name }));
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function PageFormModal({ page, onSaved, onClose }: { page: AdminPageRow | null; onSaved: (page: AdminPageRow) => void; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={page ? t("Edit {name}", { name: page.name }) : "New page"}
      description={page ? "The logo and cover are changed from the page itself, on the member site." : "The page goes live straight away. Its owner can add a logo, a cover and more admins from the member site."}
      submitLabel={page ? "Save" : "Create page"}
      busy={busy}
      error={error}
      wide
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        const text = (name: string) => String(data.get(name) ?? "").trim();
        const website = text("website");
        const owner = text("owner");
        const body = {
          name: text("name"),
          category: text("category"),
          tagline: text("tagline") || null,
          about: text("about") || null,
          website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
          official: data.get("official") === "on",
          verified: data.get("verified") === "on",
          ...(owner && owner !== (page?.owner?.handle ?? "") ? { owner } : {}),
        };
        try {
          onSaved(await api<AdminPageRow>(page ? `/admin/pages/${page.id}` : "/admin/pages", { method: page ? "PATCH" : "POST", body }));
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Page name" name="name" required minLength={2} maxLength={80} defaultValue={page?.name} />
        <Field label="Kind of page">
          {(id) => <SelectBox id={id} name="category" defaultValue={page?.category ?? "organisation"} options={PageCategory.options.map((value) => ({ value, label: PAGE_CATEGORY_LABELS[value] }))} />}
        </Field>
      </div>
      <TextField label="Tagline" name="tagline" maxLength={120} defaultValue={page?.tagline ?? ""} hint="One line under the page name." />
      <Field label="About">
        {(id) => <textarea id={id} name="about" rows={4} maxLength={2000} defaultValue={page?.about ?? ""} className={inputClasses(false, "h-auto resize-y py-2")} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Website" name="website" inputMode="url" placeholder="https://" defaultValue={page?.website ?? ""} />
        <TextField
          label="Owner"
          name="owner"
          defaultValue={page?.owner?.handle ?? ""}
          placeholder="Handle or email of a member"
          hint={page ? "Change it to hand the page to another member; the current owner stays on as an admin." : "Leave empty to own it yourself."}
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="official" defaultChecked={page?.official ?? false} className="size-4 accent-[var(--color-primary)]" />
          Official Charter Mission page
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="verified" defaultChecked={page?.verified ?? false} className="size-4 accent-[var(--color-primary)]" />
          Verified tick
        </label>
      </div>
    </FormModal>
  );
}

/** An on/off switch that saves straight away. */
function SettingSwitch({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={cn("flex items-start gap-3", disabled && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-line-strong")}
      >
        <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-secondary">{hint}</span>
      </div>
    </div>
  );
}
