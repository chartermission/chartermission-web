"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { STORY_QUICK_REACTIONS, STORY_REPLY_MAX_CHARS, type StoryReplyResult, type StoryView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/components/social/errors";
import { useT } from "@/i18n/client";

type Notice = { tone: "done" | "error"; text: string; conversationId?: string };

/**
 * Under someone else's story: quick reactions (one per member; tap the chosen one again to take it
 * back) and a reply box. A reply goes to the author as a private message with the story attached.
 * The story waits while the member is typing (onHold). What happened is said here, in the viewer:
 * page toasts sit behind the full-screen dialog.
 */
export function StoryAnswer({
  story,
  authorName,
  onHold,
  onReaction,
}: {
  story: StoryView;
  authorName: string;
  onHold: (hold: boolean) => void;
  onReaction: (reaction: string | null) => void;
}) {
  const t = useT();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Just after a reply went: the story waits a moment so the confirmation can be read. */
  const [confirming, setConfirming] = useState(false);
  const reaction = story.viewer.reaction;
  const busy = focused || sending || confirming || text.trim().length > 0;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 2500);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  // Hold the story while a reply is being written or sent, and let go when this story leaves the screen.
  useEffect(() => {
    onHold(busy);
  }, [busy, onHold]);
  useEffect(() => () => onHold(false), [onHold]);

  async function react(emoji: string) {
    if (reacting) return;
    const next = reaction === emoji ? null : emoji;
    setReacting(true);
    setNotice(null);
    onReaction(next);
    try {
      if (next) await api(`/stories/${story.id}/reaction`, { method: "PUT", body: { emoji: next } });
      else await api(`/stories/${story.id}/reaction`, { method: "DELETE" });
    } catch (e) {
      onReaction(reaction);
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setReacting(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await api<StoryReplyResult>(`/stories/${story.id}/reply`, { method: "POST", body: { body, clientId: crypto.randomUUID() } });
      setText("");
      inputRef.current?.blur();
      setNotice({
        tone: "done",
        text: result.request
          ? t("Sent as a message request. {name} will see it once they accept.", { name: authorName })
          : t("Reply sent to {name}.", { name: authorName }),
        conversationId: result.conversationId,
      });
      setConfirming(true);
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2 text-xs", notice.tone === "error" ? "bg-error text-inverse" : "bg-inverse/15 text-inverse")}>
          {notice.text}
          {notice.conversationId && (
            <>
              {" "}
              <Link href={`/messages/${notice.conversationId}`} className="font-semibold underline">
                Open the chat
              </Link>
            </>
          )}
        </p>
      )}
      {story.viewer.canReact && (
        <div role="group" aria-label={t("React to this story")} className="flex items-center justify-between gap-1">
          {STORY_QUICK_REACTIONS.map((emoji) => {
            const chosen = reaction === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => void react(emoji)}
                aria-pressed={chosen}
                aria-label={t("React with {emoji}", { emoji })}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full text-[22px] leading-none transition-transform hover:scale-110 active:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse",
                  chosen ? "scale-110 bg-inverse/30 ring-2 ring-inverse" : "bg-inverse/10 hover:bg-inverse/20",
                )}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            );
          })}
          {/* A reaction that isn't one of the quick ones (left from another app) still shows as chosen. */}
          {reaction && !(STORY_QUICK_REACTIONS as readonly string[]).includes(reaction) && (
            <button
              type="button"
              onClick={() => void react(reaction)}
              aria-pressed
              aria-label={t("React with {emoji}", { emoji: reaction })}
              className="flex size-10 scale-110 items-center justify-center rounded-full bg-inverse/30 text-[22px] leading-none ring-2 ring-inverse"
            >
              <span aria-hidden="true">{reaction}</span>
            </button>
          )}
        </div>
      )}
      {story.viewer.canReply && (
        <form onSubmit={send} className="flex items-center gap-2">
          <label htmlFor={`${id}-reply`} className="sr-only">
            {t("Reply to {name}", { name: authorName })}
          </label>
          <input
            ref={inputRef}
            id={`${id}-reply`}
            value={text}
            maxLength={STORY_REPLY_MAX_CHARS}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t("Reply to {name}…", { name: authorName })}
            autoComplete="off"
            enterKeyHint="send"
            dir="auto"
            className="h-11 min-w-0 flex-1 rounded-full border border-inverse/50 bg-ink/40 px-4 text-sm text-inverse outline-none placeholder:text-inverse/70 focus:border-inverse focus:bg-ink/60"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label={t("Send reply")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-inverse text-ink transition-opacity disabled:opacity-40"
          >
            <Icon name="send" size={18} />
          </button>
        </form>
      )}
    </div>
  );
}
