import Link from "next/link";
import { CELEBRATION_LABELS, REQUEST_LABELS, type LinkPreview, type MemberRef, type PostView } from "@chartermission/contracts";
import { Avatar, Icon, cn } from "@chartermission/ui";
import { TickNumber } from "@/components/motion";
import { absoluteDateTime, relativeTime } from "./format";
import { memberHref, postHref } from "./links";
import { postTypeAccent, postTypeMeta } from "./post-types/meta";
import { RichText } from "./rich-text";

/** Name with verified tick and staff badge. */
export function AuthorName({ member, className }: { member: MemberRef; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <Link href={memberHref(member.handle)} className="truncate text-md font-medium text-ink hover:underline">
        {member.name}
      </Link>
      {member.verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
      {member.staff && <span className="shrink-0 rounded-full bg-primary-tint px-1.5 py-px text-[11px] font-semibold text-primary">Team</span>}
    </span>
  );
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={absoluteDateTime(iso)} className={className} suppressHydrationWarning>
      {relativeTime(iso)}
    </time>
  );
}

export function MemberAvatar({ member, size = 40 }: { member: Pick<MemberRef, "name" | "avatarUrl" | "tone">; size?: 24 | 32 | 40 | 56 | 96 }) {
  return <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={size} />;
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

/** The original post inside a repost (one level only). */
export function RepostEmbed({ original }: { original: PostView | null }) {
  if (!original) {
    return (
      <p className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-secondary">
        <Icon name="eye-off" size={16} />
        The original post is no longer available.
      </p>
    );
  }
  const images = original.attachments.filter((a) => a.kind === "image").length;
  const docs = original.attachments.length - images;
  return (
    <div className="relative flex w-full flex-col gap-2 rounded-[10px] border border-line p-4 hover:bg-surface">
      <div className="flex items-center gap-2">
        <MemberAvatar member={original.author} size={24} />
        <span className="truncate text-sm font-medium text-ink">{original.author.name}</span>
        {original.author.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label="Verified" />}
        <span className="text-xs text-secondary">
          · <TimeAgo iso={original.createdAt} />
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
                  ? `Looking for · ${REQUEST_LABELS[original.request.category]}`
                  : null}
        </p>
      )}
      {(original.article || original.celebration || original.request) && (
        <p className="text-sm font-semibold text-ink">{original.article?.title ?? original.celebration?.headline ?? original.request?.title}</p>
      )}
      {original.body && !original.article && <RichText text={original.body} mentions={original.mentions} className="line-clamp-4 text-sm text-ink" />}
      {original.article?.subtitle && <p className="line-clamp-2 text-sm text-body">{original.article.subtitle}</p>}
      {(images > 0 || docs > 0 || original.poll) && !original.article && (
        <p className="flex items-center gap-1.5 text-xs text-secondary">
          <Icon name={original.poll ? "chart" : "image"} size={14} />
          {original.poll ? "Poll" : images > 0 ? `${images} image${images === 1 ? "" : "s"}` : "PDF document"}
        </p>
      )}
      <Link href={postHref(original.id)} className="text-xs font-medium text-primary-light after:absolute after:inset-0 hover:underline">
        {original.article ? "Read article" : "View original post"}
      </Link>
    </div>
  );
}

/** "3 reactions · 2 comments · 1 repost" with the reaction kinds that were used. */
export function PostCounts({ post, total, breakdown }: { post: PostView; total: number; breakdown: PostView["reactionBreakdown"] }) {
  const parts: string[] = [];
  // Counts include replies, so questions say "responses" rather than "answers".
  const noun = post.type === "question" ? "response" : "comment";
  if (post.counts.comments) parts.push(`${post.counts.comments} ${noun}${post.counts.comments === 1 ? "" : "s"}`);
  if (post.counts.reposts) parts.push(`${post.counts.reposts} repost${post.counts.reposts === 1 ? "" : "s"}`);
  if (!total && !parts.length) return null;
  const used = (["like", "insightful", "support"] as const).filter((kind) => breakdown[kind] > 0);
  const kindIcon = { like: "like", insightful: "lightbulb", support: "users" } as const;
  const kindColor = { like: "bg-primary-light", insightful: "bg-warning", support: "bg-success" } as const;
  return (
    <p className="flex w-full items-center justify-between gap-3 text-xs text-secondary">
      <span className="flex items-center gap-1.5">
        {total > 0 && (
          <>
            <span className="flex -space-x-1" aria-hidden="true">
              {used.map((kind) => (
                <span key={kind} className={cn("flex size-[18px] items-center justify-center rounded-full border border-card text-inverse", kindColor[kind])}>
                  <Icon name={kindIcon[kind]} size={10} />
                </span>
              ))}
            </span>
            <span>
              <TickNumber value={total} /> reaction{total === 1 ? "" : "s"}
              <span className="sr-only">
                {" "}
                ({used.map((kind) => `${breakdown[kind]} ${kind}`).join(", ")})
              </span>
            </span>
          </>
        )}
      </span>
      {parts.length > 0 && (
        <Link href={`${postHref(post.id)}#comments`} className="hover:text-primary hover:underline">
          {parts.join(" · ")}
        </Link>
      )}
    </p>
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
