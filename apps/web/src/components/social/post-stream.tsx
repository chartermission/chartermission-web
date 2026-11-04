"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FeedNewResponse, Page, PostView } from "@chartermission/contracts";
import { Avatar, Icon, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { CaughtUpNote } from "@/components/illustrations";
import { staggerStyle } from "@/components/motion";
import { ErrorNotice } from "./errors";
import { PostCard } from "./post-card";
import { onPostCreated } from "./post-events";
import { PostSkeleton } from "./skeletons";
import { toast } from "./toast";
import type { Viewer } from "./viewer";

type Query = Record<string, string | number | boolean | undefined>;

/** Start loading the next page this far before the end of the list comes into view. */
const PREFETCH_MARGIN = "0px 0px 1200px 0px";
const POLL_MS = 60_000;
/** A focus event right after a visibility change shouldn't check twice. */
const MIN_CHECK_GAP_MS = 5_000;

/** How a card entered after the first render: from the pill / composer, or appended by scrolling. */
type Entrance = { kind: "arrive" | "more"; order: number; delay?: number };

function entranceProps(entrance: Entrance | undefined) {
  if (!entrance) return undefined;
  return entrance.kind === "arrive"
    ? { className: "motion-arrive", style: staggerStyle(entrance.order, { start: entrance.delay ?? 80, step: 70, max: 5 }) }
    : { className: "motion-fade-up", style: staggerStyle(entrance.order, { step: 45, max: 6 }) };
}

const newest = (posts: PostView[]) => posts.reduce<string | null>((max, p) => (!max || p.createdAt > max ? p.createdAt : max), null);

/**
 * Cursor-paginated list of posts from any endpoint that returns Page<PostView>
 * (GET /feed, /topics/{tag}/posts, /me/bookmarks). Server data comes in as `initial`.
 * The next page loads as the reader nears the end (a "Load more" button stays as the
 * keyboard/screen-reader and error fallback); each cursor is fetched once.
 * Without `initial` the first page loads on mount.
 *
 * With `newPostsPath` (the feed: "/feed/new"), it polls for newer posts every minute while
 * the tab is visible and offers a "See N new posts" pill that prepends them.
 */
export function PostStream({
  path,
  query,
  initial,
  viewer,
  empty,
  acceptNew = false,
  dropUnbookmarked = false,
  newPostsPath,
  label,
}: {
  path: string;
  query?: Query;
  initial?: Page<PostView>;
  viewer: Viewer;
  empty: ReactNode;
  /** Prepend posts the viewer creates while the list is open. */
  acceptNew?: boolean;
  /** Bookmarks page: drop a card when it is un-saved. */
  dropUnbookmarked?: boolean;
  /** Endpoint returning FeedNewResponse for `since` + the same query; enables the new-posts pill. */
  newPostsPath?: string;
  label: string;
}) {
  const [posts, setPosts] = useState<PostView[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial ? initial.nextCursor : null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<PostView[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [entrances, setEntrances] = useState<Record<string, Entrance>>({});
  const queryRef = useRef(query);
  const sectionRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  /** Cursor currently being fetched, and cursors already appended ("" = first page). */
  const inFlight = useRef<string | null>(null);
  const done = useRef(new Set<string>(initial ? [""] : []));
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  /** Focus a post's card (after "Load more" from the keyboard, or after the new-posts pill). */
  const focusPost = useCallback((id: string) => {
    const article = sectionRef.current?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(id)}"] article`);
    if (!article) return;
    article.tabIndex = -1;
    article.focus({ preventScroll: true });
  }, []);

  const load = useCallback(
    async (next: string | null) => {
      const key = next ?? "";
      if (inFlight.current !== null || done.current.has(key)) return;
      inFlight.current = key;
      const fromButton = !!next && document.activeElement === loadMoreRef.current;
      setLoading(true);
      setError(null);
      if (next) setAnnouncement("Loading more posts");
      try {
        const page = await api<Page<PostView>>(path, { query: { ...queryRef.current, cursor: next ?? undefined } });
        done.current.add(key);
        const shown = new Set(postsRef.current.map((p) => p.id));
        const added = page.items.filter((p) => !shown.has(p.id));
        setPosts((current) => {
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...page.items.filter((p) => !seen.has(p.id))];
        });
        if (next && added.length) {
          setEntrances((current) => ({ ...current, ...Object.fromEntries(added.map((p, order) => [p.id, { kind: "more", order } as Entrance])) }));
        }
        setCursor(page.nextCursor);
        if (next) {
          setAnnouncement(
            `${added.length === 1 ? "1 more post" : `${added.length} more posts`} loaded.${page.nextCursor ? "" : " You’re all caught up."}`,
          );
          const first = added[0];
          if (fromButton && first) requestAnimationFrame(() => focusPost(first.id));
        }
      } catch (e) {
        setError(e);
        setAnnouncement("");
      } finally {
        inFlight.current = null;
        setLoading(false);
      }
    },
    [path, focusPost],
  );

  // First page on mount when the server didn't provide one (e.g. a tab opened later).
  useEffect(() => {
    if (!done.current.has("")) void load(null);
  }, [load]);

  // Infinite scroll: a fresh observer per page, so a sentinel that is still in view after
  // a short page triggers the next one. Paused while loading and after an error.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursor || loading || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(cursor);
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loading, error, load]);

  useEffect(() => {
    if (!acceptNew) return;
    return onPostCreated((post) => {
      setCreated((current) => [post, ...current.filter((p) => p.id !== post.id)]);
      setEntrances((current) => ({ ...current, [post.id]: { kind: "arrive", order: 0 } }));
    });
  }, [acceptNew]);

  const createdIds = new Set(created.map((p) => p.id));
  const all = [...created, ...posts.filter((p) => !createdIds.has(p.id))];
  const remove = (post: PostView, scope: "post" | "author") => {
    const keep = (p: PostView) => p.id !== post.id && !(scope === "author" && p.author.id === post.author.id);
    setPosts((current) => current.filter(keep));
    setCreated((current) => current.filter(keep));
  };

  /** Prepend the first page's new posts (from the pill), scroll to the top of the list and focus the first one. */
  const showNew = useCallback(
    async (since: string) => {
      const page = await api<Page<PostView>>(path, { query: { ...queryRef.current } });
      const shown = new Set(postsRef.current.map((p) => p.id));
      const unseen = page.items.filter((p) => !shown.has(p.id));
      const fresh = unseen.filter((p) => p.createdAt > since);
      // Ranked tabs can place new posts below older unseen ones; fall back to what's unseen.
      const added = fresh.length ? fresh : unseen;
      const addedIds = new Set(added.map((p) => p.id));
      setPosts((current) => [...added, ...current.filter((p) => !addedIds.has(p.id))]);
      const section = sectionRef.current;
      const top = section ? Math.max(0, section.getBoundingClientRect().top + window.scrollY - 88) : 0;
      // Let a long smooth scroll mostly finish before the cards slide in.
      const delay = Math.round(Math.min(450, 80 + Math.abs(window.scrollY - top) / 6));
      setEntrances((current) => ({ ...current, ...Object.fromEntries(added.map((p, order) => [p.id, { kind: "arrive", order, delay } as Entrance])) }));
      const first = added[0];
      setAnnouncement(added.length ? `${added.length === 1 ? "1 new post" : `${added.length} new posts`} added to the top of the feed` : "No new posts");
      if (section) {
        window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      if (first) requestAnimationFrame(() => focusPost(first.id));
      return added.length;
    },
    [path, focusPost],
  );

  const since = newest(posts);

  return (
    <section ref={sectionRef} aria-label={label} aria-busy={loading} className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {newPostsPath && <NewPostsPill path={newPostsPath} query={query} since={since} onShow={showNew} />}
      {all.map((post) => (
        <div key={post.id} data-post-id={post.id} {...entranceProps(entrances[post.id])}>
          <PostCard
            post={post}
            viewer={viewer}
            onRemoved={remove}
            onBookmarkChange={dropUnbookmarked ? (p, saved) => !saved && setPosts((current) => current.filter((x) => x.id !== p.id)) : undefined}
          />
        </div>
      ))}
      {loading && (
        <>
          {all.length === 0 && (
            <p role="status" className="sr-only">
              Loading posts
            </p>
          )}
          <PostSkeleton />
          {all.length === 0 && <PostSkeleton />}
        </>
      )}
      {!loading && error ? <ErrorNotice error={error} onRetry={() => load(cursor)} /> : null}
      {!loading && !error && all.length === 0 && empty}
      {cursor && !error && all.length > 0 && (
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
      {!loading && !error && !cursor && all.length > 0 && (
        <CaughtUpNote>You’ve seen every post here. New ones will show up at the top.</CaughtUpNote>
      )}
    </section>
  );
}

/**
 * Floating "See N new posts" pill, sticky under the top nav. Polls `path` every minute
 * (and when the tab becomes visible or focused) while the document is visible.
 */
function NewPostsPill({
  path,
  query,
  since: newestShown,
  onShow,
}: {
  path: string;
  query?: Query;
  since: string | null;
  onShow: (since: string) => Promise<number>;
}) {
  const [result, setResult] = useState<FeedNewResponse & { since: string }>({ count: 0, authors: [], since: "" });
  const [busy, setBusy] = useState(false);
  // An empty list counts from when it was opened.
  const [openedAt] = useState(() => new Date().toISOString());
  const since = newestShown ?? openedAt;
  const queryRef = useRef(query);
  const lastCheck = useRef(0);
  const sinceRef = useRef(since);
  useEffect(() => {
    sinceRef.current = since;
  }, [since]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let controller: AbortController | undefined;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck.current < MIN_CHECK_GAP_MS) return;
      lastCheck.current = Date.now();
      controller?.abort();
      controller = new AbortController();
      const asked = sinceRef.current;
      try {
        const next = await api<FeedNewResponse>(path, { query: { ...queryRef.current, since: asked }, signal: controller.signal });
        setResult({ ...next, since: asked });
      } catch {
        // Polling is best-effort; the next tick tries again.
      }
    };
    const start = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") timer = setInterval(check, POLL_MS);
    };
    const onVisibility = () => {
      start();
      void check();
    };
    const onFocus = () => void check();
    lastCheck.current = Date.now(); // the page was just rendered with fresh data
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [path]);

  async function show() {
    if (busy) return;
    setBusy(true);
    try {
      await onShow(since);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  // A count is only for the `since` it was asked with; newer posts on screen reset it.
  const { count, authors } = result.since === since ? result : { count: 0, authors: [] };
  const text = `See ${count > 99 ? "99+" : count} new post${count === 1 ? "" : "s"}`;
  return (
    // Zero-height sticky row: the pill floats over the list and the -mb cancels the list gap.
    <div className="pointer-events-none sticky top-[92px] z-20 -mb-4 flex h-0 justify-center">
      <p className="sr-only" aria-live="polite">
        {count > 0 ? `${count} new post${count === 1 ? "" : "s"} available` : ""}
      </p>
      {count > 0 && (
        <button
          type="button"
          onClick={show}
          aria-busy={busy}
          className="pointer-events-auto flex h-10 -translate-y-4 items-center gap-2 rounded-full bg-primary py-1 pl-1.5 pr-4 text-sm font-medium text-inverse shadow-[0px_6px_16px_0px_rgba(25,37,80,0.28)] transition-colors hover:bg-primary-light"
        >
          {authors.length > 0 ? (
            <span className="flex -space-x-2" aria-hidden="true">
              {authors.slice(0, 3).map((author) => (
                <Avatar key={author.id} name={author.name} src={author.avatarUrl ?? undefined} tone={author.tone} size={32} className="ring-2 ring-primary" />
              ))}
            </span>
          ) : (
            <span className="flex size-8 items-center justify-center" aria-hidden="true">
              <Icon name="chevron-down" size={18} className="rotate-180" />
            </span>
          )}
          <span>{busy ? "Loading…" : text}</span>
          {authors.length > 0 && <Icon name="chevron-down" size={16} className="rotate-180" />}
        </button>
      )}
    </div>
  );
}
