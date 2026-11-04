import Link from "next/link";
import type { CSSProperties } from "react";
import type { MemberRef, PostView } from "@chartermission/contracts";
import { Avatar, Icon, cn } from "@chartermission/ui";
import { BrandCover } from "@/components/illustrations";
import { absoluteDate } from "@/components/social/format";
import { articleHref, memberHref } from "@/components/social/links";
import { coverAlt } from "@/components/social/post-types/article";
import { Bone } from "@/components/social/skeletons";
import { articleDate } from "./format";

type Article = NonNullable<PostView["article"]>;

/** Cover image, or the patterned brand placeholder when the article has none. */
export function CoverImage({ article, className, eager = false, iconSize = 32 }: { article: Article; className?: string; eager?: boolean; iconSize?: number }) {
  if (!article.coverUrl) {
    return (
      <BrandCover className={className}>
        <Icon name="book" size={iconSize} />
      </BrandCover>
    );
  }
  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
      <img
        src={article.coverUrl}
        alt={coverAlt(article)}
        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        loading={eager ? "eager" : "lazy"}
      />
    </div>
  );
}

/** "3 Nov" with the full date as a tooltip. */
export function ArticleDate({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={absoluteDate(iso)} className={className} suppressHydrationWarning>
      {articleDate(iso)}
    </time>
  );
}

/** Avatar + name (links to the profile, above the card's stretched link) · date. */
export function ArticleMeta({ author, post, size = 24, className }: { author: MemberRef; post: PostView; size?: 24 | 32 | 40; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs text-secondary", className)}>
      <Avatar name={author.name} src={author.avatarUrl ?? undefined} tone={author.tone} size={size} />
      <p className="flex min-w-0 flex-wrap items-center gap-x-1">
        <Link href={memberHref(author.handle)} className="relative z-10 truncate font-medium text-ink hover:underline">
          {author.name}
        </Link>
        {author.verified && <Icon name="verified" size={14} className="relative z-10 shrink-0 text-primary" label="Verified" />}
        <span aria-hidden="true">·</span>
        <ArticleDate iso={post.createdAt} className="whitespace-nowrap" />
      </p>
    </div>
  );
}

/** Reactions and comments, with words for screen readers. */
export function ArticleCounts({ post, className }: { post: PostView; className?: string }) {
  const { reactions, comments } = post.counts;
  return (
    <p className={cn("flex items-center gap-3 text-xs text-secondary", className)}>
      <span className="flex items-center gap-1">
        <Icon name="like" size={14} />
        {reactions}
        <span className="sr-only"> reaction{reactions === 1 ? "" : "s"}</span>
      </span>
      <span className="flex items-center gap-1">
        <Icon name="message" size={14} />
        {comments}
        <span className="sr-only"> comment{comments === 1 ? "" : "s"}</span>
      </span>
    </p>
  );
}

/**
 * An article in a grid: cover, first topic, title, two-line subtitle, author, date,
 * reading time and counts. The title link stretches over the card.
 */
export function ArticleCard({
  post,
  headingLevel = 3,
  className,
  style,
}: {
  post: PostView;
  headingLevel?: 2 | 3;
  className?: string;
  style?: CSSProperties;
}) {
  const article = post.article;
  if (!article) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const topic = post.hashtags[0];
  return (
    <article
      style={style}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0px_8px_24px_0px_rgba(26,32,44,0.06)] focus-within:border-line-strong",
        className,
      )}
    >
      <CoverImage article={article} className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col gap-2 p-5 max-sm:p-4">
        <p className="flex items-center gap-1.5 text-label">
          {topic && <span className="truncate text-accent-hover">#{topic}</span>}
          {topic && (
            <span aria-hidden="true" className="text-disabled">
              ·
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1 font-medium text-secondary">
            <Icon name="clock" size={12} />
            {article.readingMinutes} min read
          </span>
        </p>
        <Heading className="line-clamp-2 text-h3 text-ink">
          <Link href={articleHref(post.id)} className="rounded-sm after:absolute after:inset-0 group-hover:underline">
            {article.title}
          </Link>
        </Heading>
        {article.subtitle && <p className="line-clamp-2 text-sm text-body">{article.subtitle}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <ArticleMeta author={post.author} post={post} />
          <ArticleCounts post={post} className="shrink-0" />
        </div>
      </div>
    </article>
  );
}

export function ArticleCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col overflow-hidden rounded-card border border-line bg-card">
      <Bone className="aspect-[16/9] w-full rounded-none" />
      <div className="flex flex-col gap-2.5 p-5">
        <Bone className="h-3 w-20" />
        <Bone className="h-5 w-[90%]" />
        <Bone className="h-3.5 w-[75%]" />
        <div className="mt-3 flex items-center gap-2">
          <Bone className="size-6 rounded-full" />
          <Bone className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

/** Responsive grid for article cards: three columns on desktop, two on tablets, one on phones. */
export const articleGridClass = "grid grid-cols-3 gap-5 max-lg:grid-cols-2 max-sm:grid-cols-1 max-sm:gap-4";
