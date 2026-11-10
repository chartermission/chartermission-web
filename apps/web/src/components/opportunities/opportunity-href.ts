import type { OpportunitiesQuery } from "@chartermission/contracts";

/** The URL query for a set of filters (defaults left out). */
export function filtersHref(path: string, q: Partial<OpportunitiesQuery>) {
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.type) params.set("type", q.type);
  if (q.country) params.set("country", q.country);
  if (q.remote) params.set("remote", "true");
  if (q.sector) params.set("sector", q.sector);
  if (q.deadline && q.deadline !== "any") params.set("deadline", q.deadline);
  if (q.sort && q.sort !== "newest") params.set("sort", q.sort);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
