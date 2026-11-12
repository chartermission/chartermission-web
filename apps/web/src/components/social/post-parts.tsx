"use client";

import { PostAttachments } from "./post-attachments";
import { PostPoll } from "./post-poll";
import { VideoEmbedPlayer } from "@/components/video/video-player";
import Link from "next/link";
import { useState } from "react";
import type React from "react";
import { CELEBRATION_LABELS, REQUEST_LABELS, type LinkPreview, type MemberRef, type PostView } from "@chartermission/contracts";
import { Avatar, Icon, cn, RoleBadgeIcon } from "@chartermission/ui";
import { PeopleLink } from "@/components/people/people-link";
import { useT, useIntlTag } from "@/i18n/client";
import { absoluteDateTime, relativeTime } from "./format";
import { memberHref, postHref } from "./links";
import { postTypeAccent, postTypeMeta } from "./post-types/meta";
import { RichText } from "./rich-text";

/** Name with verified tick and staff badge. */
export function AuthorName({ member, className, href }: { member: MemberRef; className?: string; /** For posts published as a page. */ href?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <Link href={href ?? memberHref(member.handle)} className="truncate text-md font-medium text-ink hover:underline">
        {member.name}
      </Link>
      {member.verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
      <RoleBadgeIcon badge={member.badge} size={16} />
      {member.staff && <span className="shrink-0 rounded-full bg-primary-tint px-1.5 py-px text-[11px] font-semibold text-primary">Team</span>}
    </span>
  );
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const intl = useIntlTag();
  const t = useT();
  return (
    <time dateTime={iso} title={absoluteDateTime(intl, iso)} className={className} suppressHydrationWarning>
      {relativeTime(intl, t, iso)}
    </time>
  );
}

/**
 * A member's photo. With `link`, it opens their profile (the viewer's own included); leave it
 * off where the photo already sits inside a link or a button.
 */
export function MemberAvatar({
  member,
  size = 40,
  link = false,
  className,
}: {
  member: Pick<MemberRef, "name" | "avatarUrl" | "tone"> & { handle?: string | null };
  size?: 24 | 32 | 40 | 56 | 96;
  link?: boolean;
  className?: string;
}) {
  const avatar = <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={size} />;
  if (!link || !member.handle) return avatar;
  return (
    <ProfileLink href={memberHref(member.handle)} className={className}>
      {avatar}
    </ProfileLink>
  );
}

/**
 * Makes a profile photo open the profile. The name beside it is the link people tab to and
 * screen readers announce, so the photo's link is a pointer shortcut only (out of the tab order).
 * It sits above a card's stretched link (`relative z-10`).
 */
export function ProfileLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} tabIndex={-1} aria-hidden="true" className={cn("relative z-10 shrink-0 rounded-full transition-opacity hover:opacity-90", className)}>
      {children}
    </Link>
  );
}

export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="flex w-full items-stretch overflow-hidden rounded-[10px] border border-line hover:bg-primary-tint-2"
    >
      {preview.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party preview image of unknown size
        <img src={preview.imageUrl} alt="" className="h-24 w-[132px] shrink-0 object-cover" loading="lazy" />
      ) : (
        <span className="flex h-24 w-[132px] shrink-0 items-center justify-center bg-primary-tint text-primary-light max-sm:w-20">
          <Icon name="link" size={24} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-[14px] py-3">
        <span className="text-xs text-secondary">{preview.domain}</span>
        <span className="line-clamp-2 text-sm font-medium text-ink">{preview.title ?? preview.url}</span>
        {preview.description && <span className="line-clamp-2 text-xs text-secondary">{preview.description}</span>}
      </span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Past this many characters a reposted post's text is folded, with "See more". */
const REPOST_FOLD_CHARS = 600;

/**
 * The original post inside a repost (one level only), shown in full: its text, photos, videos and
 * documents, poll, link preview or video, and an article's cover. The card links to the original.
 */
export function RepostEmbed({ original: initial }: { original: PostView | null }) {
  const t = useT();
  const [original, setOriginal] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  if (!original) {
    return (
      <p className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-secondary">
        <Icon name="eye-off" size={16} />
        The original post is no longer available.
      </p>
    );
  }
  const long = !original.article && original.body.length > REPOST_FOLD_CHARS;
  const preview = original.linkPreview && !original.article && original.attachments.length === 0 ? original.linkPreview : null;
  return (
    <div className="relative flex w-full flex-col gap-2.5 rounded-[10px] border border-line p-4 hover:bg-surface">
      <div className="flex items-center gap-2">
        <MemberAvatar member={original.author} size={32} link />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm font-medium text-ink">{original.author.name}</span>
            {original.author.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label="Verified" />}
            <RoleBadgeIcon badge={original.author.badge} size={14} />
          </span>
          <span className="truncate text-xs text-secondary">
            {original.author.headline ? `${original.author.headline} · ` : ""}
            <TimeAgo iso={original.createdAt} />
          </span>
        </span>
      </div>
      {original.type !== "standard" && (
        <p className="text-label text-accent-hover">
          {original.article
            ? "Article"
            : original.question
              ? "Question"
              : original.celebration
                ? CELEBRATION_LABELS[original.celebration.category]
                : original.request
                  ? t("Looking for · {label}", { label: t(REQUEST_LABELS[original.request.category]) })
                  : null}
        </p>
      )}
      {original.article?.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded cover of any size
        <img src={original.article.coverUrl} alt={original.article.coverAlt ?? ""} className="aspect-[2/1] w-full rounded-lg object-cover" loading="lazy" />
      )}
      {(original.article || original.celebration || original.request) && (
        <p className="text-md font-semibold text-ink">{original.article?.title ?? original.celebration?.headline ?? original.request?.title}</p>
      )}
      {original.body && !original.article && (
        <div className="flex flex-col items-start gap-1">
          <RichText text={original.body} mentions={original.mentions} className={cn("text-sm whitespace-pre-wrap text-ink", long && !expanded && "line-clamp-[10]")} />
          {long && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="relative z-10 text-sm font-medium text-secondary hover:text-ink hover:underline">
              {expanded ? t("See less") : t("See more")}
            </button>
          )}
        </div>
      )}
      {original.article?.subtitle && <p className="text-sm text-body">{original.article.subtitle}</p>}
      {/* Media, polls and links sit above the card's link so they can be opened, played and used. */}
      {original.attachments.length > 0 && !original.article && (
        <div className="relative z-10 flex flex-col gap-2">
          <PostAttachments attachments={original.attachments} />
        </div>
      )}
      {original.poll && !original.article && (
        <div className="relative z-10">
          <PostPoll postId={original.id} poll={original.poll} onUpdated={(next) => setOriginal(next)} />
        </div>
      )}
      {preview && (
        <div className="relative z-10">
          {preview.embed ? <VideoEmbedPlayer preview={preview} embed={preview.embed} /> : <LinkPreviewCard preview={preview} />}
        </div>
      )}
      <Link href={postHref(original)} className="text-xs font-medium text-primary-light after:absolute after:inset-0 hover:underline">
        {original.article ? "Read article" : "View original post"}
      </Link>
    </div>
  );
}

/**
 * "3 reactions · 2 comments · 1 repost" with the reaction kinds that were used. Each count opens
 * the list of members behind it.
 */
export function PostCounts({ post, total, breakdown }: { post: PostView; total: number; breakdown: PostView["reactionBreakdown"] }) {
  const t = useT();
  const { comments, reposts } = post.counts;
  if (!total && !comments && !reposts) return null;
  const used = (["like", "insightful", "support"] as const).filter((kind) => breakdown[kind] > 0);
  const kindIcon = { like: "like", insightful: "lightbulb", support: "users" } as const;
  const kindColor = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" } as const;
  // Counts include replies, so questions say "responses" rather than "answers".
  const commentsLabel = t(post.type === "question" ? "post.responses" : "post.comments", { count: comments });
  return (
    <div className="flex w-full items-center justify-between gap-3 text-xs text-secondary">
      <span className="flex items-center gap-1.5">
        {total > 0 && (
          <PeopleLink
            source={{ path: `/posts/${post.id}/reactions`, title: t("people.reactions"), reactions: true }}
            className="flex items-center gap-1.5"
            label={`${t("post.reactions", { count: total })} (${used.map((kind) => `${breakdown[kind]} ${t(`reaction.${kind}`)}`).join(", ")}). ${t("people.seeWho")}`}
          >
            <span className="flex -space-x-1" aria-hidden="true">
              {used.map((kind) => (
                <span key={kind} className={cn("flex size-[18px] items-center justify-center rounded-full border border-card text-inverse", kindColor[kind])}>
                  <Icon name={kindIcon[kind]} size={10} />
                </span>
              ))}
            </span>
            <span>{t("post.reactions", { count: total })}</span>
          </PeopleLink>
        )}
      </span>
      {(comments > 0 || reposts > 0) && (
        <span className="flex items-center gap-1.5">
          {comments > 0 && (
            <PeopleLink source={{ path: `/posts/${post.id}/commenters`, title: t("people.commenters") }} label={`${commentsLabel}. ${t("people.seeWho")}`}>
              {commentsLabel}
            </PeopleLink>
          )}
          {comments > 0 && reposts > 0 && <span aria-hidden>·</span>}
          {reposts > 0 && (
            <PeopleLink source={{ path: `/posts/${post.id}/reposts`, title: t("people.reposters") }} label={`${t("post.reposts", { count: reposts })}. ${t("people.seeWho")}`}>
              {t("post.reposts", { count: reposts })}
            </PeopleLink>
          )}
        </span>
      )}
    </div>
  );
}

/** Small "Question" / "Celebration" / "Looking for" / "Article" chip in the post type's accent. Nothing for standard posts. */
export function PostTypeChip({ type, className }: { type: PostView["type"]; className?: string }) {
  const accent = postTypeAccent[type];
  if (!accent) return null;
  const meta = postTypeMeta[type];
  return (
    // On phones the chip shrinks to its icon (the label stays for screen readers and as a tooltip).
    <span title={meta.badge} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-label max-sm:size-6 max-sm:justify-center max-sm:p-0", accent.chip, className)}>
      <Icon name={meta.icon} size={13} className={accent.icon} />
      <span className="max-sm:sr-only">{meta.badge}</span>
    </span>
  );
}
