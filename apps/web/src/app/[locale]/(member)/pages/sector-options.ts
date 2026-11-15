import type { TaxonomyItem } from "@chartermission/contracts";

const collator = new Intl.Collator("en");

/** Catalogue sectors for the page form's sector picker, A to Z. */
export function sectorOptions(sectors: TaxonomyItem[]): { id: string; name: string }[] {
  return sectors.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => collator.compare(a.name, b.name));
}
