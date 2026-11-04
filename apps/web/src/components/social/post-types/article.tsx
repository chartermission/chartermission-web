import Link from "next/link";
import type { PostView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { postHref } from "../links";
import { stripMarkdown } from "./markdown";

/** Cover image of an article, or nothing when it has none. */
export function ArticleCover({ article, className }: { article: NonNullable<PostView["article"]>; className?: string }) {
  if (!article.coverUrl) return null;
  return (
    <div className={cn("w-full overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
      <img src={article.coverUrl} alt={article.coverAlt ?? `Cover image for “${article.title}”`} className="size-full object-cover" loading="lazy" />
    </div>
  );
}

/** Article in a list: cover, title, subtitle, reading time and a two-line excerpt — never the full body. */
export function ArticlePreview({ post }: { post: PostView }) {
  const article = post.article!;
  const excerpt = stripMarkdown(post.body).replace(/(?:\s*#[A-Za-z0-9_]{2,50})+\s*$/, "");
  const href = postHref(post.id);
  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-[10px] border border-line transition-colors hover:border-line-strong">
      <ArticleCover article={article} className="aspect-[2/1] max-h-[280px]" />
      <div className="flex flex-col gap-1.5 p-4">
        <p className="flex items-center gap-1.5 text-label text-accent-hover">
          <Icon name="book" size={14} />
          Article
          <span aria-hidden="true" className="text-disabled">
            ·
          </span>
          <span className="font-medium text-secondary">{article.readingMinutes} min read</span>
        </p>
        <h3 className="text-h3 text-ink group-hover:underline">{article.title}</h3>
        {article.subtitle && <p className="text-sm font-medium text-body">{article.subtitle}</p>}
        {excerpt && <p className="line-clamp-2 text-sm text-secondary">{excerpt}</p>}
        <Link
          href={href}
          className="mt-1 flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary-light after:absolute after:inset-0 hover:underline"
        >
          Read article<span className="sr-only">: {article.title}</span>
          <Icon name="chevron-right" size={14} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
