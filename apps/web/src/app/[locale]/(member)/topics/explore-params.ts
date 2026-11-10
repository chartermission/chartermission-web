import type { TrendingScope, TrendingWindow } from "@chartermission/contracts";

/** URL state of the explore page. Defaults are left out of the URL. */
export type ExploreParams = {
  q: string;
  window: TrendingWindow;
  scope: TrendingScope;
  scopeId: string | null;
  list: "popular" | "new";
};

export const EXPLORE_DEFAULTS = { window: "24h", scope: "global", list: "popular" } as const;

/** Page size for the Popular / New grid and search results (even, for the 2-column grid). */
export const LIST_PAGE = 10;
/** Rows of "Your topics" before "Show more". */
export const FOLLOWED_PAGE = 6;

type Raw = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The search box accepts "#tag" or "tag"; the API matches on the bare tag. */
export function cleanQuery(value: string): string {
  return value.trim().replace(/^#+/, "").slice(0, 50);
}

export function parseExplore(raw: Raw): ExploreParams {
  const window = first(raw.window) === "7d" ? "7d" : "24h";
  const rawScope = first(raw.scope);
  const scopeId = first(raw.scopeId)?.trim().slice(0, 100) || null;
  const scope: TrendingScope = (rawScope === "country" || rawScope === "chapter") && scopeId ? rawScope : "global";
  return {
    q: cleanQuery(first(raw.q) ?? ""),
    window,
    scope,
    scopeId: scope === "global" ? null : scopeId,
    list: first(raw.list) === "new" ? "new" : "popular",
  };
}

/** /topics?… for links into the explore page (e.g. from the right rail's trending panel). */
export function exploreHref(params: Partial<Pick<ExploreParams, "window" | "scope" | "scopeId" | "list" | "q">>): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.window && params.window !== EXPLORE_DEFAULTS.window) qs.set("window", params.window);
  if (params.scope && params.scope !== "global" && params.scopeId) {
    qs.set("scope", params.scope);
    qs.set("scopeId", params.scopeId);
  }
  if (params.list && params.list !== EXPLORE_DEFAULTS.list) qs.set("list", params.list);
  const s = qs.toString();
  return s ? `/topics?${s}` : "/topics";
}

/** A trending scope the viewer can switch to (Africa, their country, their chapters). */
export type ScopeOption = { key: string; label: string; scope: TrendingScope; scopeId: string | null };

export const scopeKey = (scope: TrendingScope, scopeId: string | null) => (scope === "global" ? "global" : `${scope}:${scopeId}`);
