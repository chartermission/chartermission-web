"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type SyntheticEvent } from "react";
import {
  VIDEO_PROVIDER_LABELS,
  parseVideoEmbed,
  type ChapterRef,
  type DraftView,
  type ManagedPage,
  type PostType,
  type PostView,
} from "@chartermission/contracts";
import { Avatar, Button, Divider, Icon, cn, type IconName } from "@chartermission/ui";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import { stashArticleSeed, writeArticleHref } from "@/components/articles/write-article";
import { PageLogo } from "@/components/pages/page-logo";
import { ErrorNotice } from "@/components/social/errors";
import { absoluteDateTime } from "@/components/social/format";
import { postTypeMeta } from "@/components/social/post-types/meta";
import { toast } from "@/components/social/toast";
import { can, type Viewer } from "@/components/social/viewer";
import { ArticleEditor } from "./article-editor";
import { AttachmentPicker, useAttachments } from "./attachments";
import { ComposeEditor } from "./compose-editor";
import {
  fieldsFromDraft,
  focusFirstInvalid,
  hasContent,
  initialFields,
  mapServerFields,
  maxBodyFor,
  toComposition,
  toDraftPayload,
  validate,
  type ComposerFields,
  type FieldErrors,
  type Visibility,
} from "./composition";
import { PollBuilder, emptyPoll } from "./poll-builder";
import { PostTypeSwitcher } from "./post-type-switcher";
import { ScheduleDialog, scheduleLabel } from "./schedule-dialog";
import { CelebrationForm, FieldError, RequestForm } from "./type-fields";
import { useDraftSync } from "./use-draft";
import { T, useT, useIntlTag } from "@/i18n/client";

export type ComposeTool = "photo" | "video" | "document" | "link" | "poll" | "topic" | "mention";

const visibilityOptions: { value: Visibility; label: string; icon: IconName; hint: string }[] = [
  { value: "public", label: "Public", icon: "globe", hint: "Anyone, including people who aren’t signed in" },
  { value: "members", label: "Members", icon: "users", hint: "Signed-in Charter Mission members" },
];

const toolButtons: { tool: ComposeTool; icon: IconName; label: string; color: string; activeBg?: string }[] = [
  { tool: "photo", icon: "image", label: "Add images", color: "text-info", activeBg: "bg-info-light" },
  { tool: "video", icon: "video", label: "Add a video", color: "text-warning", activeBg: "bg-warning-light" },
  { tool: "document", icon: "book", label: "Add a PDF", color: "text-error", activeBg: "bg-error-light" },
  { tool: "link", icon: "link", label: "Add a link", color: "text-success", activeBg: "bg-success-light" },
  { tool: "poll", icon: "chart", label: "Add a poll", color: "text-accent", activeBg: "bg-accent-light" },
  { tool: "topic", icon: "hash", label: "Add a topic hashtag", color: "text-primary-light" },
  { tool: "mention", icon: "at", label: "Mention someone", color: "text-primary-light" },
];

/** Tools each post type offers (articles keep their cover in the form, links inline). */
const toolsFor: Record<PostType, ComposeTool[]> = {
  standard: ["photo", "video", "document", "link", "poll", "topic", "mention"],
  question: ["photo", "video", "document", "link", "topic", "mention"],
  celebration: ["photo", "video", "document", "link", "topic", "mention"],
  request: ["photo", "video", "document", "link", "topic", "mention"],
  article: ["topic", "mention"],
};

const bodyCopy: Record<Exclude<PostType, "article">, { label: string; placeholder: string; hint?: string }> = {
  standard: { label: "Post text", placeholder: "Share an update, ask a question or start a poll… Use # for topics and @ to mention" },
  question: {
    label: "Your question",
    placeholder: "What would you like to ask? e.g. Has anyone registered a company in Rwanda remotely?",
    hint: "Ask one clear question, with any context members need. Answers go in the comments, and you can mark the best one.",
  },
  celebration: { label: "The story", placeholder: "Tell the story — who helped, what it took, what’s next… (optional)" },
  request: { label: "Details", placeholder: "Add the details — what you need, what you can offer, how to get in touch… (optional)" },
};

const firstUrl = (text: string) => /https?:\/\/[^\s<>"'`]+/i.exec(text)?.[0]?.replace(/[.,;:!?)\]]+$/, "") ?? null;

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Create post dialog — Figma "Web / Create post — modal" (node 19:2951), extended with
 * post types (Post, Ask, Celebrate, Looking for, Article), alt text, autosaved drafts and
 * scheduling. Mount it to open; it calls onClose when dismissed.
 *
 * With `draft`, it opens pre-filled from a saved draft or scheduled post and keeps saving
 * to it; `onDraftChange` hears every save (and null once it is published or deleted).
 */
export function CreatePostDialog({
  viewer,
  initialTool,
  initialType,
  initialBody,
  draft,
  chapter,
  pageId,
  presentation = "dialog",
  onClose,
  onPosted,
  onDraftChange,
}: {
  viewer: Viewer;
  /** Start out posting as this page (the page's own "Create post" button). */
  pageId?: string;
  /**
   * "dialog" (default) opens as a modal. "page" renders the same composer in the flow of a full
   * page, for writing articles: no backdrop, a taller editor and a publish bar that stays in view.
   */
  presentation?: "dialog" | "page";
  /** Post into this chapter (the chapter page's composer). */
  chapter?: Pick<ChapterRef, "id" | "name">;
  initialTool?: ComposeTool;
  initialType?: PostType;
  /** Pre-filled post text (e.g. "\n\n#DailyPrompt"); the cursor starts before it, and it alone is not a draft. */
  initialBody?: string;
  draft?: DraftView;
  onClose: () => void;
  onPosted: (post: PostView) => void;
  onDraftChange?: (draft: DraftView | null) => void;
}) {
  const intl = useIntlTag();
  const t = useT();
  const id = useId();
  const router = useRouter();
  const inPage = presentation === "page";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  /** Pages the viewer manages and can post as (live ones only). */
  const [pages, setPages] = useState<ManagedPage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<Element | null>(null);
  const suggestionsOpenRef = useRef(false);
  /** Set once the composer's job is done (posted, scheduled, discarded) so closing says nothing. */
  const finishedRef = useRef(false);
  const postedRef = useRef(false);
  const attachments = useAttachments(draft ? { files: draft.attachments, altTexts: draft.payload.altTexts } : undefined);

  const startText = initialBody ?? (initialTool === "topic" ? "#" : initialTool === "mention" ? "@" : "");
  const startCaret = useRef(initialBody !== undefined ? 0 : null);
  const [fields, setFields] = useState<ComposerFields>(() => {
    if (draft) return fieldsFromDraft(draft.payload);
    const base = initialFields(initialType);
    return { ...base, chapterId: chapter?.id, pageId: chapter ? undefined : pageId, text: startText, poll: initialTool === "poll" ? emptyPoll() : null, link: initialTool === "link" ? "" : null };
  });
  const [caret, setCaret] = useState(initialBody !== undefined ? 0 : fields.text.length);
  const [fileMode, setFileMode] = useState<"image" | "document" | "video" | null>(
    initialTool === "photo" ? "image" : initialTool === "document" ? "document" : initialTool === "video" ? "video" : null,
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<"post" | "schedule" | "unschedule" | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);
  const [serverFields, setServerFields] = useState<FieldErrors>({});
  const [scheduling, setScheduling] = useState(false);
  const [notice, setNotice] = useState("");

  const patch = (change: Partial<ComposerFields>) => {
    setFields((current) => ({ ...current, ...change }));
    if (Object.keys(serverFields).length) setServerFields({});
  };

  const { type } = fields;
  const ready = attachments.ready;
  const fileState = { busy: attachments.busy, rejected: attachments.rejected, hasDocument: attachments.hasDocument };
  const allErrors = validate(fields, ready, fileState);
  const valid = Object.keys(allErrors).length === 0;
  const errors: FieldErrors = { ...serverFields, ...(submitted ? allErrors : {}) };
  const content = hasContent(initialBody !== undefined && fields.text === initialBody ? { ...fields, text: "" } : fields, attachments.items.length);
  const payload = toDraftPayload(fields, ready);

  const sync = useDraftSync({
    draft,
    payload,
    autosave: content && !busy && !attachments.busy,
    valid,
    onDraftChange,
  });
  const saved = sync.view;
  const scheduled = saved?.status === "scheduled" ? saved : null;
  const failed = saved?.status === "failed" ? saved : null;

  // "Post as": the member's live pages. Chapter posts and reposts are always made as yourself.
  useEffect(() => {
    if (chapter) return;
    let alive = true;
    api<ManagedPage[]>("/me/pages")
      .then((list) => alive && setPages(list.filter((p) => p.status === "active")))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chapter]);

  useEffect(() => {
    const root = inPage ? sectionRef.current : dialogRef.current;
    if (!root) return;
    const dialog = dialogRef.current;
    openerRef.current = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? textareaRef.current;
    target?.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const at = target === textareaRef.current ? (startCaret.current ?? target.value.length) : target.value.length;
      target.setSelectionRange(at, at);
    }
    if (inPage) return;
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once when the composer mounts
  }, []);

  /** On the writing page there is no dialog to close: leaving saves the draft and hands back to the page. */
  const close = () => (inPage ? leave() : dialogRef.current?.close());

  function handleClose(event: SyntheticEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    leave();
  }

  function leave() {
    if (inPage && postedRef.current) return;
    if (!finishedRef.current) {
      if (scheduled) {
        if (sync.dirty && valid) {
          sync.flush().then(() => toast.success("Scheduled post updated"), toast.error);
        } else if (sync.dirty) {
          toast.success("Your scheduled post wasn’t changed — the edits weren’t complete.");
        }
      } else if (content && (sync.dirty || !draft)) {
        sync.flush().then(() => toast.success("Saved to drafts"), toast.error);
      } else if (!content && saved && !draft) {
        // Everything was cleared: don't leave an empty draft behind.
        sync.remove().catch(() => undefined);
      }
    }
    const opener = openerRef.current;
    onClose();
    if (!inPage && opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget && !busy) close();
  }

  const onSuggestionsOpenChange = useCallback((open: boolean) => {
    suggestionsOpenRef.current = open;
  }, []);

  const maxBody = maxBodyFor(type);

  function insertAtCaret(trigger: "#" | "@") {
    const textarea = textareaRef.current;
    const text = fields.text;
    const start = textarea?.selectionStart ?? caret;
    const end = textarea?.selectionEnd ?? caret;
    const before = text.slice(0, start);
    const insert = before && !/\s$/.test(before) ? ` ${trigger}` : trigger;
    const next = (before + insert + text.slice(end)).slice(0, maxBody);
    const nextCaret = Math.min(start + insert.length, next.length);
    patch({ text: next });
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onTool(tool: ComposeTool) {
    if (tool === "topic") return insertAtCaret("#");
    if (tool === "mention") return insertAtCaret("@");
    if (tool === "poll") patch({ poll: fields.poll ? null : emptyPoll() });
    if (tool === "link") patch({ link: fields.link === null ? "" : null });
    if (tool === "photo") setFileMode((current) => (current === "image" && attachments.items.length === 0 ? null : "image"));
    if (tool === "document") setFileMode((current) => (current === "document" && attachments.items.length === 0 ? null : "document"));
    if (tool === "video") setFileMode((current) => (current === "video" && attachments.items.length === 0 ? null : "video"));
  }

  const isActive = (tool: ComposeTool) =>
    (tool === "poll" && fields.poll !== null) ||
    (tool === "link" && fields.link !== null) ||
    (tool === "photo" && fileMode === "image") ||
    (tool === "document" && fileMode === "document") ||
    (tool === "video" && fileMode === "video");

  function changeType(next: PostType) {
    // Articles are written on their own page, not in this dialog: take what was typed along.
    if (next === "article" && !inPage) {
      stashArticleSeed({ text: fields.text.trim(), pageId: fields.pageId });
      finishedRef.current = true;
      if (saved && !draft) sync.remove().catch(() => undefined);
      close();
      router.push(writeArticleHref());
      return;
    }
    patch({ type: next });
    if (next === "article" && (fileMode === "document" || fileMode === "video") && attachments.items.length === 0) setFileMode(null);
    setNotice(t("{label} selected", { label: postTypeMeta[next].label }));
  }

  /** Validate for posting or scheduling; focus the first problem. */
  function checkReady(): boolean {
    setSubmitted(true);
    setServerFields({});
    setServerError(null);
    if (valid) return true;
    requestAnimationFrame(() => focusFirstInvalid(inPage ? sectionRef.current : dialogRef.current));
    return false;
  }

  function showFailure(e: unknown) {
    if (e instanceof ApiError && e.fields) {
      const mapped = mapServerFields(e.fields);
      setServerFields(mapped);
      if (!Object.keys(mapped).length) setServerError(e);
      requestAnimationFrame(() => focusFirstInvalid(inPage ? sectionRef.current : dialogRef.current));
    } else {
      setServerError(e);
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || !checkReady()) return;
    setBusy("post");
    try {
      sync.cancel();
      const existing = await sync.settle();
      // From a draft: publish it, so no stale draft stays behind.
      const post = existing
        ? await sync.publish()
        : await api<PostView>("/posts", { method: "POST", body: toComposition(fields, ready) });
      finishedRef.current = true;
      // On the writing page onPosted opens the new article, so there is nothing left to close.
      postedRef.current = true;
      onPosted(post);
      close();
    } catch (e) {
      setBusy(null);
      showFailure(e);
    }
  }

  function openSchedule() {
    if (busy || !checkReady()) return;
    setScheduling(true);
  }

  async function schedule(iso: string) {
    setBusy("schedule");
    try {
      const view = await sync.save({ scheduledFor: iso });
      finishedRef.current = true;
      toast.success(t("Scheduled for {scheduleLabel}. Find it in Drafts → Scheduled.", { scheduleLabel: scheduleLabel(intl, view.scheduledFor ?? iso) }));
      close();
    } catch (e) {
      setBusy(null);
      if (e instanceof ApiError && e.fields && !e.fields.scheduledFor) {
        setScheduling(false);
        showFailure(e);
        return;
      }
      throw e;
    }
  }

  async function unschedule() {
    setBusy("unschedule");
    try {
      await sync.save({ scheduledFor: null });
      setNotice("Unscheduled. It’s saved in your drafts.");
      toast.success("Unscheduled. It’s saved in your drafts.");
    } catch (e) {
      showFailure(e);
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (busy) return;
    try {
      await sync.remove();
      finishedRef.current = true;
      toast.success("Draft discarded");
      close();
    } catch (e) {
      toast.error(e);
    }
  }

  const tools = toolsFor[type];
  const count = fields.text.length;
  const nearLimit = count > maxBody - 200;
  const visibilityMeta = visibilityOptions.find((option) => option.value === fields.visibility) ?? visibilityOptions[0];
  const previewUrl = type === "article" ? null : fields.link?.trim() || firstUrl(fields.text);
  const previewDomain = previewUrl ? domainOf(previewUrl) : null;
  const titleId = `${id}-title`;
  const meta = postTypeMeta[type];
  const copy = type === "article" ? null : bodyCopy[type];
  const showFiles = type === "article" || fileMode !== null || attachments.items.length > 0;
  const livePurpose = attachments.items.find((i) => i.status !== "rejected")?.purpose;
  const fileModeNow = livePurpose === "post_document" ? "document" : livePurpose === "post_video" ? "video" : livePurpose === "post_image" ? "image" : (fileMode ?? "image");
  const previewVideo = previewUrl ? parseVideoEmbed(previewUrl) : null;

  const statusText =
    sync.status === "saving"
      ? "Saving…"
      : sync.status === "error"
        ? "Couldn’t save draft"
        : sync.status === "saved" && saved
          ? scheduled
            ? sync.dirty
              ? valid
                ? "Unsaved changes"
                : "Finish the post to save changes"
              : "Changes saved"
            : sync.dirty
              ? ""
              : "Draft saved"
          : "";

  const postingAs = pages.find((p) => p.id === fields.pageId);
  const canPostAs = pages.length > 0 && !fields.chapterId && !fields.repostOfId;
  const HeadingTag = inPage ? "h1" : "h2";

  const form = (
      <form onSubmit={submit} noValidate className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-[18px] max-sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <HeadingTag id={titleId} className={cn("truncate text-ink", inPage ? "text-h2" : "text-h3")}>
              {scheduled ? (inPage ? "Edit scheduled article" : "Edit scheduled post") : inPage ? (draft ? "Edit your draft" : "Write an article") : meta.title}
            </HeadingTag>
            {chapter && fields.chapterId === chapter.id && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary">
                <Icon name="globe" size={14} />
                <span className="sr-only">Posting to </span>
                {chapter.name}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <p aria-live="polite" className={cn("flex items-center gap-1 text-xs", sync.status === "error" ? "text-error" : "text-secondary")}>
              {sync.status === "saved" && !sync.dirty && <Icon name="check" size={14} className="text-success" />}
              {sync.status === "error" && <Icon name="alert" size={14} />}
              <span className={cn(sync.status === "saved" && !sync.dirty && "max-sm:sr-only")}>{statusText}</span>
              {sync.status === "error" && (
                <button type="button" onClick={() => sync.save().catch(() => undefined)} className="ms-1 font-medium text-primary-light hover:underline">
                  Retry
                </button>
              )}
            </p>
            {saved && !scheduled && (
              <button type="button" onClick={discard} className="rounded-sm text-xs font-medium text-secondary hover:text-error hover:underline">
                Discard<span className="sr-only"> draft</span>
              </button>
            )}
            {inPage ? (
              <Button variant="secondary" size="small" onClick={close} disabled={busy !== null}>
                {content ? "Save & close" : "Close"}
              </Button>
            ) : (
              <button type="button" onClick={close} aria-label="Close" className="rounded-md p-0.5 text-secondary hover:bg-muted hover:text-ink">
                <Icon name="x" size={22} />
              </button>
            )}
          </div>
        </div>
        <Divider />

        <div className="flex flex-col gap-3.5 p-5 max-sm:px-4">
          {!inPage && (
            <PostTypeSwitcher
              value={type}
              onChange={changeType}
              disabled={fields.repostOfId ? ["question", "celebration", "request", "article"] : fields.pageId ? ["request"] : []}
            />
          )}
          {canPostAs && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-secondary">
              <span className="flex items-center gap-1.5">
                <Icon name={postingAs ? "building" : "user"} size={16} />
                {type === "article" ? "Publish as" : "Post as"}
              </span>
              <select
                value={fields.pageId ?? ""}
                onChange={(event) => {
                  const next = event.target.value || undefined;
                  // Pages don't post requests or announcements; those stay with the member.
                  patch({ pageId: next, ...(next ? { announcement: false, ...(type === "request" ? { type: "standard" as const } : {}) } : {}) });
                  setNotice(next ? t("Posting as {name}", { name: pages.find((p) => p.id === next)?.name ?? t("the page") }) : "Posting as yourself");
                }}
                className="max-w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-medium text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
              >
                <option value="">{viewer.name} (you)</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (page)
                  </option>
                ))}
              </select>
              {postingAs && <span className="text-xs">Followers of the page see this; your name isn’t shown.</span>}
            </label>
          )}
          <p className="sr-only" aria-live="polite">
            {notice}
          </p>

          {(scheduled || failed) && (
            <div
              role="note"
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-sm",
                failed ? "border border-error/30 bg-error-light" : "bg-primary-tint-2",
              )}
            >
              <Icon name={failed ? "alert" : "clock"} size={18} className={cn("shrink-0", failed ? "text-error" : "text-primary-light")} />
              <p className="min-w-0 flex-1 text-ink">
                {failed ? (
                  <>
                    Couldn’t publish{failed.scheduledFor ? ` at ${absoluteDateTime(intl, failed.scheduledFor)}` : ""}: {failed.lastError ?? "something went wrong"}. Fix it
                    and post now, or schedule it again.
                  </>
                ) : (
                  <>
                    Scheduled for <span className="font-medium">{scheduleLabel(intl, scheduled!.scheduledFor!)}</span>
                  </>
                )}
              </p>
              <span className="flex items-center gap-3">
                <button type="button" onClick={openSchedule} className="rounded-sm text-sm font-medium text-primary-light hover:underline">
                  {failed ? "Reschedule" : "Change time"}
                </button>
                {scheduled && (
                  <button
                    type="button"
                    onClick={unschedule}
                    disabled={busy !== null}
                    className="rounded-sm text-sm font-medium text-secondary hover:text-ink hover:underline disabled:opacity-60"
                  >
                    {busy === "unschedule" ? "Unscheduling…" : "Unschedule"}
                  </button>
                )}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {postingAs ? (
              <PageLogo name={postingAs.name} src={postingAs.logoUrl} size={40} />
            ) : (
              <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} size={40} tone={viewer.tone} />
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <p className="text-md font-medium text-ink">{postingAs?.name ?? viewer.name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative inline-flex items-center rounded-full border border-line text-xs text-body focus-within:ring-2 focus-within:ring-primary-light hover:border-line-strong">
                  <Icon name={visibilityMeta.icon} size={14} className="pointer-events-none absolute start-2.5 text-secondary" />
                  <select
                    aria-label="Who can see this post"
                    aria-describedby={`${id}-visibility-hint`}
                    value={fields.visibility}
                    onChange={(event) => patch({ visibility: event.target.value as Visibility })}
                    className="appearance-none rounded-full bg-transparent py-1 ps-[30px] pe-[26px] outline-none field-sizing-content"
                  >
                    {visibilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size={12} className="pointer-events-none absolute end-2.5 text-secondary" />
                </span>
                <span id={`${id}-visibility-hint`} className="text-xs text-secondary max-sm:hidden">
                  {visibilityMeta.hint}
                </span>
              </div>
            </div>
          </div>

          {can(viewer, "post.announce") && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-accent/30 bg-accent-light px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={fields.announcement}
                onChange={(event) => patch({ announcement: event.target.checked })}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">Publish as an announcement</span>
                <span className="text-xs text-body">Pinned to the top of every member’s feed. Recorded in the audit log.</span>
              </span>
            </label>
          )}

          {type === "celebration" && <CelebrationForm value={fields.celebration} onChange={(celebration) => patch({ celebration })} errors={errors} />}
          {type === "request" && <RequestForm value={fields.request} onChange={(request) => patch({ request })} errors={errors} />}

          {type === "article" ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-article-title`} className="sr-only">
                  Article title (required)
                </label>
                <textarea
                  id={`${id}-article-title`}
                  rows={1}
                  data-autofocus={draft?.payload.type === "article" || initialType === "article" ? "" : undefined}
                  value={fields.article.title}
                  maxLength={150}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      textareaRef.current?.focus();
                    }
                  }}
                  onChange={(event) => patch({ article: { ...fields.article, title: event.target.value.replace(/\s*\n+\s*/g, " ") } })}
                  placeholder="Title"
                  aria-invalid={errors["article.title"] ? true : undefined}
                  aria-describedby={errors["article.title"] ? `${id}-article-title-error` : undefined}
                  className={cn(
                    "w-full resize-none rounded-md bg-transparent py-1 text-h1 text-ink outline-none field-sizing-content placeholder:text-disabled max-sm:text-h2",
                    errors["article.title"] && "ring-2 ring-error ring-offset-2",
                  )}
                />
                <FieldError id={`${id}-article-title-error`} message={errors["article.title"]} />
                <label htmlFor={`${id}-article-subtitle`} className="sr-only">
                  Subtitle (optional)
                </label>
                <input
                  id={`${id}-article-subtitle`}
                  value={fields.article.subtitle}
                  maxLength={200}
                  onChange={(event) => patch({ article: { ...fields.article, subtitle: event.target.value } })}
                  placeholder="Add a subtitle (optional)"
                  aria-invalid={errors["article.subtitle"] ? true : undefined}
                  className="w-full bg-transparent py-1 text-h3 font-normal text-body outline-none placeholder:text-disabled"
                />
                <FieldError id={`${id}-article-subtitle-error`} message={errors["article.subtitle"]} />
              </div>
              <AttachmentPicker state={attachments} id={`${id}-files`} mode="image" maxImages={1} variant="cover" />
              {errors.files && (
                <p role="alert" className="-mt-2 text-xs text-error">
                  {errors.files}
                </p>
              )}
              <ArticleEditor
                value={fields.text}
                onChange={(text) => patch({ text })}
                error={errors.text}
                textareaRef={textareaRef}
                label="Article text (required)"
                tall={inPage}
              />
            </>
          ) : (
            <>
              {type !== "standard" && copy && (
                <p id={`${id}-label`} className="-mb-1.5 text-label text-body">
                  {copy.label}
                  {type === "question" && <span className="sr-only"> (required)</span>}
                </p>
              )}
              {type === "standard" && (
                <span id={`${id}-label`} className="sr-only">
                  {copy!.label}
                </span>
              )}
              <span id={`${id}-hint`} className="sr-only">
                <T vars={{ count: maxBody.toLocaleString("en-US") }}>{"Up to {count} characters. Type # to add a topic or @ to mention a member."}</T>
              </span>
              <div className={cn(type === "question" && "rounded-card border border-line bg-surface px-4 py-3 [&_.text-md]:text-h3")}>
                <ComposeEditor
                  value={fields.text}
                  caret={caret}
                  onChange={(value, nextCaret) => {
                    patch({ text: value });
                    setCaret(nextCaret);
                  }}
                  onCaretChange={setCaret}
                  textareaRef={textareaRef}
                  labelledBy={`${id}-label`}
                  describedBy={[`${id}-hint`, copy?.hint ? `${id}-type-hint` : null, errors.text ? `${id}-text-error` : null].filter(Boolean).join(" ")}
                  invalid={!!errors.text}
                  onSuggestionsOpenChange={onSuggestionsOpenChange}
                  placeholder={copy!.placeholder}
                  maxLength={maxBody}
                />
              </div>
              {copy?.hint && (
                <p id={`${id}-type-hint`} className="-mt-1.5 flex items-start gap-1.5 text-xs text-secondary">
                  <Icon name="lightbulb" size={14} className="mt-px shrink-0 text-warning" />
                  {copy.hint}
                </p>
              )}
              {errors.text && (
                <p id={`${id}-text-error`} role="alert" className="-mt-2 text-xs text-error">
                  {errors.text}
                </p>
              )}

              {showFiles && <AttachmentPicker state={attachments} id={`${id}-files`} mode={fileModeNow} />}
              {errors.files && (
                <p role="alert" className="-mt-2 text-xs text-error">
                  {errors.files}
                </p>
              )}

              {fields.link !== null && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-link`} className="text-label text-body">
                    Link
                  </label>
                  <div className="relative">
                    <Icon name="link" size={16} className="pointer-events-none absolute start-3 inset-y-0 my-auto h-fit text-success" />
                    <input
                      id={`${id}-link`}
                      type="url"
                      inputMode="url"
                      value={fields.link}
                      onChange={(event) => patch({ link: event.target.value })}
                      placeholder="https://"
                      aria-invalid={errors.link ? true : undefined}
                      aria-describedby={errors.link ? `${id}-link-error` : undefined}
                      className={cn(
                        "h-[38px] w-full rounded-lg border bg-card ps-9 pe-3 text-sm text-ink outline-none placeholder:text-disabled focus:ring-2 focus:ring-primary-tint",
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
                  <Icon name={previewVideo ? "video" : "link"} size={14} className="text-success" />
                  {previewVideo
                    ? t("A {label} player will be added to your post.", { label: VIDEO_PROVIDER_LABELS[previewVideo.provider] })
                    : t("A preview card for {previewDomain} will be added after you post.", { previewDomain })}
                </p>
              )}

              {type === "standard" && fields.poll && (
                <PollBuilder poll={fields.poll} onChange={(poll) => patch({ poll })} onRemove={() => patch({ poll: null })} error={errors.poll} />
              )}
              {type !== "standard" && fields.poll && (
                <p className="flex items-center gap-1.5 text-xs text-secondary">
                  <Icon name="chart" size={14} />
                  Polls are only for standard posts. Your poll is kept if you switch back to Post.
                </p>
              )}
            </>
          )}

          {errors.schedule && (
            <p role="alert" className="text-xs text-error">
              {errors.schedule}
            </p>
          )}
          <div aria-live="polite">{serverError ? <ErrorNotice error={serverError} /> : null}</div>
        </div>

        <Divider />
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 max-sm:px-4",
            // On the writing page the publish bar stays in view while the article scrolls.
            inPage && "sticky bottom-0 z-10 bg-card shadow-[0_-1px_0_0_var(--color-line)]",
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2.5" role="toolbar" aria-label="Add to your post">
            {toolButtons
              .filter((item) => tools.includes(item.tool))
              .map((item) => {
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
          <div className="ms-auto flex items-center gap-2.5">
            {type !== "article" && (
              <p className={cn("text-xs max-sm:hidden", count >= maxBody ? "text-error" : nearLimit ? "text-warning" : "text-secondary")}>
                <span aria-hidden="true">
                  {count.toLocaleString("en-US")} / {maxBody.toLocaleString("en-US")}
                </span>
                <span className="sr-only" aria-live="polite">
                  {nearLimit ? t("{count} characters left", { count: (maxBody - count).toLocaleString("en-US") }) : ""}
                </span>
              </p>
            )}
            {scheduled ? (
              <>
                <Button variant="secondary" onClick={() => submit()} disabled={busy !== null}>
                  {busy === "post" ? "Posting…" : "Post now"}
                </Button>
                <Button
                  onClick={() => {
                    if (!checkReady()) return;
                    sync
                      .flush()
                      .then(() => {
                        finishedRef.current = true;
                        toast.success("Scheduled post updated");
                        close();
                      })
                      .catch(showFailure);
                  }}
                  disabled={busy !== null || sync.status === "saving"}
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={openSchedule} disabled={busy !== null} aria-haspopup="dialog">
                  <Icon name="clock" size={16} />
                  <span className="max-sm:sr-only">Schedule</span>
                </Button>
                <Button type="submit" disabled={busy !== null}>
                  {busy === "post" ? "Posting…" : draft ? "Post now" : type === "question" ? "Ask" : type === "article" ? "Publish" : "Post"}
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="flex items-center gap-2 bg-surface px-5 py-3 text-xs text-secondary max-sm:px-4">
          <Icon name="shield" size={14} className="shrink-0" />
          {saved || content ? "Drafts save automatically. " : ""}Images and documents appear once a quick safety scan finishes.
        </p>
      </form>
  );

  const scheduleDialog = scheduling && (
    <ScheduleDialog
      initial={scheduled?.scheduledFor ?? null}
      confirmLabel={scheduled ? "Update time" : "Schedule"}
      onConfirm={schedule}
      onClose={() => setScheduling(false)}
    />
  );

  if (inPage) {
    return (
      <section ref={sectionRef} aria-labelledby={titleId} className="w-full rounded-card border border-line bg-card text-ink">
        {form}
        {scheduleDialog}
      </section>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        // Escape first closes the suggestion list, not the dialog.
        if (suggestionsOpenRef.current || busy) event.preventDefault();
      }}
      onClick={onBackdropClick}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-card p-0 text-ink shadow-[0px_24px_48px_0px_rgba(0,0,0,0.25)] backdrop:bg-primary-dark/55 max-sm:max-w-[calc(100vw-1rem)]",
        type === "article" ? "w-[760px]" : "w-[640px]",
      )}
    >
      {form}
      {scheduleDialog}
    </dialog>
  );
}
