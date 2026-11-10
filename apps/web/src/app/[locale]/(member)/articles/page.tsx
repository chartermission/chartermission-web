import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { ArticleSort, type ArticlesHub, type Page, type PostView } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { ArticleBrowser, ArticleBrowserSkeleton } from "@/components/articles/article-browser";
import { ARTICLES_PAGE } from "@/components/articles/format";
import { FeaturedArticle, HubSkeleton, PopularArticles, WriteInvite } from "@/components/articles/hub-sections";
import { TopWriters } from "@/components/articles/top-writers";
import { WriteArticleButton } from "@/components/articles/write-article-button";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { EmptyState, LoadingStatus, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Articles"),
    description: t("Long-form writing from Charter Mission members: guides, field notes and lessons from building across Africa."),
  };
}

type SearchParams = PageProps<"/[locale]/articles">["searchParams"];

/** GET /articles/hub, shared by the hub sections and the topic chips. */
const getHub = cache(() => settle(apiGet<ArticlesHub>("/articles/hub")));

const TAG = /^[\p{L}\p{N}_]{1,60}$/u;

async function parseParams(searchParams: SearchParams) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const sort = ArticleSort.safeParse(one(params.sort)).data ?? "latest";
  const rawTag = one(params.tag)?.trim().replace(/^#/, "");
  const tag = rawTag && TAG.test(rawTag) ? rawTag : null;
  return { sort, tag };
}

async function WriteAction() {
  const viewer = await requireClientViewer("/articles");
  return <WriteArticleButton viewer={viewer} />;
}

/** Featured article + popular list, then the top writers. */
async function HubTop() {
  const t = await getT();
  const viewer = await requireClientViewer("/articles");
  const hub = await getHub();
  if (!hub.ok) return <SectionError message={t("Featured articles couldn’t load. {error}", { error: errorMessage(hub.error) })} retryHref="/articles" />;
  const { featured, popular, authors, total } = hub.data;
  if (!featured || total === 0) {
    return (
      <EmptyState icon="message" title="No articles yet" actions={<WriteArticleButton viewer={viewer} size="small" label="Write the first article" />}>
        Articles are long-form posts: guides, field reports and lessons learned. They get their own page here, with a reading view and comments.
      </EmptyState>
    );
  }
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-stretch gap-5 max-lg:grid-cols-1">
        <FeaturedArticle post={featured} />
        <div className="flex flex-col gap-5">
          <PopularArticles posts={popular} />
          <WriteInvite viewer={viewer} className="min-h-[200px] flex-1" />
        </div>
      </div>
      <TopWriters writers={authors} viewer={viewer} />
    </>
  );
}

/** Topic chips, sort and the paginated grid, for the URL's ?tag= and ?sort=. */
async function HubList({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireClientViewer("/articles");
  const { sort, tag } = await parseParams(searchParams);
  const [first, hub] = await Promise.all([
    settle(apiGet<Page<PostView>>("/articles", { sort, tag: tag ?? undefined, limit: ARTICLES_PAGE })),
    getHub(),
  ]);
  return (
    <ArticleBrowser
      initial={first.ok ? first.data : null}
      error={first.ok ? null : errorMessage(first.error)}
      sort={sort}
      tag={tag}
      topics={hub.ok ? hub.data.topics : []}
      viewer={viewer}
    />
  );
}

/** Articles hub: featured, popular this week, top writers and every article by topic. */
export default function ArticlesPage({ searchParams }: PageProps<"/[locale]/articles">) {
  return (
    <PageShell className="gap-8 max-sm:gap-6 max-sm:px-3 max-sm:pt-5">
      <PageHeader
        title="Articles"
        description="Guides, field notes and lessons from members building across Africa."
        actions={
          <Suspense
            fallback={
              <Button disabled>
                <Icon name="plus" size={18} />
                Write an article
              </Button>
            }
          >
            <WriteAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading articles" />
            <HubSkeleton />
          </>
        }
      >
        <HubTop />
      </Suspense>
      <Suspense fallback={<ArticleBrowserSkeleton />}>
        <HubList searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
