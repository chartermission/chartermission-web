"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { POST_MAX_CHARS, type CreatePostInput, type PostView } from "@chartermission/contracts";
import { Avatar, Button, Divider, Icon, cn, type IconName } from "@chartermission/ui";
import { api, ApiError } from "@/lib/api/client";
import { ErrorNotice } from "@/components/social/errors";
import { can, type Viewer } from "@/components/social/viewer";
import { AttachmentPicker, useAttachments } from "./attachments";
import { ComposeEditor } from "./compose-editor";
import { MIN_POLL_OPTIONS, PollBuilder, emptyPoll, type PollDraft } from "./poll-builder";

export type ComposeTool = "photo" | "document" | "link" | "poll" | "topic" | "mention";

type Visibility = CreatePostInput["visibility"];

type Errors = { text?: string; poll?: string; link?: string; files?: string };

const visibilityOptions: { value: Visibility; label: string; icon: IconName; hint: string }[] = [
  { value: "members", label: "Members", icon: "users", hint: "Signed-in Charter Mission members" },
  { value: "public", label: "Public", icon: "globe", hint: "Anyone, including people who aren’t signed in" },
];

const toolButtons: { tool: ComposeTool; icon: IconName; label: string; color: string; activeBg?: string }[] = [
  { tool: "photo", icon: "image", label: "Add images", color: "text-info", activeBg: "bg-info-light" },
  { tool: "document", icon: "book", label: "Add a PDF", color: "text-error", activeBg: "bg-error-light" },
  { tool: "link", icon: "link", label: "Add a link", color: "text-success", activeBg: "bg-success-light" },
  { tool: "poll", icon: "chart", label: "Add a poll", color: "text-accent", activeBg: "bg-accent-light" },
  { tool: "topic", icon: "hash", label: "Add a topic hashtag", color: "text-primary-light" },
  { tool: "mention", icon: "at", label: "Mention someone", color: "text-primary-light" },
];

const firstUrl = (text: string) => /https?:\/\/[^\s<>"'`]+/i.exec(text)?.[0]?.replace(/[.,;:!?)\]]+$/, "") ?? null;

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function validate(text: string, poll: PollDraft | null, link: string | null, files: { busy: boolean; rejected: boolean; count: number }): Errors {
  const errors: Errors = {};
  const body = text.trim();
  if (!body && files.count === 0) errors.text = "Write something or attach a file.";
  else if (body.length > POST_MAX_CHARS) errors.text = `Posts can be up to ${POST_MAX_CHARS.toLocaleString("en-US")} characters.`;
  if (poll) {
    const options = poll.options.map((option) => option.trim()).filter(Boolean);
    if (!poll.question.trim()) errors.poll = "Add a question for your poll.";
    else if (options.length < MIN_POLL_OPTIONS) errors.poll = `Add at least ${MIN_POLL_OPTIONS} options.`;
    else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) errors.poll = "Each option must be different.";
  }
  if (link !== null && link.trim()) {
    try {
      const url = new URL(link.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
    } catch {
      errors.link = "Enter a full web address starting with https://";
    }
  }
  if (files.busy) errors.files = "Wait for your files to finish uploading.";
  else if (files.rejected) errors.files = "Remove the files that couldn’t be accepted.";
  return errors;
}

/**
 * Create post dialog — Figma "Web / Create post — modal" (node 19:2951), wired to
 * POST /posts with uploads, poll, link, hashtags/mentions, visibility and (for the
 * platform team) the announcement option. Mount it to open; it calls onClose when dismissed.
 */
export function CreatePostDialog({
  viewer,
  initialTool,
  onClose,
  onPosted,
}: {
  viewer: Viewer;
  initialTool?: ComposeTool;
  onClose: () => void;
  onPosted: (post: PostView) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<Element | null>(null);
  const suggestionsOpenRef = useRef(false);
  const attachments = useAttachments();

  const startText = initialTool === "topic" ? "#" : initialTool === "mention" ? "@" : "";
  const [text, setText] = useState(startText);
  const [caret, setCaret] = useState(startText.length);
  const [visibility, setVisibility] = useState<Visibility>("members");
  const [announcement, setAnnouncement] = useState(false);
  const [poll, setPoll] = useState<PollDraft | null>(initialTool === "poll" ? emptyPoll() : null);
  const [link, setLink] = useState<string | null>(initialTool === "link" ? "" : null);
  const [fileMode, setFileMode] = useState<"image" | "document" | null>(
    initialTool === "photo" ? "image" : initialTool === "document" ? "document" : null,
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [serverFields, setServerFields] = useState<Errors>({});

  const fileState = { busy: attachments.busy, rejected: attachments.rejected, count: attachments.ids.length };
  const local: Errors = submitted ? validate(text, poll, link, fileState) : {};
  const errors: Errors = { ...serverFields, ...Object.fromEntries(Object.entries(local).filter(([, v]) => v)) };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    openerRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
    };
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  function handleClose() {
    const opener = openerRef.current;
    onClose();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget && !busy) close();
  }

  const onSuggestionsOpenChange = useCallback((open: boolean) => {
    suggestionsOpenRef.current = open;
  }, []);

  function insertAtCaret(trigger: "#" | "@") {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? caret;
    const end = textarea?.selectionEnd ?? caret;
    const before = text.slice(0, start);
    const insert = before && !/\s$/.test(before) ? ` ${trigger}` : trigger;
    const next = (before + insert + text.slice(end)).slice(0, POST_MAX_CHARS);
    const nextCaret = Math.min(start + insert.length, next.length);
    setText(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onTool(tool: ComposeTool) {
    if (tool === "topic") return insertAtCaret("#");
    if (tool === "mention") return insertAtCaret("@");
    if (tool === "poll") setPoll((current) => (current ? null : emptyPoll()));
    if (tool === "link") setLink((current) => (current === null ? "" : null));
    if (tool === "photo") setFileMode((current) => (current === "image" && attachments.items.length === 0 ? null : "image"));
    if (tool === "document") setFileMode((current) => (current === "document" && attachments.items.length === 0 ? null : "document"));
  }

  const isActive = (tool: ComposeTool) =>
    (tool === "poll" && poll !== null) ||
    (tool === "link" && link !== null) ||
    (tool === "photo" && fileMode === "image") ||
    (tool === "document" && fileMode === "document");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(text, poll, link, fileState);
    setSubmitted(true);
    setServerFields({});
    setServerError(null);
    if (Object.values(nextErrors).some(Boolean)) {
      if (nextErrors.text) textareaRef.current?.focus();
      else requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    const input: Partial<CreatePostInput> = {
      body: text.trim(),
      attachmentIds: attachments.ids,
      visibility,
      kind: announcement ? "announcement" : "standard",
    };
    if (poll) {
      input.poll = {
        question: poll.question.trim(),
        options: poll.options.map((o) => o.trim()).filter(Boolean),
        durationHours: poll.duration,
      };
    }
    if (link?.trim()) input.linkUrl = link.trim();

    setBusy(true);
    try {
      const post = await api<PostView>("/posts", { method: "POST", body: input });
      onPosted(post);
      close();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.fields) {
        const mapped: Errors = {};
        for (const [field, message] of Object.entries(e.fields)) {
          if (field.startsWith("poll")) mapped.poll = message;
          else if (field.startsWith("link")) mapped.link = message;
          else if (field.startsWith("attachment")) mapped.files = message;
          else mapped.text = message;
        }
        setServerFields(mapped);
        if (!Object.keys(mapped).length) setServerError(e);
      } else {
        setServerError(e);
      }
    }
  }

  const count = text.length;
  const nearLimit = count > POST_MAX_CHARS - 200;
  const visibilityMeta = visibilityOptions.find((option) => option.value === visibility) ?? visibilityOptions[0];
  const previewUrl = link?.trim() || firstUrl(text);
  const previewDomain = previewUrl ? domainOf(previewUrl) : null;
  const titleId = `${id}-title`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onCancel={(event) => {
        // Escape first closes the suggestion list, not the dialog.
        if (suggestionsOpenRef.current || busy) event.preventDefault();
      }}
      onClick={onBackdropClick}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[640px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-card p-0 text-ink shadow-[0px_24px_48px_0px_rgba(0,0,0,0.25)] backdrop:bg-primary-dark/55"
    >
      <form onSubmit={submit} noValidate className="flex flex-col">
        <div className="flex items-center justify-between px-5 py-[18px]">
          <h2 id={titleId} className="text-h3 text-ink">
            Create post
          </h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md p-0.5 text-secondary hover:bg-muted hover:text-ink">
            <Icon name="x" size={22} />
          </button>
        </div>
        <Divider />

        <div className="flex flex-col gap-3.5 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} size={40} tone={viewer.tone} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <p className="text-md font-medium text-ink">{viewer.name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative inline-flex items-center rounded-full border border-line text-xs text-body focus-within:ring-2 focus-within:ring-primary-light hover:border-line-strong">
                  <Icon name={visibilityMeta.icon} size={14} className="pointer-events-none absolute left-2.5 text-secondary" />
                  <select
                    aria-label="Who can see this post"
                    aria-describedby={`${id}-visibility-hint`}
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value as Visibility)}
                    className="appearance-none rounded-full bg-transparent py-1 pl-[30px] pr-[26px] outline-none field-sizing-content"
                  >
                    {visibilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2.5 text-secondary" />
                </span>
                <span id={`${id}-visibility-hint`} className="text-xs text-secondary">
                  {visibilityMeta.hint}
                </span>
              </div>
            </div>
          </div>

          {can(viewer, "post.announce") && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-accent/30 bg-accent-light px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={announcement}
                onChange={(event) => setAnnouncement(event.target.checked)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">Publish as an announcement</span>
                <span className="text-xs text-body">Pinned to the top of every member’s feed. Recorded in the audit log.</span>
              </span>
            </label>
          )}

          <span id={`${id}-label`} className="sr-only">
            Post text
          </span>
          <span id={`${id}-hint`} className="sr-only">
            Up to {POST_MAX_CHARS.toLocaleString("en-US")} characters. Type # to add a topic or @ to mention a member.
          </span>
          <ComposeEditor
            value={text}
            caret={caret}
            onChange={(value, nextCaret) => {
              setText(value);
              setCaret(nextCaret);
            }}
            onCaretChange={setCaret}
            textareaRef={textareaRef}
            labelledBy={`${id}-label`}
            describedBy={errors.text ? `${id}-hint ${id}-text-error` : `${id}-hint`}
            invalid={!!errors.text}
            onSuggestionsOpenChange={onSuggestionsOpenChange}
          />
          {errors.text && (
            <p id={`${id}-text-error`} role="alert" className="-mt-2 text-xs text-error">
              {errors.text}
            </p>
          )}

          {(fileMode || attachments.items.length > 0) && (
            <AttachmentPicker
              state={attachments}
              id={`${id}-files`}
              mode={attachments.items.find((i) => i.status !== "rejected")?.purpose === "post_document" ? "document" : (fileMode ?? "image")}
            />
          )}
          {errors.files && (
            <p role="alert" className="-mt-2 text-xs text-error">
              {errors.files}
            </p>
          )}

          {link !== null && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-link`} className="text-label text-body">
                Link
              </label>
              <div className="relative">
                <Icon name="link" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-success" />
                <input
                  id={`${id}-link`}
                  type="url"
                  inputMode="url"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="https://"
                  aria-invalid={errors.link ? true : undefined}
                  aria-describedby={errors.link ? `${id}-link-error` : undefined}
                  className={cn(
                    "h-[38px] w-full rounded-lg border bg-card pl-9 pr-3 text-sm text-ink outline-none placeholder:text-disabled focus:ring-2 focus:ring-primary-tint",
                    errors.link ? "border-error" : "border-line focus:border-primary-light",
                  )}
                />
              </div>
              {errors.link && (
                <p id={`${id}-link-error`} role="alert" className="text-xs text-error">
                  {errors.link}
                </p>
              )}
            </div>
          )}
          {previewDomain && !errors.link && (
            <p className="-mt-1 flex items-center gap-1.5 text-xs text-secondary">
              <Icon name="link" size={14} className="text-success" />A preview card for {previewDomain} will be added after you post.
            </p>
          )}

          {poll && <PollBuilder poll={poll} onChange={setPoll} onRemove={() => setPoll(null)} error={errors.poll} />}

          <div aria-live="polite">{serverError ? <ErrorNotice error={serverError} /> : null}</div>
        </div>

        <Divider />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
          <div className="flex items-center gap-2 sm:gap-3" role="toolbar" aria-label="Add to your post">
            {toolButtons.map((item) => {
              const toggles = item.activeBg !== undefined;
              const active = isActive(item.tool);
              return (
                <button
                  key={item.tool}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={toggles ? active : undefined}
                  onClick={() => onTool(item.tool)}
                  className={cn("flex size-8 items-center justify-center rounded-lg transition-colors", item.color, active ? item.activeBg : "hover:bg-muted")}
                >
                  <Icon name={item.icon} size={18} />
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-3.5">
            <p className={cn("text-xs", count >= POST_MAX_CHARS ? "text-error" : nearLimit ? "text-warning" : "text-secondary")}>
              <span aria-hidden="true">
                {count.toLocaleString("en-US")} / {POST_MAX_CHARS.toLocaleString("en-US")}
              </span>
              <span className="sr-only" aria-live="polite">
                {nearLimit ? `${(POST_MAX_CHARS - count).toLocaleString("en-US")} characters left` : ""}
              </span>
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
        <p className="flex items-center gap-2 bg-surface px-5 py-3 text-xs text-secondary">
          <Icon name="shield" size={14} className="shrink-0" />
          Images and documents appear once a quick safety scan finishes.
        </p>
      </form>
    </dialog>
  );
}
