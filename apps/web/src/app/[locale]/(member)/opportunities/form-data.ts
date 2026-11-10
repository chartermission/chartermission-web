import "server-only";
import { getTaxonomies } from "@/lib/taxonomies";

/** Country and sector options for the listing form, A to Z. */
export async function formOptions() {
  const taxonomies = await getTaxonomies().catch(() => null);
  const collator = new Intl.Collator("en");
  return {
    countries: (taxonomies?.countries ?? []).map((c) => ({ value: c.code, label: c.name })).sort((a, b) => collator.compare(a.label, b.label)),
    sectors: (taxonomies?.sectors ?? []).map((s) => ({ value: s.id, label: s.name })).sort((a, b) => collator.compare(a.label, b.label)),
  };
}
