"use client";

import { useEffect, useRef, useState } from "react";
import type { GroupOwnerType, GroupSummary, GroupVisibility, GroupsQuery, Page } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { ChapterFilter } from "@/components/chapters/chapter-picker";
import { SearchField, SelectField } from "@/components/discover/filter-controls";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { GroupCard, GroupGrid } from "./group-card";

const LIMIT = 24;

type Sort = GroupsQuery["sort"];
type Filters = { q: string; visibility: GroupVisibility | ""; ownerType: GroupOwnerType | ""; country: string; chapter: string; sort: Sort };

const EMPTY: Filters = { q: "", visibility: "", ownerType: "", country: "", chapter: "", sort: "active" };

function toQuery(f: Filters, after?: string | null) {
  return {
    scope: "all",
    q: f.q.trim() || undefined,
    visibility: f.visibility || undefined,
    ownerType: f.ownerType || undefined,
    country: f.country || undefined,
    chapter: f.chapter || undefined,
    sort: f.sort,
    limit: LIMIT,
    cursor: after ?? undefined,
  };
}

/** Every group (GET /groups): search as you type, filters, sort and "Load more". */
export function GroupDirectory({ initial, countries }: { initial: Page<GroupSummary>; countries: { code: string; name: string }[] }) {
  const t = useT();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const first = useRef(true);

  // Search a moment after typing stops; the first render already has the first page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api<Page<GroupSummary>>("/groups", { query: toQuery(filters), signal: controller.signal })
        .then((page) => {
          setItems(page.items);
          setCursor(page.nextCursor);
        })
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) setError(e);
        })
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters]);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api<Page<GroupSummary>>("/groups", { query: toQuery(filters, cursor) });
      setItems((current) => [...current, ...page.items.filter((g) => !current.some((c) => c.id === g.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const filtered = !!(filters.q.trim() || filters.visibility || filters.ownerType || filters.country || filters.chapter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          label={t("Search groups")}
          placeholder={t("Search groups by name or topic")}
          value={filters.q}
          onChange={(event) => set("q", event.target.value)}
          className="min-w-[240px] flex-1 max-sm:min-w-full"
        />
        <SelectField
          label={t("Visibility")}
          value={filters.visibility}
          onChange={(event) => set("visibility", event.target.value as Filters["visibility"])}
          options={[
            { value: "", label: t("Public and private") },
            { value: "public", label: t("Public") },
            { value: "private", label: t("Private") },
          ]}
          className="w-44 max-sm:w-[calc(50%-6px)]"
        />
        <SelectField
          label={t("Run by")}
          value={filters.ownerType}
          onChange={(event) => set("ownerType", event.target.value as Filters["ownerType"])}
          options={[
            { value: "", label: t("Run by anyone") },
            { value: "member", label: t("Run by members") },
            { value: "page", label: t("Run by pages") },
            { value: "chapter", label: t("Run by chapters") },
          ]}
          className="w-44 max-sm:w-[calc(50%-6px)]"
        />
        <SelectField
          label={t("Country")}
          value={filters.country}
          onChange={(event) => set("country", event.target.value)}
          options={[{ value: "", label: t("Any country") }, ...countries.map((c) => ({ value: c.code, label: c.name }))]}
          className="w-44 max-sm:w-[calc(50%-6px)]"
        />
        <ChapterFilter value={filters.chapter || null} onChange={(chapter) => set("chapter", chapter ?? "")} size="medium" className="w-44 max-sm:w-[calc(50%-6px)]" />
        <SelectField
          label={t("Sort by")}
          value={filters.sort}
          onChange={(event) => set("sort", event.target.value as Sort)}
          options={[
            { value: "active", label: t("Most active") },
            { value: "members", label: t("Most members") },
            { value: "newest", label: t("Newest") },
            { value: "name", label: t("Name (A–Z)") },
          ]}
          className="w-44 max-sm:w-[calc(50%-6px)]"
        />
      </div>

      {error !== null && <ErrorNotice error={error} onRetry={() => setFilters((current) => ({ ...current }))} />}

      {items.length ? (
        <GroupGrid busy={loading}>
          {items.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </GroupGrid>
      ) : (
        !loading && (
          <EmptyState icon="users" title={filtered ? t("No groups match") : t("No groups yet")}>
            {filtered ? t("Try another name, or clear a filter.") : t("Start one around a topic you care about. Members, pages and chapters can all run groups.")}
          </EmptyState>
        )
      )}

      {cursor && (
        <Button variant="secondary" className="self-center" onClick={more} aria-disabled={loading}>
          {loading ? t("Loading…") : t("Load more")}
        </Button>
      )}
    </div>
  );
}
