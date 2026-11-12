"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MESSAGE_EDIT_WINDOW_MINUTES,
  QUICK_REACTIONS,
  type ConversationView,
  type MemberRef,
  type MessagesConfig,
  type MessagesPage,
  type MessageView,
  type TranslationView,
} from "@chartermission/contracts";
import { Button, ChapterAvatar, Icon, cn } from "@chartermission/ui";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { EmojiPicker } from "@/components/social/emoji-picker";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { Menu, type MenuItem } from "@/components/social/menu";
import { MemberAvatar } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { NoTranslate } from "@/i18n/auto";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { ApiError, api } from "@/lib/api/client";
import { useNow } from "@/components/events/use-viewer-zone";
import { Composer } from "./composer";
import { GroupInfoDialog } from "./group-dialogs";
import { LinkPreviewCard, MeetingCard, MessageAttachments, ShareCard, VoicePlayer } from "./message-parts";
import { announceMessagesChanged } from "./messages-events";
import { dropOutbox, newClientId, onOutboxChange, outboxFor, putOutbox, type OutboxItem } from "./outbox";
import { liveSupported, subscribeMessages } from "./stream";

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
/** How long "… is typing" stays without a new signal. */
const TYPING_MS = 5000;

/** One conversation: messages oldest at the top, live updates, and the box to write in. */
export function Thread({
  conversationId,
  viewerId,
  viewerHandle,
  config,
  focusMessageId,
  onActivity,
}: {
  conversationId: string;
  viewerId: string;
  viewerHandle: string;
  config: MessagesConfig | null;
  focusMessageId?: string | null;
  onActivity: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const tag = INTL_LOCALE[locale];
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [items, setItems] = useState<MessageView[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [editing, setEditing] = useState<MessageView | null>(null);
  const [deleting, setDeleting] = useState<MessageView | null>(null);
  const [reporting, setReporting] = useState<MessageView | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [confirm, setConfirm] = useState<null | "leave" | "block" | "decline" | "announcements-off">(null);
  const [highlight, setHighlight] = useState<string | null>(focusMessageId ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef<string | null>(null);
  const base = `/messages/conversations/${conversationId}`;
  // The parent passes a new function each render; keep the latest without re-running effects.
  const activity = useRef(onActivity);
  useEffect(() => {
    activity.current = onActivity;
  });

  const nearBottom = () => (scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight < 200 : true);
  const toBottom = () => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));

  const merge = useCallback((fresh: MessageView[]) => {
    if (!fresh.length) return;
    setItems((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      for (const m of fresh) byId.set(m.id, { ...byId.get(m.id), ...m });
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    const last = fresh[fresh.length - 1]!.createdAt;
    if (!latest.current || last > latest.current) latest.current = last;
    // Our own copies have arrived: their outbox entries are done.
    for (const m of fresh) if (m.clientId) dropOutbox(m.clientId);
  }, []);

  const refreshConversation = useCallback(async () => {
    try {
      setConversation(await api<ConversationView>(base));
    } catch {
      // Keep what we have.
    }
  }, [base]);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    await api(`${base}/read`, { method: "POST" }).catch(() => undefined);
    announceMessagesChanged();
    activity.current();
  }, [base]);

  const catchUp = useCallback(async () => {
    try {
      const page = await api<MessagesPage>(`${base}/messages`, { query: latest.current ? { after: latest.current } : {} });
      setConversation(page.conversation);
      const fromOther = page.items.some((m) => m.senderId !== viewerId);
      const bottom = nearBottom();
      merge(page.items);
      if (page.items.length && bottom) toBottom();
      if (fromOther) void markRead();
    } catch {
      // The next event or poll catches up.
    }
  }, [base, viewerId, merge, markRead]);

  // First page (or the page around a search result).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api<MessagesPage>(`${base}/messages`, { query: focusMessageId ? { around: focusMessageId } : {} });
        if (!live) return;
        setConversation(page.conversation);
        setItems(page.items);
        setOlder(page.olderCursor);
        latest.current = page.items[page.items.length - 1]?.createdAt ?? null;
        if (focusMessageId) requestAnimationFrame(() => document.getElementById(`message-${focusMessageId}`)?.scrollIntoView({ block: "center" }));
        else toBottom();
        if (page.conversation.unread || page.conversation.markedUnread) void markRead();
      } catch (e) {
        if (live) setError(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [base, focusMessageId, markRead]);

  // Live updates, with a slow poll as a safety net (and the only source where live isn't available).
  useEffect(() => {
    const off = subscribeMessages((event) => {
      if (event.type === "reconnected") return void catchUp();
      if (!("conversationId" in event) || event.conversationId !== conversationId) return;
      if (event.type === "message" || event.type === "message_updated") {
        const bottom = nearBottom();
        merge([event.message]);
        if (event.type === "message") {
          setTyping((current) => {
            const next = { ...current };
            delete next[event.message.senderId];
            return next;
          });
          if (bottom || event.message.senderId === viewerId) toBottom();
          if (event.message.senderId !== viewerId) void markRead();
        }
      } else if (event.type === "typing") {
        setTyping((current) => ({ ...current, [event.memberId]: { name: event.name, until: Date.now() + TYPING_MS } }));
      } else if (event.type === "read" || event.type === "conversation") {
        void refreshConversation();
      }
    });
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void catchUp();
      },
      liveSupported() ? 30000 : 4000,
    );
    const onVisible = () => document.visibilityState === "visible" && void catchUp();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [conversationId, viewerId, merge, markRead, catchUp, refreshConversation]);

  // Typing indicators fade out.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = window.setInterval(() => {
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, v]) => v.until > Date.now())));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typing]);

  /* ---------------- Outbox: text messages survive a dropped connection ---------------- */

  const sendQueued = useCallback(
    async (item: OutboxItem) => {
      putOutbox({ ...item, state: "sending", error: undefined });
      try {
        const message = await api<MessageView>(`${base}/messages`, { method: "POST", body: { body: item.body, replyToId: item.replyToId, clientId: item.clientId } });
        dropOutbox(item.clientId);
        merge([message]);
        toBottom();
        activity.current();
      } catch (e) {
        const offline = e instanceof ApiError && (e.status === 0 || e.status >= 500);
        putOutbox({ ...item, state: offline ? "waiting" : "failed", error: offline ? undefined : (e as Error).message });
      }
    },
    [base, merge],
  );

  useEffect(() => {
    const sync = () => setOutbox(outboxFor(conversationId));
    sync();
    const off = onOutboxChange(sync);
    const retry = () => outboxFor(conversationId).filter((i) => i.state === "waiting").forEach((i) => void sendQueued(i));
    window.addEventListener("online", retry);
    retry();
    return () => {
      off();
      window.removeEventListener("online", retry);
    };
  }, [conversationId, sendQueued]);

  function sendText(body: string, replyToId?: string) {
    const item: OutboxItem = { clientId: newClientId(), conversationId, body, replyToId, createdAt: new Date().toISOString(), state: navigator.onLine ? "sending" : "waiting" };
    putOutbox(item);
    toBottom();
    if (navigator.onLine) void sendQueued(item);
  }

  /* ---------------- Actions ---------------- */

  async function loadOlder() {
    if (!older) return;
    try {
      const height = scroller.current?.scrollHeight ?? 0;
      const page = await api<MessagesPage>(`${base}/messages`, { query: { before: older } });
      setItems((current) => [...page.items.filter((m) => !current.some((c) => c.id === m.id)), ...current]);
      setOlder(page.olderCursor);
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - height;
      });
    } catch (e) {
      toast.error(e);
    }
  }

  async function organise(body: Record<string, unknown>, done?: string) {
    try {
      setConversation(await api<ConversationView>(base, { method: "PATCH", body }));
      if (done) toast.success(t(done));
      announceMessagesChanged();
      activity.current();
    } catch (e) {
      toast.error(e);
    }
  }

  async function react(message: MessageView, emoji: string) {
    setReactingTo(null);
    const mine = message.reactions.find((r) => r.mine || r.memberIds.includes(viewerId));
    try {
      const updated =
        mine?.emoji === emoji
          ? await api<MessageView>(`/messages/${message.id}/reaction`, { method: "DELETE" })
          : await api<MessageView>(`/messages/${message.id}/reaction`, { method: "PUT", body: { emoji } });
      merge([updated]);
    } catch (e) {
      toast.error(e);
    }
  }

  async function translate(message: MessageView) {
    try {
      const result = await api<TranslationView>(`/messages/${message.id}/translate`, { method: "POST" });
      setTranslations((current) => ({ ...current, [message.id]: result.text }));
    } catch (e) {
      toast.error(e);
    }
  }

  async function respondToMeeting(message: MessageView, response: "accept" | "decline" | "cancel") {
    try {
      merge([await api<MessageView>(`/messages/${message.id}/meeting`, { method: "POST", body: { response } })]);
    } catch (e) {
      toast.error(e);
    }
  }

  async function replyPrivately(memberId: string) {
    try {
      const direct = await api<ConversationView>("/messages/conversations", { method: "POST", body: { memberId } });
      router.push(`/messages/${direct.id}`);
    } catch (e) {
      toast.error(e);
    }
  }

  async function confirmAction() {
    if (!conversation) return;
    try {
      if (confirm === "leave") await api(`/messages/groups/${conversation.id}/members/${viewerId}`, { method: "DELETE" });
      if (confirm === "announcements-off" && conversation.chapter)
        await api(`/messages/announcements/${conversation.chapter.slug}/subscription`, { method: "PUT", body: { on: false } });
      if (confirm === "decline") await api(`${base}/decline`, { method: "POST" });
      if (confirm === "block" && conversation.member) await api(`/blocks/${conversation.member.id}`, { method: "POST" });
      announceMessagesChanged();
      activity.current();
      router.push("/messages");
    } catch (e) {
      toast.error(e);
    }
  }

  const now = useNow();
  const people = useMemo(() => new Map<string, MemberRef>((conversation?.members ?? []).map((m) => [m.id, m])), [conversation]);

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

  const group = conversation.kind === "group";
  const broadcast = conversation.kind === "broadcast";
  const time = (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" });
  const lastMine = [...items].reverse().find((m) => m.senderId === viewerId && !m.deleted && m.kind !== "system");
  const seenDirect = !!lastMine && !!conversation.seenAt && conversation.seenAt >= lastMine.createdAt;
  const seenBy = lastMine && group ? conversation.readBy.filter((r) => r.readAt >= lastMine.createdAt).length : 0;
  const typingNames = Object.values(typing).map((v) => v.name);
  const subtitle = typingNames.length
    ? typingNames.length === 1
      ? t("{name} is typing…", { name: typingNames[0]! })
      : t("{count} people are typing…", { count: typingNames.length })
    : group
      ? t("{count} members", { count: conversation.memberCount })
      : broadcast
        ? t("Chapter announcements")
        : (conversation.member?.headline ?? "");

  const menu: MenuItem[] = [
    { label: conversation.pinned ? t("Unpin") : t("Pin to top"), icon: "pin", onSelect: () => void organise({ pinned: !conversation.pinned }) },
    ...(conversation.muted
      ? [{ label: t("Unmute"), icon: "bell" as const, onSelect: () => void organise({ mute: "off" }, "Notifications are back on") }]
      : [
          { label: t("Mute for 8 hours"), icon: "bell-off" as const, onSelect: () => void organise({ mute: "8h" }, "Muted for 8 hours") },
          { label: t("Mute for a week"), icon: "bell-off" as const, onSelect: () => void organise({ mute: "1w" }, "Muted for a week") },
          { label: t("Mute until I turn it back on"), icon: "bell-off" as const, onSelect: () => void organise({ mute: "always" }, "Muted") },
        ]),
    { label: t("Mark as unread"), icon: "mail", onSelect: () => void organise({ unread: true }).then(() => router.push("/messages")) },
    { label: conversation.archived ? t("Move to inbox") : t("Archive"), icon: "archive", onSelect: () => void organise({ archived: !conversation.archived }, conversation.archived ? "Moved to your inbox" : "Archived") },
    ...(group ? [{ label: t("Group info"), icon: "info" as const, onSelect: () => setInfo(true) }] : []),
    ...(group && conversation.joined ? [{ label: t("Leave group"), icon: "log-out" as const, danger: true, onSelect: () => setConfirm("leave") }] : []),
    ...(broadcast && !conversation.canManage && conversation.joined
      ? [{ label: t("Turn off announcements"), icon: "bell-off" as const, danger: true, onSelect: () => setConfirm("announcements-off") }]
      : []),
    ...(conversation.member ? [{ label: t("Block {name}", { name: conversation.member.name }), icon: "ban" as const, danger: true, onSelect: () => setConfirm("block") }] : []),
  ];

  const pendingBubbles = outbox.filter((o) => !items.some((m) => m.clientId === o.clientId));

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/messages" aria-label={t("Back to messages")} className="-ms-1.5 rounded-md p-1.5 text-secondary hover:bg-muted md:hidden">
          <Icon name="chevron-left" size={20} className="rtl:rotate-180" />
        </Link>
        <ConversationAvatar conversation={conversation} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          {conversation.member ? (
            <Link href={memberHref(conversation.member.handle)} className="truncate text-md font-medium text-ink hover:underline">
              {conversation.member.name}
            </Link>
          ) : group ? (
            <button type="button" onClick={() => setInfo(true)} className="truncate text-start text-md font-medium text-ink hover:underline">
              {conversation.title}
            </button>
          ) : (
            <span className="truncate text-md font-medium text-ink">{conversation.title}</span>
          )}
          <span className={cn("truncate text-xs", typingNames.length ? "text-primary" : "text-secondary")} aria-live="polite">
            {subtitle}
          </span>
        </div>
        {conversation.muted && <Icon name="bell-off" size={16} className="text-secondary" aria-label={t("Muted")} />}
        <Menu label={t("Conversation options")} items={menu} />
      </header>

      {conversation.request === "incoming" && conversation.member && (
        <div className="flex flex-col gap-2 border-b border-line bg-primary-tint-2 px-4 py-3">
          <p className="text-sm text-ink">
            {t("{name} wants to message you. You aren’t connected yet.", { name: conversation.member.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={() => void api<ConversationView>(`${base}/accept`, { method: "POST" }).then(setConversation, toast.error)}>
              {t("Accept")}
            </Button>
            <Button size="small" variant="secondary" onClick={() => setConfirm("decline")}>
              {t("Decline")}
            </Button>
            <Button size="small" variant="ghost" onClick={() => setConfirm("block")}>
              {t("Block")}
            </Button>
          </div>
        </div>
      )}
      {conversation.request === "outgoing" && (
        <p role="note" className="border-b border-line bg-muted/60 px-4 py-2 text-xs text-secondary">
          {t("Message request sent. {name} will see it under Requests and can accept it.", { name: conversation.member?.name ?? "" })}
        </p>
      )}
      {conversation.firstContact && conversation.request !== "outgoing" && (
        <p role="note" className="flex items-start gap-2 border-b border-line bg-[#FFF8E6] px-4 py-2 text-xs text-ink">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-[#9A6700]" />
          {t("You aren’t connected with this member. Never share passwords, codes or bank details, and be careful with requests for money.")}
        </p>
      )}

      <div ref={scroller} className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label={t("Messages in {name}", { name: conversation.title })}>
        {older && (
          <button type="button" onClick={loadOlder} className="mb-2 self-center rounded-full border border-line px-3 py-1 text-xs font-medium text-secondary hover:bg-muted">
            {t("Show earlier messages")}
          </button>
        )}
        {items.length === 0 && !pendingBubbles.length && (
          <p className="m-auto max-w-[320px] text-center text-sm text-secondary">
            {broadcast
              ? t("Announcements from the chapter team will appear here.")
              : group
                ? t("This is the start of {name}. Say hello.", { name: conversation.title })
                : t("This is the start of your conversation with {name}. Say hello.", { name: conversation.title })}
          </p>
        )}
        {items.map((message, index) => {
          const previous = items[index - 1];
          const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
          if (message.kind === "system") {
            return (
              <div key={message.id} className="flex flex-col">
                {newDay && <p className="my-3 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-secondary">{day(message.createdAt)}</p>}
                <p className="my-1 self-center text-center text-xs text-secondary" dir="auto">
                  <NoTranslate>{message.body}</NoTranslate>
                </p>
              </div>
            );
          }
          const mine = message.senderId === viewerId;
          const joined = !newDay && previous?.senderId === message.senderId && previous.kind !== "system";
          const gone = message.deleted || message.removed;
          const sender = people.get(message.senderId);
          const canEdit = mine && message.kind === "text" && !gone && now - new Date(message.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MINUTES * 60_000;
          const actions: MenuItem[] = gone
            ? []
            : [
                ...(conversation.canSend ? [{ label: t("Reply"), icon: "reply" as const, onSelect: () => (setEditing(null), setReplyTo(message)) }] : []),
                { label: t("React"), icon: "smile", onSelect: () => setReactingTo(message.id) },
                ...(message.body ? [{ label: t("Copy text"), icon: "copy" as const, onSelect: () => void navigator.clipboard.writeText(message.body).then(() => toast.success(t("Copied"))) }] : []),
                ...(config?.translation && message.body && !mine ? [{ label: t("Translate"), icon: "translate" as const, onSelect: () => void translate(message) }] : []),
                ...(broadcast && !mine ? [{ label: t("Reply privately"), icon: "message" as const, onSelect: () => void replyPrivately(message.senderId) }] : []),
                ...(canEdit ? [{ label: t("Edit"), icon: "edit" as const, onSelect: () => (setReplyTo(null), setEditing(message)) }] : []),
                ...(mine ? [{ label: t("Delete"), icon: "trash" as const, danger: true, onSelect: () => setDeleting(message) }] : []),
                ...(!mine ? [{ label: t("Report"), icon: "flag" as const, danger: true, onSelect: () => setReporting(message) }] : []),
              ];
          const bare = !gone && !message.body && (message.kind === "share" || message.kind === "meeting" || (message.attachments.length > 0 && message.attachments.every((a) => a.kind === "image")));
          return (
            <div key={message.id} id={`message-${message.id}`} className="flex flex-col">
              {newDay && <p className="my-3 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-secondary">{day(message.createdAt)}</p>}
              {(group || broadcast) && !mine && !joined && (
                <span className="ms-10 mt-2 text-xs font-medium text-secondary">{sender?.name ?? t("Member")}</span>
              )}
              <div
                className={cn(
                  "group flex max-w-[85%] items-end gap-1.5 md:max-w-[72%]",
                  mine ? "flex-row-reverse self-end" : "self-start",
                  joined ? "mt-0.5" : "mt-2",
                )}
              >
                {(group || broadcast) && !mine && (
                  <span className="w-8 shrink-0">{!joined && <MemberAvatar member={sender ?? { name: "?", avatarUrl: null, tone: "tint" }} size={32} link />}</span>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <div
                    className={cn(
                      "flex flex-col gap-1.5 rounded-2xl text-sm",
                      bare ? "p-0" : "px-3.5 py-2",
                      gone ? "border border-line bg-card text-secondary italic" : bare ? "" : mine ? "bg-primary text-inverse" : "bg-muted text-ink",
                      highlight === message.id && "ring-2 ring-accent",
                    )}
                    onAnimationEnd={() => setHighlight(null)}
                  >
                    {message.replyTo && !gone && (
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`message-${message.replyTo!.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                          setHighlight(message.replyTo!.id);
                        }}
                        className={cn("rounded-lg border-s-4 px-2 py-1 text-start text-xs", mine ? "border-white/60 bg-white/15" : "border-primary bg-card")}
                      >
                        <span className={cn("block font-semibold", mine ? "text-inverse" : "text-primary")}>
                          {message.replyTo.senderId === viewerId ? t("You") : message.replyTo.senderName}
                        </span>
                        <span className={cn("line-clamp-2", mine ? "text-inverse/85" : "text-secondary")} dir="auto">
                          {message.replyTo.gone ? t("Message unavailable") : <NoTranslate>{message.replyTo.body}</NoTranslate>}
                        </span>
                      </button>
                    )}
                    {gone ? (
                      <p>{message.deleted ? t("This message was deleted") : t("This message was removed by a moderator")}</p>
                    ) : (
                      <>
                        {message.attachments.some((a) => a.kind !== "voice") && <MessageAttachments attachments={message.attachments.filter((a) => a.kind !== "voice")} mine={mine} />}
                        {message.kind === "voice" && message.attachments[0] && <VoicePlayer attachment={message.attachments[0]} mine={mine} />}
                        {message.kind === "meeting" && message.meeting ? (
                          <MeetingCard message={message} mine={mine} respond={(r) => void respondToMeeting(message, r)} />
                        ) : (
                          message.body && (
                            <p dir="auto" className="whitespace-pre-wrap break-words">
                              <NoTranslate>{message.body}</NoTranslate>
                            </p>
                          )
                        )}
                        {translations[message.id] && (
                          <p dir="auto" className={cn("border-t pt-1.5 text-sm whitespace-pre-wrap", mine ? "border-white/30" : "border-line")}>
                            <span className={cn("me-1 text-[11px] font-semibold uppercase", mine ? "text-inverse/75" : "text-primary-light")}>{t("Translated")}</span>
                            <NoTranslate>{translations[message.id]}</NoTranslate>
                          </p>
                        )}
                        {message.share && <ShareCard share={message.share} mine={mine && !bare} />}
                        {message.linkPreview && !message.share && <LinkPreviewCard preview={message.linkPreview} />}
                      </>
                    )}
                    {!bare && (
                      <p className={cn("text-end text-[10px]", gone ? "text-secondary" : mine ? "text-inverse/70" : "text-secondary")}>
                        {message.editedAt && !gone && `${t("Edited")} · `}
                        {time(message.createdAt)}
                      </p>
                    )}
                  </div>
                  {bare && <p className={cn("text-[10px] text-secondary", mine && "text-end")}>{time(message.createdAt)}</p>}
                  {message.reactions.length > 0 && (
                    <div className={cn("flex flex-wrap gap-1", mine && "justify-end")}>
                      {message.reactions.map((r) => {
                        const reactedByMe = r.memberIds.includes(viewerId);
                        return (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => void react(message, r.emoji)}
                            title={r.names.filter(Boolean).join(", ")}
                            aria-pressed={reactedByMe}
                            aria-label={t("{emoji} reaction, {count}", { emoji: r.emoji, count: r.count })}
                            className={cn(
                              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
                              reactedByMe ? "border-primary bg-primary-tint text-primary" : "border-line bg-card text-secondary",
                            )}
                          >
                            <span>{r.emoji}</span>
                            {r.count > 1 && <span>{r.count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {reactingTo === message.id && (
                    <div role="group" aria-label={t("Quick reactions")} className={cn("flex items-center gap-0.5 rounded-full border border-line bg-card p-1 shadow-md", mine ? "self-end" : "self-start")}>
                      {QUICK_REACTIONS.map((emoji) => (
                        <button key={emoji} type="button" onClick={() => void react(message, emoji)} className="rounded-full px-1.5 py-0.5 text-lg hover:bg-muted" aria-label={t("React with {emoji}", { emoji })}>
                          {emoji}
                        </button>
                      ))}
                      <EmojiPicker placement="above" onPick={(emoji) => void react(message, emoji)} />
                      <button type="button" onClick={() => setReactingTo(null)} aria-label={t("Close")} className="rounded-full p-1 text-secondary hover:bg-muted">
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {actions.length > 0 && (
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                    <button
                      type="button"
                      onClick={() => setReactingTo(reactingTo === message.id ? null : message.id)}
                      aria-label={t("React")}
                      className="rounded-md p-1 text-secondary hover:bg-muted max-md:hidden"
                    >
                      <Icon name="smile" size={16} />
                    </button>
                    <Menu label={t("Message options")} items={actions} align={mine ? "end" : "start"} className="[&>button]:p-1" />
                  </div>
                )}
              </div>
              {mine && message.id === lastMine?.id && (seenDirect || seenBy > 0) && (
                <p className="mt-0.5 flex items-center gap-1 self-end text-[11px] text-secondary">
                  <Icon name="check-check" size={12} />
                  {group ? t("Seen by {count}", { count: seenBy }) : t("Seen")}
                </p>
              )}
            </div>
          );
        })}
        {pendingBubbles.map((item) => (
          <div key={item.clientId} className="mt-2 flex max-w-[85%] flex-col items-end self-end md:max-w-[72%]">
            <div className={cn("rounded-2xl px-3.5 py-2 text-sm", item.state === "failed" ? "border border-error bg-card text-ink" : "bg-primary/70 text-inverse")}>
              <p dir="auto" className="whitespace-pre-wrap break-words">
                <NoTranslate>{item.body}</NoTranslate>
              </p>
            </div>
            <p className={cn("mt-0.5 flex items-center gap-2 text-[11px]", item.state === "failed" ? "text-error" : "text-secondary")}>
              {item.state === "sending" ? t("Sending…") : item.state === "waiting" ? t("Waiting for a connection…") : (item.error ?? t("Not sent"))}
              {item.state !== "sending" && (
                <>
                  <button type="button" className="font-medium underline" onClick={() => void sendQueued(item)}>
                    {t("Retry")}
                  </button>
                  <button type="button" className="font-medium underline" onClick={() => dropOutbox(item.clientId)}>
                    {t("Delete")}
                  </button>
                </>
              )}
            </p>
          </div>
        ))}
        {typingNames.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 self-start text-xs text-secondary">
            <span className="flex gap-0.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-secondary" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {subtitle}
          </p>
        )}
      </div>

      {conversation.canSend ? (
        <Composer
          conversationId={conversation.id}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSendText={sendText}
          onSaveEdit={async (message, body) => merge([await api<MessageView>(`/messages/${message.id}`, { method: "PATCH", body: { body } })])}
          onSent={(message) => {
            merge([message]);
            toBottom();
            activity.current();
          }}
        />
      ) : (
        <p role="note" className="border-t border-line px-4 py-3 text-center text-sm text-secondary">
          {t(conversation.cantSendReason ?? "You can’t send messages in this conversation.")}
        </p>
      )}

      {reporting && (
        <ReportDialog
          targetType="message"
          targetId={reporting.id}
          subject={t("a message from {name}", { name: people.get(reporting.senderId)?.name ?? conversation.title })}
          onClose={() => setReporting(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("Delete this message?")}
          confirmLabel={t("Delete")}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => merge([await api<MessageView>(`/messages/${deleting.id}`, { method: "DELETE" })])}
        >
          {t("Everyone in the conversation will see that a message was deleted, but not what it said.")}
        </ConfirmDialog>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "leave"
              ? t("Leave {name}?", { name: conversation.title })
              : confirm === "block"
                ? t("Block {name}?", { name: conversation.member?.name ?? "" })
                : confirm === "decline"
                  ? t("Decline this message request?")
                  : t("Turn off {name}?", { name: conversation.title })
          }
          confirmLabel={confirm === "leave" ? t("Leave") : confirm === "block" ? t("Block") : confirm === "decline" ? t("Decline") : t("Turn off")}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={confirmAction}
        >
          {confirm === "leave"
            ? t("You won’t get its messages any more. An admin can add you back.")
            : confirm === "block"
              ? t("They won’t be able to message you, see your profile or connect with you. They aren’t told.")
              : confirm === "decline"
                ? t("They won’t be able to send you more messages here, and it disappears from your requests.")
                : t("You can turn the chapter’s announcements back on from its page.")}
        </ConfirmDialog>
      )}
      {info && group && (
        <GroupInfoDialog
          conversation={conversation}
          viewerId={viewerId}
          viewerHandle={viewerHandle}
          onClose={() => setInfo(false)}
          onChanged={(next) => setConversation(next)}
          onLeave={() => (setInfo(false), setConfirm("leave"))}
        />
      )}
    </>
  );
}

/** A member's photo, a chapter's picture, or a group's initials. */
export function ConversationAvatar({ conversation, size }: { conversation: Pick<ConversationView, "kind" | "member" | "chapter" | "title">; size: 24 | 32 | 40 | 56 }) {
  if (conversation.member) return <MemberAvatar member={conversation.member} size={size} />;
  if (conversation.chapter && conversation.kind === "broadcast") {
    return (
      <span className="relative shrink-0">
        <ChapterAvatar name={conversation.chapter.name} countryCode={conversation.chapter.countryCode} src={conversation.chapter.imageUrl} size={size} className="rounded-xl" />
        <span className="absolute -end-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-accent text-inverse ring-2 ring-card">
          <Icon name="megaphone" size={11} />
        </span>
      </span>
    );
  }
  const initials = conversation.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-primary-tint text-sm font-semibold text-primary" style={{ width: size, height: size }} aria-hidden="true">
      {initials || <Icon name="users" size={size / 2} />}
    </span>
  );
}
