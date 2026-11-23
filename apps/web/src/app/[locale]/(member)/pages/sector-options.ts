import type { TaxonomyItem } from "@chartermission/contracts";

const collator = new Intl.Collator("en");

/** Catalogue sectors for the page form's sector picker, A to Z. */
export function sectorOptions(sectors: TaxonomyItem[], held: { id: string; name: string }[] = []): { id: string; name: string }[] {
  // Sectors the page already has stay listed after an admin hides them from pickers.
  const ids = new Set(sectors.map((s) => s.id));
  return [...sectors, ...held.filter((s) => !ids.has(s.id))].map((s) => ({ id: s.id, name: s.name })).sort((a, b) => collator.compare(a.name, b.name));
}
