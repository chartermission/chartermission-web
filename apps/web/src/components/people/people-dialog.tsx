"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeoplePage, PersonEntry } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Dialog } from "@/components/social/dialog";
import { MemberRow } from "@/components/network/member-row";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useT } from "@/i18n/client";

type Kind = "like" | "insightful" | "support";
const KINDS: Kind[] = ["like", "insightful", "support"];
const KIND_ICON = { like: "like", insightful: "lightbulb", support: "users" } as const;
const KIND_COLOR = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" } as const;

export type PeopleSource = {
  /** API path that answers with a PeoplePage, e.g. /posts/{id}/reactions. */
  path: string;
  title: string;
  /** Reaction lists get a tab per reaction. */
  reactions?: boolean;
  /** Shown when the list is empty. */
  empty?: string;
};

/**
 * The members behind a count, in a popup: who reacted, commented or reposted, or a member's
 * connections and followers. Each row links to the profile and offers Connect and Follow.
 * Loads 20 at a time; more arrive as the list is scrolled (and with a button, for keyboards).
 */
export function PeopleDialog({ source, onClose }: { source: PeopleSource; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Kind | null>(null);
  const [items, setItems] = useState<PersonEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [byReaction, setByReaction] = useState<PeoplePage["byReaction"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const sentinel = useRef<HTMLLIElement>(null);

  type Next = { kind: Kind | null; cursor: string | null; reset: boolean };

  /** Fetch a page. Resolves with null when a newer request has replaced this one. */
  const fetchPage = useCallback(
    (next: Next): Promise<{ page: PeoplePage; reset: boolean } | { failed: string } | null> => {
      const mine = ++request.current;
      return api<PeoplePage>(source.path, { query: { kind: next.kind ?? undefined, cursor: next.cursor ?? undefined, limit: 20 } }).then(
        (page) => (mine === request.current ? { page, reset: next.reset } : null),
        (e: unknown) => (mine === request.current ? { failed: e instanceof ApiError ? e.message : t("common.tryAgain") } : null),
      );
    },
    [source.path, t],
  );

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchPage>>) => {
    if (!result) return;
    setLoading(false);
    if ("failed" in result) {
      setError(result.failed);
      return;
    }
    const { page, reset } = result;
    setItems((current) => (reset || !current ? page.items : [...current, ...page.items.filter((p) => !current.some((c) => c.id === p.id))]));
    setCursor(page.nextCursor);
    setTotal(page.total);
    setByReaction(page.byReaction);
    setError(null);
  }, []);

  const load = (next: Next) => {
    setLoading(true);
    setError(null);
    void fetchPage(next).then(apply);
  };

  // First page on opening (the dialog starts in its loading state).
  useEffect(() => {
    void fetchPage({ kind: null, cursor: null, reset: true }).then(apply);
  }, [fetchPage, apply]);

  // Fetch the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setLoading(true);
      void fetchPage({ kind, cursor, reset: false }).then(apply);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loading, kind, fetchPage, apply]);

  function pick(next: Kind | null) {
    if (next === kind) return;
    setKind(next);
    setItems(null);
    setCursor(null);
    load({ kind: next, cursor: null, reset: true });
  }

  const tabs = source.reactions && byReaction && total ? KINDS.filter((k) => byReaction[k] > 0) : [];

  return (
    <Dialog title={total === null ? source.title : `${source.title} · ${total.toLocaleString()}`} onClose={onClose} width={520} flush>
      {tabs.length > 1 && (
        <div role="tablist" aria-label={source.title} className="flex gap-1 overflow-x-auto border-b border-line px-4">
          {[null, ...tabs].map((k) => {
            const selected = k === kind;
            return (
              <button
                key={k ?? "all"}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => pick(k)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm outline-none focus-visible:bg-primary-tint-2",
                  selected ? "border-primary font-semibold text-ink" : "border-transparent text-secondary hover:text-ink",
                )}
              >
                {k && (
                  <span className={cn("flex size-[18px] items-center justify-center rounded-full text-inverse", KIND_COLOR[k])}>
                    <Icon name={KIND_ICON[k]} size={10} />
                  </span>
                )}
                {k ? t(`reaction.${k}`) : t("people.all")}
                <span className="text-xs text-secondary tabular-nums">{(k ? byReaction![k] : total!).toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="max-h-[min(60dvh,560px)] min-h-40 overflow-y-auto">
        {items && items.length > 0 && (
          <ul className="divide-y divide-line">
            {items.map((person) => (
              <PersonRow key={person.id} person={person} showReaction={!!source.reactions && !kind} />
            ))}
            {cursor && (
              <li ref={sentinel} className="flex justify-center px-5 py-3">
                <Button variant="ghost" size="small" disabled={loading} onClick={() => load({ kind, cursor, reset: false })}>
                  {loading ? t("common.loading") : t("common.loadMore")}
                </Button>
              </li>
            )}
          </ul>
        )}
        {items && items.length === 0 && !loading && !error && <p className="px-5 py-10 text-center text-sm text-secondary">{source.empty ?? t("people.empty")}</p>}
        {!items && loading && (
          <ul aria-hidden className="divide-y divide-line">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3.5">
                <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="h-3 w-40 animate-pulse rounded bg-muted" />
                  <span className="h-2.5 w-56 animate-pulse rounded bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <p className="text-sm text-body">{error}</p>
            <Button variant="secondary" size="small" onClick={() => load({ kind, cursor: items ? cursor : null, reset: !items })}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {loading ? t("common.loading") : ""}
        </p>
      </div>
    </Dialog>
  );
}

function PersonRow({ person, showReaction }: { person: PersonEntry; showReaction: boolean }) {
  const t = useT();
  return (
    <MemberRow
      member={person}
      avatarBadge={
        showReaction && person.reaction ? (
          <span
            title={t(`reaction.${person.reaction}`)}
            className={cn("absolute -end-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full border-2 border-card text-inverse", KIND_COLOR[person.reaction])}
          >
            <Icon name={KIND_ICON[person.reaction]} size={9} label={t(`reaction.${person.reaction}`)} />
          </span>
        ) : undefined
      }
    />
  );
}
