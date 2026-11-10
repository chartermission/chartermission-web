"use client";

import { useRouter } from "next/navigation";
import { usePathname, useT } from "@/i18n/client";
import { useState, useTransition, type FormEvent } from "react";
import type { DirectoryMember, DirectoryQuery, Page, Taxonomies } from "@chartermission/contracts";
import { Button, Icon, Panel, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { FilterGroup, SearchField, SelectField } from "@/components/discover/filter-controls";
import { ErrorNotice } from "@/components/social/errors";
import { DirectoryMemberCard } from "./member-card";

type Filters = Pick<DirectoryQuery, "q" | "country" | "sector" | "skill" | "sort">;

const sorts = [
  { value: "relevance", label: "Most relevant" },
  { value: "recent", label: "Recently joined" },
  { value: "name", label: "Name (A–Z)" },
];

/**
 * Member directory (CM-NET-01/02): search by name, headline or skill; filter by country,
 * sector and skill; sort. Filters live in the URL; "Load more" follows the cursor.
 */
export function Directory({
  filters,
  initial,
  taxonomies,
}: {
  filters: Filters;
  initial: Page<DirectoryMember>;
  taxonomies: Pick<Taxonomies, "countries" | "sectors" | "skills">;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Filters>(filters);
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function apply(next: Filters) {
    setDraft(next);
    const params = new URLSearchParams({ tab: "directory" });
    if (next.q?.trim()) params.set("q", next.q.trim());
    if (next.country) params.set("country", next.country);
    if (next.sector) params.set("sector", next.sector);
    if (next.skill) params.set("skill", next.skill);
    if (next.sort && next.sort !== "relevance") params.set("sort", next.sort);
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  }

  async function more() {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<DirectoryMember>>("/members", { query: { ...filters, cursor: cursor ?? undefined } });
      setItems((current) => [...current, ...page.items.filter((m) => !current.some((x) => x.id === m.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = !!(filters.q || filters.country || filters.sector || filters.skill);
  const cleared: Filters = { q: "", country: undefined, sector: undefined, skill: undefined, sort: draft.sort };

  return (
    <div className="flex items-start gap-6 max-lg:flex-col">
      <Button
        variant="secondary"
        className="lg:hidden"
        aria-expanded={filtersOpen}
        aria-controls="directory-filters"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <Icon name="filter" size={16} />
        {filtersOpen ? "Hide filters" : `Filters${filtered ? " (on)" : ""}`}
      </Button>
      <Panel
        id="directory-filters"
        aria-label="Filters"
        className={cn("w-[260px] shrink-0 flex-col gap-4 p-5 max-lg:w-full lg:flex", filtersOpen ? "flex" : "hidden")}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-h3 text-ink">Filters</h2>
          {filtered && (
            <button type="button" onClick={() => apply(cleared)} className="text-xs text-primary-light hover:underline">
              Clear
            </button>
          )}
        </div>
        <form
          role="search"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            apply(draft);
          }}
          className="flex flex-col gap-2"
        >
          <SearchField
            label="Search members by name, headline or skill"
            placeholder="Name, role or skill"
            value={draft.q ?? ""}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            className="h-10"
          />
          <Button type="submit" size="small" variant="secondary">
            Search
          </Button>
        </form>
        <FilterGroup legend="Country" tight>
          <SelectField
            label="Country"
            value={draft.country ?? ""}
            onChange={(e) => apply({ ...draft, country: e.target.value || undefined })}
            options={[{ value: "", label: "Any country" }, ...taxonomies.countries.map((c) => ({ value: c.code, label: c.name }))]}
          />
        </FilterGroup>
        <FilterGroup legend="Sector" tight>
          <SelectField
            label="Sector"
            value={draft.sector ?? ""}
            onChange={(e) => apply({ ...draft, sector: e.target.value || undefined })}
            options={[{ value: "", label: "Any sector" }, ...taxonomies.sectors.map((s) => ({ value: s.slug, label: s.name }))]}
          />
        </FilterGroup>
        <FilterGroup legend="Skill" tight>
          <SelectField
            label="Skill"
            value={draft.skill ?? ""}
            onChange={(e) => apply({ ...draft, skill: e.target.value || undefined })}
            options={[{ value: "", label: "Any skill" }, ...taxonomies.skills.map((s) => ({ value: s.slug, label: s.name }))]}
          />
        </FilterGroup>
        <FilterGroup legend="Sort by" tight>
          <SelectField
            label="Sort by"
            value={draft.sort ?? "relevance"}
            onChange={(e) => apply({ ...draft, sort: e.target.value as Filters["sort"] })}
            options={sorts}
          />
        </FilterGroup>
      </Panel>

      <section aria-label="Members" aria-busy={pending || loading} className={cn("flex w-full min-w-0 flex-1 flex-col gap-4", pending && "opacity-60")}>
        <p className="text-md font-medium text-ink" aria-live="polite">
          {items.length === 0 ? "No members found" : (cursor ? t("Showing {count}+ members", { count: items.length }) : t("Showing {count} members", { count: items.length }))}
        </p>
        {items.length > 0 ? (
          <ul className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((member) => (
              <li key={member.id} className="flex">
                <DirectoryMemberCard member={member} />
              </li>
            ))}
          </ul>
        ) : (
          <Panel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-md font-medium text-ink">No members match {filtered ? "these filters" : "yet"}</p>
            <p className="text-sm text-secondary">Try a different name or skill, another country or sector, or clear the filters.</p>
            {filtered && (
              <Button variant="secondary" size="small" onClick={() => apply(cleared)}>
                Clear filters
              </Button>
            )}
          </Panel>
        )}
        {error ? <ErrorNotice error={error} onRetry={more} /> : null}
        {cursor && (
          <Button variant="secondary" block disabled={loading} onClick={more}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        )}
      </section>
    </div>
  );
}
