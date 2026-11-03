import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeedQuery, type Page, type PostView } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { FeedControls } from "@/components/feed-controls";
import { FeedList } from "@/components/feed-list";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { EmptyState, LoadingStatus, PanelSkeleton, PostSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { FeedComposer } from "./feed-composer";

export const metadata: Metadata = { title: "Home" };

type SearchParams = PageProps<"/feed">["searchParams"];

function parseQuery(params: Awaited<SearchParams>): FeedQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = FeedQuery.safeParse(flat);
  return parsed.success ? { ...parsed.data, cursor: undefined } : FeedQuery.parse({});
}

function FeedEmpty({ query }: { query: FeedQuery }) {
  if (query.country || query.sector || query.chapter || query.announcements) {
    return (
      <EmptyState icon="filter" title="No posts match these filters" actions={<Link href={query.tab === "for_you" ? "/feed" : `/feed?tab=${query.tab}`} className={buttonClasses({ variant: "secondary", size: "small" })}>Clear filters</Link>}>
        Try another country, sector or chapter.
      </EmptyState>
    );
  }
  if (query.tab === "following") {
    return (
      <EmptyState
        icon="users"
        title="Nothing from people you follow yet"
        actions={
          <>
            <Link href="/network?tab=suggestions" className={buttonClasses({ size: "small" })}>
              Find people to follow
            </Link>
            <Link href="/feed?tab=latest" className={buttonClasses({ variant: "secondary", size: "small" })}>
              See latest posts
            </Link>
          </>
        }
      >
        Posts from members, chapters and hashtags you follow appear here, along with platform announcements.
      </EmptyState>
    );
  }
  if (query.tab === "latest") {
    return (
      <EmptyState icon="message" title="No posts yet">
        Be the first to share an update with the community.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon="home"
      title="Your feed is quiet"
      actions={
        <Link href="/network?tab=directory" className={buttonClasses({ size: "small" })}>
          Find people
        </Link>
      }
    >
      Follow members and topics to fill your feed, or share an update to get the conversation going.
    </EmptyState>
  );
}

async function FeedMain({ searchParams }: { searchParams: SearchParams }) {
  const query = parseQuery(await searchParams);
  const viewer = await requireClientViewer("/feed");
  const [page, taxonomies] = await Promise.all([
    settle(
      apiGet<Page<PostView>>("/feed", {
        tab: query.tab,
        country: query.country,
        sector: query.sector,
        chapter: query.chapter,
        announcements: query.announcements ? "true" : undefined,
      }),
    ),
    getTaxonomies().catch(() => ({ countries: [], sectors: [], chapters: [] })),
  ]);
  const key = JSON.stringify(query);
  return (
    <>
      <FeedComposer viewer={viewer} />
      <FeedControls query={query} taxonomies={taxonomies} />
      {page.ok ? (
        <FeedList key={key} query={query} initial={page.data} viewer={viewer} empty={<FeedEmpty query={query} />} />
      ) : (
        <SectionError message={errorMessage(page.error)} retryHref="/feed" />
      )}
    </>
  );
}

/** Home feed — Figma "Web / Home feed" (node 8:84). */
export default function FeedPage({ searchParams }: PageProps<"/feed">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="sr-only">Home feed</h1>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading your feed" />
            <PanelSkeleton className="h-[118px]" lines={1} />
            <PanelSkeleton className="h-[84px]" lines={1} />
            <PostSkeleton />
            <PostSkeleton />
          </>
        }
      >
        <FeedMain searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}
