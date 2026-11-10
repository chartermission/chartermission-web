"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  CHAPTER_NOTE_MAX_CHARS,
  type ChapterBan,
  type ChapterPostReviewInput,
  type ChapterReviewQueue,
  type MemberRef,
  type PostView,
} from "@chartermission/contracts";
import { Button, Icon, Panel, buttonClasses } from "@chartermission/ui";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { PostCard } from "@/components/social/post-card";
import { announcePostCreated } from "@/components/social/post-events";
import { AuthorName, MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";

/* Lets the Review tab, the feed and the members list tell each other what changed. */
const CHANGED = "cm:chapter-moderation";
export function announceChapterModeration() {
  window.dispatchEvent(new Event(CHANGED));
}
function useOnChapterModeration(run: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, run);
    return () => window.removeEventListener(CHANGED, run);
  }, [run]);
}

/**
 * A short form in a dialog: an optional (or required) note, then the action. Used for declining,
 * holding and removing posts, removing a member from the chapter and reporting fraud.
 */
export function NoteDialog({
  title,
  description,
  label,
  hint,
  confirmLabel,
  danger = false,
  required = false,
  maxLength = CHAPTER_NOTE_MAX_CHARS,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  label: string;
  hint?: string;
  confirmLabel: string;
  danger?: boolean;
  /** At least ten characters must be written. */
  required?: boolean;
  maxLength?: number;
  /** Resolve to close the dialog; throw to keep it open and show the error. */
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const short = required && note.trim().length < 10;

  async function confirm() {
    if (busy || short) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      width={480}
      initialFocus="textarea"
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={onClose}>
            {t("Cancel")}
          </button>
          <Button onClick={confirm} aria-disabled={busy || short} className={danger ? "bg-error hover:bg-error/90" : undefined}>
            {busy ? t("Working…") : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
          {label}
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={maxLength}
          rows={4}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-md text-ink focus:border-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
        />
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-secondary">
            {hint}
          </p>
        )}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}

/** Sends the chapter team's decision on a post. */
export function reviewPost(slug: string, postId: string, input: ChapterPostReviewInput) {
  return api<{ status: PostView["status"] }>(`/chapters/${slug}/posts/${postId}/review`, { method: "POST", body: input });
}

/**
 * Review tab, for the chapter's team: posts waiting for approval, oldest first, each with Approve
 * and Decline. Declining asks for a note, which is sent to the author.
 */
export function ChapterReview({ chapter, viewer }: { chapter: { slug: string; name: string }; viewer: Viewer }) {
  const t = useT();
  const [items, setItems] = useState<PostView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PostView | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    api<ChapterReviewQueue>(`/chapters/${chapter.slug}/review`).then(
      (queue) => {
        if (!live) return;
        setItems(queue.items);
        setError(null);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [chapter.slug, tick]);
  useOnChapterModeration(load);

  async function approve(post: PostView) {
    setBusy(post.id);
    try {
      await reviewPost(chapter.slug, post.id, { action: "approve" });
      setItems((current) => current?.filter((p) => p.id !== post.id) ?? null);
      announcePostCreated({ ...post, status: "published", chapterReview: undefined });
      toast.success(t("Approved. The post is now live in {chapter}.", { chapter: chapter.name }));
    } catch (e) {
      toast.error(e);
      load();
    } finally {
      setBusy(null);
    }
  }

  async function decline(post: PostView, note: string) {
    await reviewPost(chapter.slug, post.id, { action: "decline", note: note || undefined });
    setItems((current) => current?.filter((p) => p.id !== post.id) ?? null);
    toast.success(t("Declined. The author has been told."));
  }

  if (error && !items) return <ErrorNotice error={error} onRetry={load} />;
  if (!items) {
    return (
      <Panel aria-busy="true" className="h-40 animate-pulse">
        <span className="sr-only">{t("Loading…")}</span>
      </Panel>
    );
  }
  if (!items.length) {
    return (
      <EmptyState icon="check" title={t("Nothing is waiting for review")}>
        {t("Posts that need the team’s approval, and posts a team member sends back for review, appear here.")}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="text-sm text-secondary">{t("Only the chapter team can see these posts. Approve one to show it in the chapter, or decline it with a note for the author.")}</p>
      <ul className="flex flex-col gap-4">
        {items.map((post) => (
          <li key={post.id} className="flex flex-col gap-2">
            {post.chapterReview?.by && (
              <p className="flex items-center gap-1.5 text-xs text-secondary">
                <Icon name="clock" size={14} />
                {t("Sent back for review by {name}", { name: post.chapterReview.by.name })}
                {post.chapterReview.note ? `: “${post.chapterReview.note}”` : ""}
              </p>
            )}
            <PostCard post={post} viewer={viewer} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" onClick={() => approve(post)} aria-disabled={busy === post.id}>
                <Icon name="check" size={16} />
                {busy === post.id ? t("Approving…") : t("Approve")}
              </Button>
              <Button size="small" variant="secondary" onClick={() => setDeclining(post)} aria-disabled={busy === post.id}>
                {t("Decline")}
              </Button>
              <span className="text-xs text-secondary">
                {t("Posted")} <TimeAgo iso={post.createdAt} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {declining && (
        <NoteDialog
          title={t("Decline this post?")}
          description={t("It won’t appear in {chapter}. {name} is told, and can still see the post themselves.", { chapter: chapter.name, name: declining.author.name })}
          label={t("Note for the author (optional)")}
          hint={t("Say what would make it right for the chapter.")}
          confirmLabel={t("Decline post")}
          danger
          onConfirm={(note) => decline(declining, note)}
          onClose={() => setDeclining(null)}
        />
      )}
    </>
  );
}

/** For the chapter's team, under the members list: who has been removed from the chapter, with a way back in. */
export function ChapterBans({ slug }: { slug: string }) {
  const t = useT();
  const [bans, setBans] = useState<ChapterBan[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    api<ChapterBan[]>(`/chapters/${slug}/bans`).then(
      (list) => live && setBans(list),
      () => live && setBans([]),
    );
    return () => {
      live = false;
    };
  }, [slug, tick]);
  useOnChapterModeration(load);

  async function unban(member: MemberRef) {
    setBusy(member.id);
    try {
      setBans(await api<ChapterBan[]>(`/chapters/${slug}/bans/${member.id}`, { method: "DELETE" }));
      toast.success(t("{name} can join the chapter again", { name: member.name }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  if (!bans?.length) return null;
  return (
    <Panel aria-labelledby="chapter-bans-heading" className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h3 id="chapter-bans-heading" className="flex items-center gap-1.5 text-h3 text-ink">
          <Icon name="ban" size={18} className="text-error" />
          {t("Removed from the chapter")}
        </h3>
        <p className="text-sm text-secondary">{t("These members can’t join or post in this chapter. Only the chapter team sees this list.")}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {bans.map((ban) => (
          <li key={ban.member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <MemberAvatar member={ban.member} size={32} link />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <AuthorName member={ban.member} className="text-sm" />
              <p className="text-xs text-secondary">
                {ban.bannedBy ? t("Removed by {name}", { name: ban.bannedBy.name }) : t("Removed")} · <TimeAgo iso={ban.createdAt} />
                {ban.reason ? ` · “${ban.reason}”` : ""}
              </p>
            </div>
            <Button size="small" variant="secondary" onClick={() => unban(ban.member)} aria-disabled={busy === ban.member.id}>
              {busy === ban.member.id ? t("Working…") : t("Let back in")}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
