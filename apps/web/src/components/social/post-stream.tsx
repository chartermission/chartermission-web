"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Page, PostView } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ErrorNotice } from "./errors";
import { PostCard } from "./post-card";
import { onPostCreated } from "./post-events";
import { PostSkeleton } from "./skeletons";
import type { Viewer } from "./viewer";

type Query = Record<string, string | number | boolean | undefined>;

/**
 * Cursor-paginated list of posts from any endpoint that returns Page<PostView>
 * (GET /feed, /topics/{tag}/posts, /me/bookmarks). Server data comes in as `initial`;
 * "Load more" appends the next page. Without `initial` the first page loads on mount.
 */
export function PostStream({
  path,
  query,
  initial,
  viewer,
  empty,
  acceptNew = false,
  dropUnbookmarked = false,
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
  label: string;
}) {
  const [posts, setPosts] = useState<PostView[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial ? initial.nextCursor : null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<PostView[]>([]);
  const queryRef = useRef(query);

  async function load(next: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<PostView>>(path, { query: { ...queryRef.current, cursor: next ?? undefined } });
      setPosts((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  // First page on mount when the server didn't provide one (e.g. a tab opened later).
  const loadedOnce = useRef(!!initial);
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per mount; parents remount with a key to change query
  }, []);

  useEffect(() => {
    if (!acceptNew) return;
    return onPostCreated((post) => setCreated((current) => [post, ...current.filter((p) => p.id !== post.id)]));
  }, [acceptNew]);

  const createdIds = new Set(created.map((p) => p.id));
  const all = [...created, ...posts.filter((p) => !createdIds.has(p.id))];
  const remove = (post: PostView, scope: "post" | "author") => {
    const keep = (p: PostView) => p.id !== post.id && !(scope === "author" && p.author.id === post.author.id);
    setPosts((current) => current.filter(keep));
    setCreated((current) => current.filter(keep));
  };

  return (
    <section aria-label={label} aria-busy={loading} className="flex flex-col gap-4">
      {all.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          viewer={viewer}
          onRemoved={remove}
          onBookmarkChange={dropUnbookmarked ? (p, saved) => !saved && setPosts((current) => current.filter((x) => x.id !== p.id)) : undefined}
        />
      ))}
      {loading && (
        <>
          <p role="status" className="sr-only">
            Loading posts
          </p>
          <PostSkeleton />
          {all.length === 0 && <PostSkeleton />}
        </>
      )}
      {!loading && error ? <ErrorNotice error={error} onRetry={() => load(cursor)} /> : null}
      {!loading && !error && all.length === 0 && empty}
      {!loading && !error && cursor && (
        <Button variant="secondary" block onClick={() => load(cursor)}>
          Load more
        </Button>
      )}
      {!loading && !error && !cursor && all.length > 0 && <p className="py-2 text-center text-xs text-secondary">You’re all caught up</p>}
    </section>
  );
}
