"use client";

import { useMemo, useState } from "react";
import { Button, FilterSelect, chipClasses } from "@chartermission/ui";
import { initiativeStatusMeta, type DirectoryStatus } from "@/lib/mock/initiatives";
import { InitiativeTile, type InitiativeSummary } from "./initiative-tile";

type StatusFilter = "all" | DirectoryStatus;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(initiativeStatusMeta) as DirectoryStatus[]).map((value) => ({
    value,
    label: initiativeStatusMeta[value].label,
  })),
];

/** Padding that brings the shared FilterSelect to the 38px Figma control height. */
const selectStyle = { paddingTop: 9, paddingBottom: 9, paddingLeft: 12, paddingRight: 34 };

/** Status chips + theme/country selects filtering the initiative grid (Figma 17:1929 / 17:1948). */
export function InitiativeDirectory({
  initiatives,
  themes,
  countries,
}: {
  initiatives: InitiativeSummary[];
  themes: string[];
  countries: string[];
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [theme, setTheme] = useState("");
  const [country, setCountry] = useState("");

  const results = useMemo(
    () =>
      initiatives.filter(
        (initiative) =>
          (status === "all" || initiative.status === status) &&
          (!theme || initiative.theme === theme) &&
          (!country || initiative.country === country),
      ),
    [initiatives, status, theme, country],
  );

  function reset() {
    setStatus("all");
    setTheme("");
    setCountry("");
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {statusFilters.map((filter) => {
            const selected = filter.value === status;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setStatus(filter.value)}
                className={chipClasses(selected ? "active" : "filter", selected ? undefined : "hover:border-line-strong hover:text-ink")}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <FilterSelect
            label="Theme"
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            options={[{ value: "", label: "All themes" }, ...themes.map((value) => ({ value, label: value }))]}
            style={selectStyle}
          />
          <FilterSelect
            label="Country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            options={[{ value: "", label: "All countries" }, ...countries.map((value) => ({ value, label: value }))]}
            style={selectStyle}
          />
        </div>
      </div>

      <p className="sr-only" role="status">
        {results.length === 1 ? "1 initiative" : `${results.length} initiatives`}
      </p>

      {results.length > 0 ? (
        <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {results.map((initiative) => (
            <li key={initiative.slug} className="flex">
              <InitiativeTile initiative={initiative} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-card px-6 py-12 text-center">
          <p className="text-h3 text-ink">No initiatives match these filters</p>
          <p className="text-sm text-secondary">Try another theme or country, or start an initiative of your own.</p>
          <Button variant="secondary" size="small" onClick={reset}>
            Clear filters
          </Button>
        </div>
      )}
    </>
  );
}
