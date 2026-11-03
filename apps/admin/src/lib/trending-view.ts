import type { AdminTrendingQuery } from "@chartermission/contracts";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type TrendingView = {
  scope: AdminTrendingQuery["scope"];
  /** Country code or chapter id; undefined for global. */
  scopeId?: string;
  window: AdminTrendingQuery["window"];
};

export function parseTrendingView(params: Params): TrendingView {
  const scope = first(params.scope);
  const window = first(params.window) === "7d" ? "7d" : "24h";
  const id = first(params.id)?.slice(0, 60);
  if (scope === "country" || scope === "chapter") return { scope, scopeId: id || undefined, window };
  return { scope: "global", window };
}

export function trendingSearch(v: TrendingView): string {
  const qs = new URLSearchParams();
  if (v.scope !== "global") qs.set("scope", v.scope);
  if (v.scope !== "global" && v.scopeId) qs.set("id", v.scopeId);
  if (v.window !== "24h") qs.set("window", v.window);
  const s = qs.toString();
  return s ? `?${s}` : "";
}
