"use client";

import { useEffect, useRef, useState } from "react";
import { PAGE_CATEGORY_LABELS, PageCategory, type Page, type PageSummary } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { api } from "@/lib/api/client";
import { PageCard } from "./page-card";

const LIMIT = 24;

/** The pages directory: search, a category filter and "Load more" over GET /pages. */
export function PageDirectory({ initial }: { initial: Page<PageSummary> }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<PageCategory | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const first = useRef(true);

  // Search as you type (debounced); the first render already has the first page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api<Page<PageSummary>>("/pages", { query: { q: q.trim(), category, limit: LIMIT }, signal: controller.signal })
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
  }, [q, category]);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api<Page<PageSummary>>("/pages", { query: { q: q.trim(), category, limit: LIMIT, cursor } });
      setItems((current) => [...current, ...page.items.filter((p) => !current.some((c) => c.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search pages</span>
          <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-secondary" />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search pages by name"
            className="h-11 w-full rounded-lg border border-line bg-card pr-3 pl-10 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
          />
        </label>
        <label>
          <span className="sr-only">Kind of page</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PageCategory | "")}
            className="h-11 cursor-pointer rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
          >
            <option value="">All kinds</option>
            {PageCategory.options.map((value) => (
              <option key={value} value={value}>
                {PAGE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && <ErrorNotice error={error} />}

      {items.length ? (
        <ul aria-busy={loading} className={cn("grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1", loading && "opacity-70")}>
          {items.map((page) => (
            <li key={page.id}>
              <PageCard page={page} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="building" title={q || category ? "No pages match" : "No pages yet"}>
          {q || category ? "Try a different name or kind of page." : "Pages for organisations, companies and initiatives will appear here."}
        </EmptyState>
      )}

      {cursor && (
        <Button variant="secondary" className="self-center" onClick={more} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
