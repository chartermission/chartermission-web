"use client";

import { useEffect, useId, useState } from "react";
import { HIGHLIGHT_STORIES_MAX, HIGHLIGHT_TITLE_MAX_CHARS, type HighlightView, type StoryView } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { errorMessage } from "@/components/social/error-message";
import { inputClasses } from "@/components/auth/fields";
import { StoryViewer } from "./story-viewer";

/** Highlights row on a member profile: named story collections. The owner can add, edit and delete them. */
export function ProfileHighlights({ initial, own, name }: { initial: HighlightView[]; own: boolean; name: string }) {
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<HighlightView | "new" | null>(null);
  const [deleting, setDeleting] = useState<HighlightView | null>(null);
  if (!own && list.length === 0) return null;
  const current = open !== null ? list[open] : undefined;

  return (
    <section aria-labelledby="profile-highlights" className="flex flex-col gap-3">
      <h2 id="profile-highlights" className={cn("text-h3 text-ink", !own && "sr-only")}>
        Highlights
      </h2>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {own && (
          <li className="flex w-[76px] shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="flex size-[68px] items-center justify-center rounded-full border-2 border-dashed border-line-strong text-secondary hover:border-primary-light hover:text-primary-light"
              aria-label="New highlight"
            >
              <Icon name="plus" size={24} />
            </button>
            <span className="text-xs text-body">New</span>
          </li>
        )}
        {list.map((h, index) => (
          <li key={h.id} className="flex w-[76px] shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => h.stories.length && setOpen(index)}
              className="size-[68px] overflow-hidden rounded-full border-2 border-line bg-muted p-[2px] focus-visible:outline-2 focus-visible:outline-primary-light"
              aria-label={`Open highlight ${h.title}${own ? "" : ` from ${name}`}`}
            >
              {h.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- permission-checked media URL
                <img src={h.coverUrl} alt="" className="size-full rounded-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center rounded-full text-secondary">
                  <Icon name="image" size={20} />
                </span>
              )}
            </button>
            <span className="w-full truncate text-center text-xs text-body" aria-hidden="true">
              {h.title}
            </span>
          </li>
        ))}
      </ul>
      {own && list.length === 0 && <p className="text-sm text-secondary">Save stories to a highlight to keep them on your profile after 24 hours.</p>}

      {current && current.stories.length > 0 && (
        <StoryViewer
          groups={[{ key: current.id, author: current.stories[0]!.author, stories: current.stories, title: current.title }]}
          markViews={false}
          onClose={() => setOpen(null)}
          highlightActions={
            own
              ? {
                  onEdit: () => {
                    setOpen(null);
                    setEditing(current);
                  },
                  onDelete: () => {
                    setOpen(null);
                    setDeleting(current);
                  },
                }
              : undefined
          }
        />
      )}
      {editing && (
        <HighlightEditor
          highlight={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) =>
            setList((l) => (l.some((h) => h.id === saved.id) ? l.map((h) => (h.id === saved.id ? saved : h)) : [...l, saved]))
          }
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          confirmLabel="Delete highlight"
          danger
          onConfirm={async () => {
            await api(`/highlights/${deleting.id}`, { method: "DELETE" });
            setList((l) => l.filter((h) => h.id !== deleting.id));
          }}
          onClose={() => setDeleting(null)}
        >
          The stories stay in your archive for 30 days after they were shared.
        </ConfirmDialog>
      )}
    </section>
  );
}

/** Create or edit a highlight: a name and stories chosen from the last 30 days. */
function HighlightEditor({ highlight, onClose, onSaved }: { highlight: HighlightView | null; onClose: () => void; onSaved: (h: HighlightView) => void }) {
  const id = useId();
  const [title, setTitle] = useState(highlight?.title ?? "");
  const [stories, setStories] = useState<StoryView[] | null>(null);
  const [selected, setSelected] = useState<string[]>(highlight?.stories.map((s) => s.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<StoryView[]>("/stories/archive")
      .then((archive) => {
        if (!live) return;
        const extra = (highlight?.stories ?? []).filter((s) => !archive.some((a) => a.id === s.id));
        setStories([...archive, ...extra]);
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [highlight]);

  function toggle(storyId: string) {
    setSelected((list) => (list.includes(storyId) ? list.filter((x) => x !== storyId) : list.length >= HIGHLIGHT_STORIES_MAX ? list : [...list, storyId]));
  }

  async function save(from: HTMLElement) {
    if (!title.trim()) return setError("Give the highlight a name");
    if (!selected.length) return setError("Choose at least one story");
    setBusy(true);
    setError(null);
    try {
      const saved = highlight
        ? await api<HighlightView>(`/highlights/${highlight.id}`, { method: "PATCH", body: { title: title.trim(), storyIds: selected } })
        : await api<HighlightView>("/highlights", { method: "POST", body: { title: title.trim(), storyIds: selected } });
      onSaved(saved);
      from.closest("dialog")?.close();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={highlight ? "Edit highlight" : "New highlight"}
      description="Choose stories from the last 30 days. They stay on your profile until you remove them."
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={(e) => void save(e.currentTarget)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <label htmlFor={`${id}-title`} className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Name
        <input id={`${id}-title`} value={title} maxLength={HIGHLIGHT_TITLE_MAX_CHARS} onChange={(e) => setTitle(e.target.value)} className={inputClasses(false)} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {stories === null && !error && <p className="text-sm text-secondary">Loading your stories…</p>}
      {stories && stories.length === 0 && <p className="text-sm text-secondary">You haven’t shared any stories in the last 30 days.</p>}
      {stories && stories.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">
            Stories <span className="font-normal text-secondary">({selected.length} selected)</span>
          </legend>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {stories.map((s) => {
              const checked = selected.includes(s.id);
              const thumb = s.media.posterUrl ?? (s.media.kind === "image" ? s.media.url : null);
              return (
                <li key={s.id}>
                  <label className={cn("relative block aspect-[9/16] cursor-pointer overflow-hidden rounded-lg border-2 bg-ink", checked ? "border-primary" : "border-transparent")}>
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element -- permission-checked media URL
                      <img src={thumb} alt="" className="size-full object-cover" />
                    )}
                    <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} className="absolute start-2 top-2 size-4 accent-primary" aria-label={`${s.caption ?? (s.media.kind === "video" ? "Video" : "Photo")} story from ${new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`} />
                    {s.media.kind === "video" && <Icon name="video" size={14} className="absolute bottom-2 end-2 text-inverse" />}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </Dialog>
  );
}
