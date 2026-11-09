"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { OPPORTUNITY_TYPE_LABELS, OpportunityType, type OpportunitiesQuery } from "@chartermission/contracts";
import { Button, Divider } from "@chartermission/ui";
import { CheckRow, FilterGroup, RemovableChip, SearchField, SelectField } from "@/components/discover/filter-controls";

type Option = { value: string; label: string };

const DEADLINES: { value: OpportunitiesQuery["deadline"]; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "week", label: "Closing this week" },
  { value: "month", label: "Closing this month" },
];

export const SORTS: Option[] = [
  { value: "newest", label: "Newest" },
  { value: "closing", label: "Closing soon" },
];

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

/** Search box and filter panel; every change updates the URL (the server renders the results). */
export function OpportunityFilters({ query, countries, sectors }: { query: OpportunitiesQuery; countries: Option[]; sectors: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(query.q ?? "");
  const types = (query.type ?? "").split(",").filter(Boolean);

  function go(patch: Partial<OpportunitiesQuery>) {
    startTransition(() => router.push(filtersHref(pathname, { ...query, ...patch }), { scroll: false }));
  }

  function toggleType(type: string) {
    const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
    go({ type: next.join(",") || undefined });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go({ q: draft.trim() || undefined });
  }

  const label = (options: Option[], value?: string) => options.find((o) => o.value === value)?.label ?? value ?? "";
  const chips = [
    ...(query.q ? [{ key: "q", label: `“${query.q}”`, remove: () => (setDraft(""), go({ q: undefined })) }] : []),
    ...types.map((t) => ({ key: `type-${t}`, label: OPPORTUNITY_TYPE_LABELS[t as OpportunityType] ?? t, remove: () => toggleType(t) })),
    ...(query.country ? [{ key: "country", label: label(countries, query.country), remove: () => go({ country: undefined }) }] : []),
    ...(query.remote ? [{ key: "remote", label: "Remote-friendly", remove: () => go({ remote: undefined }) }] : []),
    ...(query.sector ? [{ key: "sector", label: label(sectors, query.sector), remove: () => go({ sector: undefined }) }] : []),
    ...(query.deadline !== "any" ? [{ key: "deadline", label: label(DEADLINES, query.deadline), remove: () => go({ deadline: "any" }) }] : []),
  ];

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <form role="search" onSubmit={search} className="flex items-center gap-3">
        <SearchField
          label="Search opportunities"
          name="q"
          placeholder="Search roles, organisations or keywords"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>

      <details className="group rounded-card border border-line bg-card lg:hidden">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-ink">Filters{chips.length ? ` (${chips.length})` : ""}</summary>
        <div className="flex flex-col gap-[18px] px-5 pb-5">
          <FilterFields name="deadline-mobile" query={query} types={types} countries={countries} sectors={sectors} go={go} toggleType={toggleType} />
        </div>
      </details>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label="Active filters" className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.key}>
                <RemovableChip label={chip.label} onRemove={chip.remove} />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              startTransition(() => router.push(pathname, { scroll: false }));
            }}
            className="text-xs text-primary-light hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/** The filter panel beside the results on wide screens. */
export function OpportunityFilterPanel({ query, countries, sectors }: { query: OpportunitiesQuery; countries: Option[]; sectors: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const types = (query.type ?? "").split(",").filter(Boolean);
  const go = (patch: Partial<OpportunitiesQuery>) => startTransition(() => router.push(filtersHref(pathname, { ...query, ...patch }), { scroll: false }));
  const toggleType = (type: string) => {
    const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
    go({ type: next.join(",") || undefined });
  };
  return (
    <aside aria-label="Filters" className="flex w-[260px] shrink-0 flex-col gap-[18px] rounded-card border border-line bg-card p-5 max-lg:hidden">
      <h2 className="text-h3 text-ink">Filters</h2>
      <FilterFields name="deadline" query={query} types={types} countries={countries} sectors={sectors} go={go} toggleType={toggleType} />
    </aside>
  );
}

function FilterFields({
  name,
  query,
  types,
  countries,
  sectors,
  go,
  toggleType,
}: {
  name: string;
  query: OpportunitiesQuery;
  types: string[];
  countries: Option[];
  sectors: Option[];
  go: (patch: Partial<OpportunitiesQuery>) => void;
  toggleType: (type: string) => void;
}) {
  return (
    <>
      <FilterGroup legend="Type">
        {OpportunityType.options.map((type) => (
          <CheckRow key={type} label={OPPORTUNITY_TYPE_LABELS[type]} checked={types.includes(type)} onChange={() => toggleType(type)} />
        ))}
      </FilterGroup>
      <Divider />
      <FilterGroup legend="Location">
        <SelectField
          label="Country"
          options={[{ value: "", label: "Any country" }, ...countries]}
          value={query.country ?? ""}
          onChange={(e) => go({ country: e.target.value || undefined })}
        />
        <CheckRow label="Remote-friendly" checked={!!query.remote} onChange={(e) => go({ remote: e.target.checked || undefined })} />
      </FilterGroup>
      <Divider />
      <FilterGroup legend="Sector">
        <SelectField
          label="Sector"
          options={[{ value: "", label: "All sectors" }, ...sectors]}
          value={query.sector ?? ""}
          onChange={(e) => go({ sector: e.target.value || undefined })}
        />
      </FilterGroup>
      <Divider />
      <FilterGroup legend="Deadline">
        {DEADLINES.map((d) => (
          <CheckRow key={d.value} type="radio" name={name} label={d.label} checked={query.deadline === d.value} onChange={() => go({ deadline: d.value })} />
        ))}
      </FilterGroup>
    </>
  );
}

/** "Sort by" select above the results. */
export function OpportunitySortSelect({ query }: { query: OpportunitiesQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  return (
    <SelectField
      label="Sort by"
      hideLabel={false}
      options={SORTS}
      value={query.sort}
      onChange={(e) => startTransition(() => router.push(filtersHref(pathname, { ...query, sort: e.target.value as OpportunitiesQuery["sort"] }), { scroll: false }))}
    />
  );
}
