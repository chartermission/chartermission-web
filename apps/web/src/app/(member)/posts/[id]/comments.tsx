"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { COMMENT_MAX_CHARS, type CommentView, type Page } from "@chartermission/contracts";
import { Avatar, Button, Icon, Panel, cn } from "@chartermission/ui";
import { api, ApiError } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice, VerifyEmailPrompt } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { Menu, type MenuItem } from "@/components/social/menu";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { ReactionButton, type ReactionSnapshot } from "@/components/social/reaction-button";
import { RichText } from "@/components/social/rich-text";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";

type Sort = "relevant" | "newest";

/** Textarea + submit for a new comment, a reply or an edit. */
function CommentForm({
  viewer,
  label,
  placeholder,
  initialText = "",
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  id: formId,
}: {
  viewer: Viewer;
  label: string;
  placeholder: string;
  initialText?: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  id?: string;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) {
      setFieldError("Write something before posting.");
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      await onSubmit(body);
      setText("");
    } catch (e) {
      if (e instanceof ApiError && e.fields?.body) setFieldError(e.fields.body);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2.5">
        <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} size={32} tone={viewer.tone} />
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-2 rounded-[18px] bg-muted px-3.5 py-2 focus-within:ring-2",
            fieldError ? "ring-2 ring-error focus-within:ring-error" : "focus-within:ring-primary-light",
          )}
        >
          <label htmlFor={`${id}-input`} className="sr-only">
            {label}
          </label>
          <textarea
            ref={ref}
            id={`${id}-input`}
            value={text}
            rows={text.includes("\n") || text.length > 70 ? 3 : 1}
            onChange={(event) => {
              setText(event.target.value);
              if (fieldError) setFieldError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && onCancel) onCancel();
            }}
            maxLength={COMMENT_MAX_CHARS}
            placeholder={placeholder}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-error` : undefined}
            className="min-h-6 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
          />
          {(text.trim() || onCancel) && (
            <div className="flex items-center justify-end gap-3">
              <span className={cn("mr-auto text-xs", text.length > COMMENT_MAX_CHARS - 100 ? "text-warning" : "text-secondary")}>
                {text.length.toLocaleString("en-US")} / {COMMENT_MAX_CHARS.toLocaleString("en-US")}
              </span>
              {onCancel && (
                <button type="button" onClick={onCancel} className="rounded-sm text-sm text-secondary hover:text-ink">
                  Cancel
                </button>
              )}
              <Button type="submit" size="small" disabled={busy || !text.trim()}>
                {busy ? "Posting…" : submitLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
      {fieldError && (
        <p id={`${id}-error`} role="alert" className="pl-[42px] text-xs text-error">
          {fieldError}
        </p>
      )}
      {error ? <ErrorNotice error={error} className="ml-[42px]" /> : null}
    </form>
  );
}

const placeholderText: Record<Exclude<CommentView["state"], "visible">, string> = {
  deleted: "This comment was deleted.",
  hidden: "This comment was hidden by moderators.",
  removed: "This comment was removed for breaking the community guidelines.",
};

function CommentItem({
  comment,
  viewer,
  highlighted,
  onReply,
  onChanged,
}: {
  comment: CommentView;
  viewer: Viewer;
  highlighted: boolean;
  onReply: (comment: CommentView) => void;
  onChanged: (comment: CommentView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<"report" | "delete" | null>(null);
  const [reactions, setReactions] = useState<ReactionSnapshot>({
    reaction: comment.viewer.reaction,
    total: comment.counts.reactions,
    breakdown: comment.reactionBreakdown,
  });

  const anchor = `comment-${comment.id}`;
  if (comment.state !== "visible" || !comment.author) {
    return (
      <div
        id={anchor}
        className={cn("flex scroll-mt-24 items-center gap-2 rounded-[10px] bg-muted p-3 text-xs text-secondary", highlighted && "ring-2 ring-accent")}
      >
        <Icon name="eye-off" size={16} className="shrink-0" />
        {comment.state === "visible" ? "This comment isn’t available." : placeholderText[comment.state]}
      </div>
    );
  }

  const author = comment.author;
  const own = author.id === viewer.id;
  const subject = `${author.name}’s comment`;
  const menu: MenuItem[] = [];
  if (comment.viewer.canEdit && own) menu.push({ label: "Edit comment", icon: "message", onSelect: () => setEditing(true) });
  if (comment.viewer.canDelete) menu.push({ label: own ? "Delete comment" : "Delete comment (moderator)", icon: "x", danger: true, onSelect: () => setModal("delete") });
  if (comment.viewer.canReport) menu.push({ label: "Report comment", icon: "flag", onSelect: () => setModal("report") });

  return (
    <article id={anchor} aria-label={`Comment by ${author.name}`} className="flex scroll-mt-24 items-start gap-2.5">
      <Link href={memberHref(author.handle)} tabIndex={-1} aria-hidden="true">
        <MemberAvatar member={author} size={32} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editing ? (
          <CommentForm
            viewer={viewer}
            label="Edit your comment"
            placeholder="Edit your comment"
            initialText={comment.body}
            submitLabel="Save"
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const updated = await api<CommentView>(`/comments/${comment.id}`, { method: "PATCH", body: { body } });
              onChanged({ ...updated, replies: comment.replies });
              setEditing(false);
              toast.success("Comment updated");
            }}
          />
        ) : (
          <div
            className={cn(
              "flex flex-col gap-1 rounded-card bg-surface px-3.5 py-2.5 transition-shadow",
              highlighted && "bg-accent-light ring-2 ring-accent",
            )}
          >
            <div className="flex items-start gap-2">
              <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
                <Link href={memberHref(author.handle)} className="text-sm font-medium text-ink hover:underline">
                  {author.name}
                </Link>
                {author.verified && <Icon name="verified" size={14} className="text-primary" label="Verified" />}
                {comment.isPostAuthor && <span className="rounded-full bg-primary-tint px-1.5 py-px text-[11px] font-semibold text-primary">Author</span>}
                <span className="text-xs text-secondary">
                  · <TimeAgo iso={comment.createdAt} />
                  {comment.editedAt && " · Edited"}
                </span>
              </p>
              {menu.length > 0 && <Menu label={`More options for ${subject}`} items={menu} trigger={<Icon name="more" size={16} />} />}
            </div>
            {author.headline && <p className="-mt-1 truncate text-xs text-secondary">{author.headline}</p>}
            <RichText text={comment.body} className="text-sm text-body" />
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-3 px-1 text-xs">
            <ReactionButton targetType="comment" targetId={comment.id} state={reactions} onChange={setReactions} compact subject={subject} />
            <button type="button" onClick={() => onReply(comment)} className="rounded-sm font-medium text-secondary hover:text-primary">
              Reply<span className="sr-only"> to {author.name}</span>
            </button>
          </div>
        )}
      </div>
      {modal === "report" && <ReportDialog targetType="comment" targetId={comment.id} subject={subject} onClose={() => setModal(null)} />}
      {modal === "delete" && (
        <ConfirmDialog
          title="Delete this comment?"
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api(`/comments/${comment.id}`, { method: "DELETE" });
            onChanged({ ...comment, state: "deleted", body: "", author: null });
            toast.success("Comment deleted");
          }}
        >
          {comment.counts.replies > 0 ? "Replies stay, and a placeholder shows where your comment was." : "This can’t be undone."}
        </ConfirmDialog>
      )}
    </article>
  );
}

type Thread = CommentView & { repliesCursor?: string | null; loadingReplies?: boolean };

/**
 * Comments for a post (CM-FED-03): sort, load more, one level of replies with
 * "View N more replies", add/edit/delete/report, and #comment-{id} deep links.
 */
export function Comments({
  postId,
  initial,
  total: initialTotal,
  viewer,
}: {
  postId: string;
  initial: Page<CommentView> | null;
  total: number;
  viewer: Viewer;
}) {
  const id = useId();
  const [sort, setSort] = useState<Sort>("relevant");
  const [threads, setThreads] = useState<Thread[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<unknown>(initial ? null : new ApiError(0, "UNKNOWN", "Comments couldn’t be loaded."));
  const [total, setTotal] = useState(initialTotal);
  const [replyTo, setReplyTo] = useState<{ parentId: string; mention: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const threadsRef = useRef(threads);
  const cursorRef = useRef(cursor);
  useEffect(() => {
    threadsRef.current = threads;
    cursorRef.current = cursor;
  });

  const fetchPage = useCallback(
    (nextSort: Sort, next: string | null) =>
      api<Page<CommentView>>(`/posts/${postId}/comments`, { query: { sort: nextSort, cursor: next ?? undefined } }),
    [postId],
  );

  async function reload(nextSort: Sort) {
    setSort(nextSort);
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(nextSort, null);
      setThreads(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(sort, cursor);
      setThreads((current) => {
        const seen = new Set(current.map((c) => c.id));
        return [...current, ...page.items.filter((c) => !seen.has(c.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadReplies(parentId: string) {
    const thread = threadsRef.current.find((t) => t.id === parentId);
    if (!thread) return;
    setThreads((current) => current.map((t) => (t.id === parentId ? { ...t, loadingReplies: true } : t)));
    try {
      const page = await api<Page<CommentView>>(`/comments/${parentId}/replies`, { query: { cursor: thread.repliesCursor ?? undefined, limit: 20 } });
      setThreads((current) =>
        current.map((t) => {
          if (t.id !== parentId) return t;
          const seen = new Set(t.replies.map((r) => r.id));
          return { ...t, loadingReplies: false, replies: [...t.replies, ...page.items.filter((r) => !seen.has(r.id))], repliesCursor: page.nextCursor };
        }),
      );
    } catch (e) {
      setThreads((current) => current.map((t) => (t.id === parentId ? { ...t, loadingReplies: false } : t)));
      toast.error(e);
    }
  }

  function replace(updated: CommentView) {
    setThreads((current) =>
      current.map((t) =>
        t.id === updated.id
          ? { ...t, ...updated, replies: t.replies }
          : { ...t, replies: t.replies.map((r) => (r.id === updated.id ? updated : r)) },
      ),
    );
  }

  async function addComment(body: string, parentId?: string) {
    const created = await api<CommentView>(`/posts/${postId}/comments`, { method: "POST", body: { body, parentId } });
    setTotal((value) => value + 1);
    if (created.parentId) {
      setThreads((current) =>
        current.map((t) =>
          t.id === created.parentId ? { ...t, replies: [...t.replies, created], counts: { ...t.counts, replies: t.counts.replies + 1 } } : t,
        ),
      );
      setReplyTo(null);
    } else {
      setThreads((current) => [created, ...current]);
    }
    setStatus(created.parentId ? "Your reply was posted." : "Your comment was posted.");
    setHighlight(created.id);
    requestAnimationFrame(() => document.getElementById(`comment-${created.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  // Deep link: #comment-{id} scrolls to and highlights the comment, loading more if needed.
  useEffect(() => {
    let cancelled = false;
    async function locate() {
      const match = /^#comment-([0-9a-f-]{36})$/i.exec(window.location.hash);
      if (!match) return;
      const target = match[1]!;
      const found = () => document.getElementById(`comment-${target}`);
      for (let attempt = 0; attempt < 6 && !found() && !cancelled; attempt++) {
        const withHidden = threadsRef.current.find((t) => t.counts.replies > t.replies.length && !t.repliesCursor);
        if (cursorRef.current) {
          const page = await fetchPage("relevant", cursorRef.current).catch(() => null);
          if (!page) break;
          setThreads((current) => [...current, ...page.items.filter((c) => !current.some((x) => x.id === c.id))]);
          setCursor(page.nextCursor);
        } else if (withHidden) {
          await loadReplies(withHidden.id);
        } else break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const el = found();
      if (el && !cancelled) {
        setHighlight(target);
        el.scrollIntoView({ block: "center" });
        el.querySelector<HTMLElement>("a:not([tabindex='-1']), button")?.focus({ preventScroll: true });
      }
    }
    void locate();
    window.addEventListener("hashchange", locate);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", locate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount and on hash changes
  }, []);

  const canComment = viewer.emailVerified;

  return (
    <Panel id="comments" aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-4 p-5 max-sm:px-4">
      <div className="flex items-center justify-between">
        <h2 id={`${id}-title`} className="text-h3 text-ink">
          {total.toLocaleString("en-US")} comment{total === 1 ? "" : "s"}
        </h2>
        <span className="relative inline-flex items-center">
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(event) => reload(event.target.value as Sort)}
            className="appearance-none rounded-md bg-transparent py-0.5 pl-1 pr-5 text-sm font-medium text-body hover:text-ink"
          >
            <option value="relevant">Most relevant</option>
            <option value="newest">Newest first</option>
          </select>
          <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-0.5 text-secondary" />
        </span>
      </div>

      <div id="add-comment" className="scroll-mt-24">
        {canComment ? (
          <CommentForm viewer={viewer} label="Add a comment" placeholder="Add a comment… use @handle to mention" submitLabel="Post" onSubmit={(body) => addComment(body)} />
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg bg-warning-light px-3 py-2.5">
            <Icon name="mail" size={18} className="mt-0.5 shrink-0 text-warning" />
            <VerifyEmailPrompt message="Verify your email address to comment and react." />
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>

      {threads.length === 0 && !loading && !error && <p className="py-4 text-center text-sm text-secondary">No comments yet. Start the conversation.</p>}

      <ul className="flex flex-col gap-4" aria-busy={loading}>
        {threads.map((thread) => {
          const hiddenReplies = thread.counts.replies - thread.replies.length;
          return (
            <li key={thread.id} className="flex flex-col gap-3">
              <CommentItem
                comment={thread}
                viewer={viewer}
                highlighted={highlight === thread.id}
                onReply={(c) => setReplyTo({ parentId: thread.id, mention: c.author && c.author.id !== viewer.id ? `@${c.author.handle} ` : "" })}
                onChanged={replace}
              />
              {(thread.replies.length > 0 || hiddenReplies > 0 || replyTo?.parentId === thread.id) && (
                <ul className="flex flex-col gap-3 pl-[42px]">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        comment={reply}
                        viewer={viewer}
                        highlighted={highlight === reply.id}
                        onReply={(c) => setReplyTo({ parentId: thread.id, mention: c.author && c.author.id !== viewer.id ? `@${c.author.handle} ` : "" })}
                        onChanged={replace}
                      />
                    </li>
                  ))}
                  {hiddenReplies > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => loadReplies(thread.id)}
                        disabled={thread.loadingReplies}
                        className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline disabled:opacity-60"
                      >
                        <Icon name="chevron-down" size={14} />
                        {thread.loadingReplies ? "Loading replies…" : `View ${hiddenReplies} more repl${hiddenReplies === 1 ? "y" : "ies"}`}
                      </button>
                    </li>
                  )}
                  {replyTo?.parentId === thread.id && (
                    <li>
                      {canComment ? (
                        <CommentForm
                          key={replyTo.mention}
                          viewer={viewer}
                          label={`Reply to ${thread.author?.name ?? "comment"}`}
                          placeholder="Write a reply…"
                          initialText={replyTo.mention}
                          submitLabel="Reply"
                          autoFocus
                          onCancel={() => setReplyTo(null)}
                          onSubmit={(body) => addComment(body, thread.id)}
                        />
                      ) : (
                        <VerifyEmailPrompt compact message="Verify your email address to reply." />
                      )}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {error ? <ErrorNotice error={error} onRetry={() => (threads.length ? loadMore() : reload(sort))} /> : null}
      {loading && (
        <p role="status" className="py-2 text-center text-sm text-secondary">
          Loading comments…
        </p>
      )}
      {!loading && cursor && (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Load more comments
          </button>
        </div>
      )}
    </Panel>
  );
}
