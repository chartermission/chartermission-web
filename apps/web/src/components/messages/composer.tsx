"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_CHARS, VOICE_NOTE_MAX_SECONDS, type MessageView, type UploadPurpose } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Dialog } from "@/components/social/dialog";
import { EmojiPicker, insertAtCaret } from "@/components/social/emoji-picker";
import { Menu } from "@/components/social/menu";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { uploadFile } from "@/lib/upload";
import { newClientId } from "./outbox";
import { useVoiceRecorder } from "./voice-recorder";

type Pending = { key: string; file: File; purpose: UploadPurpose; progress: number; fileId: string | null; error: string | null; preview: string | null };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The box at the bottom of a conversation. Text goes through the caller's outbox (so it survives a
 * dropped connection); photos, documents, voice notes and meetings upload first and are sent here.
 */
export function Composer({
  conversationId,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onSendText,
  onSaveEdit,
  onSent,
}: {
  conversationId: string;
  replyTo: MessageView | null;
  editing: MessageView | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSendText: (body: string, replyToId?: string) => void;
  onSaveEdit: (message: MessageView, body: string) => Promise<void>;
  onSent: (message: MessageView) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [meeting, setMeeting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const recorder = useVoiceRecorder();
  const base = `/messages/conversations/${conversationId}`;

  // Editing fills the box with the message (adjusted while rendering, when a new one is picked).
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    if (editing) setText(editing.body);
  }
  useEffect(() => {
    if (editing) requestAnimationFrame(() => field.current?.focus());
  }, [editing]);
  useEffect(() => {
    if (replyTo) field.current?.focus();
  }, [replyTo]);
  useEffect(() => () => pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), [pending]);

  function typing() {
    const now = Date.now();
    if (now - lastTyping.current < 3000) return;
    lastTyping.current = now;
    void api(`${base}/typing`, { method: "POST" }).catch(() => undefined);
  }

  function addFiles(list: FileList | null, purpose: UploadPurpose) {
    if (!list) return;
    const files = [...list].slice(0, MESSAGE_MAX_ATTACHMENTS - pending.length);
    const added: Pending[] = files.map((file) => ({
      key: newClientId(),
      file,
      purpose,
      progress: 0,
      fileId: null,
      error: null,
      preview: purpose === "message_image" ? URL.createObjectURL(file) : null,
    }));
    setPending((current) => [...current, ...added]);
    for (const item of added) {
      void uploadFile(item.file, item.purpose, (progress) => setPending((c) => c.map((p) => (p.key === item.key ? { ...p, progress } : p))))
        .then((view) => setPending((c) => c.map((p) => (p.key === item.key ? { ...p, fileId: view.id, progress: 1 } : p))))
        .catch((e: unknown) => setPending((c) => c.map((p) => (p.key === item.key ? { ...p, error: (e as Error).message || t("Upload failed") } : p))));
    }
  }

  const uploading = pending.some((p) => !p.fileId && !p.error);
  const ready = pending.filter((p) => p.fileId);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (sending) return;
    if (editing) {
      if (!body) return;
      setSending(true);
      try {
        await onSaveEdit(editing, body);
        setText("");
        onCancelEdit();
      } catch (e) {
        toast.error(e);
      } finally {
        setSending(false);
      }
      return;
    }
    if (uploading) return;
    if (ready.length) {
      setSending(true);
      try {
        const message = await api<MessageView>(`${base}/messages`, {
          method: "POST",
          body: { body, attachmentIds: ready.map((p) => p.fileId), replyToId: replyTo?.id, clientId: newClientId() },
        });
        onSent(message);
        setPending([]);
        setText("");
        onCancelReply();
      } catch (e) {
        toast.error(e);
      } finally {
        setSending(false);
      }
      return;
    }
    if (!body) return;
    onSendText(body, replyTo?.id);
    setText("");
    onCancelReply();
    field.current?.focus();
  }

  async function sendVoice() {
    if (!recorder.file) return;
    setSending(true);
    try {
      const view = await uploadFile(recorder.file, "voice_note");
      const message = await api<MessageView>(`${base}/messages`, {
        method: "POST",
        body: { voiceNoteId: view.id, replyToId: replyTo?.id, clientId: newClientId() },
      });
      onSent(message);
      recorder.cancel();
      onCancelReply();
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && (editing || replyTo)) {
      if (editing) {
        setText("");
        onCancelEdit();
      } else onCancelReply();
    }
  }

  const canSend = editing ? !!text.trim() : (!!text.trim() || ready.length > 0) && !uploading;

  return (
    <div className="border-t border-line">
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 border-b border-line bg-muted/60 px-4 py-2">
          <Icon name={editing ? "edit" : "reply"} size={16} className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate text-xs text-secondary">
            {editing ? t("Editing your message") : t("Replying to {name}", { name: "" })}
            <span className="ms-1 text-ink" dir="auto">
              {(editing ?? replyTo)!.body || t("Attachment")}
            </span>
          </p>
          <button
            type="button"
            onClick={() => (editing ? (setText(""), onCancelEdit()) : onCancelReply())}
            aria-label={editing ? t("Cancel editing") : t("Cancel reply")}
            className="rounded-md p-1 text-secondary hover:bg-card"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label={t("Attachments")}>
          {pending.map((p) => (
            <li key={p.key} className="relative flex shrink-0 items-center gap-2 rounded-lg border border-line bg-card p-1.5 pe-7">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className="size-12 rounded object-cover" />
              ) : (
                <Icon name="file" size={22} className="ms-1 text-secondary" />
              )}
              <span className="flex w-[160px] flex-col">
                <span className="truncate text-xs font-medium text-ink">{p.file.name}</span>
                <span className={cn("line-clamp-2 text-[11px]", p.error ? "text-error" : "text-secondary")} title={p.error ?? undefined}>
                  {p.error ?? (p.fileId ? t("Ready") : t("Uploading {percent}%", { percent: Math.round(p.progress * 100) }))}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPending((c) => c.filter((x) => x.key !== p.key))}
                aria-label={t("Remove {name}", { name: p.file.name })}
                className="absolute end-1 top-1 rounded p-0.5 text-secondary hover:bg-muted"
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {recorder.state !== "idle" ? (
        <div className="flex items-center gap-3 px-3 py-3" role="group" aria-label={t("Voice message")}>
          <button type="button" onClick={recorder.cancel} aria-label={t("Discard recording")} className="rounded-full p-2 text-error hover:bg-muted">
            <Icon name="trash" size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-muted px-4 py-2">
            {recorder.state === "recording" && <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-error" aria-hidden="true" />}
            <span className="text-sm text-ink tabular-nums">{clock(recorder.seconds)}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-primary transition-[width]"
                style={{ width: recorder.state === "recording" ? `${Math.max(4, recorder.level * 100)}%` : "100%" }}
              />
            </span>
            <span className="text-xs text-secondary">{t("max {time}", { time: clock(VOICE_NOTE_MAX_SECONDS) })}</span>
          </div>
          {recorder.state === "recording" ? (
            <Button type="button" onClick={recorder.stop} aria-label={t("Stop recording")} className="size-10 shrink-0 rounded-full p-0!">
              <Icon name="stop" size={18} />
            </Button>
          ) : (
            <Button type="button" onClick={() => void sendVoice()} disabled={sending} aria-label={t("Send voice message")} className="size-10 shrink-0 rounded-full p-0!">
              <Icon name="send" size={18} />
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 px-3 py-3">
          {!editing && (
            <Menu
              label={t("Attach")}
              align="start"
              trigger={<Icon name="paperclip" size={20} />}
              className="mb-0.5 shrink-0"
              items={[
                { label: t("Photo"), icon: "image", onSelect: () => photoInput.current?.click(), disabled: pending.length >= MESSAGE_MAX_ATTACHMENTS },
                { label: t("Document"), icon: "file", onSelect: () => fileInput.current?.click(), disabled: pending.length >= MESSAGE_MAX_ATTACHMENTS },
                { label: t("Propose a meeting"), icon: "calendar", onSelect: () => setMeeting(true) },
              ]}
            />
          )}
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => (addFiles(e.target.files, "message_image"), (e.target.value = ""))} />
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.xlsx,.pptx,application/pdf"
            multiple
            hidden
            onChange={(e) => (addFiles(e.target.files, "message_file"), (e.target.value = ""))}
          />
          <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[20px] bg-muted px-3.5 py-2 focus-within:ring-2 focus-within:ring-primary-light">
            <label htmlFor={`message-box-${conversationId}`} className="sr-only">
              {t("Write a message")}
            </label>
            <textarea
              id={`message-box-${conversationId}`}
              ref={field}
              value={text}
              rows={Math.min(5, Math.max(1, text.split("\n").length))}
              maxLength={4000}
              placeholder={t("Write a message")}
              onChange={(event) => {
                setText(event.target.value);
                if (event.target.value) typing();
              }}
              onKeyDown={onKeyDown}
              className="min-h-6 w-full min-w-0 flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
            <EmojiPicker
              className="-my-0.5 -me-1.5 shrink-0"
              placement="above"
              onPick={(emoji) => insertAtCaret(field.current, text, emoji, setText, MESSAGE_MAX_CHARS)}
            />
          </div>
          {!editing && !text.trim() && !pending.length && recorder.supported ? (
            <Button type="button" onClick={() => void recorder.start()} aria-label={t("Record a voice message")} className="size-10 shrink-0 rounded-full p-0!">
              <Icon name="mic" size={18} />
            </Button>
          ) : (
            <Button type="submit" disabled={!canSend || sending} aria-label={editing ? t("Save") : t("Send")} className="size-10 shrink-0 rounded-full p-0!">
              <Icon name={editing ? "check" : "send"} size={18} />
            </Button>
          )}
        </form>
      )}
      {recorder.error && (
        <p role="alert" className="px-4 pb-3 text-xs text-error">
          {t(recorder.error)}
        </p>
      )}
      {meeting && <MeetingDialog conversationId={conversationId} onClose={() => setMeeting(false)} onSent={onSent} />}
    </div>
  );
}

/** Propose a time for a call: a card the other person accepts or declines, with a calendar file. */
function MeetingDialog({ conversationId, onClose, onSent }: { conversationId: string; onClose: () => void; onSent: (m: MessageView) => void }) {
  const t = useT();
  const id = useId();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(30);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const startsAt = new Date(`${date}T${time}`);
    if (!title.trim()) return setError(t("Give the meeting a title"));
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now()) return setError(t("Choose a time in the future"));
    setBusy(true);
    try {
      const message = await api<MessageView>(`/messages/conversations/${conversationId}/messages`, {
        method: "POST",
        body: { meeting: { title: title.trim(), startsAt: startsAt.toISOString(), durationMinutes: duration, link: link.trim() || undefined, note: note.trim() || undefined }, clientId: newClientId() },
      });
      onSent(message);
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }

  const input = "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-light/20";
  return (
    <Dialog
      title={t("Propose a meeting")}
      description={t("They can accept or decline, and add it to their calendar. Leave the link empty for a free video room.")}
      onClose={onClose}
      width={460}
    >
      <form id={id} onSubmit={send} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          {t("Title")}
          <input className={input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Partnership call")} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t("Date")}
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t("Time")}
            <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          {t("Length")}
          <select className={input} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {t("{count} min", { count: m })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          {t("Video call link (optional)")}
          <input className={input} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          {t("Note (optional)")}
          <textarea className={cn(input, "h-20 py-2")} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {t("Send invitation")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
