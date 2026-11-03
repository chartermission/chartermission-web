"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import type { FeedQuery, Taxonomies } from "@chartermission/contracts";
import { FilterSelect, SegmentedControl, chipClasses, cn } from "@chartermission/ui";

const views = [
  { value: "for_you", label: "For you" },
  { value: "following", label: "Following" },
  { value: "latest", label: "Latest" },
] as const;

type Tab = (typeof views)[number]["value"];

/**
 * Feed tabs and filters (CM-FED-04). State lives in the URL (?tab=&country=&sector=&chapter=&announcements=)
 * so views are linkable and the server renders the first page.
 */
export function FeedControls({ query: serverQuery, taxonomies }: { query: FeedQuery; taxonomies: Pick<Taxonomies, "countries" | "sectors" | "chapters"> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useOptimistic(serverQuery);

  function navigate(patch: Partial<Record<"tab" | "country" | "sector" | "chapter" | "announcements", string | undefined>>) {
    const current: Record<string, string | undefined> = {
      tab: query.tab === "for_you" ? undefined : query.tab,
      country: query.country,
      sector: query.sector,
      chapter: query.chapter,
      announcements: query.announcements ? "true" : undefined,
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
    const qs = params.toString();
    startTransition(() => {
      setQuery({
        ...query,
        tab: (current.tab as Tab | undefined) ?? "for_you",
        country: current.country,
        sector: current.sector,
        chapter: current.chapter,
        announcements: current.announcements === "true",
      });
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const filtered = !!(query.country || query.sector || query.chapter || query.announcements);

  return (
    <div className={cn("flex flex-col gap-2.5 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <SegmentedControl<Tab> label="Feed view" items={views} value={query.tab} onChange={(tab) => navigate({ tab: tab === "for_you" ? undefined : tab })} className="self-start" />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the feed">
        <FilterSelect
          label="Country"
          style={{ maxWidth: 168 }}
          value={query.country ?? ""}
          onChange={(event) => navigate({ country: event.target.value || undefined })}
          options={[{ value: "", label: "All countries" }, ...taxonomies.countries.map((c) => ({ value: c.code, label: c.name }))]}
        />
        <FilterSelect
          label="Sector"
          style={{ maxWidth: 168 }}
          value={query.sector ?? ""}
          onChange={(event) => navigate({ sector: event.target.value || undefined })}
          options={[{ value: "", label: "All sectors" }, ...taxonomies.sectors.map((s) => ({ value: s.slug, label: s.name }))]}
        />
        <FilterSelect
          label="Chapter"
          style={{ maxWidth: 168 }}
          value={query.chapter ?? ""}
          onChange={(event) => navigate({ chapter: event.target.value || undefined })}
          options={[{ value: "", label: "All chapters" }, ...taxonomies.chapters.map((c) => ({ value: c.slug, label: c.name }))]}
        />
        <button
          type="button"
          aria-pressed={!!query.announcements}
          onClick={() => navigate({ announcements: query.announcements ? undefined : "true" })}
          className={chipClasses(query.announcements ? "active" : "filter", "cursor-pointer")}
        >
          Announcements
        </button>
        {filtered && (
          <button
            type="button"
            onClick={() => navigate({ country: undefined, sector: undefined, chapter: undefined, announcements: undefined })}
            className="rounded-sm text-sm font-medium text-primary-light hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
