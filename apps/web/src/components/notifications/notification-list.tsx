"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationView, NotificationsQuery, Page, UnreadCount } from "@chartermission/contracts";
import { Button, Icon, Panel, cn, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ErrorNotice } from "@/components/social/errors";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";

type Filter = NotificationsQuery["filter"];

const iconFor: Record<NotificationView["icon"], { name: IconName; className: string }> = {
  avatar: { name: "user", className: "bg-primary-tint text-primary" },
  trending: { name: "trending", className: "bg-accent-light text-accent" },
  briefcase: { name: "briefcase", className: "bg-info-light text-info" },
  calendar: { name: "calendar", className: "bg-info-light text-info" },
  lightbulb: { name: "lightbulb", className: "bg-warning-light text-warning" },
  shield: { name: "shield", className: "bg-error-light text-error" },
  users: { name: "users", className: "bg-success-light text-success" },
  flag: { name: "flag", className: "bg-error-light text-error" },
  alert: { name: "alert", className: "bg-warning-light text-warning" },
  check: { name: "check", className: "bg-success-light text-success" },
  clock: { name: "clock", className: "bg-primary-tint text-primary" },
};

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mentions", label: "Mentions" },
];

function Item({ item, onOpen }: { item: NotificationView; onOpen: (item: NotificationView) => void }) {
  const actor = item.actors[0];
  const icon = iconFor[item.icon];
  const text = item.segments.map((s) => s.text).join("");
  return (
    <li className={cn("relative flex items-start gap-3 px-5 py-4 max-sm:px-4", !item.read && "bg-primary-tint-2")}>
      <span className="relative shrink-0" aria-hidden="true">
        {item.icon === "avatar" && actor ? (
          <MemberAvatar member={actor} size={40} />
        ) : (
          <span className={cn("flex size-10 items-center justify-center rounded-full", icon.className)}>
            <Icon name={icon.name} size={20} />
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={item.href}
          onClick={() => onOpen(item)}
          className="text-sm text-body after:absolute after:inset-0 hover:text-ink focus-visible:outline-none"
          aria-label={`${item.read ? "" : "Unread: "}${text}`}
        >
          {item.segments.map((segment, index) =>
            segment.strong ? (
              <strong key={index} className="font-semibold text-ink">
                {segment.text}
              </strong>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </Link>
        <p className="text-xs text-secondary">
          <TimeAgo iso={item.createdAt} />
        </p>
      </div>
      {!item.read && (
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      )}
    </li>
  );
}

/**
 * Notifications (CM-NTF-01): All / Mentions, unread styling, mark one (on open) or all as read
 * (POST /notifications/read), "Load more". router.refresh() clears the top-nav badge.
 */
export function NotificationList({ initial, initialFilter, unread: initialUnread }: { initial: Page<NotificationView>; initialFilter: Filter; unread: number }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load(nextFilter: Filter, nextCursor: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<NotificationView>>("/notifications", { query: { filter: nextFilter, cursor: nextCursor ?? undefined } });
      setItems((current) => (nextCursor ? [...current, ...page.items.filter((n) => !current.some((x) => x.id === n.id))] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  function switchFilter(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    setItems([]);
    setCursor(null);
    void load(next, null);
    window.history.replaceState(null, "", next === "all" ? "/notifications" : `/notifications?filter=${next}`);
  }

  async function markAll() {
    const before = items;
    setItems((current) => current.map((n) => ({ ...n, read: true })));
    try {
      const result = await api<UnreadCount>("/notifications/read", { method: "POST", body: { all: true } });
      setUnread(result.unread);
      toast.success("All notifications marked as read");
      router.refresh();
    } catch (e) {
      setItems(before);
      toast.error(e);
    }
  }

  function open(item: NotificationView) {
    if (item.read) return;
    setItems((current) => current.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    // Fire and forget: navigation continues; the badge refreshes with the next page render.
    void api<UnreadCount>("/notifications/read", { method: "POST", body: { ids: [item.id] } })
      .then(() => router.refresh())
      .catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter notifications" className="inline-flex gap-1 rounded-[10px] bg-muted p-1">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => switchFilter(item.value)}
              className={cn(
                "rounded-[7px] px-3.5 py-1.5 text-sm",
                filter === item.value ? "bg-card font-medium text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-secondary" aria-live="polite">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </p>
          <Button variant="secondary" size="small" onClick={markAll} disabled={unread === 0 && items.every((n) => n.read)}>
            <Icon name="check" size={16} />
            Mark all as read
          </Button>
        </div>
      </div>

      <Panel aria-busy={loading} className="overflow-hidden">
        {items.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <Item key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
        )}
        {loading && (
          <p role="status" className="px-5 py-6 text-center text-sm text-secondary">
            Loading notifications…
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
              <Icon name={filter === "mentions" ? "at" : "bell"} size={24} />
            </span>
            <p className="text-md font-medium text-ink">{filter === "mentions" ? "No mentions yet" : "No notifications yet"}</p>
            <p className="max-w-sm text-sm text-secondary">
              {filter === "mentions"
                ? "When someone mentions you with @your-handle in a post or comment, it shows up here."
                : "Comments, reactions, connection requests and updates about your reports show up here."}
            </p>
          </div>
        )}
        {error ? <ErrorNotice error={error} onRetry={() => load(filter, cursor)} className="m-4" /> : null}
      </Panel>
      {!loading && cursor && (
        <Button variant="secondary" block onClick={() => load(filter, cursor)}>
          Load more
        </Button>
      )}
    </div>
  );
}
