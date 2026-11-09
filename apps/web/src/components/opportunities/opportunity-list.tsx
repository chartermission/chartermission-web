"use client";

import { useState, type ReactNode } from "react";
import type { OpportunitySummary, Page } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { api } from "@/lib/api/client";
import { OpportunityListCard } from "./opportunity-card";

type Query = Record<string, string | number | boolean | undefined>;

/** A page of listings with "Load more" (GET /opportunities or /me/opportunities). */
export function OpportunityList({
  path,
  query,
  initial,
  empty,
  showStatus = false,
  dropUnsaved = false,
}: {
  path: string;
  query: Query;
  initial: Page<OpportunitySummary>;
  empty: ReactNode;
  showStatus?: boolean;
  /** Saved tab: drop a card when it's un-saved. */
  dropUnsaved?: boolean;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<OpportunitySummary>>(path, { query: { ...query, cursor } });
      setItems((current) => [...current, ...page.items.filter((i) => !current.some((c) => c.id === i.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  if (!items.length) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <OpportunityListCard
              item={item}
              showStatus={showStatus}
              onSavedChange={dropUnsaved ? (saved) => !saved && setItems((current) => current.filter((i) => i.id !== item.id)) : undefined}
            />
          </li>
        ))}
      </ul>
      {error ? <ErrorNotice error={error} onRetry={more} /> : null}
      {cursor && (
        <div className="flex justify-center py-2">
          <Button variant="secondary" onClick={more} aria-disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
