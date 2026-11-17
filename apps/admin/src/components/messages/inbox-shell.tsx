"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminInboxItem, AdminInboxPage } from "@chartermission/contracts";
import { Avatar, Button, Icon, SegmentedControl, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { SkeletonBar } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

const PAGE_SIZE = 25;
const POLL_MS = 15_000;

type Filter = "all" | "unread";
type InboxApi = {
  /** The open thread was read: drop its unread dot. Returns whether it had one. */
  markRead: (conversationId: string) => boolean;
  /** Something changed (a reply went out): fetch the list again quietly. */
  refresh: () => void;
};

const InboxContext = createContext<InboxApi>({ markRead: () => false, refresh: () => {} });
export const useInbox = () => useContext(InboxContext);

/**
 * The Charter Mission inbox: members' official conversations on the left, the open one on the right
 * (one at a time on small screens). The list refreshes every 15 seconds.
 */
export function InboxShell({ children }: { children: ReactNode }) {
  const params = useParams<{ conversationId?: string }>();
  const selected = typeof params.conversationId === "string" ? params.conversationId : null;
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminInboxItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const loaded = useRef(0);
  const rowsRef = useRef<AdminInboxItem[] | null>(null);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++request.current;
      if (!quiet) setError(null);
      try {
        const limit = quiet ? Math.min(50, Math.max(PAGE_SIZE, loaded.current)) : PAGE_SIZE;
        const page = await api<AdminInboxPage>("/admin/inbox", { query: { filter, q: q.trim() || undefined, limit } });
        if (mine !== request.current) return;
        setRows(page.items);
        setCursor(page.nextCursor);
        setUnreadCount(page.unreadCount);
        loaded.current = page.items.length;
      } catch (e) {
        if (mine !== request.current || quiet) return;
        setError(errorMessage(e));
      }
    },
    [filter, q],
  );

  // Typing waits a moment before searching; a filter change applies at once.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [q, filter, load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    const mine = request.current;
    try {
      const page = await api<AdminInboxPage>("/admin/inbox", { query: { filter, q: q.trim() || undefined, cursor, limit: PAGE_SIZE } });
      if (mine !== request.current) return;
      setRows((list) => {
        const next = [...(list ?? []), ...page.items.filter((i) => !list?.some((o) => o.conversationId === i.conversationId))];
        loaded.current = next.length;
        return next;
      });
      setCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  const markRead = useCallback((conversationId: string) => {
    const row = rowsRef.current?.find((r) => r.conversationId === conversationId);
    if (!row?.unread) return false;
    setRows((list) => list?.map((r) => (r.conversationId === conversationId ? { ...r, unread: false } : r)) ?? list);
    setUnreadCount((n) => (n === null ? n : Math.max(0, n - 1)));
    return true;
  }, []);
  const refresh = useCallback(() => void load(true), [load]);
  const value = useMemo(() => ({ markRead, refresh }), [markRead, refresh]);

  return (
    <InboxContext.Provider value={value}>
      <div className="grid overflow-hidden rounded-card border border-line bg-card lg:h-[calc(100dvh-250px)] lg:min-h-[520px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className={cn("min-h-0 flex-col border-line lg:border-e", selected ? "hidden lg:flex" : "flex")}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <div className="relative flex items-center">
              <Icon name="search" size={16} className="pointer-events-none absolute start-2.5 text-secondary" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, handle or email"
                aria-label="Search conversations"
                className={inputClasses(false, "py-1.5 ps-8 pe-3")}
              />
            </div>
            <SegmentedControl
              label={t("Show")}
              size="small"
              value={filter}
              onChange={setFilter}
              items={[
                { value: "all", label: t("All") },
                { value: "unread", label: unreadCount ? t("Unread ({count})", { count: unreadCount }) : t("Unread") },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={rows === null}>
            {error ? (
              <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-sm text-body">{error}</p>
                <Button variant="secondary" size="small" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : rows === null ? (
              <ul aria-label={t("Loading conversations")}>
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 border-b border-line px-3 py-3">
                    <SkeletonBar className="size-10 rounded-full" />
                    <span className="flex flex-1 flex-col gap-1.5">
                      <SkeletonBar className="h-4 w-1/2" />
                      <SkeletonBar className="h-3 w-3/4" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              q.trim() || filter === "unread" ? (
                <EmptyState icon="search" title={filter === "unread" && !q.trim() ? t("No unread conversations") : t("No conversations match")}>
                  {filter === "unread" && !q.trim() ? "You’re all caught up." : "Try a different search."}
                </EmptyState>
              ) : (
                <EmptyState icon="message" title={t("No conversations yet")}>
                  When members reply to a message from Charter Mission, or you write to one from Members, the conversation appears here.
                </EmptyState>
              )
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((row) => (
                  <InboxRow key={row.conversationId} row={row} active={row.conversationId === selected} />
                ))}
              </ul>
            )}
            {rows && cursor && (
              <div className="flex justify-center border-t border-line px-3 py-3">
                <Button variant="secondary" size="small" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void more()}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className={cn("min-h-[480px] min-w-0 flex-col lg:min-h-0", selected ? "flex" : "hidden lg:flex")}>{children}</div>
      </div>
    </InboxContext.Provider>
  );
}

function InboxRow({ row, active }: { row: AdminInboxItem; active: boolean }) {
  const t = useT();
  const last = row.lastMessage;
  const excerpt = last ? last.body.replace(/\s+/g, " ").trim() || t("Attachment") : null;
  return (
    <li>
      <Link
        href={`/messages/inbox/${row.conversationId}`}
        aria-current={active ? "page" : undefined}
        className={cn("flex items-start gap-3 px-3 py-3 transition-colors", active ? "bg-primary-tint" : "hover:bg-surface")}
      >
        <Avatar name={row.member.name} src={row.member.avatarUrl ?? undefined} tone={row.member.tone} size={40} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("flex min-w-0 items-center gap-1 truncate text-sm", row.unread ? "font-semibold text-ink" : "font-medium text-ink")}>
              <NoTranslate>
                <span className="truncate">{row.member.name}</span>
              </NoTranslate>
              {row.member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary-light" label={t("Verified")} />}
            </span>
            {last && <Age iso={last.at} className="shrink-0 text-xs text-secondary" />}
          </span>
          <span className="truncate text-xs text-secondary">
            @{row.member.handle} · {row.member.email}
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", row.unread ? "text-ink" : "text-secondary")}>
              {excerpt === null ? (
                <span className="italic">No messages yet</span>
              ) : last && !last.fromMember ? (
                <>
                  {t("You:")} <NoTranslate>{excerpt}</NoTranslate>
                </>
              ) : (
                <NoTranslate>{excerpt}</NoTranslate>
              )}
            </span>
            {row.unread && (
              <span className="size-2.5 shrink-0 rounded-full bg-accent">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The right pane when no conversation is open (wide screens). */
export function InboxPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState icon="message" title="Choose a conversation">
        Members’ replies to Charter Mission arrive here. Answer them as Charter Mission; every reply shows who on the team wrote it.
      </EmptyState>
    </div>
  );
}
