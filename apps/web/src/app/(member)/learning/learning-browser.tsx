"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { COURSE_LEVEL_LABELS, type CourseDuration, type CourseLevel, type CourseSummary, type LearningHub, type Page } from "@chartermission/contracts";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { SearchField, SelectField } from "@/components/discover/filter-controls";
import { CaughtUpNote } from "@/components/illustrations";
import { CourseTile, CourseTileSkeleton, courseGridClass } from "@/components/learning/course-tile";
import {
  courseSorts,
  durationOptions,
  emptyFilters,
  filtersToQuery,
  filtersToSearch,
  hasActiveFilters,
  type CourseFilters,
  type CourseSort,
} from "@/components/learning/format";
import { staggerStyle } from "@/components/motion";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { api } from "@/lib/api/client";

const PREFETCH_MARGIN = "0px 0px 800px 0px";
const SEARCH_DEBOUNCE_MS = 350;

export type CatalogueFacets = Pick<LearningHub, "topics" | "languages" | "levels" | "total">;

/** The exact result count when the hub's facet counts can tell it, otherwise null. */
function knownTotal(f: CourseFilters, facets: CatalogueFacets): number | null {
  const narrowing = [f.q, f.topic, f.level, f.language, f.duration, f.free, f.saved].filter(Boolean).length;
  if (narrowing === 0) return facets.total;
  if (narrowing > 1) return null;
  if (f.topic) return facets.topics.find((t) => t.topic.slug === f.topic)?.courses ?? null;
  if (f.level) return facets.levels.find((l) => l.level === f.level)?.courses ?? null;
  if (f.language) return facets.languages.find((l) => l.code === f.language)?.courses ?? null;
  return null;
}

const courses = (n: number) => `${n} ${n === 1 ? "course" : "courses"}`;

/** Cursor-paginated course grid for one set of filters. Remounted (keyed) when they change. */
function CourseGrid({
  initial,
  filters,
  facets,
  toolbar,
  onClear,
  onClearSaved,
}: {
  initial: Page<CourseSummary>;
  filters: CourseFilters;
  facets: CatalogueFacets;
  toolbar: ReactNode;
  onClear: () => void;
  onClearSaved: () => void;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const [added, setAdded] = useState<Record<string, number>>({});
  const inFlight = useRef(false);
  const done = useRef(new Set<string>());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (next: string) => {
      if (inFlight.current || done.current.has(next)) return;
      inFlight.current = true;
      const fromButton = document.activeElement === loadMoreRef.current;
      setLoading(true);
      setError(null);
      setAnnouncement("Loading more courses");
      try {
        const page = await api<Page<CourseSummary>>("/courses", { query: { ...filtersToQuery(filters), cursor: next } });
        done.current.add(next);
        setItems((current) => {
          const seen = new Set(current.map((c) => c.id));
          return [...current, ...page.items.filter((c) => !seen.has(c.id))];
        });
        setAdded((current) => ({ ...current, ...Object.fromEntries(page.items.map((c, order) => [c.id, order])) }));
        setCursor(page.nextCursor);
        setAnnouncement(`${page.items.length === 1 ? "1 more course" : `${page.items.length} more courses`} loaded.${page.nextCursor ? "" : " That’s every course."}`);
        const first = page.items[0];
        if (fromButton && first) {
          requestAnimationFrame(() => gridRef.current?.querySelector<HTMLAnchorElement>(`[data-course-id="${CSS.escape(first.id)}"] h3 a`)?.focus());
        }
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

  const total = cursor ? knownTotal(filters, facets) : items.length;
  const countLabel = total !== null ? courses(total) : `${items.length}+ courses`;
  const onlySaved = filters.saved && !hasActiveFilters({ ...filters, saved: false });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-3 text-sm text-secondary">
          <span role="status" aria-live="polite" className="font-medium text-ink">
            {items.length === 0 ? "No courses" : countLabel}
          </span>
          {hasActiveFilters(filters) && (
            <button type="button" onClick={onClear} className="rounded-sm font-medium text-primary-light hover:underline">
              Clear filters
            </button>
          )}
        </p>
        {toolbar}
      </div>

      {items.length === 0 ? (
        onlySaved ? (
          <EmptyState
            icon="bookmark"
            title="No saved courses yet"
            actions={
              <button type="button" onClick={onClearSaved} className={buttonClasses({ size: "small" })}>
                Browse all courses
              </button>
            }
          >
            Select the bookmark on any course to keep it here. Only you can see what you’ve saved.
          </EmptyState>
        ) : (
          <EmptyState
            icon="search"
            title="No courses match these filters"
            actions={
              <button type="button" onClick={onClear} className={buttonClasses({ variant: "secondary", size: "small" })}>
                Clear filters
              </button>
            }
          >
            Try another topic, a different length, or a broader search.
          </EmptyState>
        )
      ) : (
        <ul ref={gridRef} className={courseGridClass}>
          {items.map((course) => (
            <li
              key={course.id}
              data-course-id={course.id}
              className={cn("flex", course.id in added && "motion-fade-up")}
              style={course.id in added ? staggerStyle(added[course.id]!, { step: 50, max: 6 }) : undefined}
            >
              <CourseTile course={course} />
            </li>
          ))}
          {loading &&
            [0, 1, 2, 3].map((i) => (
              <li key={`skeleton-${i}`} className={cn("flex", i > 0 && "max-sm:hidden")}>
                <CourseTileSkeleton />
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
          <button
            ref={loadMoreRef}
            type="button"
            disabled={loading}
            onClick={() => void load(cursor)}
            className={buttonClasses({ variant: "secondary", size: "small" })}
          >
            {loading ? "Loading…" : "Load more courses"}
          </button>
        </div>
      ) : (
        items.length > initial.items.length && <CaughtUpNote title="That’s every course">New courses arrive from Charter Center as they’re published.</CaughtUpNote>
      )}
    </div>
  );
}

/** Square-check toggle that sits in the filter bar next to the selects. */
function FilterToggle({ pressed, onClick, icon, children }: { pressed: boolean; onClick: () => void; icon?: "bookmark"; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-[38px] items-center justify-center gap-2 rounded-lg border px-3 max-sm:flex-1 text-sm whitespace-nowrap transition-colors",
        pressed ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong hover:text-ink",
      )}
    >
      {icon ? (
        <Icon name={icon} size={16} fill={pressed ? "currentColor" : "none"} />
      ) : (
        <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", pressed ? "border-inverse bg-inverse text-primary" : "border-line-strong")}>
          {pressed && <Icon name="check" size={12} />}
        </span>
      )}
      {children}
    </button>
  );
}

/**
 * The catalogue below the hub: search, topic chips with counts, level / language / duration
 * selects, Free only and Saved toggles, sort, and the grid. Every filter lives in the URL
 * (shareable; back / forward step through filter changes; typing replaces instead).
 */
export function LearningBrowser({
  filters,
  initial,
  error,
  facets,
}: {
  filters: CourseFilters;
  initial: Page<CourseSummary> | null;
  error?: string | null;
  facets: CatalogueFacets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<CourseFilters>(filters);
  const shown = pending ? target : filters;

  /* Search box: debounced into ?q=; reset when the URL changes from elsewhere (back / forward, clear). */
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [sentQ, setSentQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    if (filters.q !== sentQ) {
      setDraft(filters.q);
      setSentQ(filters.q);
    }
  }

  /** The search string of our latest navigation, until it has landed. */
  const wanted = useRef<string | null>(null);
  const hrefFor = useCallback((qs: string) => `${pathname}${qs ? `?${qs}` : ""}`, [pathname]);

  const go = useCallback(
    (next: CourseFilters, mode: "push" | "replace" = "push") => {
      setTarget(next);
      setSentQ(next.q);
      const qs = filtersToSearch(next);
      wanted.current = qs;
      const href = hrefFor(qs);
      startTransition(() => (mode === "push" ? router.push(href, { scroll: false }) : router.replace(href, { scroll: false })));
    },
    [hrefFor, router],
  );

  /*
   * Quick successive changes can race (a cached route resolving after a newer one): once the
   * navigation settles, make sure the URL holds the latest filters. One retry, never a loop.
   */
  useEffect(() => {
    if (pending || wanted.current === null) return;
    const want = wanted.current;
    wanted.current = null;
    if (want !== filtersToSearch(filters)) startTransition(() => router.replace(hrefFor(want), { scroll: false }));
  }, [pending, filters, hrefFor, router]);

  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });
  useEffect(() => {
    const q = draft.trim().slice(0, 100);
    if (q === shownRef.current.q) return;
    const timer = window.setTimeout(() => go({ ...shownRef.current, q }, "replace"), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, go]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = draft.trim().slice(0, 100);
    if (q !== shown.q) go({ ...shown, q }, "replace");
  }

  const update = (patch: Partial<CourseFilters>) => go({ ...shown, ...patch });
  const clearAll = () => {
    setDraft("");
    go({ ...emptyFilters, sort: shown.sort });
  };

  const topics = facets.topics.filter((t) => t.courses > 0 || t.topic.slug === shown.topic);
  const activeTopic = facets.topics.find((t) => t.topic.slug === shown.topic)?.topic;
  const languages = [{ value: "", label: "Any language" }, ...facets.languages.map((l) => ({ value: l.code, label: `${l.name} (${l.courses})` }))];
  if (shown.language && !facets.languages.some((l) => l.code === shown.language)) languages.push({ value: shown.language, label: shown.language });
  const levels = [
    { value: "", label: "Any level" },
    ...(facets.levels.length
      ? facets.levels.map((l) => ({ value: l.level, label: `${COURSE_LEVEL_LABELS[l.level]} (${l.courses})` }))
      : (Object.keys(COURSE_LEVEL_LABELS) as CourseLevel[]).map((level) => ({ value: level, label: COURSE_LEVEL_LABELS[level] }))),
  ];
  const heading = shown.saved ? "Saved courses" : activeTopic ? `${activeTopic.name} courses` : "All courses";
  const gridKey = filtersToSearch(filters);

  const chip = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-[5px] text-sm font-medium whitespace-nowrap transition-colors",
      active ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong hover:text-ink",
    );

  return (
    <section aria-labelledby="course-catalogue-heading" id="courses" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="course-catalogue-heading" className="text-h2 text-ink max-sm:text-h3">
          {heading}
        </h2>
        <p className="text-sm text-secondary">
          {shown.saved ? "Courses you’ve saved. Only you can see this list." : "Browse the full catalogue by topic, level, language and length."}
        </p>
      </div>

      <div role="group" aria-label="Filter by topic" className="relative flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 sm:flex-wrap">
        <button type="button" aria-pressed={!shown.topic} onClick={() => update({ topic: null })} className={chip(!shown.topic)}>
          All topics
          {facets.total > 0 && <span className={cn("text-xs", !shown.topic ? "text-inverse/75" : "text-secondary")}>{facets.total}</span>}
        </button>
        {topics.map(({ topic, courses: count }) => {
          const active = shown.topic === topic.slug;
          return (
            <button key={topic.id} type="button" aria-pressed={active} onClick={() => update({ topic: active ? null : topic.slug })} className={chip(active)}>
              {topic.name}
              <span className={cn("text-xs", active ? "text-inverse/75" : "text-secondary")}>
                {count}
                <span className="sr-only"> {count === 1 ? "course" : "courses"}</span>
              </span>
              {active && <Icon name="x" size={14} />}
              {active && <span className="sr-only">(selected, press to clear)</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-line bg-card p-3 max-sm:p-2.5">
        <form role="search" onSubmit={onSearch} className="min-w-[240px] flex-1 max-sm:min-w-full">
          <SearchField
            label="Search courses"
            name="q"
            placeholder="Search courses, providers or skills"
            value={draft}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
            className="h-[38px] rounded-lg"
          />
        </form>
        <SelectField
          label="Level"
          options={levels}
          value={shown.level ?? ""}
          onChange={(event) => update({ level: (event.target.value || null) as CourseLevel | null })}
          className="w-[168px] max-sm:w-[calc(50%-5px)]"
        />
        <SelectField
          label="Language"
          options={languages}
          value={shown.language ?? ""}
          onChange={(event) => update({ language: event.target.value || null })}
          className="w-[172px] max-sm:w-[calc(50%-5px)]"
        />
        <SelectField
          label="Duration"
          options={[{ value: "", label: "Any length" }, ...durationOptions]}
          value={shown.duration ?? ""}
          onChange={(event) => update({ duration: (event.target.value || null) as CourseDuration | null })}
          className="w-[150px] max-sm:w-full"
        />
        <FilterToggle pressed={shown.free} onClick={() => update({ free: !shown.free })}>
          Free only
        </FilterToggle>
        <FilterToggle pressed={shown.saved} onClick={() => update({ saved: !shown.saved })} icon="bookmark">
          Saved
        </FilterToggle>
      </div>

      <div aria-busy={pending} className={cn("transition-opacity", pending && "pointer-events-none opacity-60")}>
        {initial ? (
          <CourseGrid
            key={gridKey}
            initial={initial}
            filters={filters}
            facets={facets}
            onClear={clearAll}
            onClearSaved={() => update({ saved: false })}
            toolbar={
              <SelectField
                label="Sort by"
                hideLabel={false}
                options={courseSorts}
                value={shown.sort}
                onChange={(event) => update({ sort: event.target.value as CourseSort })}
                className="w-[230px]"
              />
            }
          />
        ) : (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error-light px-3 py-2.5 text-sm">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-error" />
            <p className="flex-1 text-ink">Courses couldn’t load. {error}</p>
            <button type="button" onClick={() => startTransition(() => router.refresh())} className="shrink-0 rounded-sm font-medium text-primary-light hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Updating courses" : ""}
      </p>
    </section>
  );
}

/** Placeholder for the catalogue while the first page loads. */
export function CatalogueSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <span className="motion-shimmer block h-7 w-40 rounded" />
      <div className="flex gap-2 overflow-hidden">
        {[88, 128, 96, 100, 80, 76].map((w, i) => (
          <span key={i} className="motion-shimmer block h-8 shrink-0 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <span className="motion-shimmer block h-16 w-full rounded-card" />
      <div className={courseGridClass}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
            <CourseTileSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
