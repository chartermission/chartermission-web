import "server-only";
import { cacheLife } from "next/cache";
import type { Country, Taxonomies } from "@chartermission/contracts";
import { API_INTERNAL_URL } from "@/lib/api/server";
import { ApiError } from "@/lib/api/errors";

/**
 * GET /taxonomies — public reference data (countries, sectors, skills, interests, languages, chapters).
 * It reads no cookies, so it is cached on the server and can be part of the static shell.
 */
export async function getTaxonomies(): Promise<Taxonomies> {
  "use cache";
  cacheLife("minutes");
  const res = await fetch(`${API_INTERNAL_URL}/taxonomies`, { headers: { accept: "application/json" } }).catch(() => {
    throw new ApiError(503, "NETWORK_ERROR", "The service is unavailable. Please try again shortly.");
  });
  if (!res.ok) throw await ApiError.from(res);
  return (await res.json()) as Taxonomies;
}

export type CountryGroup = { label: string; countries: Pick<Country, "code" | "name">[] };

const collator = new Intl.Collator("en");

/** Countries grouped for selects: African regions first (alphabetical), then the diaspora. */
export function groupCountries(countries: Country[]): CountryGroup[] {
  const byRegion = new Map<string, Country[]>();
  for (const country of countries) {
    const list = byRegion.get(country.region) ?? [];
    list.push(country);
    byRegion.set(country.region, list);
  }
  const regions = [...byRegion.keys()].sort((a, b) => (a === "Diaspora" ? 1 : b === "Diaspora" ? -1 : collator.compare(a, b)));
  return regions.map((region) => ({
    label: region === "Diaspora" ? "Rest of the world" : region,
    countries: byRegion
      .get(region)!
      .map(({ code, name }) => ({ code, name }))
      .sort((a, b) => collator.compare(a.name, b.name)),
  }));
}
