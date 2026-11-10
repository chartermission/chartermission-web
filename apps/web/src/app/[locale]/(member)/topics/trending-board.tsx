"use client";

import Link from "next/link";
import { useState } from "react";
import type { TrendingItem, TrendingWindow } from "@chartermission/contracts";
import { Icon, Panel, SegmentedControl, chipClasses, cn } from "@chartermission/ui";
import { topicHref } from "@/components/social/links";
import type { ScopeOption } from "./explore-params";
import { useExploreNav } from "./explore-state";

const windows = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

const INITIAL_ROWS = 10;

function Velocity({ pct, window }: { pct: number; window: TrendingWindow }) {
  const up = pct >= 0;
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums", up ? "text-success" : "text-error")}>
      <Icon name="trending" size={16} className={up ? undefined : "-scale-y-100"} />
      {up ? "+" : "−"}
      {Math.abs(pct).toLocaleString("en-US")}%<span className="sr-only"> vs. usual, {window === "24h" ? "last 24 hours" : "last 7 days"}</span>
    </span>
  );
}

function Row({ item, window }: { item: TrendingItem; window: TrendingWindow }) {
  return (
    <li>
      <Link href={topicHref(item.tag)} className="group flex items-center gap-3.5 px-5 py-3 hover:bg-primary-tint-2 max-sm:px-4">
        <span className={cn("w-6 shrink-0 text-center text-md font-semibold tabular-nums", item.rank <= 3 ? "text-accent" : "text-disabled")}>
          <span className="sr-only">Rank </span>
          {item.rank}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-md font-medium text-ink group-hover:underline">#{item.tag}</span>
            {item.pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-light px-2 py-0.5 text-xs font-medium text-info">
                <Icon name="pin" size={12} />
                Featured
              </span>
            )}
          </span>
          <span className="truncate text-xs text-secondary">
            <span className="max-sm:hidden">{item.context} · </span>
            {item.posts.toLocaleString("en-US")} post{item.posts === 1 ? "" : "s"} · {item.authors.toLocaleString("en-US")} member
            {item.authors === 1 ? "" : "s"}
          </span>
        </span>
        <Velocity pct={item.velocityPct} window={window} />
      </Link>
    </li>
  );
}

/**
 * "Trending now" (GET /trending, limit 20): 24h / 7d and Africa / country / chapter scopes, all
 * in the URL. Ranks, context, post and author counts, velocity and the featured (pinned) marker.
 */
export function TrendingBoard({
  items,
  window,
  scopes,
  active,
  updated,
  error,
}: {
  items: TrendingItem[];
  window: TrendingWindow;
  scopes: ScopeOption[];
  active: ScopeOption;
  /** "Updated 5m ago", computed on the server. */
  updated: string | null;
  error: string | null;
}) {
  const { go, refresh, pending } = useExploreNav();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, INITIAL_ROWS);
  const where = active.scope === "global" ? "across Africa" : `in ${active.label}`;
  const period = window === "24h" ? "in the last 24 hours" : "this week";

  return (
    <Panel aria-labelledby="trending-now" className="flex flex-col">
      <div className="flex flex-col gap-3 px-5 pb-3 pt-4 max-sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="trending-now" className="flex items-center gap-2 text-h3 text-ink">
              <Icon name="flame" size={20} className="text-accent" />
              Trending now
            </h2>
            <p className="text-xs text-secondary">
              Fastest-growing topics {where}
              {updated ? ` · ${updated}` : ""}
            </p>
          </div>
          <SegmentedControl
            label="Trending time window"
            items={windows}
            value={window}
            onChange={(value) => go({ window: value === "24h" ? null : value })}
          />
        </div>
        {scopes.length > 1 && (
          <div role="group" aria-label="Trending scope" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            {scopes.map((scope) => {
              const selected = scope.key === active.key;
              return (
                <button
                  key={scope.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => go({ scope: scope.scope === "global" ? null : scope.scope, scopeId: scope.scopeId })}
                  className={chipClasses(selected ? "active" : "filter", cn("cursor-pointer gap-1.5", !selected && "hover:border-line-strong hover:text-ink"))}
                >
                  <Icon name={scope.scope === "chapter" ? "users" : scope.scope === "country" ? "map-pin" : "globe"} size={14} />
                  {scope.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div aria-live="polite" aria-busy={pending} className={cn("border-t border-line transition-opacity", pending && "opacity-60")}>
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <Icon name="alert" size={22} className="text-error" />
            <p className="text-sm text-ink">{error}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={refresh} className="text-sm font-medium text-primary-light hover:underline">
                Try again
              </button>
              {active.scope !== "global" && (
                <button type="button" onClick={() => go({ scope: null, scopeId: null })} className="text-sm font-medium text-primary-light hover:underline">
                  See trending across Africa
                </button>
              )}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-accent-light text-accent">
              <Icon name="flame" size={22} />
            </span>
            <p className="text-md font-medium text-ink">Nothing is trending {where} {period}</p>
            <p className="max-w-sm text-sm text-secondary">Topics trend once several members post about them.{active.scope !== "global" ? " Try a wider scope" : ""}{active.scope !== "global" && window === "24h" ? " or" : window === "24h" ? " Try" : ""}{window === "24h" ? " the 7-day view" : ""}{active.scope !== "global" || window === "24h" ? "." : ""}</p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {active.scope !== "global" && (
                <button type="button" onClick={() => go({ scope: null, scopeId: null })} className={chipClasses("filter", "cursor-pointer hover:border-line-strong")}>
                  Trending across Africa
                </button>
              )}
              {window === "24h" && (
                <button type="button" onClick={() => go({ window: "7d" })} className={chipClasses("filter", "cursor-pointer hover:border-line-strong")}>
                  Show the last 7 days
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <ol aria-label={`Trending ${where}, ${period}`} className="flex flex-col divide-y divide-line py-1">
              {shown.map((item) => (
                <Row key={item.tag} item={item} window={window} />
              ))}
            </ol>
            {items.length > INITIAL_ROWS && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-center gap-1 rounded-b-card border-t border-line py-3 text-sm font-medium text-primary-light hover:bg-primary-tint-2"
              >
                {expanded ? "Show top 10 only" : `Show ${items.length - INITIAL_ROWS} more`}
                <Icon name="chevron-down" size={16} className={expanded ? "rotate-180" : undefined} />
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
