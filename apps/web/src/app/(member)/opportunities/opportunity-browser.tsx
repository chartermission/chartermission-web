"use client";

import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Divider, Panel } from "@chartermission/ui";
import {
  CheckRow,
  FilterGroup,
  RemovableChip,
  SearchField,
  SelectField,
} from "@/components/discover/filter-controls";
import { isRestOfMonth, isWithinDays } from "@/components/discover/dates";
import {
  opportunityCountries,
  opportunityDeadlines,
  opportunitySectors,
  opportunitySorts,
  opportunityTypes,
  type Opportunity,
  type OpportunityDeadlineFilter,
  type OpportunitySort,
  type OpportunityTypeFilter,
} from "@/lib/mock/opportunities";

/** An opportunity plus its server-rendered card. */
export type OpportunityEntry = Opportunity & { card: ReactNode };

type Filters = {
  query: string;
  types: OpportunityTypeFilter[];
  country: string;
  remoteFriendly: boolean;
  sector: string;
  deadline: OpportunityDeadlineFilter;
};

const emptyFilters: Filters = { query: "", types: [], country: "", remoteFriendly: false, sector: "", deadline: "any" };

const PAGE_SIZE = 5;
const remoteFriendlyModes = new Set<Opportunity["workMode"]>(["Remote", "Remote-friendly", "Hybrid"]);

function labelOf(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function matches(entry: OpportunityEntry, filters: Filters, today: string, ignoreType = false) {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = [entry.title, entry.organisation, entry.place, entry.sectorLabel, entry.engagement].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (!ignoreType && filters.types.length > 0 && !filters.types.includes(entry.type)) return false;
  if (filters.country && entry.country !== filters.country) return false;
  if (filters.remoteFriendly && !remoteFriendlyModes.has(entry.workMode)) return false;
  if (filters.sector && entry.sector !== filters.sector) return false;
  if (filters.deadline === "week" && !isWithinDays(entry.deadline, today, 7)) return false;
  if (filters.deadline === "month" && !isRestOfMonth(entry.deadline, today)) return false;
  return true;
}

const sorters: Record<OpportunitySort, (a: OpportunityEntry, b: OpportunityEntry) => number> = {
  closing: (a, b) => a.deadline.localeCompare(b.deadline),
  newest: (a, b) => b.published.localeCompare(a.published),
  title: (a, b) => a.title.localeCompare(b.title),
};

/**
 * Search bar, filter panel and result list for /opportunities. Cards arrive
 * pre-rendered from the server; this component only decides which to show.
 */
export function OpportunityBrowser({ entries, today, rail }: { entries: OpportunityEntry[]; today: string; rail: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draftQuery, setDraftQuery] = useState("");
  const [sort, setSort] = useState<OpportunitySort>("closing");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setLimit(PAGE_SIZE);
  }

  function clearAll() {
    setFilters(emptyFilters);
    setDraftQuery("");
    setLimit(PAGE_SIZE);
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ query: draftQuery });
    resultsHeading.current?.focus();
  }

  function toggleType(type: OpportunityTypeFilter) {
    update({ types: filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type] });
  }

  const results = useMemo(
    () => entries.filter((entry) => matches(entry, filters, today)).sort(sorters[sort]),
    [entries, filters, today, sort],
  );

  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(opportunityTypes.map((t) => [t.value, 0])) as Record<OpportunityTypeFilter, number>;
    for (const entry of entries) if (matches(entry, filters, today, true)) counts[entry.type] += 1;
    return counts;
  }, [entries, filters, today]);

  const activeChips: { key: string; label: string; remove: () => void }[] = [
    ...(filters.query ? [{ key: "query", label: `“${filters.query}”`, remove: () => { setDraftQuery(""); update({ query: "" }); } }] : []),
    ...filters.types.map((type) => ({ key: `type-${type}`, label: labelOf(opportunityTypes, type), remove: () => toggleType(type) })),
    ...(filters.country ? [{ key: "country", label: labelOf(opportunityCountries, filters.country), remove: () => update({ country: "" }) }] : []),
    ...(filters.remoteFriendly ? [{ key: "remote", label: "Remote-friendly", remove: () => update({ remoteFriendly: false }) }] : []),
    ...(filters.sector ? [{ key: "sector", label: labelOf(opportunitySectors, filters.sector), remove: () => update({ sector: "" }) }] : []),
    ...(filters.deadline !== "any"
      ? [{ key: "deadline", label: labelOf(opportunityDeadlines, filters.deadline), remove: () => update({ deadline: "any" }) }]
      : []),
  ];

  const shown = results.slice(0, limit);

  return (
    <>
      <form role="search" onSubmit={onSearch} className="flex items-center gap-3">
        <SearchField
          label="Search opportunities"
          name="q"
          placeholder="Search roles, organisations or skills"
          value={draftQuery}
          onChange={(event) => {
            setDraftQuery(event.target.value);
            update({ query: event.target.value });
          }}
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>

      <div className="flex items-start gap-6">
        <aside aria-label="Filters" className="flex w-[260px] shrink-0 flex-col gap-[18px] rounded-card border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-h3 text-ink">Filters</h2>
            <button type="button" onClick={clearAll} className="text-xs text-primary-light hover:underline">
              Clear all
            </button>
          </div>

          <FilterGroup legend="Type">
            {opportunityTypes.map((type) => (
              <CheckRow
                key={type.value}
                label={type.label}
                count={typeCounts[type.value]}
                checked={filters.types.includes(type.value)}
                onChange={() => toggleType(type.value)}
              />
            ))}
          </FilterGroup>
          <Divider />
          <FilterGroup legend="Location">
            <SelectField
              label="Country"
              options={opportunityCountries}
              value={filters.country}
              onChange={(event) => update({ country: event.target.value })}
            />
            <CheckRow
              label="Remote-friendly"
              checked={filters.remoteFriendly}
              onChange={(event) => update({ remoteFriendly: event.target.checked })}
            />
          </FilterGroup>
          <Divider />
          <FilterGroup legend="Sector">
            <SelectField
              label="Sector"
              options={opportunitySectors}
              value={filters.sector}
              onChange={(event) => update({ sector: event.target.value })}
            />
          </FilterGroup>
          <Divider />
          <FilterGroup legend="Deadline">
            {opportunityDeadlines.map((deadline) => (
              <CheckRow
                key={deadline.value}
                type="radio"
                name="deadline"
                label={deadline.label}
                checked={filters.deadline === deadline.value}
                onChange={() => update({ deadline: deadline.value })}
              />
            ))}
          </FilterGroup>
        </aside>

        <section aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id={headingId} ref={resultsHeading} tabIndex={-1} aria-live="polite" className="text-md font-medium text-ink outline-none">
              {results.length} {results.length === 1 ? "opportunity" : "opportunities"}
            </h2>
            <SelectField
              label="Sort by"
              hideLabel={false}
              options={opportunitySorts}
              value={sort}
              onChange={(event) => setSort(event.target.value as OpportunitySort)}
            />
          </div>

          {activeChips.length > 0 && (
            <ul aria-label="Active filters" className="flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <li key={chip.key}>
                  <RemovableChip label={chip.label} onRemove={chip.remove} />
                </li>
              ))}
            </ul>
          )}

          {shown.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {shown.map((entry) => (
                <li key={entry.slug}>{entry.card}</li>
              ))}
            </ul>
          ) : (
            <Panel className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-md font-medium text-ink">No opportunities match these filters</p>
              <p className="text-sm text-secondary">Try removing a filter or searching for something broader.</p>
              <Button variant="secondary" size="small" onClick={clearAll}>
                Clear all filters
              </Button>
            </Panel>
          )}

          {results.length > limit && (
            <div className="flex justify-center py-2">
              <Button variant="secondary" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                Load more
              </Button>
            </div>
          )}
        </section>

        {rail}
      </div>
    </>
  );
}
