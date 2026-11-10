"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { AdminTopicRow, AdminTopicUpdateInput } from "@chartermission/contracts";
import { Button, Chip, Icon, SegmentedControl, cn } from "@chartermission/ui";
import { FormModal } from "@/components/ambassadors/modal";
import { TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

type Filter = "all" | "featured" | "active" | "disabled";
const numberFormat = new Intl.NumberFormat("en-US");

/** Topic catalogue (GET /admin/topics): add, feature, activate / deactivate, edit, remove unused. */
export function TopicsConsole({ initial }: { initial: AdminTopicRow[] }) {
  const t = useT();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [newTag, setNewTag] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminTopicRow | null>(null);
  const [removing, setRemoving] = useState<AdminTopicRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().replace(/^#/, "").toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || (filter === "featured" ? r.featured : r.status === filter)) &&
        (!q || r.tag.includes(q) || (r.description ?? "").toLowerCase().includes(q)),
    );
  }, [rows, query, filter]);

  const upsert = (row: AdminTopicRow) => setRows((list) => (list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [row, ...list]));

  async function patch(row: AdminTopicRow, body: AdminTopicUpdateInput, done: string) {
    setBusyId(row.id);
    try {
      upsert(await api<AdminTopicRow>(`/admin/topics/${row.id}`, { method: "PATCH", body }));
      toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const row = await api<AdminTopicRow>("/admin/topics", {
        method: "POST",
        body: { tag: newTag, featured: true, ...(newDescription.trim() ? { description: newDescription.trim() } : {}) },
      });
      upsert(row);
      setNewTag("");
      setNewDescription("");
      toast(t("#{display} added as a featured topic.", { display: row.display }));
    } catch (e) {
      setAddError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <form onSubmit={add} noValidate className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
        <h2 className="text-h3 text-ink">Add a topic</h2>
        <div className="grid items-start gap-3 sm:grid-cols-[220px_1fr_auto]">
          <TextField label="Hashtag" placeholder="#BlueEconomy" value={newTag} onChange={(e) => setNewTag(e.target.value)} error={addError} />
          <TextField label="Description (optional)" placeholder="What the topic covers" maxLength={300} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <Button type="submit" size="small" disabled={adding || newTag.trim().replace(/^#/, "").length < 2} className="sm:mt-[26px]">
            <Icon name="plus" size={16} />
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <p className="text-xs text-secondary">
          The capitalisation you type is how the topic is shown. Adding a topic that already exists features it and turns it back on.
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search topics</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 left-3 my-auto h-fit text-secondary" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics" className={inputClasses(false, "pl-9")} />
        </label>
        <SegmentedControl
          label="Show"
          size="small"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: t("All ({count})", { count: rows.length }) },
            { value: "featured", label: t("Featured ({count})", { count: rows.filter((r) => r.featured).length }) },
            { value: "active", label: "Active" },
            { value: "disabled", label: t("Inactive ({count})", { count: rows.filter((r) => r.status === "disabled").length }) },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        {visible.length === 0 ? (
          <EmptyState icon="hash" title="No topics match" />
        ) : (
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <caption className="sr-only">Topics</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2.5 pr-2.5 pl-4 font-semibold">Topic</th>
                <th scope="col" className="py-2.5 pr-2.5 text-right font-semibold">Posts</th>
                <th scope="col" className="py-2.5 pr-2.5 text-right font-semibold">Followers</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Status</th>
                <th scope="col" className="py-2.5 pr-4 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const active = row.status === "active";
                const busy = busyId === row.id;
                return (
                  <tr key={row.id} className={cn("border-t border-line first:border-t-0", !active && "bg-surface")}>
                    <td className="py-3 pr-2.5 pl-4">
                      <div className="flex flex-col gap-0.5">
                        <span className={cn("font-medium", active ? "text-ink" : "text-secondary line-through")}>#{row.display}</span>
                        {row.description && <span className="line-clamp-1 text-xs text-secondary">{row.description}</span>}
                      </div>
                    </td>
                    <td className="py-3 pr-2.5 text-right text-body tabular-nums">{numberFormat.format(row.postCount)}</td>
                    <td className="py-3 pr-2.5 text-right text-body tabular-nums">{numberFormat.format(row.followerCount)}</td>
                    <td className="py-3 pr-2.5 whitespace-nowrap">
                      <div className="flex gap-1">
                        <Chip tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Chip>
                        {row.featured && <Chip tone="warning">Featured</Chip>}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={busy}
                          onClick={() => void patch(row, { featured: !row.featured }, row.featured ? t("#{display} is no longer featured.", { display: row.display }) : t("#{display} featured.", { display: row.display }))}
                        >
                          {row.featured ? "Unfeature" : "Feature"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void patch(row, { status: active ? "disabled" : "active" }, active ? t("#{display} deactivated.", { display: row.display }) : t("#{display} activated.", { display: row.display }))
                          }
                        >
                          {active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button variant="ghost" size="small" disabled={busy} onClick={() => setEditing(row)}>
                          Edit
                        </Button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRemoving(row)}
                          className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-50"
                        >
                          <Icon name="x" size={16} label={t("Remove #{display}", { display: row.display })} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && <EditTopic row={editing} onSaved={(row) => { upsert(row); setEditing(null); toast(t("#{display} saved.", { display: row.display })); }} onClose={() => setEditing(null)} />}
      {removing && (
        <ReasonDialog
          title={t("Remove #{display}?", { display: removing.display })}
          description="Only topics no post uses can be removed; members who follow it stop following it. To hide a topic that’s in use, deactivate it."
          confirmLabel="Remove topic"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/admin/topics/${removing.id}`, { method: "DELETE" });
            setRows((list) => list.filter((r) => r.id !== removing.id));
            toast(t("#{display} removed.", { display: removing.display }));
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function EditTopic({ row, onSaved, onClose }: { row: AdminTopicRow; onSaved: (row: AdminTopicRow) => void; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t("Edit #{display}", { display: row.display })}
      submitLabel="Save"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        try {
          onSaved(
            await api<AdminTopicRow>(`/admin/topics/${row.id}`, {
              method: "PATCH",
              body: { display: String(data.get("display") ?? ""), description: String(data.get("description") ?? "").trim() || null },
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <TextField label="Shown as" name="display" defaultValue={row.display} hint="Only the capitalisation can change, e.g. Fintech → FinTech." />
      <TextField label="Description" name="description" defaultValue={row.description ?? ""} maxLength={300} />
    </FormModal>
  );
}
