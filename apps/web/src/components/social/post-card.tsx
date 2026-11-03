"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { POST_MAX_CHARS, type PostView } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog, UnblockHint } from "./confirm-dialog";
import { ErrorNotice } from "./errors";
import { absoluteUrl, postHref } from "./links";
import { Menu, type MenuItem } from "./menu";
import { PostAttachments } from "./post-attachments";
import { AuthorName, LinkPreviewCard, MemberAvatar, PostCounts, RepostEmbed, TimeAgo } from "./post-parts";
import { PostPoll } from "./post-poll";
import { ReactionButton, type ReactionSnapshot } from "./reaction-button";
import { RepostDialog } from "./repost-dialog";
import { RichText } from "./rich-text";
import { toast } from "./toast";
import type { Viewer } from "./viewer";

const CLAMP_AT = 420;

type Modal = "report" | "delete" | "block" | "mute" | "repost" | null;

async function copyLink(id: string) {
  try {
    await navigator.clipboard.writeText(absoluteUrl(postHref(id)));
    toast.success("Link copied");
  } catch {
    toast.error(new Error("copy"));
  }
}

/**
 * A post wherever posts appear (feed, topic, profile, bookmarks, detail). Owns its
 * interactions: reactions (optimistic), poll votes, repost, bookmark, share, and the
 * overflow menu (copy link, edit, delete, report, mute, block).
 */
export function PostCard({
  post: initial,
  viewer,
  detail = false,
  onRemoved,
  onBookmarkChange,
}: {
  post: PostView;
  viewer: Viewer;
  /** On the post page: full body, and delete navigates back to the feed. */
  detail?: boolean;
  /** Called after delete, mute or block so lists can drop the card. */
  onRemoved?: (post: PostView, scope: "post" | "author") => void;
  onBookmarkChange?: (post: PostView, bookmarked: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [post, setPost] = useState(initial);
  const [reactions, setReactions] = useState<ReactionSnapshot>({
    reaction: initial.viewer.reaction,
    total: initial.counts.reactions,
    breakdown: initial.reactionBreakdown,
  });
  const [bookmarked, setBookmarked] = useState(initial.viewer.bookmarked);
  const [expanded, setExpanded] = useState(detail);
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.body);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<unknown>(null);
  const [gone, setGone] = useState(false);

  const isOwn = post.author.id === viewer.id;
  const subject = `${post.author.name}’s post`;
  const long = post.body.length > CLAMP_AT && !expanded;

  function update(next: PostView) {
    setPost(next);
    setReactions({ reaction: next.viewer.reaction, total: next.counts.reactions, breakdown: next.reactionBreakdown });
  }

  async function toggleBookmark() {
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await api("/bookmarks", { method: next ? "PUT" : "DELETE", body: { targetType: "post", targetId: post.id } });
      toast.success(next ? "Saved to your bookmarks" : "Removed from your bookmarks");
      onBookmarkChange?.(post, next);
    } catch (e) {
      setBookmarked(!next);
      toast.error(e);
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if (!body) return setEditError(new Error("empty"));
    setSaving(true);
    setEditError(null);
    try {
      update(await api<PostView>(`/posts/${post.id}`, { method: "PATCH", body: { body } }));
      setEditing(false);
      toast.success("Post updated");
    } catch (e) {
      setEditError(e);
    } finally {
      setSaving(false);
    }
  }

  function removed(message: string, scope: "post" | "author" = "post") {
    toast.success(message);
    if (detail) {
      router.push("/feed");
      return;
    }
    setGone(true);
    onRemoved?.(post, scope);
  }

  const menu: MenuItem[] = [{ label: "Copy link", icon: "link", onSelect: () => copyLink(post.id) }];
  if (post.viewer.canEdit && !post.isRepost) {
    menu.push({
      label: "Edit post",
      icon: "message",
      onSelect: () => {
        setDraft(post.body);
        setEditing(true);
        setExpanded(true);
      },
    });
  }
  if (isOwn && post.viewer.canDelete) menu.push({ label: "Delete post", icon: "x", danger: true, onSelect: () => setModal("delete") });
  if (!isOwn) {
    if (post.viewer.canReport) menu.push({ label: "Report post", icon: "flag", onSelect: () => setModal("report") });
    menu.push({ label: `Mute ${post.author.name}`, icon: "eye-off", onSelect: () => setModal("mute") });
    menu.push({ label: `Block ${post.author.name}`, icon: "shield", danger: true, onSelect: () => setModal("block") });
    if (post.viewer.canDelete) menu.push({ label: "Delete post (moderator)", icon: "x", danger: true, onSelect: () => setModal("delete") });
  }

  if (gone) return null;

  const moderated = post.moderationState && post.moderationState !== "visible";
  const bodyText = long ? `${post.body.slice(0, CLAMP_AT).trimEnd()}…` : post.body;

  return (
    <article
      aria-labelledby={`${id}-author`}
      className={cn("flex w-full flex-col gap-[14px] rounded-card border bg-card p-5 max-sm:px-4", moderated ? "border-error/40" : "border-line")}
    >
      {post.pinned && (
        <p className="flex items-center gap-1.5 text-label text-accent-hover">
          <Icon name="pin" size={14} />
          {post.kind === "announcement" ? "Pinned announcement" : "Pinned"}
          {post.author.staff && " · Charter Mission team"}
        </p>
      )}
      {!post.pinned && post.kind === "announcement" && (
        <p className="flex items-center gap-1.5 text-label text-accent-hover">
          <Icon name="flag" size={14} />
          Announcement
        </p>
      )}

      {moderated && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-error-light px-3 py-2.5 text-sm text-ink">
          <Icon name="eye-off" size={18} className="mt-0.5 shrink-0 text-error" />
          <p>
            {post.moderationState === "removed" ? "Removed by moderators" : "Hidden by moderators"} — only you can see this post.{" "}
            <Link href="/settings/moderation" className="font-medium text-primary-light hover:underline">
              See why and how to appeal
            </Link>
          </p>
        </div>
      )}
      {post.status === "pending_media" && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-info-light px-3 py-2.5 text-sm text-ink">
          <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-info" />
          <p>Your attachments are being scanned. Others will see this post once the scan finishes.</p>
        </div>
      )}

      <header className="flex w-full items-start gap-3">
        <Link href={`/members/${post.author.handle}`} tabIndex={-1} aria-hidden="true">
          <MemberAvatar member={post.author} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`${id}-author`}>
            <AuthorName member={post.author} />
          </span>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-secondary">
            {post.author.headline && <span className="truncate">{post.author.headline}</span>}
            {post.author.headline && <span aria-hidden="true">·</span>}
            {post.chapter && (
              <>
                <Link href={`/chapters/${post.chapter.slug}`} className="hover:underline">
                  {post.chapter.name}
                </Link>
                <span aria-hidden="true">·</span>
              </>
            )}
            <Link href={postHref(post.id)} className="hover:underline">
              <TimeAgo iso={post.createdAt} />
            </Link>
            {post.editedAt && (
              <span title={`Edited`}>
                <span aria-hidden="true">· </span>Edited
              </span>
            )}
          </p>
        </div>
        <Menu label={`More options for ${subject}`} items={menu} />
      </header>

      {post.isRepost && !post.body && (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-secondary">
          <Icon name="repeat" size={14} />
          Reposted
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-edit`} className="sr-only">
            Edit your post
          </label>
          <textarea
            id={`${id}-edit`}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            maxLength={POST_MAX_CHARS}
            rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
            className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-md text-ink outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-secondary">
              {draft.length.toLocaleString("en-US")} / {POST_MAX_CHARS.toLocaleString("en-US")} · Edited posts are marked “Edited”.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="small" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="small" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div aria-live="polite">
            {editError ? (
              editError instanceof Error && editError.message === "empty" ? (
                <p role="alert" className="text-xs text-error">
                  Write something before saving.
                </p>
              ) : (
                <ErrorNotice error={editError} />
              )
            ) : null}
          </div>
        </div>
      ) : (
        post.body && (
          <div className="w-full text-md text-ink">
            <RichText text={bodyText} mentions={post.mentions} />
            {long && (
              <button type="button" onClick={() => setExpanded(true)} className="mt-1 rounded-sm text-sm font-medium text-secondary hover:text-primary hover:underline">
                See more<span className="sr-only"> of {subject}</span>
              </button>
            )}
          </div>
        )
      )}

      {post.attachments.length > 0 && <PostAttachments attachments={post.attachments} />}
      {post.poll && <PostPoll postId={post.id} poll={post.poll} onUpdated={update} />}
      {post.linkPreview && !post.isRepost && <LinkPreviewCard preview={post.linkPreview} />}
      {post.isRepost && <RepostEmbed original={post.repostOf} />}

      <PostCounts post={post} total={reactions.total} breakdown={reactions.breakdown ?? post.reactionBreakdown} />

      <div className="h-px w-full bg-line" />

      <footer className="flex w-full flex-wrap items-center justify-between gap-y-1">
        <ReactionButton targetType="post" targetId={post.id} state={reactions} onChange={setReactions} subject={subject} />
        {detail ? (
          <a href="#add-comment" className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-secondary hover:bg-muted hover:text-primary">
            <Icon name="message" size={18} />
            <span className="max-sm:sr-only">Comment</span>
          </a>
        ) : (
          <Link
            href={`${postHref(post.id)}#comments`}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-secondary hover:bg-muted hover:text-primary"
          >
            <Icon name="message" size={18} />
            <span className="max-sm:sr-only">Comment</span>
            <span className="sr-only"> on {subject}</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setModal("repost")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted hover:text-primary",
            post.viewer.reposted ? "text-success" : "text-secondary",
          )}
        >
          <Icon name="repeat" size={18} />
          <span className="max-sm:sr-only">{post.viewer.reposted ? "Reposted" : "Repost"}</span>
          <span className="sr-only"> {subject}</span>
        </button>
        <button
          type="button"
          aria-pressed={bookmarked}
          onClick={toggleBookmark}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted hover:text-primary",
            bookmarked ? "text-primary" : "text-secondary",
          )}
        >
          <Icon name="bookmark" size={18} />
          <span className="max-sm:sr-only">{bookmarked ? "Saved" : "Save"}</span>
          <span className="sr-only"> {subject}</span>
        </button>
        <button
          type="button"
          onClick={() => copyLink(post.id)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-secondary hover:bg-muted hover:text-primary"
        >
          <Icon name="share" size={18} />
          <span className="max-sm:sr-only">Share</span>
          <span className="sr-only"> link to {subject}</span>
        </button>
      </footer>

      {modal === "report" && <ReportDialog targetType="post" targetId={post.id} subject={subject} onClose={() => setModal(null)} />}
      {modal === "repost" && (
        <RepostDialog
          post={post}
          onClose={() => setModal(null)}
          onReposted={() => setPost((current) => ({ ...current, viewer: { ...current.viewer, reposted: true }, counts: { ...current.counts, reposts: current.counts.reposts + 1 } }))}
        />
      )}
      {modal === "delete" && (
        <ConfirmDialog
          title="Delete this post?"
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api(`/posts/${post.id}`, { method: "DELETE" });
            removed("Post deleted");
          }}
        >
          It will be removed from feeds, topics and bookmarks. Comments on it are removed too. This can’t be undone.
        </ConfirmDialog>
      )}
      {modal === "mute" && (
        <ConfirmDialog
          title={`Mute ${post.author.name}?`}
          confirmLabel="Mute"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api("/mutes", { method: "POST", body: { targetType: "member", targetId: post.author.id } });
            removed(`${post.author.name} is muted. Their posts won’t appear in your feed.`, "author");
          }}
        >
          Their posts won’t appear in your feed. They won’t be told, and you stay connected. Unmute any time from their profile.
        </ConfirmDialog>
      )}
      {modal === "block" && (
        <ConfirmDialog
          title={`Block ${post.author.name}?`}
          confirmLabel="Block"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api(`/blocks/${post.author.id}`, { method: "POST" });
            removed(`${post.author.name} is blocked. You can unblock them in Settings → Blocked & muted.`, "author");
          }}
        >
          You won’t see each other’s posts or profiles, and any connection or follow between you is removed. They aren’t told. <UnblockHint />
        </ConfirmDialog>
      )}
    </article>
  );
}
