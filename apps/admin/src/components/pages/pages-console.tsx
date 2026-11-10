"use client";

import { useEffect, useRef, useState } from "react";
import {
  PAGE_CATEGORY_LABELS,
  PageCategory,
  type AdminPageRow,
  type AdminPageStatusInput,
  type Page,
  type PageCreationPolicy,
  type PagesSettings,
  type PageStatus,
} from "@chartermission/contracts";
import { Button, Chip, Icon, cn, type ChipTone } from "@chartermission/ui";
import { Field, FormModal, SelectBox, selectClasses } from "@/components/ambassadors/modal";
import { TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { webHref } from "@/lib/navigation";

type Filter = "all" | PageStatus;

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

const POLICY: { value: PageCreationPolicy; label: string; hint: string }[] = [
  { value: "review", label: "Members create pages, the team reviews them first", hint: "New pages wait here until someone approves them." },
  { value: "open", label: "Members create pages that go live straight away", hint: "No review step. You can still suspend or remove a page afterwards." },
  { value: "closed", label: "Only the team creates pages", hint: "Members see no Create a page button." },
];

const ACTION_COPY: Record<AdminPageStatusInput["action"], { title: (name: string) => string; description: string; confirm: string; done: string; needsNote: boolean }> = {
  approve: { title: (n) => `Approve ${n}?`, description: "The page goes live, its admins are told, and it can start posting.", confirm: "Approve page", done: "approved and live.", needsNote: false },
  reject: {
    title: (n) => `Don’t approve ${n}?`,
    description: "The page stays hidden. Its admins see your note and can edit the page to send it back for review.",
    confirm: "Don’t approve",
    done: "sent back to its admins.",
    needsNote: true,
  },
  suspend: { title: (n) => `Suspend ${n}?`, description: "The page and its posts are hidden from members straight away. Its admins see your note.", confirm: "Suspend page", done: "suspended.", needsNote: true },
  restore: { title: (n) => `Restore ${n}?`, description: "The page and its posts become visible again.", confirm: "Restore page", done: "restored.", needsNote: false },
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
  const [pages, setPages] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editing, setEditing] = useState<AdminPageRow | "new" | null>(null);
  const [acting, setActing] = useState<{ page: AdminPageRow; action: AdminPageStatusInput["action"] } | null>(null);
  const [removing, setRemoving] = useState<AdminPageRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const first = useRef(true);

  const upsert = (page: AdminPageRow) => setPages((list) => (list.some((x) => x.id === page.id) ? list.map((x) => (x.id === page.id ? page : x)) : [page, ...list]));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<Page<AdminPageRow>>("/admin/pages", { query: { status: filter, q: q.trim(), limit: 100 }, signal: controller.signal })
        .then((page) => {
          setPages(page.items);
          setCursor(page.nextCursor);
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
  }, [filter, q]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api<Page<AdminPageRow>>("/admin/pages", { query: { status: filter, q: q.trim(), limit: 100, cursor } });
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

  async function setVerified(page: AdminPageRow, verified: boolean) {
    setBusyId(page.id);
    try {
      upsert(await api<AdminPageRow>(`/admin/pages/${page.id}`, { method: "PATCH", body: { verified } }));
      toast(verified ? `${page.name} is verified.` : `Verified tick removed from ${page.name}.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  const policy = POLICY.find((p) => p.value === settings.memberCreation) ?? POLICY[0]!;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-card border border-line bg-card px-5 py-4">
        <div className="flex min-w-[280px] flex-1 flex-col gap-1.5">
          <label htmlFor="pages-policy" className="text-label text-ink">
            Who can create pages
          </label>
          <span className="relative">
            <select
              id="pages-policy"
              value={settings.memberCreation}
              disabled={!canChangeSettings || savingSettings}
              onChange={(event) => void saveSettings({ ...settings, memberCreation: event.target.value as PageCreationPolicy })}
              aria-describedby="pages-policy-hint"
              className={selectClasses()}
            >
              {POLICY.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary" />
          </span>
          <p id="pages-policy-hint" className="text-xs text-secondary">
            {policy.hint}
            {!canChangeSettings && " Only Platform Admins can change this."}
          </p>
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
        <label className="relative ml-auto min-w-[220px]">
          <span className="sr-only">Search pages</span>
          <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-secondary" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name" className={inputClasses(false, "pl-9")} />
        </label>
        <Button size="small" onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} />
          New page
        </Button>
      </div>

      <div className={cn("rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {pages.length === 0 ? (
          <EmptyState icon="building" title={filter === "pending" ? "Nothing waiting for review" : "No pages here"} />
        ) : (
          <ul className="divide-y divide-line">
            {pages.map((page) => {
              const busy = busyId === page.id;
              return (
                <li key={page.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
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
                    {page.reviewNote && page.status !== "active" && <p className="text-sm text-body">Note to admins: “{page.reviewNote}”</p>}
                    <p className="text-xs text-secondary">
                      Owner:{" "}
                      {page.owner ? (
                        <a href={webHref(`/members/${page.owner.handle}`)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                          {page.owner.name}
                        </a>
                      ) : (
                        "none"
                      )}
                      {page.owner?.email ? ` (${page.owner.email})` : ""} · {page.admins} admin{page.admins === 1 ? "" : "s"} · {formatCount(page.followers)} follower
                      {page.followers === 1 ? "" : "s"} · {formatCount(page.posts)} post{page.posts === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(page.status === "pending" || page.status === "rejected") && (
                      <Button size="small" disabled={busy} onClick={() => setActing({ page, action: "approve" })}>
                        Approve
                      </Button>
                    )}
                    {page.status === "pending" && (
                      <Button variant="secondary" size="small" disabled={busy} onClick={() => setActing({ page, action: "reject" })}>
                        Don’t approve
                      </Button>
                    )}
                    {page.status === "active" && (
                      <>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => void setVerified(page, !page.verified)}>
                          {page.verified ? "Remove tick" : "Verify"}
                        </Button>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => setActing({ page, action: "suspend" })}>
                          Suspend
                        </Button>
                      </>
                    )}
                    {page.status === "suspended" && (
                      <Button variant="secondary" size="small" disabled={busy} onClick={() => setActing({ page, action: "restore" })}>
                        Restore
                      </Button>
                    )}
                    <Button variant="ghost" size="small" disabled={busy} onClick={() => setEditing(page)}>
                      Edit
                    </Button>
                    <button type="button" disabled={busy} onClick={() => setRemoving(page)} className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-50">
                      <Icon name="x" size={16} label={`Remove ${page.name}`} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {cursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void more()}>
          Load more
        </Button>
      )}

      {editing && (
        <PageFormModal
          page={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(page) => {
            upsert(page);
            setEditing(null);
            toast(`${page.name} saved.`);
          }}
        />
      )}
      {acting && (
        <ReasonDialog
          title={ACTION_COPY[acting.action].title(acting.page.name)}
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
            toast(`${page.name} ${ACTION_COPY[action].done}`);
            setActing(null);
          }}
        />
      )}
      {removing && (
        <ReasonDialog
          title={`Remove ${removing.name}?`}
          description={`This deletes the page with its ${formatCount(removing.posts)} post${removing.posts === 1 ? "" : "s"} and ${formatCount(removing.followers)} follower${removing.followers === 1 ? "" : "s"}. It can’t be undone. To hide a page and keep its content, suspend it instead.`}
          confirmLabel="Remove page"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/admin/pages/${removing.id}`, { method: "DELETE" });
            setPages((list) => list.filter((x) => x.id !== removing.id));
            toast(`${removing.name} removed.`);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function PageFormModal({ page, onSaved, onClose }: { page: AdminPageRow | null; onSaved: (page: AdminPageRow) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={page ? `Edit ${page.name}` : "New page"}
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
