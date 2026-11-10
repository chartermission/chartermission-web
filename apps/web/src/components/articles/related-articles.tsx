import Link from "next/link";
import type { PostView, RelatedArticles as Related } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { ArticleCard, ArticleCardSkeleton } from "./article-card";
import { articleGridClass } from "./article-grid";
import { getT } from "@/i18n/server";

function Shelf({ id, title, action, posts }: { id: string; title: string; action?: { href: string; label: string }; posts: PostView[] }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-h2 text-ink max-sm:text-h3">
          {title}
        </h2>
        {action && (
          <Link href={action.href} className="flex items-center gap-1 rounded-sm text-sm font-medium text-primary-light hover:underline">
            {action.label}
            <Icon name="chevron-right" size={16} />
          </Link>
        )}
      </div>
      <ul className={articleGridClass}>
        {posts.map((post) => (
          <li key={post.id}>
            <ArticleCard post={post} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "More from <author>" and "Related articles" below the reader (GET /articles/:id/related). */
export async function RelatedArticles({ related, author, authorLink }: { related: Related; author: PostView["author"]; /** The page, for an article published as one. */ authorLink?: string }) {
  const t = await getT();
  const firstName = author.name.split(" ")[0] ?? author.name;
  return (
    <>
      {related.moreByAuthor.length > 0 && (
        <Shelf
          id="more-by-author"
          title={t("More from {name}", { name: author.name })}
          action={authorLink ? { href: authorLink, label: "Open the page" } : { href: memberHref(author.handle), label: `${firstName}’s profile` }}
          posts={related.moreByAuthor}
        />
      )}
      {related.related.length > 0 && (
        <Shelf id="related-articles" title="Related articles" action={{ href: "/articles", label: "All articles" }} posts={related.related} />
      )}
    </>
  );
}

export function RelatedSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <span className="motion-shimmer block h-7 w-56 rounded" />
      <div className={articleGridClass}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
            <ArticleCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
