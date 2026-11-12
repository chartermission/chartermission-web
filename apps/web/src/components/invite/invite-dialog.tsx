"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { INVITE_EMAILS_MAX, INVITE_MESSAGE_MAX, type SendInvitesResult, type ShareTarget } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { openSendInMessage } from "@/components/messages/share-dialog";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/components/social/error-message";

export type InviteEvent = { slug: string; title: string };

/**
 * Invite people to Charter Mission, to a chapter or to an event: invite members already here (a
 * message with the chapter's or event's card), share the link with a ready-made message (WhatsApp,
 * Telegram, LinkedIn, X, a text message, the email app or the phone's share sheet), copy either,
 * or have Charter Mission email the invitation.
 * The link is /invite?chapter={slug}&from={handle} or /invite?event={slug}&from={handle} (see the
 * proxy): members go straight there; someone new signs up first.
 */
export function InviteDialog({
  inviterHandle,
  chapter,
  event,
  onClose,
}: {
  inviterHandle: string;
  chapter?: { slug: string; name: string } | null;
  event?: InviteEvent | null;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const shareTarget: ShareTarget | null = chapter ? { type: "chapter", key: chapter.slug } : event ? { type: "event", key: event.slug } : null;
  const [origin, setOrigin] = useState("https://chartermission.com");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's own address, known only in the browser
  useEffect(() => setOrigin(window.location.origin), []);
  const link = useMemo(() => {
    const q = new URLSearchParams();
    if (chapter) q.set("chapter", chapter.slug);
    else if (event) q.set("event", event.slug);
    q.set("from", inviterHandle);
    return `${origin}/invite?${q.toString()}`;
  }, [origin, chapter, event, inviterHandle]);

  const [note, setNote] = useState(() =>
    chapter
      ? t("Join me in the {name} on Charter Mission, the professional community where Africa and its diaspora build together.", { name: chapter.name })
      : event
        ? t("Join me at {name} on Charter Mission.", { name: event.title })
        : t("I’m on Charter Mission, the professional community where Africa and its diaspora build together. Join me there."),
  );
  const message = `${note.trim()}\n${link}`;
  const subject = chapter
    ? t("Join the {name} on Charter Mission", { name: chapter.name })
    : event
      ? t("You’re invited: {name}", { name: event.title })
      : t("Join me on Charter Mission");

  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  async function copy(what: "link" | "message") {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : message);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      window.prompt(t("Copy this"), what === "link" ? link : message);
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const targets: { label: string; icon: IconName; href: string }[] = [
    { label: "WhatsApp", icon: "message", href: `https://wa.me/?text=${encodeURIComponent(message)}` },
    { label: "Telegram", icon: "send", href: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(note.trim())}` },
    { label: "LinkedIn", icon: "briefcase", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` },
    { label: "X", icon: "share", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}` },
    { label: t("Text message"), icon: "message", href: `sms:?&body=${encodeURIComponent(message)}` },
    { label: t("Email app"), icon: "mail", href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` },
  ];

  const [emails, setEmails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(submit: FormEvent) {
    submit.preventDefault();
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!list.length) return setError(t("Add at least one email address"));
    if (list.length > INVITE_EMAILS_MAX) return setError(t("Up to {count} addresses at a time", { count: INVITE_EMAILS_MAX }));
    setSending(true);
    setError(null);
    try {
      const res = await api<SendInvitesResult>("/invites", { method: "POST", body: { emails: list, chapterSlug: chapter?.slug, eventSlug: event?.slug, message: note.trim() || undefined } });
      setEmails("");
      toast.success(t("Invitation sent to {count} people", { count: res.sent }));
    } catch (e) {
      // The field's own message ("Add someone else’s email address") says more than the summary.
      const field = e instanceof ApiError ? (e.fields?.emails ?? Object.values(e.fields ?? {})[0]) : undefined;
      setError(field ?? errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      title={
        chapter
          ? t("Invite people to the {name}", { name: chapter.name })
          : event
            ? t("Invite people to {name}", { name: event.title })
            : t("Invite people to Charter Mission")
      }
      description={
        shareTarget
          ? t("Invite members already on Charter Mission, share the link wherever you talk to people, or let us email it for you.")
          : t("Share the link wherever you talk to people, or let us email it for you.")
      }
      onClose={onClose}
      width={560}
    >
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink">{t("Your message")}</span>
          <textarea
            value={note}
            maxLength={INVITE_MESSAGE_MAX}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
          />
          <span className="truncate text-xs text-secondary" dir="ltr">
            {link}
          </span>
        </label>

        {shareTarget && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-primary-tint-2 p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Icon name="users" size={18} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-ink">{t("Invite members")}</span>
              <span className="text-xs text-secondary">{t("Your connections and chats on Charter Mission get your message with the card, in their messages.")}</span>
            </div>
            <Button
              size="small"
              onClick={(e) => {
                const from = e.currentTarget;
                closeDialog(from);
                openSendInMessage(shareTarget, { note: note.trim(), title: t("Invite members") });
              }}
            >
              {t("Choose members")}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-label text-ink">{t("Share")}</span>
          <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
            {targets.map((target) => (
              <a key={target.label} href={target.href} target="_blank" rel="noopener noreferrer" className={cn(buttonClasses({ variant: "secondary", size: "small" }), "justify-start")}>
                <Icon name={target.icon} size={16} />
                {target.label}
              </a>
            ))}
            {canShare && (
              <button
                type="button"
                onClick={() => void navigator.share({ title: subject, text: note.trim(), url: link }).catch(() => undefined)}
                className={cn(buttonClasses({ variant: "secondary", size: "small" }), "justify-start")}
              >
                <Icon name="share" size={16} />
                {t("More apps")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="small" onClick={() => void copy("link")}>
              <Icon name={copied === "link" ? "check" : "link"} size={16} />
              {copied === "link" ? t("Link copied") : t("Copy link")}
            </Button>
            <Button variant="ghost" size="small" onClick={() => void copy("message")}>
              <Icon name={copied === "message" ? "check" : "message"} size={16} />
              {copied === "message" ? t("Message copied") : t("Copy message")}
            </Button>
          </div>
        </div>

        <form onSubmit={send} className="flex flex-col gap-1.5 border-t border-line pt-4">
          <label htmlFor={`${id}-emails`} className="text-label text-ink">
            {t("Send by email")}
          </label>
          <p className="text-xs text-secondary">{t("We email your message and the link from Charter Mission. Up to {count} addresses, separated by commas.", { count: INVITE_EMAILS_MAX })}</p>
          <div className="flex gap-2 max-sm:flex-col">
            <input
              id={`${id}-emails`}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="name@example.com, …"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
            />
            <Button type="submit" size="small" disabled={sending}>
              <Icon name="mail" size={16} />
              {sending ? t("Sending…") : t("Send invitations")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
        </form>
        <span className="sr-only" role="status">
          {copied === "link" ? t("Link copied") : copied === "message" ? t("Message copied") : ""}
        </span>
      </div>
    </Dialog>
  );
}

/** A button that opens the invite dialog. */
export function InvitePeopleButton({
  inviterHandle,
  chapter,
  event,
  variant = "accent",
  className,
  label,
}: {
  inviterHandle: string;
  chapter?: { slug: string; name: string } | null;
  event?: InviteEvent | null;
  variant?: "accent" | "secondary" | "primary";
  className?: string;
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClasses({ variant }), className)}>
        <Icon name="plus" size={16} />
        {label ?? t("Invite people")}
      </button>
      {open && <InviteDialog inviterHandle={inviterHandle} chapter={chapter} event={event} onClose={() => setOpen(false)} />}
    </>
  );
}
