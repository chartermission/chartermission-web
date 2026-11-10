"use client";

import { useMemo, useState } from "react";
import type { AdminChapterRow, AdminChapterUpdateInput, ChapterPostApproval, ChapterPostsSettings, Country } from "@chartermission/contracts";
import { Button, ChapterAvatar, ChapterCover, Chip, Icon, SegmentedControl, cn } from "@chartermission/ui";
import { Field, FormModal, SelectBox } from "@/components/ambassadors/modal";
import { TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { WEB_URL } from "@/lib/navigation";
import { BulkPictureUpload } from "./bulk-upload";
import { PictureField } from "./picture-field";

type StatusFilter = "all" | "active" | "dormant";

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Chapter catalogue (GET /admin/chapters). Every change is audited by the API. Removing is only
 * allowed for chapters nobody has used yet; otherwise the API asks to deactivate instead.
 */
export function ChaptersConsole({ initial, countries, postRule }: { initial: AdminChapterRow[]; countries: Country[]; postRule: ChapterPostsSettings }) {
  const [rows, setRows] = useState(initial);
  const [rule, setRule] = useState<ChapterPostApproval>(postRule.approval);
  const [ruleBusy, setRuleBusy] = useState(false);
  const waiting = rows.reduce((sum, r) => sum + r.pendingPosts, 0);

  async function changeRule(next: ChapterPostApproval) {
    if (next === rule || ruleBusy) return;
    setRuleBusy(true);
    try {
      const saved = await api<ChapterPostsSettings>("/admin/settings/chapter-posts", { method: "PUT", body: { approval: next } });
      setRule(saved.approval);
      toast(saved.approval === "review" ? "Members’ posts now wait for approval in every chapter that follows the platform rule" : "Members’ posts now appear straight away in every chapter that follows the platform rule");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRuleBusy(false);
    }
  }
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<AdminChapterRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [removing, setRemoving] = useState<AdminChapterRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.countryName.toLowerCase().includes(q) || r.countryCode.toLowerCase() === q),
    );
  }, [rows, query, status]);

  const counts = useMemo(
    () => ({ active: rows.filter((r) => r.status === "active").length, dormant: rows.filter((r) => r.status === "dormant").length }),
    [rows],
  );

  const replace = (row: AdminChapterRow) => setRows((list) => list.map((r) => (r.id === row.id ? row : r)));

  async function patch(row: AdminChapterRow, body: AdminChapterUpdateInput, done: string) {
    setBusyId(row.id);
    try {
      replace(await api<AdminChapterRow>(`/admin/chapters/${row.id}`, { method: "PATCH", body }));
      toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div aria-labelledby="post-rule" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card border border-line bg-card px-5 py-4">
        <div className="flex max-w-[640px] flex-col gap-1">
          <h2 id="post-rule" className="text-h3 text-ink">
            Members’ posts in chapters
          </h2>
          <p className="text-sm text-secondary">
            {rule === "review"
              ? "A member’s post is seen only by them until the chapter’s Ambassadors, Chapter Leads or the Charter Mission team approve it."
              : "A member’s post appears in the chapter as soon as it is posted. The chapter’s team can still send it back for review or remove it."}{" "}
            Ambassadors, Chapter Leads and the team always post directly. A chapter can have its own rule: open it with Edit.
            {waiting > 0 && ` ${numberFormat.format(waiting)} ${waiting === 1 ? "post is" : "posts are"} waiting for approval.`}
          </p>
        </div>
        <SegmentedControl
          label="Members’ posts in chapters"
          size="small"
          value={rule}
          onChange={changeRule}
          items={[
            { value: "direct", label: "Appear straight away" },
            { value: "review", label: "Wait for approval" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search chapters</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 left-3 my-auto h-fit text-secondary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by chapter, country or code"
            className={inputClasses(false, "pl-9")}
          />
        </label>
        <SegmentedControl
          label="Status"
          size="small"
          value={status}
          onChange={setStatus}
          items={[
            { value: "all", label: `All (${rows.length})` },
            { value: "active", label: `Active (${counts.active})` },
            { value: "dormant", label: `Inactive (${counts.dormant})` },
          ]}
        />
        <Button variant="secondary" size="small" onClick={() => setBulk(true)}>
          <Icon name="image" size={16} />
          Bulk upload pictures
        </Button>
        <Button size="small" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Add chapter
        </Button>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        {visible.length === 0 ? (
          <EmptyState icon="map-pin" title="No chapters match">
            Try another search or status.
          </EmptyState>
        ) : (
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <caption className="sr-only">Chapters</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2.5 pr-2.5 pl-4 font-semibold">Chapter</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Cover</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Country</th>
                <th scope="col" className="py-2.5 pr-2.5 text-right font-semibold">Members</th>
                <th scope="col" className="py-2.5 pr-2.5 text-right font-semibold">Posts</th>
                <th scope="col" className="py-2.5 pr-2.5 font-semibold">Status</th>
                <th scope="col" className="py-2.5 pr-4 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const active = row.status === "active";
                return (
                  <tr key={row.id} className="border-t border-line first:border-t-0">
                    <td className="py-3 pr-2.5 pl-4">
                      <div className="flex items-center gap-3">
                        <ChapterAvatar name={row.name} countryCode={row.countryCode} src={row.imageUrl} size={40} className="rounded-full" />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium text-ink">{row.name}</span>
                          <span className="text-xs text-secondary">
                            /chapters/{row.slug}
                            {row.hashtag && ` · #${row.hashtag}`}
                            {row.imageUrl && " · custom picture"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-2.5">
                      <div className="h-8 w-32 overflow-hidden rounded-md border border-line">
                        <ChapterCover name={row.name} countryCode={row.countryCode} src={row.coverUrl} photo={row.photoUrl ? { url: row.photoUrl } : null} />
                      </div>
                    </td>
                    <td className="py-3 pr-2.5 text-body">
                      {row.countryName}
                      <span className="block text-xs text-secondary">{row.region === "Diaspora" ? "Diaspora" : row.region}</span>
                    </td>
                    <td className="py-3 pr-2.5 text-right text-body tabular-nums">{numberFormat.format(row.followers)}</td>
                    <td className="py-3 pr-2.5 text-right text-body tabular-nums">
                      {numberFormat.format(row.posts)}
                      {row.pendingPosts > 0 && (
                        <a
                          href={`${WEB_URL}/chapters/${row.slug}#review`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs font-medium text-accent-hover hover:underline"
                        >
                          {numberFormat.format(row.pendingPosts)} to review
                        </a>
                      )}
                      {row.postApproval && <span className="block text-xs text-secondary">{row.postApproval === "review" ? "Approval on" : "Approval off"}</span>}
                    </td>
                    <td className="py-3 pr-2.5">
                      <Chip tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Chip>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="small" disabled={busyId === row.id} onClick={() => setEditing(row)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={busyId === row.id}
                          onClick={() =>
                            void patch(row, { status: active ? "dormant" : "active" }, active ? `${row.name} deactivated.` : `${row.name} activated.`)
                          }
                        >
                          {active ? "Deactivate" : "Activate"}
                        </Button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => setRemoving(row)}
                          className="rounded-md p-1.5 text-secondary hover:bg-error-light hover:text-error disabled:opacity-50"
                        >
                          <Icon name="x" size={16} label={`Remove ${row.name}`} />
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

      {editing && (
        <EditChapter
          row={editing}
          onSaved={(row) => {
            replace(row);
            setEditing(null);
            toast(`${row.name} saved.`);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <AddChapter
          countries={countries}
          onSaved={(row) => {
            setRows((list) => [...list, row].sort((a, b) => a.name.localeCompare(b.name)));
            setAdding(false);
            toast(`${row.name} added.`);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {bulk && <BulkPictureUpload chapters={rows} onUpdated={replace} onClose={() => setBulk(false)} />}
      {removing && (
        <ReasonDialog
          title={`Remove ${removing.name}?`}
          description="Only chapters nobody has joined or posted in can be removed. It won’t come back when the platform restarts. To hide a chapter that’s in use, deactivate it."
          confirmLabel="Remove chapter"
          tone="danger"
          reasonField="none"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api(`/admin/chapters/${removing.id}`, { method: "DELETE" });
            setRows((list) => list.filter((r) => r.id !== removing.id));
            toast(`${removing.name} removed.`);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function AddChapter({ countries, onSaved, onClose }: { countries: Country[]; onSaved: (row: AdminChapterRow) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const sorted = useMemo(() => [...countries].sort((a, b) => a.name.localeCompare(b.name)), [countries]);
  return (
    <FormModal
      title="Add a chapter"
      description="One chapter per country. Diaspora chapters use the host country (e.g. Pakistan for a Pakistan diaspora chapter)."
      submitLabel="Add chapter"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        setFields({});
        try {
          const slug = String(data.get("slug") ?? "").trim();
          onSaved(
            await api<AdminChapterRow>("/admin/chapters", {
              method: "POST",
              body: { name: String(data.get("name") ?? ""), countryCode: String(data.get("countryCode") ?? ""), ...(slug ? { slug } : {}) },
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
          if (e && typeof e === "object" && "fields" in e && e.fields) setFields(e.fields as Record<string, string>);
          setBusy(false);
        }
      }}
    >
      <TextField label="Name" name="name" required placeholder="e.g. Pakistan Diaspora Chapter" error={fields.name} />
      <Field label="Country" error={fields.countryCode}>
        {(id, describedBy) => (
          <SelectBox
            id={id}
            name="countryCode"
            describedBy={describedBy}
            options={[{ value: "", label: "Choose a country" }, ...sorted.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))]}
          />
        )}
      </Field>
      <TextField label="Link name (optional)" name="slug" placeholder="made from the name" hint="Lowercase letters, numbers and hyphens: /chapters/link-name" error={fields.slug} />
    </FormModal>
  );
}

function EditChapter({ row, onSaved, onClose }: { row: AdminChapterRow; onSaved: (row: AdminChapterRow) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<{ fileId: string | null; url: string | null } | undefined>(undefined);
  const [cover, setCover] = useState<{ fileId: string | null; url: string | null } | undefined>(undefined);
  const [photoUrl, setPhotoUrl] = useState(row.photoUrl ?? "");
  const imageUrl = image === undefined ? row.imageUrl : image.url;
  const coverUrl = cover === undefined ? row.coverUrl : cover.url;
  return (
    <FormModal
      title={`Edit ${row.name}`}
      submitLabel="Save changes"
      wide
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        setBusy(true);
        setError(null);
        const body: AdminChapterUpdateInput = {
          name: String(data.get("name") ?? "").trim(),
          status: data.get("status") === "active" ? "active" : "dormant",
          about: String(data.get("about") ?? "").trim() || null,
          hashtag: String(data.get("hashtag") ?? "").trim().replace(/^#/, "") || null,
          photoUrl: photoUrl.trim() || null,
          photoCredit: String(data.get("photoCredit") ?? "").trim() || null,
          photoCreditUrl: String(data.get("photoCreditUrl") ?? "").trim() || null,
          postApproval: data.get("postApproval") === "direct" ? "direct" : data.get("postApproval") === "review" ? "review" : null,
          ...(image !== undefined ? { imageFileId: image.fileId } : {}),
          ...(cover !== undefined ? { coverFileId: cover.fileId } : {}),
        };
        try {
          onSaved(await api<AdminChapterRow>(`/admin/chapters/${row.id}`, { method: "PATCH", body }));
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <TextField label="Name" name="name" defaultValue={row.name} required />
        <Field label="Status">
          {(id) => (
            <SelectBox
              id={id}
              name="status"
              defaultValue={row.status === "active" ? "active" : "dormant"}
              options={[
                { value: "active", label: "Active" },
                { value: "dormant", label: "Inactive" },
              ]}
            />
          )}
        </Field>
      </div>
      <Field label="Members’ posts" hint="Whether a member’s post appears in this chapter straight away or waits for the chapter team’s approval.">
        {(id) => (
          <SelectBox
            id={id}
            name="postApproval"
            defaultValue={row.postApproval ?? "inherit"}
            options={[
              { value: "inherit", label: "Follow the platform rule" },
              { value: "direct", label: "Appear straight away" },
              { value: "review", label: "Wait for approval" },
            ]}
          />
        )}
      </Field>
      <PictureField
        label="Display picture"
        hint="Square, at least 800 × 800. Shown in a circle: keep the subject in the middle."
        purpose="chapter_image"
        preview={<ChapterAvatar name={row.name} countryCode={row.countryCode} src={imageUrl} size={88} className="rounded-full" />}
        custom={!!imageUrl}
        onUploaded={(fileId, url) => setImage({ fileId, url })}
        onReset={() => setImage({ fileId: null, url: null })}
        disabled={busy}
      />
      <PictureField
        label="Cover"
        hint="Wide, 4:1 (about 1600 × 400). Shown across the top of the chapter page."
        purpose="chapter_cover"
        preview={
          <div className="h-[60px] w-[240px] overflow-hidden rounded-md border border-line">
            <ChapterCover name={row.name} countryCode={row.countryCode} src={coverUrl} photo={photoUrl ? { url: photoUrl } : null} />
          </div>
        }
        custom={!!coverUrl}
        onUploaded={(fileId, url) => setCover({ fileId, url })}
        onReset={() => setCover({ fileId: null, url: null })}
        disabled={busy}
      />
      <TextField
        label="Country photo"
        name="photoUrl"
        type="url"
        value={photoUrl}
        onChange={(event) => setPhotoUrl(event.target.value)}
        maxLength={600}
        placeholder="https://images.unsplash.com/photo-…"
        hint="A photograph of the country, shown behind the title when there is no uploaded cover. Paste an image address from Unsplash (free to use). Leave empty for the plain green cover."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Photographer" name="photoCredit" defaultValue={row.photoCredit ?? ""} maxLength={120} hint="Shown as “Photo: name / Unsplash” on the cover." />
        <TextField label="Photographer’s page" name="photoCreditUrl" type="url" defaultValue={row.photoCreditUrl ?? ""} maxLength={600} placeholder="https://unsplash.com/@…" />
      </div>
      <TextField
        label="Chapter hashtag"
        name="hashtag"
        defaultValue={row.hashtag ?? ""}
        maxLength={51}
        placeholder="e.g. Nigeria"
        hint="Shown on the chapter page. Letters, numbers and underscores, with no spaces."
      />
      <Field label="About" hint="Up to 1,000 characters. Ambassadors and Chapter Leads can also edit this on the chapter page.">
        {(id, describedBy) => (
          <textarea id={id} name="about" rows={3} maxLength={1000} defaultValue={row.about ?? ""} aria-describedby={describedBy} className={cn(inputClasses(false), "resize-y")} />
        )}
      </Field>
    </FormModal>
  );
}
