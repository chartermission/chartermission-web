"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { MemberProfile, PostView } from "@chartermission/contracts";
import { Avatar, Icon, buttonClasses, cn, RoleBadgeIcon } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { pop } from "@/components/motion";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { FollowControl, useRelationship } from "@/components/network/relationship";
import { ConfirmDialog, UnblockHint } from "@/components/social/confirm-dialog";
import { absoluteUrl, articleHref, articlesHref, authorHref, memberHref, postAnalyticsHref } from "@/components/social/links";
import { Menu, type MenuItem } from "@/components/social/menu";
import { PostCounts } from "@/components/social/post-parts";
import { coverAlt } from "@/components/social/post-types/article";
import { Markdown } from "@/components/social/post-types/markdown";
import { PostEditForm } from "@/components/social/post-types/post-edit-form";
import { ReactionButton, type ReactionSnapshot } from "@/components/social/reaction-button";
import { RepostDialog } from "@/components/social/repost-dialog";
import { toast } from "@/components/social/toast";
import { usePostView } from "@/components/social/view-tracker";
import type { Viewer } from "@/components/social/viewer";
import { BrandCover } from "@/components/illustrations";
import { articleLongDate, withoutTrailingTags } from "./format";
import { ReadingProgress } from "./reading-progress";

type Modal = "report" | "delete" | "block" | "mute" | "repost" | null;

const action = "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted hover:text-primary";

/**
 * The article reading view: cover, title, subtitle, byline with follow, the body in a
 * comfortable measure, hashtags, the post actions (react, comment, repost, save, share and
 * the overflow menu) and an "about the author" footer. Comments render below, separately.
 */
export function ArticleReader({ post: initial, viewer, author }: { post: PostView; viewer: Viewer; author: MemberProfile | null }) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [reactions, setReactions] = useState<ReactionSnapshot>({
    reaction: initial.viewer.reaction,
    total: initial.counts.reactions,
    breakdown: initial.reactionBreakdown,
  });
  const [bookmarked, setBookmarked] = useState(initial.viewer.bookmarked);
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bookmarkIconRef = useRef<HTMLSpanElement>(null);
  const follow = useRelationship(post.author, author?.relationship ?? { connection: "none", connectionId: null, following: false });

  usePostView(bodyRef, initial.id, !initial.viewer.canViewAnalytics && initial.status === "published" && !initial.moderationState);

  const article = post.article!;
  // An article published as a page belongs to everyone who manages that page.
  const isOwn = post.page ? post.viewer.canEdit : post.author.id === viewer.id;
  const canFollow = !!author && !author.relationship.self && !isOwn;
  const subject = `${post.author.name}’s article`;
  const moderated = post.moderationState && post.moderationState !== "visible";

  function update(next: PostView) {
    setPost(next);
    setReactions({ reaction: next.viewer.reaction, total: next.counts.reactions, breakdown: next.reactionBreakdown });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(articleHref(post.id)));
      toast.success("Link copied");
    } catch {
      toast.error(new Error("copy"));
    }
  }

  async function toggleBookmark() {
    const next = !bookmarked;
    setBookmarked(next);
    if (next) pop(bookmarkIconRef.current, { scale: 1.25, duration: 380 });
    try {
      await api("/bookmarks", { method: next ? "PUT" : "DELETE", body: { targetType: "post", targetId: post.id } });
      toast.success(next ? "Saved to your bookmarks" : "Removed from your bookmarks");
    } catch (e) {
      setBookmarked(!next);
      toast.error(e);
    }
  }

  function leave(message: string) {
    toast.success(message);
    router.push("/articles");
  }

  const menu: MenuItem[] = [{ label: "Copy link", icon: "link", onSelect: copyLink }];
  if (post.viewer.canEdit && !post.isRepost) menu.push({ label: "Edit article", icon: "message", onSelect: () => setEditing(true) });
  if (post.viewer.canViewAnalytics) menu.push({ label: "View analytics", icon: "chart", onSelect: () => router.push(postAnalyticsHref(post.id)) });
  if (isOwn && post.viewer.canDelete) menu.push({ label: "Delete article", icon: "x", danger: true, onSelect: () => setModal("delete") });
  if (!isOwn) {
    if (post.viewer.canReport) menu.push({ label: "Report article", icon: "flag", onSelect: () => setModal("report") });
    if (!post.page) {
      menu.push({ label: `Mute ${post.author.name}`, icon: "eye-off", onSelect: () => setModal("mute") });
      menu.push({ label: `Block ${post.author.name}`, icon: "shield", danger: true, onSelect: () => setModal("block") });
    }
    if (post.viewer.canDelete) menu.push({ label: "Delete article (moderator)", icon: "x", danger: true, onSelect: () => setModal("delete") });
  }

  const topic = post.hashtags[0];
  const body = withoutTrailingTags(post.body);

  return (
    <article aria-labelledby="article-title" className="flex flex-col gap-8 max-sm:gap-6">
      <ReadingProgress target={bodyRef} />

      {article.coverUrl ? (
        <figure className="overflow-hidden rounded-card border border-line bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
          <img src={article.coverUrl} alt={coverAlt(article)} className="aspect-[2/1] max-h-[480px] w-full object-cover max-sm:aspect-[16/10]" />
        </figure>
      ) : (
        <BrandCover variant="navy" className="aspect-[3/1] rounded-card max-sm:aspect-[2/1]">
          <Icon name="book" size={48} />
        </BrandCover>
      )}

      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
        {moderated && (
          <div role="note" className="flex items-start gap-2.5 rounded-lg bg-error-light px-3 py-2.5 text-sm text-ink">
            <Icon name="eye-off" size={18} className="mt-0.5 shrink-0 text-error" />
            <p>
              {post.moderationState === "removed" ? "Removed by moderators" : "Hidden by moderators"} — only you can see this article.{" "}
              <Link href="/settings/moderation" className="font-medium text-primary-light hover:underline">
                See why and how to appeal
              </Link>
            </p>
          </div>
        )}
        {post.status === "pending_media" && (
          <div role="note" className="flex items-start gap-2.5 rounded-lg bg-info-light px-3 py-2.5 text-sm text-ink">
            <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-info" />
            <p>Your cover is being scanned. Others will see this article once the scan finishes.</p>
          </div>
        )}

        {editing ? (
          <>
            <h1 id="article-title" className="sr-only">
              Editing “{article.title}”
            </h1>
            <PostEditForm
              post={post}
              onSaved={(next) => {
                update(next);
                setEditing(false);
                toast.success("Article updated");
              }}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <header className="flex flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2 text-label">
              <Link href="/articles" className="inline-flex items-center gap-1 rounded-full bg-primary-tint-2 px-2 py-0.5 text-primary-light hover:bg-primary-tint">
                <Icon name="book" size={13} />
                Article
              </Link>
              {topic && (
                <Link href={articlesHref(topic)} className="rounded-sm text-accent-hover hover:underline">
                  #{topic}
                </Link>
              )}
            </p>
            <h1 id="article-title" dir="auto" className="bidi-auto text-display text-ink max-md:text-h1 max-sm:text-[28px] max-sm:leading-9">
              {article.title}
            </h1>
            {article.subtitle && <p className="text-[20px] leading-[30px] text-body max-sm:text-[17px] max-sm:leading-7">{article.subtitle}</p>}

            <div className="flex items-center gap-3 border-y border-line py-4">
              <Link href={authorHref(post)} tabIndex={-1} aria-hidden="true" className="shrink-0">
                <Avatar name={post.author.name} src={post.author.avatarUrl ?? undefined} tone={post.author.tone} size={40} />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex min-w-0 items-center gap-1">
                    <Link href={authorHref(post)} className="truncate text-md font-medium text-ink hover:underline">
                      {post.author.name}
                    </Link>
                    {post.author.verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
                    <RoleBadgeIcon badge={post.author.badge} size={16} />
                  </span>
                  {canFollow && (
                    <>
                      <span aria-hidden="true" className="text-disabled">
                        ·
                      </span>
                      <button
                        type="button"
                        aria-pressed={follow.state.following}
                        disabled={follow.busy === "follow"}
                        onClick={() => (follow.state.following ? follow.unfollow() : follow.follow())}
                        className={cn(
                          "rounded-sm text-sm font-medium hover:underline disabled:opacity-60",
                          follow.state.following ? "text-secondary" : "text-primary-light",
                        )}
                      >
                        {follow.state.following ? "Following" : "Follow"}
                        <span className="sr-only"> {post.author.name}</span>
                      </button>
                    </>
                  )}
                </p>
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-secondary">
                  {post.author.headline && (
                    <>
                      <span className="truncate">{post.author.headline}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <time dateTime={post.createdAt} suppressHydrationWarning>
                    {articleLongDate(post.createdAt)}
                  </time>
                  <span aria-hidden="true">·</span>
                  <span>{article.readingMinutes} min read</span>
                  {post.editedAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Edited</span>
                    </>
                  )}
                </p>
              </div>
              <Menu label={`More options for ${subject}`} items={menu} />
            </div>
          </header>
        )}

        {!editing && (
          <div ref={bodyRef} id="article-body">
            <Markdown
              text={body}
              mentions={post.mentions}
              className="max-w-[68ch] gap-5 text-[17px] leading-[1.8] text-ink/90 max-sm:text-[16px]"
            />
          </div>
        )}

        {!editing && post.hashtags.length > 0 && (
          <ul aria-label="Topics" className="flex flex-wrap gap-2">
            {post.hashtags.map((tag) => (
              <li key={tag}>
                <Link
                  href={articlesHref(tag)}
                  className="inline-flex items-center rounded-full bg-accent-light px-3 py-[5px] text-sm font-medium text-accent-hover hover:bg-accent hover:text-inverse"
                >
                  #{tag}
                  <span className="sr-only"> — more articles on this topic</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3">
          <PostCounts post={post} total={reactions.total} breakdown={reactions.breakdown ?? post.reactionBreakdown} />
          <div role="group" aria-label="Article actions" className="flex flex-wrap items-center justify-between gap-y-1 rounded-card border border-line bg-card px-3 py-1.5">
            <ReactionButton targetType="post" targetId={post.id} state={reactions} onChange={setReactions} subject={subject} />
            <a href="#add-comment" className={cn(action, "text-secondary")}>
              <Icon name="message" size={18} />
              <span className="max-sm:sr-only">Comment</span>
              <span className="sr-only"> on {subject}</span>
            </a>
            <button type="button" onClick={() => setModal("repost")} className={cn(action, post.viewer.reposted ? "text-success" : "text-secondary")}>
              <Icon name="repeat" size={18} />
              <span className="max-sm:sr-only">{post.viewer.reposted ? "Reposted" : "Repost"}</span>
              <span className="sr-only"> {subject}</span>
            </button>
            <button type="button" aria-pressed={bookmarked} onClick={toggleBookmark} className={cn(action, bookmarked ? "text-primary" : "text-secondary")}>
              <span ref={bookmarkIconRef} className="flex">
                <Icon name="bookmark" size={18} fill={bookmarked ? "currentColor" : "none"} className="transition-[fill] duration-200" />
              </span>
              <span className="max-sm:sr-only">{bookmarked ? "Saved" : "Save"}</span>
              <span className="sr-only"> {subject}</span>
            </button>
            <button type="button" onClick={copyLink} className={cn(action, "text-secondary")}>
              <Icon name="share" size={18} />
              <span className="max-sm:sr-only">Share</span>
              <span className="sr-only"> link to {subject}</span>
            </button>
          </div>
        </div>

        {author && (
          <section aria-labelledby="about-author" className="flex items-start gap-4 rounded-card border border-line bg-surface p-5 max-sm:flex-col max-sm:gap-3 max-sm:px-4">
            <Avatar name={author.name} src={author.avatarUrl ?? undefined} tone={author.tone} size={56} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-label text-secondary">Written by</p>
              <h2 id="about-author" className="flex items-center gap-1 text-h3 text-ink">
                <Link href={memberHref(author.handle)} className="hover:underline">
                  {author.name}
                </Link>
                {author.verified && <Icon name="verified" size={16} className="text-primary" label="Verified" />}
                <RoleBadgeIcon badge={author.badge} size={16} />
              </h2>
              {author.headline && <p className="text-sm text-body">{author.headline}</p>}
              {author.bio && <p className="line-clamp-3 text-sm text-secondary">{author.bio}</p>}
              <p className="text-xs text-secondary">
                {author.counts.followers.toLocaleString("en-US")} follower{author.counts.followers === 1 ? "" : "s"} · {author.counts.posts.toLocaleString("en-US")} post
                {author.counts.posts === 1 ? "" : "s"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {canFollow && <FollowControl member={author} controls={follow} />}
                <Link href={memberHref(author.handle)} className={buttonClasses({ variant: "secondary", size: "small" })}>
                  View profile
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>

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
          title="Delete this article?"
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api(`/posts/${post.id}`, { method: "DELETE" });
            leave("Article deleted");
          }}
        >
          It will be removed from Articles, feeds, topics and bookmarks. Comments on it are removed too. This can’t be undone.
        </ConfirmDialog>
      )}
      {modal === "mute" && (
        <ConfirmDialog
          title={`Mute ${post.author.name}?`}
          confirmLabel="Mute"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api("/mutes", { method: "POST", body: { targetType: "member", targetId: post.author.id } });
            leave(`${post.author.name} is muted. Their posts won’t appear in your feed.`);
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
            leave(`${post.author.name} is blocked. You can unblock them in Settings → Blocked & muted.`);
          }}
        >
          You won’t see each other’s posts or profiles, and any connection or follow between you is removed. They aren’t told. <UnblockHint />
        </ConfirmDialog>
      )}
    </article>
  );
}
