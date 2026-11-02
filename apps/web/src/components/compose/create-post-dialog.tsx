"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Avatar, Button, Divider, Icon, cn, type IconName } from "@chartermission/ui";
import { audienceOptions } from "@/lib/mock/compose";
import { viewer } from "@/lib/mock-data";
import { ComposeEditor, MAX_POST_LENGTH } from "./compose-editor";
import { MAX_POLL_OPTIONS, MIN_POLL_OPTIONS, PollBuilder, emptyPoll, type PollDraft } from "./poll-builder";

export type ComposeTool = "photo" | "link" | "poll" | "topic" | "mention";

type Audience = (typeof audienceOptions)[number]["value"];

type Errors = { text?: string; poll?: string; link?: string };

const toolButtons: {
  tool: ComposeTool;
  icon: IconName;
  label: string;
  color: string;
  activeBg?: string;
}[] = [
  { tool: "photo", icon: "image", label: "Add photos", color: "text-info", activeBg: "bg-info-light" },
  { tool: "link", icon: "link", label: "Add a link", color: "text-success", activeBg: "bg-success-light" },
  { tool: "poll", icon: "chart", label: "Add a poll", color: "text-accent", activeBg: "bg-accent-light" },
  { tool: "topic", icon: "hash", label: "Add a topic hashtag", color: "text-primary-light" },
  { tool: "mention", icon: "at", label: "Mention someone", color: "text-primary-light" },
];

function validate(text: string, poll: PollDraft | null, link: string | null): Errors {
  const errors: Errors = {};
  const body = text.trim();
  if (!body) errors.text = poll ? "Add a question for your poll." : "Write something before posting.";
  else if (body.length > MAX_POST_LENGTH) errors.text = `Posts can be up to ${MAX_POST_LENGTH.toLocaleString("en-US")} characters.`;
  if (poll) {
    const options = poll.options.map((option) => option.trim()).filter(Boolean);
    if (options.length < MIN_POLL_OPTIONS) errors.poll = `Add at least ${MIN_POLL_OPTIONS} options.`;
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
  return errors;
}

/**
 * Create post dialog — Figma "Web / Create post — modal" (node 19:2951).
 * A native modal <dialog>: the page behind is inert (focus stays inside),
 * Escape and the backdrop close it, and focus returns to the opener.
 * Mount it to open; it calls onClose when dismissed.
 */
export function CreatePostDialog({
  initialTool,
  onClose,
  onPosted,
}: {
  initialTool?: ComposeTool;
  onClose: () => void;
  onPosted: (message: string) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<Element | null>(null);
  const suggestionsOpenRef = useRef(false);

  const startText = initialTool === "topic" ? "#" : initialTool === "mention" ? "@" : "";
  const [text, setText] = useState(startText);
  const [caret, setCaret] = useState(startText.length);
  const [audience, setAudience] = useState<Audience>("everyone");
  const [poll, setPoll] = useState<PollDraft | null>(initialTool === "poll" ? emptyPoll() : null);
  const [link, setLink] = useState<string | null>(initialTool === "link" ? "" : null);
  const [photos, setPhotos] = useState<File[] | null>(initialTool === "photo" ? [] : null);
  const [submitted, setSubmitted] = useState(false);
  // Errors show once the member has tried to post, then update as they edit.
  const errors: Errors = submitted ? validate(text, poll, link) : {};

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
    if (event.target === event.currentTarget) close();
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
    const next = (before + insert + text.slice(end)).slice(0, MAX_POST_LENGTH);
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
    if (tool === "photo") setPhotos((current) => (current === null ? [] : null));
  }

  const isActive = (tool: ComposeTool) =>
    (tool === "poll" && poll !== null) || (tool === "link" && link !== null) || (tool === "photo" && photos !== null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(text, poll, link);
    setSubmitted(true);
    if (nextErrors.text) return textareaRef.current?.focus();
    if (nextErrors.poll || nextErrors.link) {
      // Wait for the error state to render, then focus the first invalid field.
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    const audienceLabel = audienceOptions.find((option) => option.value === audience)?.label ?? "Everyone";
    onPosted(poll ? `Your poll is live · ${audienceLabel}` : `Your post is live · ${audienceLabel}`);
    close();
  }

  const count = text.length;
  const nearLimit = count > MAX_POST_LENGTH - 200;
  const audienceMeta = audienceOptions.find((option) => option.value === audience) ?? audienceOptions[0];
  const titleId = `${id}-title`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onCancel={(event) => {
        // Escape first closes the suggestion list, not the dialog.
        if (suggestionsOpenRef.current) event.preventDefault();
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
            <Avatar name={viewer.name} size={40} tone="primary" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <p className="text-md font-medium text-ink">{viewer.name}</p>
              <span className="relative inline-flex items-center rounded-full border border-line text-xs text-body focus-within:ring-2 focus-within:ring-primary-light hover:border-line-strong">
                <Icon name={audienceMeta.icon} size={14} className="pointer-events-none absolute left-2.5 text-secondary" />
                <select
                  aria-label="Who can see this post"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value as Audience)}
                  className="appearance-none rounded-full bg-transparent py-1 pl-[30px] pr-[26px] outline-none field-sizing-content"
                >
                  {audienceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2.5 text-secondary" />
              </span>
            </div>
          </div>

          <span id={`${id}-label`} className="sr-only">
            Post text
          </span>
          <span id={`${id}-hint`} className="sr-only">
            Up to {MAX_POST_LENGTH.toLocaleString("en-US")} characters. Type # to add a topic or @ to mention a member.
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

          {photos !== null && (
            <div className="flex flex-col gap-2 rounded-card border border-dashed border-line-strong bg-surface p-4">
              <label className="flex cursor-pointer items-center gap-2 rounded-md text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-primary-light">
                <Icon name="image" size={18} className="text-info" />
                {photos.length ? "Add more photos" : "Choose photos to upload"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    setPhotos((current) => [...(current ?? []), ...files].slice(0, 4));
                    event.target.value = "";
                  }}
                />
              </label>
              {photos.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {photos.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-xs text-body">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setPhotos((current) => current?.filter((_, i) => i !== index) ?? null)}
                        className="rounded-sm text-error hover:underline"
                      >
                        Remove<span className="sr-only"> {file.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-secondary">Up to 4 images. JPG, PNG or WebP.</p>
              )}
            </div>
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

          {poll && <PollBuilder poll={poll} onChange={setPoll} onRemove={() => setPoll(null)} error={errors.poll} />}
        </div>

        <Divider />
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-4" role="toolbar" aria-label="Add to your post">
            {toolButtons.map((item) => {
              const toggles = item.activeBg !== undefined;
              const active = isActive(item.tool);
              return (
                <button
                  key={item.tool}
                  type="button"
                  title={item.label}
                  aria-label={item.tool === "poll" && poll ? `${item.label} (up to ${MAX_POLL_OPTIONS} options)` : item.label}
                  aria-pressed={toggles ? active : undefined}
                  onClick={() => onTool(item.tool)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors",
                    item.color,
                    active ? item.activeBg : "hover:bg-muted",
                  )}
                >
                  <Icon name={item.icon} size={18} />
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3.5">
            <p className={cn("text-xs", count >= MAX_POST_LENGTH ? "text-error" : nearLimit ? "text-warning" : "text-secondary")}>
              <span aria-hidden="true">
                {count.toLocaleString("en-US")} / {MAX_POST_LENGTH.toLocaleString("en-US")}
              </span>
              <span className="sr-only" aria-live="polite">
                {nearLimit ? `${(MAX_POST_LENGTH - count).toLocaleString("en-US")} characters left` : ""}
              </span>
            </p>
            <Button type="submit">Post</Button>
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
