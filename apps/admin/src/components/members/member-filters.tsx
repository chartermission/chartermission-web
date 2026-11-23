"use client";

import { useId, useState } from "react";
import type { AdminBadge, AdminMemberCounts, Taxonomies } from "@chartermission/contracts";
import { Button, FilterSelect, Icon, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { useIntlTag, useT } from "@/i18n/client";
import { PANEL_FILTERS, panelCount, type MembersFilters, type PanelFilter, type QuickFilter } from "@/lib/members-filters";

export const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  unverified: "Email not confirmed",
  suspended: "Suspended",
  deactivated: "Deactivated",
  deletion_pending: "Being deleted",
  deleted: "Deleted",
};

const ROLE_LABELS: Record<string, string> = {
  moderator: "Moderator",
  platform_admin: "Platform Admin",
  super_admin: "Super Admin",
  event_host: "Event Host",
  team: "Team member",
  official: "Official account",
};

const SORT_LABELS = { newest: "Newest first", oldest: "Oldest first", name: "Name (A to Z)" } as const;

const FILTER_LABELS: Record<PanelFilter, string> = {
  country: "Country",
  chapter: "Chapter",
  status: "Status",
  role: "Role",
  joinedFrom: "Joined from",
  joinedTo: "Joined until",
  emailVerified: "Email confirmed",
  twoStep: "Two-step",
  photo: "Photo",
  referred: "Invited",
  skill: "Skill",
  sector: "Sector",
  interest: "Interest",
  language: "Language",
};

type Option = { value: string; label: string };

/** Search, quick filters, the Filters panel, active-filter chips, sort and CSV export for the Members page. */
export function MemberFilterBar({
  filters,
  counts,
  badges,
  taxonomies,
  exportHref,
  onChange,
}: {
  filters: MembersFilters;
  counts: AdminMemberCounts | null;
  badges: AdminBadge[];
  taxonomies: Taxonomies | null;
  exportHref: string;
  onChange: (patch: Partial<MembersFilters>) => void;
}) {
  const t = useT();
  const id = useId();
  const numbers = new Intl.NumberFormat(useIntlTag());
  const active = panelCount(filters);
  const [open, setOpen] = useState(active > 0);

  const named = (items: { id: string; name: string }[] | undefined): Option[] => (items ?? []).map((i) => ({ value: i.id, label: i.name }));
  const options: Record<PanelFilter, Option[] | null> = {
    country: (taxonomies?.countries ?? []).map((c) => ({ value: c.code, label: c.name })),
    chapter: named(taxonomies?.chapters),
    status: Object.entries(STATUS_LABELS)
      .filter(([k]) => k !== "deleted")
      .map(([value, label]) => ({ value, label: t(label) })),
    role: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label: t(label) })),
    joinedFrom: null,
    joinedTo: null,
    emailVerified: [
      { value: "yes", label: t("Confirmed") },
      { value: "no", label: t("Not confirmed") },
    ],
    twoStep: [
      { value: "on", label: t("On") },
      { value: "off", label: t("Off") },
    ],
    photo: [
      { value: "yes", label: t("Has a photo") },
      { value: "no", label: t("No photo") },
    ],
    referred: [
      { value: "yes", label: t("Joined through an invitation") },
      { value: "no", label: t("Joined on their own") },
    ],
    skill: named(taxonomies?.skills),
    sector: named(taxonomies?.sectors),
    interest: named(taxonomies?.interests),
    language: named(taxonomies?.languages),
  };

  /** "Country: Nigeria", "Joined from 2025-03-01" for a chip. */
  const chipText = (key: PanelFilter) => {
    const value = filters[key]!;
    const label = t(FILTER_LABELS[key]);
    if (key === "joinedFrom" || key === "joinedTo") return `${label} ${value}`;
    return `${label}: ${options[key]?.find((o) => o.value === value)?.label ?? value}`;
  };
  const badge = badges.find((b) => b.slug === filters.badge);
  const clearAll = () =>
    onChange({ ...Object.fromEntries(PANEL_FILTERS.map((k) => [k, undefined])), badge: undefined, filter: "all", q: undefined });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search members</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input
            type="search"
            value={filters.q ?? ""}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search by name, @handle or email"
            className={inputClasses(false, "ps-9")}
          />
        </label>
        <SegmentedControl<QuickFilter>
          label="Show"
          size="small"
          value={filters.badge ? "all" : (filters.filter ?? "all")}
          onChange={(value) => onChange({ filter: value, badge: undefined })}
          items={(
            [
              { value: "all", label: t("All"), count: counts?.all },
              { value: "verified", label: t("Verified"), count: counts?.verified },
              { value: "unverified", label: t("Not verified"), count: counts?.unverified },
              { value: "featured", label: t("Suggested on sign-up"), count: counts?.featured },
              { value: "claude", label: t("Claude access"), count: counts?.claude },
            ] as const
          ).map((item) => ({ value: item.value, label: item.count === undefined ? item.label : `${item.label} · ${numbers.format(item.count)}` }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={open || active ? "secondary" : "ghost"}
          size="small"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="filter" size={16} />
          {active ? t("Filters · {count}", { count: active }) : t("Filters")}
        </Button>
        <FilterSelect
          label="Filter by badge"
          value={filters.badge ?? ""}
          onChange={(e) => onChange({ badge: e.target.value || undefined, filter: "all" })}
          options={[{ value: "", label: t("Any badge") }, ...badges.map((b) => ({ value: b.slug, label: b.name }))]}
        />
        <FilterSelect
          label="Sort"
          value={filters.sort ?? "newest"}
          onChange={(e) => onChange({ sort: e.target.value as MembersFilters["sort"] })}
          options={Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label: t(label) }))}
        />
        <a href={exportHref} className={cn(buttonClasses({ variant: "ghost", size: "small" }), "ms-auto")} download>
          <Icon name="download" size={16} />
          Export CSV
        </a>
      </div>

      {open && (
        <div id={`${id}-panel`} className="grid grid-cols-2 gap-3 rounded-card border border-line bg-card p-4 md:grid-cols-4">
          {PANEL_FILTERS.map((key) => {
            const list = options[key];
            const label = t(FILTER_LABELS[key]);
            return (
              <label key={key} className="flex min-w-0 flex-col gap-1">
                <span className="text-label text-secondary">{label}</span>
                {list ? (
                  <FilterSelect
                    label={label}
                    value={filters[key] ?? ""}
                    onChange={(e) => onChange({ [key]: e.target.value || undefined })}
                    options={[{ value: "", label: t("Any") }, ...list]}
                    className="w-full [&>select]:w-full"
                  />
                ) : (
                  <input
                    type="date"
                    value={filters[key] ?? ""}
                    max={key === "joinedFrom" ? filters.joinedTo : undefined}
                    min={key === "joinedTo" ? filters.joinedFrom : undefined}
                    onChange={(e) => onChange({ [key]: e.target.value || undefined })}
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-body hover:border-line-strong"
                  />
                )}
              </label>
            );
          })}
        </div>
      )}

      {(active > 0 || badge) && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {badge && (
            <li>
              <RemovableChip text={`${t("Badge")}: ${badge.name}`} onRemove={() => onChange({ badge: undefined })} />
            </li>
          )}
          {PANEL_FILTERS.filter((k) => !!filters[k]).map((key) => (
            <li key={key}>
              <RemovableChip text={chipText(key)} onRemove={() => onChange({ [key]: undefined })} />
            </li>
          ))}
          <li>
            <button type="button" onClick={clearAll} className="text-sm font-medium text-primary hover:underline">
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function RemovableChip({ text, onRemove }: { text: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card py-1 ps-3 pe-1 text-sm text-body">
      {text}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("Remove filter {name}", { name: text })}
        className="inline-flex size-5 items-center justify-center rounded-full text-secondary hover:bg-muted hover:text-ink"
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}
