"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCHEDULE_MAX_DAYS, type DraftView, type Page, type PostView } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { writeArticleHref } from "@/components/articles/write-article";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { announcePostCreated } from "@/components/social/post-events";
import { EmptyState, PanelSkeleton } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { api } from "@/lib/api/client";
import { DraftCard, type DraftAction } from "./draft-card";
import { announceDraftsChanged } from "./drafts-events";

export type DraftsTab = "drafts" | "scheduled";
type Counts = { drafts: number; scheduled: number };

const PREFETCH_MARGIN = "0px 0px 800px 0px";
const tabOf = (draft: DraftView): DraftsTab => (draft.status === "draft" ? "drafts" : "scheduled");
const countKey = (tab: DraftsTab): keyof Counts => tab;

/** Drafts / Scheduled tabs as links (?tab=scheduled), styled like the feed's segmented control. */
function Tabs({ tab, counts }: { tab: DraftsTab; counts: Counts }) {
  const items: { value: DraftsTab; label: string; href: string }[] = [
    { value: "drafts", label: "Drafts", href: "/drafts" },
    { value: "scheduled", label: "Scheduled", href: "/drafts?tab=scheduled" },
  ];
  return (
    <nav aria-label="Drafts and scheduled posts" className="inline-flex items-start gap-1 self-start rounded-[10px] bg-muted p-1">
      {items.map((item) => {
        const selected = item.value === tab;
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3.5 py-1.5 text-sm transition-colors",
              selected ? "bg-card font-medium text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
            )}
          >
            {item.label}
            <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs font-medium", selected ? "bg-primary-tint text-primary" : "bg-card text-secondary")}>
              {counts[countKey(item.value)]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * /drafts — the member's drafts and scheduled posts (GET /me/drafts), cursor-paginated with
 * the same infinite-scroll pattern as the feed. Edit opens the composer on the draft;
 * Publish now, Unschedule and Delete act in place.
 */
export function DraftsView({ tab, initial, counts: initialCounts, viewer }: { tab: DraftsTab; initial: Page<DraftView>; counts: Counts; viewer: Viewer }) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [counts, setCounts] = useState(initialCounts);
  const [busy, setBusy] = useState<{ id: string; action: DraftAction } | null>(null);
  const [editing, setEditing] = useState<{ key: number; draft: DraftView | null } | null>(null);
  const [deleting, setDeleting] = useState<DraftView | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inFlight = useRef(false);
  const done = useRef(new Set<string>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const load = useCallback(
    async (next: string) => {
      if (inFlight.current || done.current.has(next)) return;
      inFlight.current = true;
      const fromButton = document.activeElement === loadMoreRef.current;
      setLoading(true);
      setError(null);
      setAnnouncement("Loading more");
      try {
        const page = await api<Page<DraftView>>("/me/drafts", { query: { status: tab === "drafts" ? "draft" : "scheduled", cursor: next } });
        done.current.add(next);
        const shown = new Set(itemsRef.current.map((d) => d.id));
        const added = page.items.filter((d) => !shown.has(d.id));
        setItems((current) => {
          const seen = new Set(current.map((d) => d.id));
          return [...current, ...page.items.filter((d) => !seen.has(d.id))];
        });
        setCursor(page.nextCursor);
        setAnnouncement(`${added.length} more loaded.${page.nextCursor ? "" : " That’s everything."}`);
        const first = added[0];
        if (fromButton && first) {
          requestAnimationFrame(() => {
            const article = listRef.current?.querySelector<HTMLElement>(`[data-draft-id="${CSS.escape(first.id)}"] article`);
            if (article) {
              article.tabIndex = -1;
              article.focus({ preventScroll: true });
            }
          });
        }
      } catch (e) {
        setError(e);
        setAnnouncement("");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursor || loading || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(cursor), { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loading, error, load]);

  /** Drop a draft from this tab (published, deleted or moved to the other tab). */
  function drop(id: string, movedTo?: DraftsTab) {
    setItems((current) => current.filter((d) => d.id !== id));
    setCounts((current) => {
      const next = { ...current, [countKey(tab)]: Math.max(0, current[countKey(tab)] - 1) };
      if (movedTo) next[countKey(movedTo)] += 1;
      return next;
    });
    announceDraftsChanged();
  }

  /** Latest saved version of the draft open in the composer (null for a new post until it's saved). */
  const editingRef = useRef<DraftView | null>(null);

  /** The composer saved, scheduled, unscheduled, discarded or published the draft it has open. */
  function sync(next: DraftView | null) {
    const previous = editingRef.current;
    editingRef.current = next;
    if (!previous && !next) return;
    setCounts((current) => {
      const updated = { ...current };
      if (previous) updated[countKey(tabOf(previous))] = Math.max(0, updated[countKey(tabOf(previous))] - 1);
      if (next) updated[countKey(tabOf(next))] += 1;
      return updated;
    });
    const id = next?.id ?? previous?.id;
    setItems((current) => {
      const without = current.filter((d) => d.id !== id);
      if (!next || tabOf(next) !== tab) return without;
      // Drafts: newest edit first. Scheduled: soonest first.
      if (tab === "drafts") return [next, ...without];
      return [...without, next].sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
    });
    announceDraftsChanged();
  }

  function openComposer(draft: DraftView | null) {
    editingRef.current = draft;
    // Article drafts open on the writing page; everything else in the composer dialog.
    if (draft?.payload.type === "article") {
      router.push(writeArticleHref(draft.id));
      return;
    }
    setEditing((current) => ({ key: (current?.key ?? 0) + 1, draft }));
  }

  function posted(post: PostView) {
    announcePostCreated(post);
    toast.success(post.status === "pending_media" ? "Posted. Your files are being checked; others will see the post once that finishes." : "Your post is live");
  }

  async function act(draft: DraftView, action: DraftAction) {
    if (action === "edit") return openComposer(draft);
    if (action === "delete") return setDeleting(draft);
    setBusy({ id: draft.id, action });
    try {
      if (action === "publish") {
        const post = await api<PostView>(`/me/drafts/${draft.id}/publish`, { method: "POST" });
        drop(draft.id);
        posted(post);
      } else {
        await api<DraftView>(`/me/drafts/${draft.id}`, { method: "PATCH", body: { payload: draft.payload, scheduledFor: null } });
        drop(draft.id, "drafts");
        toast.success("Unscheduled. The post is back in your drafts.");
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const noun = tab === "drafts" ? "draft" : "scheduled post";

  return (
    <>
      <Tabs tab={tab} counts={counts} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {items.length === 0 && !loading ? (
        tab === "drafts" ? (
          <EmptyState
            icon="send"
            title="No drafts"
            actions={
              <Button size="small" onClick={() => openComposer(null)}>
                Start a post
              </Button>
            }
          >
            Save a post as a draft from the composer and finish it later. Only you can see your drafts.
          </EmptyState>
        ) : (
          <EmptyState
            icon="clock"
            title="Nothing scheduled"
            actions={
              counts.drafts > 0 ? (
                <Link href="/drafts" className="text-sm font-medium text-primary-light hover:underline">
                  Schedule one of your drafts
                </Link>
              ) : undefined
            }
          >
            Choose a date and time in the composer to publish a post later, up to {SCHEDULE_MAX_DAYS} days ahead. It appears here until it goes live.
          </EmptyState>
        )
      ) : (
        <ul ref={listRef} aria-label={tab === "drafts" ? "Drafts" : "Scheduled posts"} className="flex flex-col gap-4">
          {items.map((draft) => (
            <li key={draft.id} data-draft-id={draft.id}>
              <DraftCard draft={draft} busy={busy?.id === draft.id ? busy.action : null} onAction={(action) => act(draft, action)} />
            </li>
          ))}
        </ul>
      )}

      {loading && <PanelSkeleton className="h-[160px]" lines={2} />}
      {!loading && error ? <ErrorNotice error={error} onRetry={() => cursor && load(cursor)} /> : null}
      {cursor && !error && items.length > 0 && (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="-mt-4 h-0" />
          <button
            ref={loadMoreRef}
            type="button"
            aria-disabled={loading}
            onClick={() => !loading && load(cursor)}
            className={buttonClasses({ variant: "secondary", block: true, className: cn(loading && "cursor-progress opacity-60") })}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </>
      )}
      {!cursor && items.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 py-2 text-center text-xs text-secondary">
          <Icon name="check" size={14} />
          {items.length === 1 ? `1 ${noun}` : `${items.length} ${noun}s`}
          {tab === "scheduled" ? " · times shown in your time zone" : ""}
        </p>
      )}

      {editing && (
        <CreatePostDialog
          key={editing.key}
          viewer={viewer}
          draft={editing.draft ?? undefined}
          onDraftChange={sync}
          onClose={() => setEditing(null)}
          onPosted={(post) => {
            sync(null);
            posted(post);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={deleting.status === "draft" ? "Delete this draft?" : "Delete this scheduled post?"}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/me/drafts/${deleting.id}`, { method: "DELETE" });
            drop(deleting.id);
            toast.success(deleting.status === "draft" ? "Draft deleted" : "Scheduled post deleted");
          }}
        >
          <p className="text-sm text-body">
            “{deleting.preview}” will be deleted{deleting.status !== "draft" ? " and won’t be published" : ""}. You can’t undo this.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
