"use client";

import { useEffect, useState } from "react";
import { MESSAGE_MAX_CHARS, type MessageRecipient, type ShareTarget } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { MemberAvatar } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { ConversationAvatar } from "./thread";
import { announceMessagesChanged } from "./messages-events";

const EVENT = "cm:send-in-message";
const MAX = 20;

type Request = { target: ShareTarget; note?: string; title?: string };

/** Opens the "Send in a message" dialog for a post, event, profile… from anywhere on a member page; `note` pre-fills the message. */
export function openSendInMessage(target: ShareTarget, options: { note?: string; title?: string } = {}) {
  window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: { target, ...options } }));
}

/** Mounted once in the member layout; shows the dialog when something asks for it. */
export function SendInMessageHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    const on = (e: Event) => setRequest((e as CustomEvent<Request>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!request) return null;
  const { target } = request;
  return (
    <SendInMessageDialog
      key={`${target.type}:${target.key}:${request.note ?? ""}`}
      target={target}
      initialNote={request.note}
      title={request.title}
      onClose={() => setRequest(null)}
    />
  );
}

/** A small "Send" button for page headers (events, opportunities, profiles, chapters). */
export function SendInMessageButton({ target, className, compact = false }: { target: ShareTarget; className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <Button variant="secondary" size={compact ? "small" : undefined} className={className} onClick={() => openSendInMessage(target)}>
      <Icon name="send" size={16} />
      {t("Send")}
    </Button>
  );
}

const keyOf = (r: MessageRecipient) => (r.type === "conversation" ? `c:${r.conversationId}` : `m:${r.member.id}`);

function SendInMessageDialog({ target, initialNote = "", title, onClose }: { target: ShareTarget; initialNote?: string; title?: string; onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MessageRecipient[] | null>(null);
  const [picked, setPicked] = useState<MessageRecipient[]>([]);
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(
      () => {
        api<MessageRecipient[]>("/messages/recipients", { query: query.trim() ? { q: query.trim() } : {} })
          .then((r) => live && setOptions(r))
          .catch((e) => live && setError(e));
      },
      query ? 250 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const toggle = (r: MessageRecipient) =>
    setPicked((current) => (current.some((p) => keyOf(p) === keyOf(r)) ? current.filter((p) => keyOf(p) !== keyOf(r)) : current.length >= MAX ? current : [...current, r]));

  async function send(from: HTMLElement) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ sent: number }>("/messages/share", {
        method: "POST",
        body: {
          share: target,
          body: note.trim(),
          conversationIds: picked.flatMap((p) => (p.type === "conversation" ? [p.conversationId] : [])),
          memberIds: picked.flatMap((p) => (p.type === "member" ? [p.member.id] : [])),
        },
      });
      announceMessagesChanged();
      toast.success(result.sent === 1 ? t("Sent") : t("Sent to {count} chats", { count: result.sent }));
      closeDialog(from);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title ?? t("Send in a message")}
      description={t("Pick up to {count} people or chats.", { count: MAX })}
      onClose={onClose}
      width={480}
      flush
      footer={
        <div className="flex w-full flex-col gap-3">
          {error ? <ErrorNotice error={error} /> : null}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MESSAGE_MAX_CHARS}
            rows={2}
            placeholder={t("Add a note (optional)")}
            aria-label={t("Add a note (optional)")}
            className="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-light"
          />
          <div className="flex justify-end">
            <Button disabled={busy || !picked.length} onClick={(e) => void send(e.currentTarget)}>
              <Icon name="send" size={16} />
              {picked.length > 1 ? t("Send to {count}", { count: picked.length }) : t("Send")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="border-b border-line px-5 py-3">
        <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
          <Icon name="search" size={16} />
          <span className="sr-only">{t("Search chats and connections")}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search chats and connections")} className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-disabled" />
        </label>
      </div>
      <div className="max-h-[340px] min-h-[160px] overflow-y-auto">
        {!options ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : options.length === 0 ? (
          <p className="p-6 text-center text-sm text-secondary">{query ? t("No one matches that name.") : t("Connect with members to send them things.")}</p>
        ) : (
          <ul>
            {options.map((r) => {
              const selected = picked.some((p) => keyOf(p) === keyOf(r));
              const name = r.type === "conversation" ? r.title : r.member.name;
              return (
                <li key={keyOf(r)}>
                  <button type="button" aria-pressed={selected} onClick={() => toggle(r)} className="flex w-full items-center gap-3 px-5 py-2.5 text-start hover:bg-muted">
                    {r.type === "member" ? (
                      <MemberAvatar member={r.member} size={40} />
                    ) : (
                      <ConversationAvatar conversation={{ kind: r.kind, member: r.member, chapter: null, title: r.title }} size={40} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-ink">{name}</span>
                      <span className="truncate text-xs text-secondary">{r.type === "conversation" ? (r.kind === "group" ? t("Group") : t("Recent chat")) : t("Connection")}</span>
                    </span>
                    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-inverse" : "border-line")}>
                      {selected && <Icon name="check" size={12} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
