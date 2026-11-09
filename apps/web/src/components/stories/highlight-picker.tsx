"use client";

import { useEffect, useId, useState } from "react";
import { HIGHLIGHT_TITLE_MAX_CHARS, type HighlightView, type StoryView } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { Dialog } from "@/components/social/dialog";
import { errorMessage } from "@/components/social/error-message";
import { inputClasses } from "@/components/auth/fields";

/** "Add to highlight" from the story viewer: pick one of your highlights or start a new one. */
export function HighlightPicker({ story, onClose, onAdded }: { story: StoryView; onClose: () => void; onAdded: (highlightId: string) => void }) {
  const id = useId();
  const [highlights, setHighlights] = useState<HighlightView[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<HighlightView[]>("/highlights", { query: { member: story.author.id } })
      .then((list) => live && setHighlights(list))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [story.author.id]);

  async function addTo(highlight: HighlightView) {
    setBusy(highlight.id);
    setError(null);
    try {
      const updated = await api<HighlightView>(`/highlights/${highlight.id}/stories`, { method: "POST", body: { storyId: story.id } });
      setHighlights((list) => list?.map((h) => (h.id === updated.id ? updated : h)) ?? null);
      onAdded(updated.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!title.trim()) return setError("Give the highlight a name");
    setBusy("new");
    setError(null);
    try {
      const created = await api<HighlightView>("/highlights", { method: "POST", body: { title: title.trim(), storyIds: [story.id] } });
      setHighlights((list) => [...(list ?? []), created]);
      setTitle("");
      onAdded(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog title="Add to highlight" description="Highlights stay on your profile after the story’s 24 hours are up." onClose={onClose} width={440}>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {highlights === null && !error && <p className="text-sm text-secondary">Loading your highlights…</p>}
      {highlights && highlights.length > 0 && (
        <ul className="flex flex-col gap-2">
          {highlights.map((h) => {
            const added = h.stories.some((s) => s.id === story.id);
            return (
              <li key={h.id} className="flex items-center gap-3">
                <span className="size-10 shrink-0 overflow-hidden rounded-full bg-muted">
                  {h.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- permission-checked media URL
                    <img src={h.coverUrl} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{h.title}</span>
                  <span className="text-xs text-secondary">
                    {h.stories.length} {h.stories.length === 1 ? "story" : "stories"}
                  </span>
                </span>
                {added ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Icon name="check" size={14} />
                    Added
                  </span>
                ) : (
                  <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => addTo(h)}>
                    {busy === h.id ? "Adding…" : "Add"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink" htmlFor={`${id}-title`}>
          New highlight
          <input
            id={`${id}-title`}
            value={title}
            maxLength={HIGHLIGHT_TITLE_MAX_CHARS}
            placeholder="e.g. Lagos meetup"
            onChange={(e) => setTitle(e.target.value)}
            className={inputClasses(false)}
          />
        </label>
        <Button type="submit" disabled={busy !== null}>
          {busy === "new" ? "Creating…" : "Create"}
        </Button>
      </form>
    </Dialog>
  );
}
