"use client";

import { useEffect, useRef, useState } from "react";
import type { DirectoryMember, Page } from "@chartermission/contracts";
import { Button } from "@chartermission/ui";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { SearchField } from "@/components/discover/filter-controls";
import { DirectoryMemberCard } from "@/components/network/member-card";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";

/**
 * A chapter's members as directory cards (Connect / Message / Follow), searchable by name,
 * headline or organisation. Members who hide themselves from the directory, and anyone the viewer
 * has blocked, are not listed (GET /members?chapter=).
 */
export function ChapterMemberDirectory({
  slug,
  initial,
}: {
  slug: string;
  initial: Page<DirectoryMember>;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const searched = useRef("");

  async function load(q: string, after: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<DirectoryMember>>("/members", {
        query: {
          chapter: slug,
          q: q || undefined,
          sort: q ? "relevance" : "name",
          cursor: after ?? undefined,
          limit: 24,
        },
      });
      if (searched.current !== q) return; // a newer search is on its way
      setItems((current) =>
        after
          ? [
              ...current,
              ...page.items.filter((m) => !current.some((c) => c.id === m.id)),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  // Search as the member types, a moment after they stop.
  useEffect(() => {
    const q = query.trim();
    if (q === searched.current) return;
    const timer = window.setTimeout(() => {
      searched.current = q;
      void load(q, null);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <section
      aria-labelledby="chapter-members-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="chapter-members-heading" className="text-h3 text-ink">
          {t("Members")}
        </h2>
        <SearchField
          label={t("Search members")}
          placeholder={t("Search by name, headline or organisation")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full sm:w-80"
        />
      </div>
      {error ? (
        <ErrorNotice
          error={error}
          onRetry={() => void load(searched.current, null)}
        />
      ) : null}
      {items.length === 0 && !loading ? (
        <EmptyState
          icon="users"
          title={
            query.trim()
              ? t("No members match your search")
              : t("No members yet")
          }
        >
          {query.trim()
            ? t("Try another name or word.")
            : t("Be the first to join this chapter.")}
        </EmptyState>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy={loading}
        >
          {items.map((member) => (
            <li key={member.id} className="flex">
              <DirectoryMemberCard member={member} />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void load(searched.current, cursor)}
            aria-disabled={loading}
          >
            {loading ? t("Loading…") : t("Show more members")}
          </Button>
        </div>
      )}
    </section>
  );
}
