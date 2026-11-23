/*
 * Hidden content filters (Moderation → Hidden), kept in the URL so the list can be shared and
 * survives a reload: ?type=post|comment&since=7d|30d&by=moderator|automatic&q=words.
 */

export type HiddenType = "all" | "post" | "comment";
export type HiddenSince = "" | "7d" | "30d";
export type HiddenBy = "" | "moderator" | "automatic";
export type HiddenFilters = { type: HiddenType; since: HiddenSince; by: HiddenBy; q: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function hiddenFilters(params: Record<string, string | string[] | undefined>): HiddenFilters {
  const type = one(params.type);
  const since = one(params.since);
  const by = one(params.by);
  return {
    type: type === "post" || type === "comment" ? type : "all",
    since: since === "7d" || since === "30d" ? since : "",
    by: by === "moderator" || by === "automatic" ? by : "",
    q: one(params.q).trim().slice(0, 100),
  };
}

export function hiddenSearch(f: HiddenFilters): string {
  const qs = new URLSearchParams();
  if (f.type !== "all") qs.set("type", f.type);
  if (f.since) qs.set("since", f.since);
  if (f.by) qs.set("by", f.by);
  if (f.q) qs.set("q", f.q);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function hiddenApiQuery(f: HiddenFilters) {
  return { targetType: f.type === "all" ? undefined : f.type, since: f.since || undefined, by: f.by || undefined, q: f.q || undefined };
}
