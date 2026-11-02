"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Avatar, Button, Divider, Icon, Panel, chipClasses, cn } from "@chartermission/ui";
import { CheckRow, FilterGroup, SearchField, SelectField, ToggleChip } from "@/components/discover/filter-controls";
import {
  networkChapters,
  networkCountries,
  networkDefaults,
  networkSectors,
  networkTabs,
  suggestedSkills,
  type DirectoryMember,
  type NetworkTab,
  connectionRequests as initialRequests,
} from "@/lib/mock/network";

/** A member plus their server-rendered card. */
export type MemberEntry = { member: DirectoryMember; card: ReactNode };

type Filters = typeof networkDefaults & { query: string };
const clearedFilters: Filters = {
  query: "",
  country: "",
  sector: "",
  chapter: "",
  skills: [],
  openToMentoring: false,
  openToCollaborate: false,
  diaspora: false,
};

type Request = (typeof initialRequests)[number] & { accepted?: boolean };

function sectorLabel(value: string) {
  return networkSectors.find((sector) => sector.value === value)?.label ?? "";
}

function matches(member: DirectoryMember, tab: NetworkTab, f: Filters) {
  if (tab === "connections" && member.connection !== "connected") return false;
  if (tab === "following" && !member.following) return false;
  const query = f.query.trim().toLowerCase();
  if (query && ![member.name, member.headline, member.location, sectorLabel(member.sector), ...member.skills].join(" ").toLowerCase().includes(query)) return false;
  if (f.country && member.country !== f.country) return false;
  if (f.sector && member.sector !== f.sector) return false;
  if (f.chapter && member.chapter !== f.chapter) return false;
  if (f.skills.length > 0 && !f.skills.some((skill) => member.skills.includes(skill))) return false;
  if (f.openToMentoring && !member.openToMentoring) return false;
  if (f.openToCollaborate && !member.openToCollaborate) return false;
  if (f.diaspora && !member.diaspora) return false;
  return true;
}

/** Tabs, connection requests, filter panel and member grid for /network. */
export function NetworkBrowser({ entries }: { entries: MemberEntry[] }) {
  const [tab, setTab] = useState<NetworkTab>("discover");
  const [filters, setFilters] = useState<Filters>({ ...networkDefaults, query: "" });
  const [skillOptions, setSkillOptions] = useState(suggestedSkills);
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [requests, setRequests] = useState<Request[]>(initialRequests);
  const tabIds = useId();

  const pendingCount = requests.filter((request) => !request.accepted).length;
  const results = useMemo(() => entries.filter((entry) => matches(entry.member, tab, filters)), [entries, tab, filters]);

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function toggleSkill(skill: string) {
    update({ skills: filters.skills.includes(skill) ? filters.skills.filter((s) => s !== skill) : [...filters.skills, skill] });
  }

  function addSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const skill = newSkill.trim();
    if (skill) {
      if (!skillOptions.some((s) => s.toLowerCase() === skill.toLowerCase())) setSkillOptions([...skillOptions, skill]);
      if (!filters.skills.includes(skill)) update({ skills: [...filters.skills, skill] });
    }
    setNewSkill("");
    setAddingSkill(false);
  }

  return (
    <>
      <div role="tablist" aria-label="Network sections" className="flex gap-6">
        {networkTabs.map((item) => {
          const selected = tab === item.value;
          const count = item.value === "requests" ? pendingCount : "count" in item ? item.count : undefined;
          return (
            <button
              key={item.value}
              id={`${tabIds}-${item.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabIds}-panel`}
              onClick={() => setTab(item.value)}
              className={cn("group flex flex-col items-center gap-2.5 text-md", selected ? "font-medium text-primary" : "text-secondary hover:text-ink")}
            >
              <span>
                {item.label}
                {count !== undefined && ` (${count})`}
              </span>
              <span className={cn("h-[3px] w-full", selected ? "bg-accent" : "bg-transparent group-hover:bg-line")} />
            </button>
          );
        })}
      </div>

      <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-${tab}`} className="flex flex-col gap-5">
        {(tab === "discover" || tab === "requests") && (
          <Panel aria-labelledby={`${tabIds}-requests-heading`} className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 id={`${tabIds}-requests-heading`} className="text-h3 text-ink">
                {pendingCount === 0 ? "No pending requests" : `${pendingCount} connection request${pendingCount === 1 ? "" : "s"}`}
              </h2>
              {tab === "discover" && (
                <button type="button" onClick={() => setTab("requests")} className="text-sm font-medium text-primary-light hover:underline">
                  See all
                </button>
              )}
            </div>
            {requests.length > 0 && (
              <ul className={cn("grid gap-4", tab === "requests" ? "grid-cols-1" : "grid-cols-2 xl:grid-cols-3")}>
                {requests.map((request) => (
                  <li key={request.handle} className="flex min-w-0 items-center gap-2.5 rounded-[10px] bg-surface p-3">
                    <Avatar name={request.name} tone={request.tone} />
                    <Link href={`/members/${request.handle}`} className="group flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-ink group-hover:underline">{request.name}</span>
                      <span className="text-xs text-secondary">{request.headline}</span>
                    </Link>
                    {request.accepted ? (
                      <span className="flex items-center gap-1 text-sm font-medium text-success">
                        <Icon name="check" size={16} />
                        Connected
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => setRequests(requests.filter((r) => r.handle !== request.handle))}
                        >
                          Ignore<span className="sr-only"> {request.name}</span>
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setRequests(requests.map((r) => (r.handle === request.handle ? { ...r, accepted: true } : r)))}
                        >
                          Accept<span className="sr-only"> {request.name}</span>
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tab !== "requests" && (
          <div className="flex items-start gap-6">
            <aside aria-label="Filters" className="flex w-[260px] shrink-0 flex-col gap-4 rounded-card border border-line bg-card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-h3 text-ink">Filters</h2>
                <button type="button" onClick={() => setFilters(clearedFilters)} className="text-xs text-primary-light hover:underline">
                  Clear
                </button>
              </div>
              <SearchField
                label="Search members by name, headline or skill"
                placeholder="Name, role or skill"
                value={filters.query}
                onChange={(event) => update({ query: event.target.value })}
                className="h-10"
              />
              <FilterGroup legend="Country" tight>
                <SelectField label="Country" options={networkCountries} value={filters.country} onChange={(e) => update({ country: e.target.value })} />
              </FilterGroup>
              <FilterGroup legend="Sector" tight>
                <SelectField label="Sector" options={networkSectors} value={filters.sector} onChange={(e) => update({ sector: e.target.value })} />
              </FilterGroup>
              <FilterGroup legend="Chapter" tight>
                <SelectField label="Chapter" options={networkChapters} value={filters.chapter} onChange={(e) => update({ chapter: e.target.value })} />
              </FilterGroup>
              <FilterGroup legend="Skills" tight>
                <div className="flex flex-wrap gap-1.5">
                  {skillOptions.map((skill) => (
                    <ToggleChip key={skill} active={filters.skills.includes(skill)} onClick={() => toggleSkill(skill)}>
                      {skill}
                    </ToggleChip>
                  ))}
                  {!addingSkill && (
                    <button type="button" onClick={() => setAddingSkill(true)} className={chipClasses("neutral", "hover:text-ink")}>
                      + Add
                    </button>
                  )}
                </div>
              </FilterGroup>
              {addingSkill && (
                <form onSubmit={addSkill} className="-mt-2 flex gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Skill to filter by</span>
                    <input
                      autoFocus
                      value={newSkill}
                      onChange={(event) => setNewSkill(event.target.value)}
                      onKeyDown={(event) => event.key === "Escape" && setAddingSkill(false)}
                      placeholder="e.g. Storage"
                      className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light"
                    />
                  </label>
                  <Button type="submit" size="small">
                    Add
                  </Button>
                </form>
              )}
              <Divider />
              <div className="flex flex-col gap-4">
                <CheckRow label="Open to mentoring" checked={filters.openToMentoring} onChange={(e) => update({ openToMentoring: e.target.checked })} />
                <CheckRow label="Open to collaborate" checked={filters.openToCollaborate} onChange={(e) => update({ openToCollaborate: e.target.checked })} />
                <CheckRow label="Diaspora members" checked={filters.diaspora} onChange={(e) => update({ diaspora: e.target.checked })} />
              </div>
            </aside>

            <section aria-label="Members" className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-md font-medium text-ink" aria-live="polite">
                  {results.length} member{results.length === 1 ? "" : "s"}
                </h2>
                <p className="text-sm text-secondary">Sorted by relevance</p>
              </div>
              {results.length > 0 ? (
                <ul className="grid grid-cols-2 items-start gap-4 xl:grid-cols-3">
                  {results.map((entry) => (
                    <li key={entry.member.handle} className="flex">
                      {entry.card}
                    </li>
                  ))}
                </ul>
              ) : (
                <Panel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <p className="text-md font-medium text-ink">No members match these filters</p>
                  <p className="text-sm text-secondary">Try another country or sector, or clear the filters.</p>
                  <Button variant="secondary" size="small" onClick={() => setFilters(clearedFilters)}>
                    Clear filters
                  </Button>
                </Panel>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
