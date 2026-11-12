"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ConversationView, MessageSearchHit, MessagesConfig } from "@chartermission/contracts";
import { Button, Icon, Panel, cn } from "@chartermission/ui";
import { EmptyState } from "@/components/social/skeletons";
import { NoTranslate } from "@/i18n/auto";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { api } from "@/lib/api/client";
import { NewMessageDialog } from "./group-dialogs";
import { announceMessagesChanged, onMessagesChanged } from "./messages-events";
import { enablePush, pushState, type PushState } from "./push";
import { subscribeMessages } from "./stream";
import { ConversationAvatar, Thread } from "./thread";

type Box = "inbox" | "requests" | "archived";
const LIST_POLL_MS = 60000;

/** "14:05" today, "Mon" this week, "3 Nov" earlier. */
function useShortWhen() {
  const { locale } = useLocale();
  const tag = INTL_LOCALE[locale];
  return (iso: string) => {
    const date = new Date(iso);
    if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
    if (Date.now() - date.getTime() < 6 * 24 * 3600_000) return date.toLocaleDateString(tag, { weekday: "short" });
    return date.toLocaleDateString(tag, { day: "numeric", month: "short" });
  };
}

/**
 * Messages: conversations (inbox, requests, archived, and search) on one side and the open
 * conversation on the other — one at a time on a phone. Updates arrive live.
 */
export function MessagesView({
  viewerId,
  viewerHandle,
  initial,
  activeId,
  focusMessageId = null,
}: {
  viewerId: string;
  viewerHandle: string;
  initial: ConversationView[];
  activeId: string | null;
  focusMessageId?: string | null;
}) {
  const t = useT();
  const short = useShortWhen();
  const [box, setBox] = useState<Box>("inbox");
  const [lists, setLists] = useState<Record<Box, ConversationView[] | null>>({ inbox: initial, requests: null, archived: null });
  const [requests, setRequests] = useState(0);
  const [composing, setComposing] = useState(false);
  const [config, setConfig] = useState<MessagesConfig | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; hits: MessageSearchHit[] } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [inbox, unread] = await Promise.all([
        api<ConversationView[]>("/messages/conversations", { query: { box: "inbox" } }),
        api<{ unread: number; requests: number }>("/messages/unread"),
      ]);
      setRequests(unread.requests);
      const others = await Promise.all(
        (["requests", "archived"] as const).map((b) => (b === box ? api<ConversationView[]>("/messages/conversations", { query: { box: b } }) : Promise.resolve(null))),
      );
      setLists((current) => ({ inbox, requests: others[0] ?? current.requests, archived: others[1] ?? current.archived }));
    } catch {
      // Keep what we have; the next event or poll tries again.
    }
  }, [box]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the folder's list loads when the tab changes
    void reload();
  }, [reload]);

  useEffect(() => {
    api<MessagesConfig>("/messages/config")
      .then(async (c) => {
        setConfig(c);
        setPush(await pushState(c).catch(() => "unsupported" as const));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let pending: number | undefined;
    const soon = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => void reload(), 400);
    };
    const off = subscribeMessages((event) => {
      if (event.type !== "typing") soon();
    });
    const offChanged = onMessagesChanged(soon);
    const timer = window.setInterval(() => document.visibilityState === "visible" && void reload(), LIST_POLL_MS);
    return () => {
      off();
      offChanged();
      window.clearInterval(timer);
      window.clearTimeout(pending);
    };
  }, [reload]);

  // Search across all messages.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api<MessageSearchHit[]>("/messages/search", { query: { q } })
        .then((r) => live && setFound({ q, hits: r }))
        .catch(() => live && setFound({ q, hits: [] }));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const list = lists[box];
  const searching = query.trim().length >= 2;
  const hits = searching ? (found?.q === query.trim() ? found.hits : found?.hits ?? []) : null;

  function preview(c: ConversationView) {
    const last = c.lastMessage;
    if (!last) return c.request === "incoming" ? t("Wants to message you") : "";
    if (last.deleted) return t("Message deleted");
    if (last.removed) return t("Message removed");
    const who = last.mine ? `${t("You")}: ` : c.kind !== "direct" && last.kind !== "system" ? `${last.senderName}: ` : "";
    const body =
      last.body ||
      (last.kind === "voice" ? t("Voice message") : last.kind === "meeting" ? t("Meeting invitation") : last.kind === "share" ? t("Shared a link") : t("Attachment"));
    return `${who}${body}`;
  }

  return (
    <Panel
      className={cn(
        "flex h-[calc(100dvh-140px)] min-h-[420px] overflow-hidden",
        activeId ? "max-md:h-[calc(100dvh-110px)]" : "max-md:h-[calc(100dvh-137px-env(safe-area-inset-bottom))]",
      )}
    >
      <aside aria-label={t("Conversations")} className={cn("flex w-[340px] shrink-0 flex-col border-e border-line max-md:w-full max-md:border-e-0", activeId && "max-md:hidden")}>
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <h1 className="text-h3 text-ink">{t("Messages")}</h1>
          <Button size="small" onClick={() => setComposing(true)}>
            <Icon name="plus" size={16} />
            {t("New")}
          </Button>
        </div>
        <div className="px-4 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
            <Icon name="search" size={15} />
            <span className="sr-only">{t("Search messages")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search messages")}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
          </label>
        </div>
        {hits === null && (
          <div role="tablist" aria-label={t("Folders")} className="flex gap-1 border-b border-line px-3">
            {(
              [
                ["inbox", t("Inbox")],
                ["requests", t("Requests")],
                ["archived", t("Archived")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={box === key}
                onClick={() => setBox(key)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm font-medium",
                  box === key ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink",
                )}
              >
                {label}
                {key === "requests" && requests > 0 && (
                  <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-semibold text-inverse">{requests}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {push === "off" && config?.pushPublicKey && hits === null && (
          <div className="flex items-center gap-3 border-b border-line bg-primary-tint-2 px-4 py-2.5">
            <Icon name="bell" size={18} className="shrink-0 text-primary" />
            <p className="flex-1 text-xs text-ink">{t("Get notified about new messages when Charter Mission isn’t open.")}</p>
            <Button
              size="small"
              variant="secondary"
              onClick={() =>
                void enablePush(config)
                  .then(setPush)
                  .catch(() => setPush("off"))
              }
            >
              {t("Turn on")}
            </Button>
          </div>
        )}

        {hits !== null ? (
          <ul className="flex-1 overflow-y-auto" aria-label={t("Search results")}>
            {hits.length === 0 ? (
              <li className="p-6 text-center text-sm text-secondary">{t("No messages match that search.")}</li>
            ) : (
              hits.map((hit) => (
                <li key={hit.message.id}>
                  <Link href={`/messages/${hit.conversation.id}?around=${hit.message.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted">
                    <ConversationAvatar conversation={hit.conversation} size={32} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{hit.conversation.title}</span>
                        <span className="shrink-0 text-xs text-secondary">{short(hit.message.createdAt)}</span>
                      </span>
                      <span dir="auto" className="line-clamp-2 text-xs text-secondary">
                        <NoTranslate>{hit.message.body}</NoTranslate>
                      </span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        ) : !list ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : list.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Icon name={box === "archived" ? "archive" : "message"} size={28} className="text-secondary" />
            <p className="text-md font-medium text-ink">
              {box === "requests" ? t("No message requests") : box === "archived" ? t("Nothing archived") : t("No messages yet")}
            </p>
            <p className="text-sm text-secondary">
              {box === "requests"
                ? t("When someone you aren’t connected with messages you, it waits here until you accept.")
                : box === "archived"
                  ? t("Archived conversations come back to your inbox when a new message arrives.")
                  : t("Start a conversation with a connection, or create a group.")}
            </p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {list.map((c) => {
              const unread = c.unread > 0 || c.markedUnread;
              return (
                <li key={c.id}>
                  <Link
                    href={`/messages/${c.id}`}
                    aria-current={c.id === activeId ? "page" : undefined}
                    className={cn("flex items-center gap-3 px-4 py-3 hover:bg-muted", c.id === activeId && "bg-primary-tint-2")}
                  >
                    <ConversationAvatar conversation={c} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("flex min-w-0 items-center gap-1 text-sm text-ink", unread ? "font-semibold" : "font-medium")}>
                          <span className="truncate">{c.title}</span>
                          {c.kind === "group" && <Icon name="users" size={13} className="shrink-0 text-secondary" aria-label={t("Group")} />}
                        </span>
                        {c.lastMessage && <span className="shrink-0 text-xs text-secondary">{short(c.lastMessage.createdAt)}</span>}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span dir="auto" className={cn("min-w-0 flex-1 truncate text-xs", unread ? "font-medium text-ink" : "text-secondary")}>
                          <NoTranslate>{preview(c)}</NoTranslate>
                        </span>
                        {c.muted && <Icon name="bell-off" size={13} className="shrink-0 text-secondary" aria-label={t("Muted")} />}
                        {c.pinned && <Icon name="pin" size={13} className="shrink-0 text-secondary" aria-label={t("Pinned")} />}
                        {unread && (
                          <span className={cn("min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-inverse", c.muted ? "bg-secondary" : "bg-accent")}>
                            {c.unread > 99 ? "99+" : c.unread || ""}
                            <span className="sr-only"> {t("unread")}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className={cn("flex min-w-0 flex-1 flex-col", !activeId && "max-md:hidden")}>
        {activeId ? (
          <Thread
            key={`${activeId}:${focusMessageId ?? ""}`}
            conversationId={activeId}
            viewerId={viewerId}
            viewerHandle={viewerHandle}
            config={config}
            focusMessageId={focusMessageId}
            onActivity={() => {
              void reload();
              announceMessagesChanged();
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon="message" title={t("Choose a conversation")} className="border-0">
              {t("Pick one on the left, or start a new message or group.")}
            </EmptyState>
          </div>
        )}
      </section>

      {composing && <NewMessageDialog viewerHandle={viewerHandle} onClose={() => setComposing(false)} />}
    </Panel>
  );
}
