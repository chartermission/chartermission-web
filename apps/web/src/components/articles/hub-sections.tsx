import Link from "next/link";
import type { PostView } from "@chartermission/contracts";
import { Avatar, Icon, Panel, cn, RoleBadgeIcon } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import type { Viewer } from "@/components/social/viewer";
import { WriteArticleButton } from "./write-article-button";
import { articleHref, authorHref } from "@/components/social/links";
import { Bone } from "@/components/social/skeletons";
import { ArticleCounts, ArticleDate, CoverImage } from "./article-card";

/** The featured article: large cover, title, subtitle, author, date and reading time. */
export function FeaturedArticle({ post }: { post: PostView }) {
  const article = post.article!;
  const topic = post.hashtags[0];
  return (
    <article
      aria-labelledby="featured-title"
      className="group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0px_8px_24px_0px_rgba(26,32,44,0.06)]"
    >
      <CoverImage article={article} eager iconSize={48} className="aspect-[2/1] w-full max-sm:aspect-[16/9]" />
      <div className="flex flex-1 flex-col gap-3 p-6 max-sm:p-4">
        <p className="flex flex-wrap items-center gap-2 text-label">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2 py-0.5 text-accent-hover">
            <Icon name="flame" size={13} />
            Featured
          </span>
          {topic && <span className="text-accent-hover">#{topic}</span>}
        </p>
        <h2 id="featured-title" className="text-h1 text-ink max-sm:text-h2">
          <Link href={articleHref(post.id)} className="rounded-sm after:absolute after:inset-0 group-hover:underline">
            {article.title}
          </Link>
        </h2>
        {article.subtitle && <p className="line-clamp-2 text-h3 font-normal text-body max-sm:text-md">{article.subtitle}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={post.author.name} src={post.author.avatarUrl ?? undefined} tone={post.author.tone} size={40} />
            <div className="flex min-w-0 flex-col">
              <p className="flex items-center gap-1">
                <Link href={authorHref(post)} className="relative z-10 truncate text-md font-medium text-ink hover:underline">
                  {post.author.name}
                </Link>
                {post.author.verified && <Icon name="verified" size={16} className="relative z-10 shrink-0 text-primary" label="Verified" />}
                <RoleBadgeIcon badge={post.author.badge} size={16} className="relative z-10" />
              </p>
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-secondary">
                {post.author.headline && (
                  <>
                    <span className="truncate">{post.author.headline}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <ArticleDate iso={post.createdAt} />
                <span aria-hidden="true">·</span>
                <span>{article.readingMinutes} min read</span>
              </p>
            </div>
          </div>
          <ArticleCounts post={post} />
        </div>
      </div>
    </article>
  );
}

/** "Popular this week": a numbered list of the most engaged-with recent articles. */
export function PopularArticles({ posts, className }: { posts: PostView[]; className?: string }) {
  return (
    <Panel aria-labelledby="popular-title" className={cn("relative flex flex-col gap-1 overflow-hidden p-5 max-sm:px-4", className)}>
      <h2 id="popular-title" className="relative flex items-center gap-2 pb-2 text-h3 text-ink">
        <Icon name="trending" size={20} className="text-accent" />
        Popular this week
      </h2>
      {posts.length === 0 ? (
        <p className="relative py-6 text-sm text-secondary">Nothing has stood out yet this week. React to the articles you find useful and they’ll show up here.</p>
      ) : (
        <ol className="relative flex flex-col">
          {posts.map((post, index) => (
            <li key={post.id} className="group relative flex items-start gap-3.5 border-t border-line py-3.5 first:border-t-0 first:pt-1.5">
              <span
                aria-hidden="true"
                className={cn("w-7 shrink-0 text-h2 tabular-nums", index === 0 ? "text-accent" : "text-line-strong")}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="line-clamp-2 text-md font-semibold text-ink">
                  <Link href={articleHref(post.id)} className="rounded-sm after:absolute after:inset-0 group-hover:underline">
                    {post.article?.title}
                  </Link>
                </h3>
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-secondary">
                  <span className="truncate">{post.author.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{post.article?.readingMinutes ?? 1} min read</span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1">
                    <Icon name="like" size={12} />
                    {post.counts.reactions}
                    <span className="sr-only"> reactions</span>
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Link
        href="/articles?sort=popular#all"
        className="relative mt-1 flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary-light hover:underline"
      >
        See all popular articles
        <Icon name="chevron-right" size={16} />
      </Link>
    </Panel>
  );
}

/** Invitation to write, in the navy brand surface. */
export function WriteInvite({ viewer, className }: { viewer: Viewer; className?: string }) {
  return (
    <section
      aria-labelledby="write-invite"
      className={cn("relative flex flex-col justify-end gap-3 overflow-hidden rounded-card bg-linear-to-br from-primary to-primary-light p-5 text-inverse", className)}
    >
      <BrandPattern tone="text-inverse" opacity={0.1} fade="top" />
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-14 size-36 rounded-full border-[12px] border-accent/35" />
      <h2 id="write-invite" className="relative text-h3">
        Share what you’ve learned
      </h2>
      <p className="relative text-sm text-inverse/80">
        A guide, a field report or the story behind a launch. Articles get their own page, a reading view and comments.
      </p>
      <div className="relative">
        <WriteArticleButton viewer={viewer} variant="accent" size="small" label="Start writing" />
      </div>
    </section>
  );
}

/** Placeholder for the featured article, popular list and writers while the hub loads. */
export function HubSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5 max-lg:grid-cols-1">
        <div className="flex flex-col overflow-hidden rounded-card border border-line bg-card">
          <Bone className="aspect-[2/1] w-full rounded-none" />
          <div className="flex flex-col gap-3 p-6">
            <Bone className="h-4 w-24" />
            <Bone className="h-8 w-[85%]" />
            <Bone className="h-5 w-[60%]" />
            <div className="mt-2 flex items-center gap-3">
              <Bone className="size-10 rounded-full" />
              <Bone className="h-4 w-1/3" />
            </div>
          </div>
        </div>
        <Panel className="flex flex-col gap-5 p-5">
          <Bone className="h-6 w-1/2" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3.5">
              <Bone className="h-7 w-7" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Bone className="h-4 w-[90%]" />
                <Bone className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </Panel>
      </div>
      <Panel className="flex flex-col gap-4 p-5">
        <Bone className="h-6 w-32" />
        <div className="grid grid-cols-5 gap-3 max-md:grid-cols-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2 rounded-card border border-line p-4">
              <Bone className="size-14 rounded-full" />
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
              <Bone className="h-8 w-full" />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
