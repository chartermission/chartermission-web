import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FeedQuery, type Page, type PostView } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState, LoadingStatus, PostSkeleton, SectionError } from "@/components/social/skeletons";
import { NewPostsSeen, NewPostsSince } from "@/components/social/new-posts-seen";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("New posts") };
}

type SearchParams = PageProps<"/[locale]/feed/latest">["searchParams"];

/**
 * /feed/latest?since=…: exactly the posts the "N new posts" pill (or the welcome strip) counted,
 * newest first, with the tab and filters the feed had (tab, type, country, sector, chapter).
 * Opening it marks them seen, so the pill on the feed starts counting from now.
 */
async function NewPostsMain({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const flat = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = FeedQuery.safeParse(flat);
  if (!parsed.success || !parsed.data.since) redirect("/feed?tab=latest");
  const q = parsed.data;
  const viewer = await requireClientViewer("/feed/latest");
  const query = {
    tab: q.tab,
    type: q.type,
    unanswered: q.type === "question" && q.unanswered ? "true" : undefined,
    country: q.country,
    sector: q.sector,
    chapter: q.chapter,
    announcements: q.announcements ? "true" : undefined,
    since: q.since,
  };
  const page = await settle(apiGet<Page<PostView>>("/feed", query));
  const back = `/feed${q.tab === "for_you" ? "" : `?tab=${q.tab}`}`;
  return (
    <>
      <NewPostsSeen />
      <header className="flex flex-col gap-1">
        <Link href={back} className="flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
          <Icon name="chevron-left" size={16} />
          Back to feed
        </Link>
        <h1 className="text-h2 text-ink">New posts</h1>
        <NewPostsSince since={q.since!} />
      </header>
      {page.ok ? (
        <PostStream
          path="/feed"
          label="New posts"
          query={query}
          initial={page.data}
          viewer={viewer}
          empty={
            <EmptyState
              icon="check"
              title="You’re all caught up"
              actions={
                <Link href={back} className={buttonClasses({ size: "small" })}>
                  Back to feed
                </Link>
              }
            >
              There are no new posts since then.
            </EmptyState>
          }
        />
      ) : (
        <SectionError message={errorMessage(page.error)} retryHref={back} />
      )}
    </>
  );
}

export default function NewPostsPage({ searchParams }: PageProps<"/[locale]/feed/latest">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading new posts" />
            <PostSkeleton />
            <PostSkeleton />
          </>
        }
      >
        <NewPostsMain searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}
