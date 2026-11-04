"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ArticleSort, ArticlesHub, Page, PostView } from "@chartermission/contracts";
import { Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { CaughtUpNote } from "@/components/illustrations";
import { staggerStyle } from "@/components/motion";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import type { Viewer } from "@/components/social/viewer";
import { ArticleCard, ArticleCardSkeleton, articleGridClass } from "./article-card";
import { ARTICLES_PAGE } from "./format";
import { WriteArticleButton } from "./write-article-button";

const PREFETCH_MARGIN = "0px 0px 800px 0px";

const sorts = [
  { value: "latest", label: "Latest" },
  { value: "popular", label: "Popular" },
] as const satisfies readonly { value: ArticleSort; label: string }[];

type Topic = ArticlesHub["topics"][number];

/** Cursor-paginated grid for one sort + tag. Remounted (keyed) when either changes. */
function ArticleGrid({
  initial,
  sort,
  tag,
  viewer,
  onClear,
}: {
  initial: Page<PostView>;
  sort: ArticleSort;
  tag: string | null;
  viewer: Viewer;
  onClear: () => void;
}) {
  const [posts, setPosts] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const [added, setAdded] = useState<Record<string, number>>({});
  const inFlight = useRef(false);
  const done = useRef(new Set<string>());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (next: string) => {
      if (inFlight.current || done.current.has(next)) return;
      inFlight.current = true;
      const fromButton = document.activeElement === loadMoreRef.current;
      setLoading(true);
      setError(null);
      setAnnouncement("Loading more articles");
      try {
        const page = await api<Page<PostView>>("/articles", { query: { sort, tag: tag ?? undefined, cursor: next, limit: ARTICLES_PAGE } });
        done.current.add(next);
        setPosts((current) => {
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setAdded((current) => ({ ...current, ...Object.fromEntries(page.items.map((p, order) => [p.id, order])) }));
        setCursor(page.nextCursor);
        const count = page.items.length;
        setAnnouncement(`${count === 1 ? "1 more article" : `${count} more articles`} loaded.${page.nextCursor ? "" : " That’s every article."}`);
        const first = page.items[0];
        if (fromButton && first) {
          requestAnimationFrame(() => gridRef.current?.querySelector<HTMLAnchorElement>(`[data-article-id="${CSS.escape(first.id)}"] h3 a`)?.focus());
        }
      } catch (e) {
        setError(e);
        setAnnouncement("");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [sort, tag],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursor || loading || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(cursor), { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loading, error, load]);

  if (!posts.length) {
    return tag ? (
      <EmptyState icon="search" title={`No articles tagged #${tag} yet`} actions={
        <button type="button" onClick={onClear} className={buttonClasses({ variant: "secondary", size: "small" })}>
          Show all articles
        </button>
      }>
        Articles carry the hashtags their authors add. Try another topic, or write the first one.
      </EmptyState>
    ) : (
      <EmptyState icon="message" title="No articles yet" actions={<WriteArticleButton viewer={viewer} size="small" label="Write the first article" />}>
        Long-form posts from members will appear here. Share a guide, a field report or lessons learned.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ul ref={gridRef} className={articleGridClass}>
        {posts.map((post) => (
          <li
            key={post.id}
            data-article-id={post.id}
            className={post.id in added ? "motion-fade-up" : undefined}
            style={post.id in added ? staggerStyle(added[post.id]!, { step: 50, max: 6 }) : undefined}
          >
            <ArticleCard post={post} />
          </li>
        ))}
        {loading &&
          [0, 1, 2].map((i) => (
            <li key={`skeleton-${i}`} className={i > 0 ? "max-sm:hidden" : undefined}>
              <ArticleCardSkeleton />
            </li>
          ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div ref={sentinelRef} aria-hidden="true" />
      {error ? (
        <ErrorNotice error={error} onRetry={() => cursor && void load(cursor)} />
      ) : cursor ? (
        <div className="flex justify-center">
          <button
            ref={loadMoreRef}
            type="button"
            disabled={loading}
            onClick={() => void load(cursor)}
            className={buttonClasses({ variant: "secondary", size: "small" })}
          >
            {loading ? "Loading…" : "Load more articles"}
          </button>
        </div>
      ) : (
        posts.length > ARTICLES_PAGE && <CaughtUpNote title="That’s every article">Come back soon for new writing from members.</CaughtUpNote>
      )}
    </div>
  );
}

/**
 * All articles: topic chips (?tag=) and Latest / Popular (?sort=) in the URL, then a
 * three-column grid that loads more as the reader scrolls.
 */
export function ArticleBrowser({
  initial,
  error,
  sort,
  tag,
  topics,
  viewer,
}: {
  initial: Page<PostView> | null;
  /** Why the first page failed, when `initial` is null. */
  error?: string | null;
  sort: ArticleSort;
  tag: string | null;
  topics: Topic[];
  viewer: Viewer;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<{ sort: ArticleSort; tag: string | null }>({ sort, tag });
  const shown = pending ? target : { sort, tag };

  function go(next: { sort: ArticleSort; tag: string | null }) {
    setTarget(next);
    const params = new URLSearchParams();
    if (next.tag) params.set("tag", next.tag);
    if (next.sort !== "latest") params.set("sort", next.sort);
    const qs = params.toString();
    startTransition(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  const chips: Topic[] = tag && !topics.some((t) => t.tag.toLowerCase() === tag.toLowerCase()) ? [{ tag, articles: 0 }, ...topics] : topics;
  const isActive = (t: string) => shown.tag?.toLowerCase() === t.toLowerCase();
  const heading = `${shown.sort === "popular" ? "Popular" : "Latest"} articles${shown.tag ? ` on #${shown.tag}` : ""}`;

  return (
    <section aria-labelledby="all-articles" id="all" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="all-articles" className="text-h2 text-ink max-sm:text-h3">
            {heading}
          </h2>
          <p className="text-sm text-secondary">
            {shown.sort === "popular" ? "The most reacted-to and discussed articles of the last 30 days." : "Newest first, from members across the network."}
          </p>
        </div>
        <SegmentedControl label="Sort articles" items={sorts} value={shown.sort} onChange={(value) => go({ sort: value, tag: shown.tag })} />
      </div>

      {chips.length > 0 && (
        <div role="group" aria-label="Filter by topic" className="flex items-center gap-2 max-sm:-mx-3 max-sm:overflow-x-auto max-sm:px-3 max-sm:pb-1 sm:flex-wrap">
          <button
            type="button"
            aria-pressed={!shown.tag}
            onClick={() => go({ sort: shown.sort, tag: null })}
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-3 py-[5px] text-sm font-medium whitespace-nowrap transition-colors",
              !shown.tag ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-primary-tint-2",
            )}
          >
            All topics
          </button>
          {chips.map((topic) => {
            const active = isActive(topic.tag);
            return (
              <button
                key={topic.tag}
                type="button"
                aria-pressed={active}
                onClick={() => go({ sort: shown.sort, tag: active ? null : topic.tag })}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-[5px] text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-primary-tint-2",
                )}
              >
                #{topic.tag}
                {topic.articles > 0 && <span className={cn("text-xs", active ? "text-inverse/75" : "text-secondary")}>{topic.articles}</span>}
                {active && <Icon name="x" size={14} />}
                {active && <span className="sr-only">(selected, press to clear)</span>}
              </button>
            );
          })}
        </div>
      )}

      <div aria-busy={pending} className={cn("transition-opacity", pending && "pointer-events-none opacity-60")}>
        {initial ? (
          <ArticleGrid key={`${sort}:${tag ?? ""}`} initial={initial} sort={sort} tag={tag} viewer={viewer} onClear={() => go({ sort: shown.sort, tag: null })} />
        ) : (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error-light px-3 py-2.5 text-sm">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-error" />
            <p className="flex-1 text-ink">Articles couldn’t load. {error}</p>
            <button type="button" onClick={() => startTransition(() => router.refresh())} className="shrink-0 rounded-sm font-medium text-primary-light hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? `Loading ${heading.toLowerCase()}` : ""}
      </p>
    </section>
  );
}

/** Placeholder for the list while the first page loads. */
export function ArticleBrowserSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <span className="motion-shimmer block h-7 w-48 rounded" />
        <span className="motion-shimmer block h-9 w-40 rounded-[10px]" />
      </div>
      <div className="flex gap-2">
        {[64, 96, 80, 104, 72].map((w, i) => (
          <span key={i} className="motion-shimmer block h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <div className={articleGridClass}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
            <ArticleCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
