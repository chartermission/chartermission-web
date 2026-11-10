import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeedQuery, type MomentsResponse, type Page, type PostView } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { FeedControls } from "@/components/feed-controls";
import { momentItems } from "@/components/home/moments";
import { AmbassadorOnboardingNotice } from "@/components/ambassadors/onboarding-notice";
import { StoriesStripLoader } from "@/components/stories/stories-loader";
import { Welcome, WelcomeSkeleton } from "@/components/home/welcome";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState, LoadingStatus, PanelSkeleton, PostSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { FeedComposer } from "./feed-composer";

export const metadata: Metadata = { title: "Home" };

type SearchParams = PageProps<"/[locale]/feed">["searchParams"];

function parseQuery(params: Awaited<SearchParams>): FeedQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = FeedQuery.safeParse(flat);
  return parsed.success ? { ...parsed.data, cursor: undefined } : FeedQuery.parse({});
}

/** The /feed API query for a parsed URL query (also what /feed/new is asked with). */
function apiQuery(query: FeedQuery) {
  return {
    tab: query.tab,
    type: query.type,
    unanswered: query.type === "question" && query.unanswered ? "true" : undefined,
    country: query.country,
    sector: query.sector,
    chapter: query.chapter,
    announcements: query.announcements ? "true" : undefined,
  };
}

/** The plain "For you" feed: the only view that gets community moments and the welcome strip. */
function isHome(query: FeedQuery) {
  return query.tab === "for_you" && !query.type && !query.country && !query.sector && !query.chapter && !query.announcements && !query.author;
}

/** Moments go after the 2nd post, then after every 5th. */
const MOMENTS_AFTER = 2;
const MOMENTS_EVERY = 5;

function feedHref(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])).toString();
  return qs ? `/feed?${qs}` : "/feed";
}

const typeEmpty: Record<string, { title: string; text: string }> = {
  question: { title: "No questions here yet", text: "Ask the community something: questions get answers from members across the network." },
  unanswered: { title: "No unanswered questions", text: "Every question here has an accepted answer. Check back later." },
  celebration: { title: "No celebrations yet", text: "New roles, funding rounds and milestones from members show up here." },
  request: { title: "No “Looking for” posts yet", text: "Members looking for co-founders, mentors or volunteers show up here." },
  article: { title: "No articles yet", text: "Long-form posts from members show up here." },
};

function FeedEmpty({ query }: { query: FeedQuery }) {
  const tab = query.tab === "for_you" ? undefined : query.tab;
  const filtered = !!(query.country || query.sector || query.chapter || query.announcements);
  const typeKey = query.type === "question" && query.unanswered ? "unanswered" : query.type;
  if (filtered) {
    return (
      <EmptyState
        icon="filter"
        title="No posts match these filters"
        actions={
          <Link href={feedHref({ tab, type: query.type, unanswered: typeKey === "unanswered" ? "true" : undefined })} className={buttonClasses({ variant: "secondary", size: "small" })}>
            Clear filters
          </Link>
        }
      >
        Try another country, sector or chapter.
      </EmptyState>
    );
  }
  const forType = typeKey ? typeEmpty[typeKey] : undefined;
  if (forType) {
    return (
      <EmptyState
        icon="filter"
        title={forType.title}
        actions={
          <Link href={feedHref({ tab })} className={buttonClasses({ variant: "secondary", size: "small" })}>
            Show all posts
          </Link>
        }
      >
        {forType.text}
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
  const params = await searchParams;
  const query = parseQuery(params);
  const home = isHome(query);
  const viewer = await requireClientViewer("/feed");
  const [page, taxonomies, moments] = await Promise.all([
    settle(apiGet<Page<PostView>>("/feed", apiQuery(query))),
    getTaxonomies().catch(() => ({ countries: [], sectors: [], chapters: [] })),
    // Moments are extras: without them the feed is just the feed.
    home ? apiGet<MomentsResponse>("/home/moments").catch(() => null) : null,
  ]);
  const key = JSON.stringify(query);
  const interleave = moments?.moments.length
    ? { after: MOMENTS_AFTER, every: MOMENTS_EVERY, items: momentItems(moments.moments, viewer) }
    : undefined;
  return (
    <>
      <FeedComposer viewer={viewer} compose={params.compose === "1"} />
      <FeedControls query={query} taxonomies={taxonomies} />
      {page.ok ? (
        <PostStream
          key={key}
          path="/feed"
          label="Feed"
          query={apiQuery(query)}
          initial={page.data}
          viewer={viewer}
          empty={<FeedEmpty query={query} />}
          acceptNew
          newPostsPath="/feed/new"
          interleave={interleave}
        />
      ) : (
        <SectionError message={errorMessage(page.error)} retryHref="/feed" />
      )}
    </>
  );
}

/** The welcome strip, on the unfiltered feed only (tabs keep it; type and filter views don't). */
async function FeedWelcome({ searchParams }: { searchParams: SearchParams }) {
  const query = parseQuery(await searchParams);
  if (query.type || query.country || query.sector || query.chapter || query.announcements || query.author) return null;
  return (
    <>
      <Suspense fallback={<PanelSkeleton className="h-[104px]" lines={1} />}>
        <StoriesStripLoader />
      </Suspense>
      <Suspense fallback={<WelcomeSkeleton />}>
        <Welcome />
      </Suspense>
      <Suspense fallback={null}>
        <AmbassadorOnboardingNotice />
      </Suspense>
    </>
  );
}

/** Home feed — Figma "Web / Home feed" (node 8:84). */
export default function FeedPage({ searchParams }: PageProps<"/[locale]/feed">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="sr-only">Home feed</h1>
      <Suspense fallback={null}>
        <FeedWelcome searchParams={searchParams} />
      </Suspense>
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
