"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { InitiativeStatus, InitiativeSummary, Page } from "@chartermission/contracts";
import { Button, FilterSelect, Icon, chipClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";
import { InitiativeTile } from "./initiative-tile";
import { initiativeStatusMeta } from "./format";
import { useT } from "@/i18n/client";

export type DirectoryFilters = { status: string; theme: string; country: string; q: string; scope: "all" | "mine" };
type Option = { value: string; label: string };

const STATUS_FILTERS: ("" | InitiativeStatus)[] = ["", "recruiting", "active", "idea", "paused", "completed"];

/** Padding that brings the shared FilterSelect to the 38px Figma control height. */
const selectStyle = { paddingTop: 9, paddingBottom: 9, paddingLeft: 12, paddingRight: 34 };

const query = (f: DirectoryFilters) => {
  const params = new URLSearchParams();
  if (f.scope === "mine") params.set("scope", "mine");
  if (f.status) params.set("status", f.status);
  if (f.theme) params.set("theme", f.theme);
  if (f.country) params.set("country", f.country);
  if (f.q) params.set("q", f.q);
  return params;
};

/**
 * The initiatives directory (GET /initiatives): All / Yours, status chips, theme and country, a
 * search box, then the grid with "Load more". Filters live in the address, so they can be shared.
 */
export function InitiativeDirectory({
  initial,
  filters,
  themes,
  countries,
}: {
  initial: Page<InitiativeSummary>;
  filters: DirectoryFilters;
  themes: Option[];
  countries: Option[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(filters.q);
  // A new first page from the server (filters changed) replaces what was loaded.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }

  function apply(next: Partial<DirectoryFilters>) {
    const params = query({ ...filters, ...next });
    startTransition(() => router.replace(`/initiatives${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const params = query(filters);
      params.set("cursor", cursor);
      const page = await api<Page<InitiativeSummary>>(`/initiatives?${params}`);
      setItems((current) => [...current, ...page.items.filter((i) => !current.some((c) => c.id === i.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = !!(filters.status || filters.theme || filters.country || filters.q);

  return (
    <>
      <div role="tablist" aria-label="Which initiatives" className="flex gap-1 border-b border-line">
        {(["all", "mine"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={filters.scope === scope}
            onClick={() => apply({ scope })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium",
              filters.scope === scope ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink",
            )}
          >
            {scope === "all" ? "All initiatives" : "Yours"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((value) => {
            const selected = filters.status === value;
            return (
              <button
                key={value || "all"}
                type="button"
                aria-pressed={selected}
                onClick={() => apply({ status: value })}
                className={chipClasses(selected ? "active" : "filter", selected ? undefined : "hover:border-line-strong hover:text-ink")}
              >
                {value ? initiativeStatusMeta[value].label : "All"}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <form
            role="search"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              apply({ q: search.trim() });
            }}
            className="relative flex"
          >
            <Icon name="search" size={16} className="pointer-events-none absolute start-3 inset-y-0 my-auto text-secondary" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
              placeholder="Search initiatives"
              aria-label="Search initiatives"
              className="h-[38px] w-56 rounded-lg border border-line bg-card ps-9 pe-3 text-sm text-ink placeholder:text-disabled focus:border-primary-light focus:outline-none max-sm:w-full"
            />
          </form>
          <FilterSelect
            label="Theme"
            value={filters.theme}
            onChange={(event) => apply({ theme: event.target.value })}
            options={[{ value: "", label: "All themes" }, ...themes]}
            style={selectStyle}
          />
          <FilterSelect
            label="Country"
            value={filters.country}
            onChange={(event) => apply({ country: event.target.value })}
            options={[{ value: "", label: "All countries" }, ...countries]}
            style={selectStyle}
          />
        </div>
      </div>

      <p className="sr-only" role="status">
        {pending ? "Loading initiatives…" : t("{count} initiatives", { count: items.length })}
      </p>

      {items.length > 0 ? (
        <>
          <ul className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2", pending && "opacity-60")}>
            {items.map((initiative) => (
              <li key={initiative.id} className="flex">
                <InitiativeTile initiative={initiative} />
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void loadMore()} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-card px-6 py-12 text-center">
          {filters.scope === "mine" && !filtered ? (
            <>
              <p className="text-h3 text-ink">You’re not part of any initiatives yet</p>
              <p className="text-sm text-secondary">Initiatives you start, join or follow show up here.</p>
              <Button variant="secondary" size="small" onClick={() => apply({ scope: "all" })}>
                Browse all initiatives
              </Button>
            </>
          ) : filtered ? (
            <>
              <p className="text-h3 text-ink">No initiatives match these filters</p>
              <p className="text-sm text-secondary">Try another theme or country, or start an initiative of your own.</p>
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setSearch("");
                  apply({ status: "", theme: "", country: "", q: "" });
                }}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-h3 text-ink">No initiatives yet</p>
              <p className="text-sm text-secondary">Be the first: start an initiative and invite people to help.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
