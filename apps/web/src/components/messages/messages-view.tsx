"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MESSAGE_MAX_CHARS, type ConversationView, type MessagesPage, type MessageView, type PeoplePage, type PersonEntry } from "@chartermission/contracts";
import { Button, Icon, Panel, cn } from "@chartermission/ui";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { EmojiPicker, insertAtCaret } from "@/components/social/emoji-picker";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { NoTranslate } from "@/i18n/auto";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { api } from "@/lib/api/client";
import { announceMessagesChanged } from "./messages-events";

const POLL_MS = 4000;
const LIST_POLL_MS = 20000;

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** "14:05" in the list for today, "Mon" this week, "3 Nov" earlier. */
function useWhen() {
  const { locale } = useLocale();
  const tag = INTL_LOCALE[locale];
  return {
    time: (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }),
    day: (iso: string) => new Date(iso).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" }),
    short: (iso: string) => {
      const date = new Date(iso);
      const age = Date.now() - date.getTime();
      if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
      if (age < 6 * 24 * 3600_000) return date.toLocaleDateString(tag, { weekday: "short" });
      return date.toLocaleDateString(tag, { day: "numeric", month: "short" });
    },
  };
}

/**
 * Private messages: the member's conversations on one side and the open conversation on the
 * other (one at a time on a phone). New messages are fetched every few seconds while the page is
 * in view.
 */
export function MessagesView({ viewerId, viewerHandle, initial, activeId }: { viewerId: string; viewerHandle: string; initial: ConversationView[]; activeId: string | null }) {
  const t = useT();
  const when = useWhen();
  const [conversations, setConversations] = useState(initial);
  const [composing, setComposing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setConversations(await api<ConversationView[]>("/messages/conversations"));
    } catch {
      // The list keeps what it has; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  return (
    <Panel className="flex h-[calc(100dvh-140px)] min-h-[420px] overflow-hidden max-md:h-[calc(100dvh-110px)]">
      <aside aria-label={t("Conversations")} className={cn("flex w-[320px] shrink-0 flex-col border-e border-line max-md:w-full max-md:border-e-0", activeId && "max-md:hidden")}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h1 className="text-h3 text-ink">{t("Messages")}</h1>
          <Button size="small" onClick={() => setComposing(true)}>
            <Icon name="plus" size={16} />
            {t("New message")}
          </Button>
        </div>
        {conversations.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Icon name="message" size={28} className="text-secondary" />
            <p className="text-md font-medium text-ink">{t("No messages yet")}</p>
            <p className="text-sm text-secondary">{t("Start a conversation with one of your connections.")}</p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  aria-current={c.id === activeId ? "page" : undefined}
                  className={cn("flex items-center gap-3 px-4 py-3 hover:bg-muted", c.id === activeId && "bg-primary-tint-2")}
                >
                  <MemberAvatar member={c.member} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm text-ink", c.unread ? "font-semibold" : "font-medium")}>{c.member.name}</span>
                      {c.lastMessage && <span className="shrink-0 text-xs text-secondary">{when.short(c.lastMessage.createdAt)}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span dir="auto" className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "font-medium text-ink" : "text-secondary")}>
                        {c.lastMessage ? (c.lastMessage.deleted ? t("Message deleted") : c.lastMessage.removed ? t("Message removed") : `${c.lastMessage.mine ? `${t("You")}: ` : ""}${c.lastMessage.body}`) : ""}
                      </span>
                      {c.unread > 0 && (
                        <span className="min-w-5 shrink-0 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-semibold text-inverse">
                          {c.unread > 99 ? "99+" : c.unread}
                          <span className="sr-only"> {t("unread")}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className={cn("flex min-w-0 flex-1 flex-col", !activeId && "max-md:hidden")}>
        {activeId ? (
          <Thread key={activeId} conversationId={activeId} viewerId={viewerId} onActivity={reload} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon="message" title={t("Choose a conversation")} className="border-0">
              {t("Pick one on the left, or start a new message to one of your connections.")}
            </EmptyState>
          </div>
        )}
      </section>

      {composing && <NewMessageDialog viewerHandle={viewerHandle} onClose={() => setComposing(false)} />}
    </Panel>
  );
}

/** One conversation: its messages, oldest at the top, and the box to write in. */
function Thread({ conversationId, viewerId, onActivity }: { conversationId: string; viewerId: string; onActivity: () => void }) {
  const t = useT();
  const when = useWhen();
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [items, setItems] = useState<MessageView[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState<MessageView | null>(null);
  const [reporting, setReporting] = useState<MessageView | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<string | null>(null);
  const base = `/messages/conversations/${conversationId}`;

  const toBottom = () => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
  const add = useCallback((fresh: MessageView[]) => {
    if (!fresh.length) return;
    setItems((current) => [...current, ...fresh.filter((m) => !current.some((c) => c.id === m.id))]);
    latest.current = fresh[fresh.length - 1]!.createdAt;
  }, []);
  const markRead = useCallback(async () => {
    await api(`${base}/read`, { method: "POST" }).catch(() => undefined);
    announceMessagesChanged();
    onActivity();
  }, [base, onActivity]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api<MessagesPage>(`${base}/messages`);
        if (!live) return;
        setConversation(page.conversation);
        setItems(page.items);
        setOlder(page.olderCursor);
        latest.current = page.items[page.items.length - 1]?.createdAt ?? null;
        toBottom();
        if (page.conversation.unread) void markRead();
      } catch (e) {
        if (live) setError(e);
      }
    })();
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const page = await api<MessagesPage>(`${base}/messages`, { query: latest.current ? { after: latest.current } : {} });
        if (!live) return;
        setConversation(page.conversation);
        const fromOther = page.items.some((m) => m.senderId !== viewerId);
        const nearBottom = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight < 160 : true;
        if (latest.current) add(page.items);
        else if (page.items.length) {
          setItems(page.items);
          latest.current = page.items[page.items.length - 1]!.createdAt;
        }
        if (page.items.length && nearBottom) toBottom();
        if (fromOther) void markRead();
      } catch {
        // A missed poll is harmless; the next one catches up.
      }
    }, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [base, viewerId, add, markRead]);

  async function loadOlder() {
    if (!older) return;
    try {
      const height = scroller.current?.scrollHeight ?? 0;
      const page = await api<MessagesPage>(`${base}/messages`, { query: { before: older } });
      setItems((current) => [...page.items.filter((m) => !current.some((c) => c.id === m.id)), ...current]);
      setOlder(page.olderCursor);
      // Keep the message the member was reading where it was.
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - height;
      });
    } catch (e) {
      toast.error(e);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const message = await api<MessageView>(`${base}/messages`, { method: "POST", body: { body } });
      add([message]);
      setText("");
      toBottom();
      onActivity();
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
      field.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  async function remove(message: MessageView) {
    const updated = await api<MessageView>(`/messages/${message.id}`, { method: "DELETE" });
    setItems((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    onActivity();
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <ErrorNotice error={error} />
        <Link href="/messages" className="text-sm font-medium text-primary-light hover:underline">
          {t("Back to messages")}
        </Link>
      </div>
    );
  }
  if (!conversation) {
    return (
      <div aria-busy="true" className="flex flex-1 items-center justify-center">
        <span className="block size-6 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
        <span className="sr-only">{t("Loading…")}</span>
      </div>
    );
  }

  const lastMine = [...items].reverse().find((m) => m.senderId === viewerId && !m.deleted);
  const gone = (m: MessageView) => m.deleted || m.removed;
  const seen = !!lastMine && !!conversation.seenAt && conversation.seenAt >= lastMine.createdAt;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/messages" aria-label={t("Back to messages")} className="-ms-1.5 rounded-md p-1.5 text-secondary hover:bg-muted md:hidden">
          <Icon name="chevron-left" size={20} />
        </Link>
        <MemberAvatar member={conversation.member} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Link href={memberHref(conversation.member.handle)} className="truncate text-md font-medium text-ink hover:underline">
            {conversation.member.name}
          </Link>
          {conversation.member.headline && <span className="truncate text-xs text-secondary">{conversation.member.headline}</span>}
        </div>
      </header>

      <div ref={scroller} className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label={t("Messages with {name}", { name: conversation.member.name })}>
        {older && (
          <button type="button" onClick={loadOlder} className="mb-2 self-center rounded-full border border-line px-3 py-1 text-xs font-medium text-secondary hover:bg-muted">
            {t("Show earlier messages")}
          </button>
        )}
        {items.length === 0 && <p className="m-auto max-w-[320px] text-center text-sm text-secondary">{t("This is the start of your conversation with {name}. Say hello.", { name: conversation.member.name })}</p>}
        {items.map((message, index) => {
          const mine = message.senderId === viewerId;
          const previous = items[index - 1];
          const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
          const joined = !newDay && previous?.senderId === message.senderId;
          return (
            <div key={message.id} className="flex flex-col">
              {newDay && <p className="my-3 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-secondary">{when.day(message.createdAt)}</p>}
              <div className={cn("group flex max-w-[78%] items-end gap-1.5", mine ? "flex-row-reverse self-end" : "self-start", joined ? "mt-0.5" : "mt-2")}>
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2 text-sm",
                    gone(message) ? "border border-line bg-card text-secondary italic" : mine ? "bg-primary text-inverse" : "bg-muted text-ink",
                  )}
                >
                  <p dir="auto" className="whitespace-pre-wrap break-words">
                    {message.deleted ? t("This message was deleted") : message.removed ? t("This message was removed by a moderator") : <NoTranslate>{message.body}</NoTranslate>}
                  </p>
                  <p className={cn("mt-0.5 text-end text-[10px]", gone(message) ? "text-secondary" : mine ? "text-inverse/70" : "text-secondary")}>{when.time(message.createdAt)}</p>
                </div>
                {mine && !message.deleted && (
                  <button
                    type="button"
                    aria-label={t("Delete message")}
                    title={t("Delete message")}
                    onClick={() => setDeleting(message)}
                    className="rounded-md p-1 text-secondary opacity-0 hover:bg-muted hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
                {!mine && !gone(message) && (
                  <button
                    type="button"
                    aria-label={t("Report message")}
                    title={t("Report message")}
                    onClick={() => setReporting(message)}
                    className="rounded-md p-1 text-secondary opacity-0 hover:bg-muted hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Icon name="flag" size={14} />
                  </button>
                )}
              </div>
              {seen && message.id === lastMine?.id && <p className="mt-0.5 self-end text-[11px] text-secondary">{t("Seen")}</p>}
            </div>
          );
        })}
      </div>

      {conversation.canSend ? (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line px-3 py-3">
          <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[20px] bg-muted px-3.5 py-2 focus-within:ring-2 focus-within:ring-primary-light">
            <label htmlFor="message-box" className="sr-only">
              {t("Write a message")}
            </label>
            <textarea
              id="message-box"
              ref={field}
              value={text}
              rows={Math.min(5, Math.max(1, text.split("\n").length))}
              maxLength={MESSAGE_MAX_CHARS}
              placeholder={t("Write a message")}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="min-h-6 w-full min-w-0 flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
            <EmojiPicker className="-my-0.5 -me-1.5 shrink-0" placement="above" onPick={(emoji) => insertAtCaret(field.current, text, emoji, setText, MESSAGE_MAX_CHARS)} />
          </div>
          <Button type="submit" disabled={!text.trim() || sending} aria-label={t("Send")} className="size-10 shrink-0 rounded-full p-0!">
            <Icon name="send" size={18} />
          </Button>
        </form>
      ) : (
        <p role="note" className="border-t border-line px-4 py-3 text-center text-sm text-secondary">
          {t("You can’t send messages in this conversation.")}
        </p>
      )}

      {reporting && (
        <ReportDialog targetType="message" targetId={reporting.id} subject={t("a message from {name}", { name: conversation.member.name })} onClose={() => setReporting(null)} />
      )}

      {deleting && (
        <ConfirmDialog title={t("Delete this message?")} confirmLabel={t("Delete")} danger onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)}>
          {t("{name} will see that a message was deleted, but not what it said.", { name: conversation.member.name })}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Pick a connection to write to. */
function NewMessageDialog({ viewerHandle, onClose }: { viewerHandle: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [people, setPeople] = useState<PersonEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const all: PersonEntry[] = [];
        let cursor: string | null | undefined;
        // Up to 200 connections are listed; the search box narrows them.
        for (let i = 0; i < 4; i += 1) {
          const page: PeoplePage = await api<PeoplePage>(`/members/${viewerHandle}/connections`, { query: { limit: 50, cursor: cursor ?? undefined } });
          all.push(...page.items);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (live) setPeople(all);
      } catch (e) {
        if (live) setError(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [viewerHandle]);

  async function open(memberId: string) {
    setBusy(memberId);
    try {
      const conversation = await api<ConversationView>("/messages/conversations", { method: "POST", body: { memberId } });
      onClose();
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !p.official && (!q || p.name.toLowerCase().includes(q) || p.handle.includes(q)));

  return (
    <Dialog title={t("New message")} description={t("You can message members you’re connected with.")} onClose={onClose} width={460} flush>
      <div className="border-b border-line px-5 py-3">
        <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
          <Icon name="search" size={16} />
          <span className="sr-only">{t("Search your connections")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search your connections")} className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-disabled" />
        </label>
      </div>
      <div className="max-h-[360px] min-h-[160px] overflow-y-auto">
        {error ? (
          <div className="p-5">
            <ErrorNotice error={error} />
          </div>
        ) : !people ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-secondary">
            {people.length ? t("No connection matches that name.") : t("You have no connections yet. Connect with members first, then you can message them.")}{" "}
            {!people.length && (
              <Link href="/network" className="font-medium text-primary-light hover:underline">
                {t("Find members")}
              </Link>
            )}
          </p>
        ) : (
          <ul>
            {shown.map((person) => (
              <li key={person.id}>
                <button type="button" disabled={!!busy} onClick={() => void open(person.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-start hover:bg-muted disabled:opacity-60">
                  <MemberAvatar member={person} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{person.name}</span>
                    {person.headline && <span className="truncate text-xs text-secondary">{person.headline}</span>}
                  </span>
                  {busy === person.id && <span className="block size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
