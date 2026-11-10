"use client";

import Link from "next/link";
import { useState } from "react";
import type { Page, TopicSummary } from "@chartermission/contracts";
import { Icon, Panel, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/components/social/errors";
import { relativeTime } from "@/components/social/format";
import { topicHref } from "@/components/social/links";
import { FOLLOWED_PAGE, LIST_PAGE } from "./explore-params";
import { FollowButton, useExploreNav, useSessionFollowed, useTopicFollow } from "./explore-state";

const n = (value: number) => value.toLocaleString("en-US");

/** Paginated GET /topics: keeps the first page from the server and appends "Load more" pages. */
function usePagedTopics(initial: Page<TopicSummary> | null, query: Record<string, string | number | undefined>) {
  const [extra, setExtra] = useState<TopicSummary[]>([]);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<TopicSummary>>("/topics", { query: { ...query, cursor } });
      setExtra((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const seen = new Set<string>();
  const items = [...(initial?.items ?? []), ...extra].filter((t) => (seen.has(t.tag) ? false : (seen.add(t.tag), true)));
  return { items, hasMore: Boolean(cursor), loading, error, loadMore };
}

function LoadMore({ hasMore, loading, error, onClick, label = "Load more topics" }: { hasMore: boolean; loading: boolean; error: string | null; onClick: () => void; label?: string }) {
  if (!hasMore && !error) return null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      {hasMore && (
        <button type="button" onClick={onClick} disabled={loading} className={buttonClasses({ variant: "secondary", size: "small" })}>
          {loading ? "Loading…" : error ? "Try again" : label}
        </button>
      )}
    </div>
  );
}

function HashTile({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-accent-light text-accent",
        size === "sm" ? "size-9 rounded-lg" : "size-11 rounded-[10px]",
      )}
    >
      <Icon name="hash" size={size === "sm" ? 18 : 22} />
    </span>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <Icon name="alert" size={22} className="text-error" />
      <p className="text-sm text-ink">{message}</p>
      <button type="button" onClick={onRetry} className="text-sm font-medium text-primary-light hover:underline">
        Try again
      </button>
    </div>
  );
}

/* ---------- Popular / New cards ---------- */

function TopicCard({ topic, list }: { topic: TopicSummary; list: "popular" | "new" }) {
  const { following, followers, busy, toggle } = useTopicFollow(topic);
  const started = relativeTime(topic.createdAt);
  return (
    <li className="flex flex-col gap-3 rounded-[10px] border border-line bg-card p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3">
        <HashTile />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-md font-medium text-ink">
            <Link href={topicHref(topic.tag)} className="hover:underline">
              #{topic.tag}
            </Link>
          </h3>
          <p className="truncate text-xs text-secondary">
            {n(topic.posts)} post{topic.posts === 1 ? "" : "s"} · {n(followers)} follower{followers === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <p className={cn("line-clamp-2 min-h-9 text-sm", topic.description ? "text-body" : "text-disabled")}>
        {topic.description ?? "No description yet."}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col text-xs text-secondary">
          <span className="truncate">
            <span className={topic.posts7d > 0 ? "font-semibold text-success" : undefined}>{n(topic.posts7d)}</span> post{topic.posts7d === 1 ? "" : "s"} this week
          </span>
          {list === "new" && (
            <span className="truncate">Started {started === "now" ? "just now" : /\d{4}$/.test(started) ? started : `${started} ago`}</span>
          )}
        </span>
        <FollowButton following={following} busy={busy} onToggle={toggle} tag={topic.tag} />
      </div>
    </li>
  );
}

const lists = [
  { value: "popular", label: "Popular" },
  { value: "new", label: "New" },
] as const;

/** "Popular topics" / "New topics" (GET /topics?sort=popular|new), switched via ?list=. */
export function DiscoverTopics({ list, initial, error }: { list: "popular" | "new"; initial: Page<TopicSummary> | null; error: string | null }) {
  const { go, refresh, pending } = useExploreNav();
  const paged = usePagedTopics(initial, { sort: list, limit: LIST_PAGE });
  return (
    <Panel aria-labelledby="discover-topics" className="flex flex-col gap-4 p-5 max-sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="discover-topics" className="text-h3 text-ink">
            {list === "popular" ? "Popular topics" : "New topics"}
          </h2>
          <p className="text-xs text-secondary">{list === "popular" ? "Most posted-about across the community" : "Hashtags members started most recently"}</p>
        </div>
        <SegmentedControl label="Topic list" items={lists} value={list} onChange={(value) => go({ list: value === "popular" ? null : value })} />
      </div>
      <div aria-live="polite" aria-busy={pending} className={cn("flex flex-col gap-4 transition-opacity", pending && "opacity-60")}>
        {error ? (
          <InlineError message={error} onRetry={refresh} />
        ) : paged.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-secondary">No topics yet. Add a #hashtag to a post to start one.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {paged.items.map((topic) => (
              <TopicCard key={topic.tag} topic={topic} list={list} />
            ))}
          </ul>
        )}
        <LoadMore hasMore={paged.hasMore} loading={paged.loading} error={paged.error} onClick={paged.loadMore} />
      </div>
    </Panel>
  );
}

/* ---------- Rows: search results and "Your topics" ---------- */

function TopicRow({ topic, detail }: { topic: TopicSummary; detail: boolean }) {
  const { following, followers, busy, toggle } = useTopicFollow(topic);
  return (
    <li className={cn("flex items-center gap-3", detail ? "px-5 py-3.5 max-sm:px-4" : "py-2.5")}>
      <HashTile size={detail ? "md" : "sm"} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={topicHref(topic.tag)} className="truncate text-sm font-medium text-ink hover:underline">
          #{topic.tag}
        </Link>
        {detail && topic.description && <p className="line-clamp-1 text-xs text-body">{topic.description}</p>}
        <p className="truncate text-xs text-secondary">
          {detail ? `${n(topic.posts)} post${topic.posts === 1 ? "" : "s"} · ` : ""}
          {n(topic.posts7d)} this week{detail ? ` · ${n(followers)} follower${followers === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <FollowButton following={following} busy={busy} onToggle={toggle} tag={topic.tag} />
    </li>
  );
}

/** Results for ?q= (GET /topics?q=), with "Load more". */
export function TopicSearchResults({ q, initial, error }: { q: string; initial: Page<TopicSummary> | null; error: string | null }) {
  const { refresh, pending, go } = useExploreNav();
  const paged = usePagedTopics(initial, { q, sort: "popular", limit: LIST_PAGE });
  const count = paged.items.length;
  return (
    <Panel aria-labelledby="topic-results" className={cn("flex flex-col transition-opacity", pending && "opacity-60")}>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4 max-sm:px-4">
        <h2 id="topic-results" className="min-w-0 truncate text-h3 text-ink">
          Topics matching “{q}”
        </h2>
        <p role="status" className="shrink-0 text-xs text-secondary">
          {error ? "" : `${count}${paged.hasMore ? "+" : ""} ${count === 1 ? "topic" : "topics"}`}
        </p>
      </div>
      <div className="border-t border-line">
        {error ? (
          <InlineError message={error} onRetry={refresh} />
        ) : count === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
              <Icon name="search" size={22} />
            </span>
            <p className="text-md font-medium text-ink">No topics match “{q}”</p>
            <p className="max-w-sm text-sm text-secondary">Check the spelling, or start the topic yourself: a hashtag becomes a topic once it’s used in a post.</p>
            <button type="button" onClick={() => go({ q: null })} className={buttonClasses({ variant: "secondary", size: "small", className: "mt-2" })}>
              Clear search
            </button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {paged.items.map((topic) => (
              <TopicRow key={topic.tag} topic={topic} detail />
            ))}
          </ul>
        )}
      </div>
      {paged.hasMore || paged.error ? (
        <div className="border-t border-line px-5 py-3">
          <LoadMore hasMore={paged.hasMore} loading={paged.loading} error={paged.error} onClick={paged.loadMore} label="More results" />
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * "Your topics" (GET /topics?sort=followed). Topics followed elsewhere on the page join the top of
 * the list; unfollowed ones stay (as "Follow") until the page reloads, so an unfollow can be undone.
 */
export function YourTopics({ id, initial, error, className }: { id: string; initial: Page<TopicSummary> | null; error: string | null; className?: string }) {
  const { refresh } = useExploreNav();
  const paged = usePagedTopics(initial, { sort: "followed", limit: FOLLOWED_PAGE });
  const session = useSessionFollowed();
  const listed = new Set(paged.items.map((t) => t.tag.toLowerCase()));
  const items = [...session.filter((t) => !listed.has(t.tag.toLowerCase())), ...paged.items];

  return (
    <Panel aria-labelledby={id} className={cn("flex flex-col gap-1 p-5 max-sm:p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-h3 text-ink">
          Your topics
        </h2>
        {items.length > 0 && <span className="text-xs text-secondary">{n(items.length)}{paged.hasMore ? "+" : ""} followed</span>}
      </div>
      {error ? (
        <InlineError message={error} onRetry={refresh} />
      ) : items.length === 0 ? (
        <p className="pt-1.5 text-sm text-secondary">You don’t follow any topics yet. Follow a few below and their posts will show up in your feed.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((topic) => (
            <TopicRow key={topic.tag} topic={topic} detail={false} />
          ))}
        </ul>
      )}
      {(paged.hasMore || paged.error) && (
        <div className="pt-2">
          <LoadMore hasMore={paged.hasMore} loading={paged.loading} error={paged.error} onClick={paged.loadMore} label="Show more" />
        </div>
      )}
    </Panel>
  );
}
