"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { EVENT_FORMAT_LABELS, EventFormat, type EventCategory, type EventSummary, type Page } from "@chartermission/contracts";
import { FilterSelect, Icon, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { ToggleChip } from "@/components/discover/filter-controls";
import { EventGridCard, EventGridCardSkeleton, FeaturedEvent } from "@/components/events/event-cards";
import { EventsCalendar } from "@/components/events/events-calendar";
import { EVENTS_PAGE, apiFilters, eventFiltersQuery, hasNarrowingFilters, type EventFilters } from "@/components/events/filters";
import { monthHeading } from "@/components/events/time";
import { useViewerZone } from "@/components/events/use-viewer-zone";
import { CaughtUpNote } from "@/components/illustrations";
import { staggerStyle } from "@/components/motion";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { api } from "@/lib/api/client";

type Option = { value: string; label: string };
export type FilterOptions = { categories: EventCategory[]; countries: Option[]; chapters: Option[] };

const views: { value: EventFilters["view"]; label: string; icon: IconName }[] = [
  { value: "list", label: "List", icon: "menu" },
  { value: "calendar", label: "Calendar", icon: "calendar" },
];

const whenTabs: { value: EventFilters["when"]; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
];

const PREFETCH_MARGIN = "0px 0px 800px 0px";

/** Cards grouped under month headings in the viewer's zone. */
function groupByMonth(events: EventSummary[], zone: string | null) {
  const groups: { key: string; label: string; events: EventSummary[] }[] = [];
  for (const event of events) {
    const label = monthHeading(event.startsAt, zone ?? event.timezone);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.events.push(event);
    else groups.push({ key: `${label}-${groups.length}`, label, events: [event] });
  }
  return groups;
}

/** Cursor-paginated list for one filter set. Remounted (keyed) when the filters change. */
function EventList({ initial, filters, excludeId, onReset }: { initial: Page<EventSummary>; filters: EventFilters; excludeId: string | null; onReset: () => void }) {
  const zone = useViewerZone();
  const [events, setEvents] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const [added, setAdded] = useState<Record<string, number>>({});
  const inFlight = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (next: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      setAnnouncement("Loading more events");
      try {
        const page = await api<Page<EventSummary>>("/events", { query: { when: filters.when, ...apiFilters(filters), cursor: next, limit: EVENTS_PAGE } });
        setEvents((current) => {
          const seen = new Set(current.map((e) => e.id));
          return [...current, ...page.items.filter((e) => !seen.has(e.id))];
        });
        setAdded((current) => ({ ...current, ...Object.fromEntries(page.items.map((e, order) => [e.id, order])) }));
        setCursor(page.nextCursor);
        setAnnouncement(`${page.items.length} more events loaded.${page.nextCursor ? "" : " That’s every event."}`);
      } catch (e) {
        setError(e);
        setAnnouncement("");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursor || loading || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(cursor), { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loading, error, load]);

  const visible = useMemo(() => events.filter((e) => e.id !== excludeId), [events, excludeId]);
  const groups = useMemo(
    () => (filters.when === "past" ? (visible.length ? [{ key: "past", label: "Past events", events: visible }] : []) : groupByMonth(visible, zone)),
    [visible, zone, filters.when],
  );

  if (!visible.length && !excludeId) {
    const narrowed = hasNarrowingFilters(filters);
    return (
      <EmptyState
        icon="calendar"
        illustration={narrowed ? "no-results" : "quiet"}
        title={narrowed ? "No events match these filters" : filters.when === "past" ? "No past events yet" : "No upcoming events yet"}
        actions={
          narrowed ? (
            <button type="button" onClick={onReset} className={buttonClasses({ variant: "secondary", size: "small" })}>
              Clear filters
            </button>
          ) : undefined
        }
      >
        {narrowed ? "Try another format, country or chapter, or clear the filters to see everything." : "Events from members and chapters will appear here."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group, index) => (
        <section key={group.key} aria-labelledby={`events-group-${index}`} className="flex flex-col gap-4">
          <h2 id={`events-group-${index}`} className="text-h3 text-ink">
            {group.label}
          </h2>
          <ul className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-3 max-sm:gap-4">
            {group.events.map((event) => (
              <li
                key={event.id}
                className={cn("flex", event.id in added && "motion-fade-up")}
                style={event.id in added ? staggerStyle(added[event.id]!, { step: 50, max: 6 }) : undefined}
              >
                <EventGridCard event={event} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {loading && (
        <ul aria-hidden="true" className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
              <EventGridCardSkeleton />
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div ref={sentinelRef} aria-hidden="true" />
      {error ? (
        <ErrorNotice error={error} onRetry={() => cursor && void load(cursor)} />
      ) : cursor ? (
        <div className="flex justify-center">
          <button type="button" disabled={loading} onClick={() => void load(cursor)} className={buttonClasses({ variant: "secondary", size: "small" })}>
            {loading ? "Loading…" : "Load more events"}
          </button>
        </div>
      ) : (
        events.length > EVENTS_PAGE && <CaughtUpNote title="That’s every event">New events appear as hosts publish them.</CaughtUpNote>
      )}
    </div>
  );
}

/** The filter bar, Upcoming / Past, List / Calendar, the featured event and the list or calendar. */
export function EventsBrowser({
  filters,
  initial,
  error,
  featured,
  options,
  rail,
}: {
  filters: EventFilters;
  initial: Page<EventSummary> | null;
  error: unknown;
  featured: EventSummary | null;
  options: FilterOptions;
  rail: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(filters);
  const shown = pending ? target : filters;
  const [search, setSearch] = useState(filters.q ?? "");
  const searchTimer = useRef<number | undefined>(undefined);

  const go = useCallback(
    (patch: Partial<EventFilters>) => {
      const next = { ...filters, ...patch };
      setTarget(next);
      startTransition(() => router.replace(`${pathname}${eventFiltersQuery(next)}`, { scroll: false }));
    },
    [filters, pathname, router],
  );

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  function onSearch(value: string) {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => go({ q: value.trim() || null }), 350);
  }

  function reset() {
    setSearch("");
    go({ format: null, category: null, country: null, chapter: null, q: null });
  }

  const showFeatured = Boolean(featured) && shown.view === "list" && shown.when === "upcoming" && !hasNarrowingFilters(shown);
  const listKey = eventFiltersQuery({ ...filters, view: "list" });

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {shown.view === "list" ? (
            <div role="tablist" aria-label="Upcoming or past events" className="flex gap-6 border-b border-line">
              {whenTabs.map((tab) => {
                const selected = shown.when === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="events-panel"
                    onClick={() => go({ when: tab.value })}
                    className={cn(
                      "-mb-px border-b-2 pb-2 text-md font-medium transition-colors",
                      selected ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-secondary">All events in the month, in your time zone.</p>
          )}
          <div role="group" aria-label="Events view" className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-[3px]">
            {views.map((item) => {
              const selected = shown.view === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => go({ view: item.value })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    selected ? "bg-card text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
                  )}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Format" className="flex flex-wrap gap-2">
            <ToggleChip active={!shown.format} onClick={() => go({ format: null })}>
              All formats
            </ToggleChip>
            {EventFormat.options.map((format) => (
              <ToggleChip key={format} active={shown.format === format} onClick={() => go({ format: shown.format === format ? null : format })}>
                {EVENT_FORMAT_LABELS[format]}
              </ToggleChip>
            ))}
          </div>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-line max-md:hidden" />
          <FilterSelect
            label="Category"
            value={shown.category ?? ""}
            onChange={(e) => go({ category: e.target.value || null })}
            options={[{ value: "", label: "All categories" }, ...options.categories.map((c) => ({ value: c.slug, label: c.name }))]}
          />
          <FilterSelect
            label="Country"
            value={shown.country ?? ""}
            onChange={(e) => go({ country: e.target.value || null })}
            options={[{ value: "", label: "Any country" }, ...options.countries]}
            className="max-w-44"
          />
          <FilterSelect
            label="Chapter"
            value={shown.chapter ?? ""}
            onChange={(e) => go({ chapter: e.target.value || null })}
            options={[{ value: "", label: "Any chapter" }, { value: "mine", label: "Chapters I follow" }, ...options.chapters]}
            className="max-w-48"
          />
          <label className="flex h-[34px] min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-disabled focus-within:border-primary-light focus-within:ring-2 focus-within:ring-primary-light/20 hover:border-line-strong max-sm:min-w-full">
            <Icon name="search" size={16} className="shrink-0" />
            <span className="sr-only">Search events</span>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search events"
              className="h-full w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
          </label>
          {hasNarrowingFilters(shown) && (
            <button type="button" onClick={reset} className="text-sm font-medium text-primary-light hover:underline">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-start gap-6">
        <div id="events-panel" role={shown.view === "list" ? "tabpanel" : undefined} aria-busy={pending || undefined} className={cn("flex min-w-0 flex-1 flex-col gap-6 transition-opacity", pending && "opacity-60")}>
          {shown.view === "list" ? (
            <>
              {showFeatured && featured && <FeaturedEvent event={featured} />}
              {initial ? (
                <EventList key={listKey} initial={initial} filters={filters} excludeId={showFeatured ? (featured?.id ?? null) : null} onReset={reset} />
              ) : (
                <ErrorNotice error={error} onRetry={() => router.refresh()} />
              )}
            </>
          ) : (
            <EventsCalendar filters={filters} onNavigate={(patch) => go(patch)} />
          )}
        </div>
        {rail}
      </div>
    </>
  );
}

/** "My events" link for the page header. */
export function MyEventsLink() {
  return (
    <Link href="/events/mine" className={buttonClasses({ variant: "secondary", className: "max-sm:px-3" })}>
      <Icon name="calendar" size={18} />
      <span className="max-sm:sr-only">My events</span>
    </Link>
  );
}
