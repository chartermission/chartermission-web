"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import type { TrendingResponse, TrendingWindow } from "@chartermission/contracts";
import { Divider, Icon, Panel, SegmentedControl, TrendingItem, chipClasses } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { errorMessage } from "./social/errors";
import { topicHref } from "./social/links";
import { exploreHref } from "@/app/[locale]/(member)/topics/explore-params";
import { useT } from "@/i18n/client";

const windows = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

type Scope = { key: string; label: string; scope: "global" | "country"; scopeId?: string };

/**
 * Trending topics (GET /trending) with a time window and an Africa / my-country scope switch.
 * Each item shows the API's context label ("Trending in Nigeria"). "Show more topics" opens the
 * explore page (/topics) on the same window and scope.
 */
export function TrendingTopics({
  initial,
  country,
}: {
  initial: TrendingResponse | null;
  /** The viewer's country, for the second scope. */
  country: { code: string; name: string } | null;
}) {
  const t = useT();
  const scopes: Scope[] = [
    { key: "global", label: "Africa", scope: "global" },
    ...(country ? [{ key: country.code, label: country.name, scope: "country" as const, scopeId: country.code }] : []),
  ];
  const [window, setWindow] = useState<TrendingWindow>("24h");
  const [scope, setScope] = useState<Scope>(scopes[0]!);
  const [data, setData] = useState<TrendingResponse | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : "Trending topics are unavailable right now.");

  async function load(nextScope: Scope, nextWindow: TrendingWindow) {
    setScope(nextScope);
    setWindow(nextWindow);
    setLoading(true);
    setError(null);
    try {
      setData(
        await api<TrendingResponse>("/trending", {
          query: { scope: nextScope.scope, scopeId: nextScope.scopeId, window: nextWindow, limit: 5 },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <Panel aria-labelledby="trending-heading" className="flex flex-col gap-1 p-5">
      <div className="flex items-center justify-between">
        <h2 id="trending-heading" className="flex items-center gap-2 text-h3 text-ink">
          <Icon name="flame" size={20} className="text-accent" />
          Trending topics
        </h2>
        <SegmentedControl size="small" label="Time window" items={windows} value={window} onChange={(value) => load(scope, value)} />
      </div>
      {scopes.length > 1 && (
        <div className="flex gap-1.5 pb-1.5 pt-2.5" role="group" aria-label="Trending scope">
          {scopes.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.key === scope.key}
              onClick={() => load(item, window)}
              className={chipClasses(item.key === scope.key ? "active" : "filter", "cursor-pointer")}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div aria-live="polite" aria-busy={loading} className={loading ? "opacity-60" : undefined}>
        {error ? (
          <p className="flex items-center justify-between gap-2 py-3 text-sm text-secondary">
            {error}
            <button type="button" onClick={() => load(scope, window)} className="font-medium text-primary-light hover:underline">
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="py-3 text-sm text-secondary">
            {scope.scope === "country" ? t("Nothing is trending in {label} yet.", { label: scope.label }) : "Nothing is trending yet."} Topics appear here once several
            members post about them.
          </p>
        ) : (
          <ol>
            {items.map((topic, index) => (
              <Fragment key={topic.tag}>
                {index > 0 && <Divider />}
                <li>
                  <TrendingItem
                    rank={topic.rank}
                    tag={topic.tag}
                    context={topic.pinned ? t("{context} · Featured", { context: topic.context }) : topic.context}
                    stats={`${t("{count} posts", { count: topic.posts })} · ${topic.velocityPct >= 0 ? "+" : ""}${topic.velocityPct}% ${window === "24h" ? t("today") : t("this week")}`}
                    href={topicHref(topic.tag)}
                    linkAs={Link}
                  />
                </li>
              </Fragment>
            ))}
          </ol>
        )}
      </div>
      <Divider />
      <Link
        href={exploreHref({ window, scope: scope.scope, scopeId: scope.scopeId })}
        className="-mb-1 flex items-center justify-center gap-1 rounded-md pt-2.5 text-sm font-medium text-primary-light hover:underline"
      >
        Show more topics
        <Icon name="chevron-right" size={16} />
      </Link>
    </Panel>
  );
}
