"use client";

import { useRouter } from "next/navigation";
import { usePathname } from "@/i18n/client";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import type { FeedQuery, PostType, Taxonomies } from "@chartermission/contracts";
import { FilterSelect, Icon, SegmentedControl, chipClasses, cn } from "@chartermission/ui";

const views = [
  { value: "for_you", label: "For you" },
  { value: "following", label: "Following" },
  { value: "latest", label: "Latest" },
] as const;

type Tab = (typeof views)[number]["value"];

/** Post-type chips → `type` (and `unanswered`) query params. */
const types: { value: string; label: string; type?: PostType; unanswered?: boolean }[] = [
  { value: "all", label: "All" },
  { value: "question", label: "Questions", type: "question" },
  { value: "unanswered", label: "Unanswered", type: "question", unanswered: true },
  { value: "celebration", label: "Celebrations", type: "celebration" },
  { value: "request", label: "Looking for", type: "request" },
  { value: "article", label: "Articles", type: "article" },
];

type Param = "tab" | "country" | "sector" | "chapter" | "announcements" | "type" | "unanswered";

/** Feed query → URL params (defaults left out). */
function feedParams(query: FeedQuery, patch: Partial<Record<Param, string | undefined>> = {}) {
  const current: Record<string, string | undefined> = {
    tab: query.tab === "for_you" ? undefined : query.tab,
    type: query.type,
    unanswered: query.type === "question" && query.unanswered ? "true" : undefined,
    country: query.country,
    sector: query.sector,
    chapter: query.chapter,
    announcements: query.announcements ? "true" : undefined,
    ...patch,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
  return params;
}

const activeFilterCount = (query: FeedQuery) => [query.country, query.sector, query.chapter, query.announcements].filter(Boolean).length;

/**
 * Feed tabs, post-type chips and filters (CM-FED-04). State lives in the URL
 * (?tab=&type=&unanswered=&country=&sector=&chapter=&announcements=) so views are linkable
 * and the server renders the first page. Country, sector, chapter and announcements sit
 * in a "Filters" disclosure so the bar stays on one line down to 375px.
 */
export function FeedControls({ query: serverQuery, taxonomies }: { query: FeedQuery; taxonomies: Pick<Taxonomies, "countries" | "sectors" | "chapters"> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useOptimistic(serverQuery);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function navigate(patch: Partial<Record<Param, string | undefined>>) {
    const params = feedParams(query, patch);
    const qs = params.toString();
    const get = (key: Param) => params.get(key) ?? undefined;
    startTransition(() => {
      setQuery({
        ...query,
        tab: (get("tab") as Tab | undefined) ?? "for_you",
        type: get("type") as PostType | undefined,
        unanswered: get("unanswered") === "true",
        country: get("country"),
        sector: get("sector"),
        chapter: get("chapter"),
        announcements: get("announcements") === "true",
      });
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  // Close the filters panel on outside click and Escape (focus back to the button).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = activeFilterCount(query);
  const selectedType = query.type === "question" && query.unanswered ? "unanswered" : (query.type ?? "all");
  const clear = () => navigate({ country: undefined, sector: undefined, chapter: undefined, announcements: undefined });

  return (
    <div className={cn("flex flex-col gap-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="relative flex items-center justify-between gap-2">
        <SegmentedControl<Tab> label="Feed view" items={views} value={query.tab} onChange={(tab) => navigate({ tab: tab === "for_you" ? undefined : tab })} />
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-medium transition-colors",
            open || count ? "border-primary-tint bg-primary-tint text-primary" : "border-line bg-card text-body hover:border-line-strong hover:text-ink",
          )}
        >
          <Icon name="filter" size={16} />
          {/* Narrow screens: icon + count badge once filters are on, so the row never wraps. */}
          <span className={cn(count > 0 && "max-sm:sr-only")}>Filters</span>
          {count > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-inverse">
              {count}
              <span className="sr-only"> active</span>
            </span>
          )}
          <Icon name="chevron-down" size={14} className={cn("transition-transform max-sm:hidden", open && "rotate-180")} />
        </button>

        {open && (
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label="Feed filters"
            className="absolute end-0 top-full z-30 mt-2 flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-3.5 rounded-card border border-line bg-card p-4 shadow-[0px_8px_24px_0px_rgba(26,32,44,0.12)]"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Filter posts</p>
              {count > 0 && (
                <button type="button" onClick={clear} className="rounded-sm text-sm font-medium text-primary-light hover:underline">
                  Clear
                </button>
              )}
            </div>
            {(
              [
                ["Country", "country", "All countries", taxonomies.countries.map((c) => ({ value: c.code, label: c.name }))],
                ["Sector", "sector", "All sectors", taxonomies.sectors.map((s) => ({ value: s.slug, label: s.name }))],
                ["Chapter", "chapter", "All chapters", taxonomies.chapters.map((c) => ({ value: c.slug, label: c.name }))],
              ] as const
            ).map(([label, key, all, options]) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-label text-secondary">{label}</span>
                <FilterSelect
                  label={label}
                  className="w-full [&>select]:w-full [&>select]:py-2"
                  value={query[key] ?? ""}
                  onChange={(event) => navigate({ [key]: event.target.value || undefined })}
                  options={[{ value: "", label: all }, ...options]}
                />
              </label>
            ))}
            <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line pt-3.5">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-ink">Announcements only</span>
                <span className="text-xs text-secondary">Updates from the Charter Mission team</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={!!query.announcements}
                onChange={(event) => navigate({ announcements: event.target.checked ? "true" : undefined })}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="relative h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-card after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-light"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className="self-end rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-inverse hover:bg-primary-light"
            >
              Done
            </button>
          </div>
        )}
      </div>

      <div role="group" aria-label="Post type" className="-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] max-sm:-me-3 max-sm:pe-6 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [&::-webkit-scrollbar]:hidden">
        {types.map((item) => {
          const selected = item.value === selectedType;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => navigate({ type: item.type, unanswered: item.unanswered ? "true" : undefined })}
              className={chipClasses(selected ? "active" : "filter", cn("cursor-pointer", !selected && "hover:border-line-strong hover:text-ink"))}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
