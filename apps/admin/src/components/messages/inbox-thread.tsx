"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminInboxMessage, AdminInboxThread } from "@chartermission/contracts";
import { Avatar, Button, Icon, cn, VerifiedBadge } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { SkeletonBar } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { useInbox } from "./inbox-shell";
import { Linkified } from "./shared";

const POLL_MS = 15_000;
const REPLY_MAX = 4000;
/** Within this many pixels of the bottom, new messages keep the view at the bottom. */
const STICK_PX = 120;

const ATTACHMENT_ICON = { image: "image", document: "file", voice: "mic" } as const;

function byTime(a: AdminInboxMessage, b: AdminInboxMessage) {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

/**
 * One member's conversation with Charter Mission (GET /admin/inbox/{id}; opening it marks it read for
 * the whole team): their messages on one side, the team's on the other with who wrote each, older
 * messages on request, and a reply box (Ctrl/Cmd+Enter sends). Looks for new messages every 15 seconds.
 */
export function InboxThread({ conversationId }: { conversationId: string }) {
  const t = useT();
  const router = useRouter();
  const inbox = useInbox();
  // The list's callbacks change with its filters; the thread doesn't need to reload for that.
  const inboxRef = useRef(inbox);
  useEffect(() => {
    inboxRef.current = inbox;
  }, [inbox]);
  const [latest, setLatest] = useState<AdminInboxThread | null>(null);
  const [older, setOlder] = useState<AdminInboxMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const heightBeforeOlder = useRef<number | null>(null);
  const pagedBack = useRef(false);
  const first = useRef(true);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const thread = await api<AdminInboxThread>(`/admin/inbox/${conversationId}`);
        setLatest(thread);
        setError(null);
        // Until older pages are loaded, the newest page says whether there are more.
        if (!pagedBack.current) setOlderCursor(thread.olderCursor);
        if (first.current) {
          first.current = false;
          // Opening it marked it read: update the list, and the sidebar count when it was unread.
          if (inboxRef.current.markRead(conversationId)) router.refresh();
          inboxRef.current.refresh();
        }
      } catch (e) {
        if (quiet) return;
        setError({ message: errorMessage(e), missing: e instanceof ApiError && e.status === 404 });
      }
    },
    [conversationId, router],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const messages = useMemo(() => {
    const seen = new Map<string, AdminInboxMessage>();
    for (const m of older) seen.set(m.id, m);
    for (const m of latest?.messages ?? []) seen.set(m.id, m);
    return [...seen.values()].sort(byTime);
  }, [older, latest]);

  // Keep the newest message in view, and the reading position when older ones are added above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (heightBeforeOlder.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
      return;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (!olderCursor) return;
    setLoadingOlder(true);
    try {
      const page = await api<AdminInboxThread>(`/admin/inbox/${conversationId}`, { query: { cursor: olderCursor } });
      heightBeforeOlder.current = scroller.current?.scrollHeight ?? null;
      pagedBack.current = true;
      setOlder((list) => [...page.messages, ...list]);
      setOlderCursor(page.olderCursor);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = reply.trim();
    if (!body) {
      setReplyError(t("Write a message"));
      return;
    }
    if (body.length > REPLY_MAX) {
      setReplyError(t("At most 4,000 characters"));
      return;
    }
    setSending(true);
    setReplyError(null);
    try {
      const sent = await api<AdminInboxMessage | undefined>(`/admin/inbox/${conversationId}/messages`, { method: "POST", body: { body } });
      setReply("");
      stick.current = true;
      if (sent && typeof sent === "object" && "id" in sent && "body" in sent) {
        setLatest((thread) => (thread ? { ...thread, messages: [...thread.messages.filter((m) => m.id !== sent.id), sent] } : thread));
      }
      void load(true);
      inbox.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fields?.body) setReplyError(e.fields.body);
      else toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!sending) void send();
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <BackLink />
        <div className="flex flex-1 items-center justify-center">
          {error.missing ? (
            <EmptyState icon="message" title={t("Conversation not found")}>
              It may have been removed with the member’s account.
            </EmptyState>
          ) : (
            <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="max-w-md text-sm text-body">{error.message}</p>
              <Button variant="secondary" size="small" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const member = latest?.member;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <BackLink />
        {member ? (
          <>
            <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1 font-medium text-ink">
                <NoTranslate>
                  <span className="truncate">{member.name}</span>
                </NoTranslate>
                {member.verified && <VerifiedBadge size={14} className="shrink-0" label={t("Verified")} />}
              </span>
              <span className="truncate text-xs text-secondary">
                @{member.handle} · {member.email}
              </span>
            </span>
            <a href={webHref(`/${member.handle}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View profile
              <Icon name="external" size={12} />
            </a>
          </>
        ) : (
          <span className="flex flex-1 items-center gap-3">
            <SkeletonBar className="size-10 rounded-full" />
            <span className="flex flex-col gap-1.5">
              <SkeletonBar className="h-4 w-32" />
              <SkeletonBar className="h-3 w-48" />
            </span>
          </span>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
        className="min-h-[280px] flex-1 overflow-y-auto bg-surface px-4 py-4"
        aria-busy={latest === null}
      >
        {olderCursor && (
          <div className="mb-4 flex justify-center">
            <Button variant="secondary" size="small" disabled={loadingOlder} aria-busy={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
          </div>
        )}
        {latest === null ? (
          <div className="flex flex-col gap-3" role="status" aria-label={t("Loading messages")}>
            <SkeletonBar className="h-12 w-2/3 rounded-2xl" />
            <SkeletonBar className="ms-auto h-16 w-1/2 rounded-2xl" />
            <SkeletonBar className="h-10 w-1/2 rounded-2xl" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-secondary">No messages yet. Write the first one below.</p>
        ) : (
          <ol className="flex flex-col gap-3" aria-label={t("Messages")}>
            {messages.map((m) => (
              <MessageItem key={m.id} m={m} />
            ))}
          </ol>
        )}
      </div>

      <form noValidate onSubmit={(e) => void send(e)} className="flex flex-col gap-2 border-t border-line bg-card p-3">
        <label htmlFor={`reply-${conversationId}`} className="sr-only">
          Reply as Charter Mission
        </label>
        <textarea
          id={`reply-${conversationId}`}
          rows={3}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            if (replyError) setReplyError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Reply as Charter Mission…"
          aria-invalid={replyError ? true : undefined}
          aria-describedby={`reply-${conversationId}-hint`}
          className={inputClasses(!!replyError, "max-h-60 resize-y")}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {replyError ? (
            <p id={`reply-${conversationId}-hint`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
              <Icon name="alert" size={14} />
              {replyError}
            </p>
          ) : (
            <p id={`reply-${conversationId}-hint`} className="text-xs text-secondary">
              The member sees it from Charter Mission; the team sees your name. Ctrl+Enter or ⌘+Enter sends.
            </p>
          )}
          <Button type="submit" size="small" disabled={sending || !reply.trim()} aria-busy={sending}>
            <Icon name="send" size={16} className="rtl:-scale-x-100" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/messages" className="inline-flex items-center gap-1 text-sm text-secondary hover:text-ink lg:hidden">
      <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
      All conversations
    </Link>
  );
}

function MessageItem({ m }: { m: AdminInboxMessage }) {
  const t = useT();
  const team = m.from === "team";
  return (
    <li className={cn("flex flex-col gap-1", team ? "items-end" : "items-start")}>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
          team ? "rounded-se-sm bg-primary-tint text-ink" : "rounded-ss-sm bg-card text-body",
        )}
      >
        {m.deleted ? (
          <span className="text-secondary italic">Message deleted</span>
        ) : (
          <>
            {m.body && (
              <p>
                <Linkified text={m.body} linkClassName="text-primary" />
              </p>
            )}
            {m.attachments.length > 0 && (
              <ul className="flex flex-col gap-1">
                {m.attachments.map((a, i) => (
                  <li key={`${a.url}-${i}`}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-medium text-primary hover:underline">
                      <Icon name={ATTACHMENT_ICON[a.kind]} size={14} className="shrink-0" />
                      <NoTranslate>
                        <span className="truncate">{a.name}</span>
                      </NoTranslate>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-1 px-1 text-xs text-secondary">
        {team &&
          (m.announcement ? (
            <>
              {t("Bulk message:")}{" "}
              <Link href={`/messages/${m.announcement.id}`} className="font-medium hover:text-primary hover:underline">
                <NoTranslate>{m.announcement.subject}</NoTranslate>
              </Link>
              {" · "}
            </>
          ) : m.staff ? (
            <>{t("Sent by {name}", { name: m.staff.name })} · </>
          ) : null)}
        <DateTime iso={m.at} />
      </span>
    </li>
  );
}
