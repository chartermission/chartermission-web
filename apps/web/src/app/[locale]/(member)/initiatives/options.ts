import "server-only";
import { getTaxonomies } from "@/lib/taxonomies";

/** Theme (sector) and country options for the directory filters and the form, A to Z. */
export async function initiativeOptions() {
  const taxonomies = await getTaxonomies().catch(() => null);
  const collator = new Intl.Collator("en");
  return {
    countries: (taxonomies?.countries ?? []).map((c) => ({ value: c.code, label: c.name })).sort((a, b) => collator.compare(a.label, b.label)),
    themes: (taxonomies?.sectors ?? []).map((s) => ({ value: s.id, label: s.name })).sort((a, b) => collator.compare(a.label, b.label)),
  };
}
