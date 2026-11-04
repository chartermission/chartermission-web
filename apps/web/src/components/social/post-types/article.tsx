import Link from "next/link";
import type { PostView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { BrandCover } from "@/components/illustrations";
import { articleHref } from "../links";
import { stripMarkdown } from "./markdown";

/** Default alt text when the author didn't describe the cover. */
export const coverAlt = (article: NonNullable<PostView["article"]>) => article.coverAlt ?? `Cover image for “${article.title}”`;

/** Cover image of an article, or nothing when it has none. */
export function ArticleCover({ article, className }: { article: NonNullable<PostView["article"]>; className?: string }) {
  if (!article.coverUrl) return null;
  return (
    <div className={cn("w-full overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
      <img src={article.coverUrl} alt={coverAlt(article)} className="size-full object-cover" loading="lazy" />
    </div>
  );
}

/** The article's plain-text opening, without a trailing line of hashtags. */
export function articleExcerpt(body: string) {
  return stripMarkdown(body).replace(/(?:\s*#[\p{L}\p{N}_]{2,60})+\s*$/u, "");
}

/**
 * Compact article teaser in the feed (the card header already carries the "Article" chip):
 * title, subtitle or opening, reading time and a thumbnail. The whole teaser opens the
 * article on its reader page; the full body is never shown here.
 */
export function ArticlePreview({ post }: { post: PostView }) {
  const article = post.article!;
  const lead = article.subtitle ?? articleExcerpt(post.body);
  return (
    <div className="group relative flex w-full items-stretch gap-4 overflow-hidden rounded-[10px] border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface max-sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 pl-1">
        <h3 className="line-clamp-2 text-h3 text-ink group-hover:underline max-sm:text-md max-sm:font-semibold">
          <Link href={articleHref(post.id)} className="rounded-sm after:absolute after:inset-0">
            {article.title}
          </Link>
        </h3>
        {lead && <p className="line-clamp-2 text-sm text-body">{lead}</p>}
        <p className="mt-auto flex items-center gap-1.5 pt-1.5 text-xs text-secondary">
          <Icon name="clock" size={14} />
          {article.readingMinutes} min read
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-0.5 font-medium text-primary-light">
            Read article
            <Icon name="chevron-right" size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </p>
      </div>
      <div className="w-[148px] shrink-0 overflow-hidden rounded-lg max-sm:w-[88px]">
        {article.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
          <img src={article.coverUrl} alt={coverAlt(article)} className="size-full min-h-[104px] object-cover max-sm:min-h-[88px]" loading="lazy" />
        ) : (
          <BrandCover className="size-full min-h-[104px] max-sm:min-h-[88px]">
            <Icon name="book" size={28} />
          </BrandCover>
        )}
      </div>
    </div>
  );
}
