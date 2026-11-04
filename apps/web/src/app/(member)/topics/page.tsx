import type { Metadata } from "next";
import { Suspense, cache } from "react";
import type { FollowView, MemberProfile, Page, TopicSummary, TrendingResponse } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { SiteFooter } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { relativeTime } from "@/components/social/format";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull, getViewer } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { FOLLOWED_PAGE, LIST_PAGE, parseExplore, scopeKey, type ExploreParams, type ScopeOption } from "./explore-params";
import { FollowProvider } from "./explore-state";
import { DiscoverTopics, TopicSearchResults, YourTopics } from "./topic-lists";
import { TopicSearch } from "./topic-search";
import { TrendingBoard } from "./trending-board";

export const metadata: Metadata = { title: "Explore topics" };

type SearchParams = PageProps<"/topics">["searchParams"];

/** GET /topics?sort=followed, shared by the main column (below xl) and the right column. */
const followedTopics = cache(() => settle(apiGet<Page<TopicSummary>>("/topics", { sort: "followed", limit: FOLLOWED_PAGE })));

/** Africa, the viewer's country and their chapters (member of or following); plus the URL's scope if it is something else. */
async function scopeOptions(params: ExploreParams, trending: TrendingResponse | null): Promise<{ scopes: ScopeOption[]; active: ScopeOption }> {
  const viewer = await getViewer();
  const [taxonomies, profile, chapterFollows] = await Promise.all([
    getTaxonomies().catch(() => null),
    viewer ? apiGetOrNull<MemberProfile>(`/members/${viewer.handle}`).catch(() => null) : null,
    apiGet<Page<FollowView>>("/me/follows", { type: "chapter", limit: 4 }).catch(() => null),
  ]);
  const scopes: ScopeOption[] = [{ key: "global", label: "Africa", scope: "global", scopeId: null }];
  const country = viewer?.countryCode;
  if (country) {
    const name = taxonomies?.countries.find((c) => c.code === country)?.name ?? country;
    scopes.push({ key: scopeKey("country", country), label: name, scope: "country", scopeId: country });
  }
  const chapters = [...(profile?.chapters ?? []), ...(chapterFollows?.items.flatMap((f) => (f.chapter ? [f.chapter] : [])) ?? [])];
  for (const chapter of chapters) {
    if (scopes.some((s) => s.key === scopeKey("chapter", chapter.slug))) continue;
    scopes.push({ key: scopeKey("chapter", chapter.slug), label: chapter.name, scope: "chapter", scopeId: chapter.slug });
  }
  const wanted = scopeKey(params.scope, params.scope === "country" ? (params.scopeId?.toUpperCase() ?? null) : params.scopeId);
  let active = scopes.find((s) => s.key === wanted);
  if (!active) {
    const fromContext = trending?.items[0]?.context.replace(/^Trending in /, "");
    const fromTaxonomy =
      params.scope === "country"
        ? taxonomies?.countries.find((c) => c.code === params.scopeId?.toUpperCase())?.name
        : taxonomies?.chapters.find((c) => c.slug === params.scopeId || c.id === params.scopeId)?.name;
    active = { key: wanted, label: fromTaxonomy ?? fromContext ?? params.scopeId ?? "Africa", scope: params.scope, scopeId: params.scopeId };
    scopes.push(active);
  }
  return { scopes, active };
}

function PageHeader({ q }: { q: string }) {
  return (
    <Panel className="flex flex-col gap-4 p-6 max-sm:p-4">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-accent-light text-accent">
          <Icon name="hash" size={26} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h2 text-ink">Explore topics</h1>
          <p className="text-sm text-body">See what the community is talking about across Africa and the diaspora. Follow topics to bring their posts into your feed.</p>
        </div>
      </div>
      <TopicSearch q={q} />
    </Panel>
  );
}

async function ExploreMain({ searchParams }: { searchParams: SearchParams }) {
  const params = parseExplore(await searchParams);
  await requireClientViewer("/topics");

  if (params.q) {
    const results = await settle(apiGet<Page<TopicSummary>>("/topics", { q: params.q, sort: "popular", limit: LIST_PAGE }));
    return (
      <>
        <PageHeader q={params.q} />
        <TopicSearchResults key={params.q} q={params.q} initial={results.ok ? results.data : null} error={results.ok ? null : errorMessage(results.error)} />
      </>
    );
  }

  const [trending, list, followed] = await Promise.all([
    settle(
      apiGet<TrendingResponse>("/trending", {
        scope: params.scope,
        scopeId: params.scopeId ?? undefined,
        window: params.window,
        limit: 20,
      }),
    ),
    settle(apiGet<Page<TopicSummary>>("/topics", { sort: params.list, limit: LIST_PAGE })),
    followedTopics(),
  ]);
  const { scopes, active } = await scopeOptions(params, trending.ok ? trending.data : null);
  const computedAt = trending.ok ? trending.data.computedAt : null;
  const ago = computedAt ? relativeTime(computedAt) : null;

  return (
    <>
      <PageHeader q="" />
      <TrendingBoard
        key={`${active.key}-${params.window}`}
        items={trending.ok ? trending.data.items : []}
        window={params.window}
        scopes={scopes}
        active={active}
        updated={ago ? (ago === "now" ? "Updated just now" : `Updated ${ago} ago`) : null}
        error={trending.ok ? null : errorMessage(trending.error)}
      />
      <YourTopics
        id="your-topics-main"
        className="xl:hidden"
        initial={followed.ok ? followed.data : null}
        error={followed.ok ? null : errorMessage(followed.error)}
      />
      <DiscoverTopics key={params.list} list={params.list} initial={list.ok ? list.data : null} error={list.ok ? null : errorMessage(list.error)} />
    </>
  );
}

async function ExploreRight() {
  const followed = await followedTopics();
  return <YourTopics id="your-topics-rail" initial={followed.ok ? followed.data : null} error={followed.ok ? null : errorMessage(followed.error)} />;
}

function HowTopicsWork() {
  const points: { icon: "hash" | "trending" | "pin"; text: string }[] = [
    { icon: "hash", text: "Add a #hashtag to any post to start a topic or join one." },
    { icon: "trending", text: "Trending ranks topics by how much faster they’re growing than usual, refreshed every few minutes." },
    { icon: "pin", text: "Featured topics are pinned by the Charter Mission team." },
  ];
  return (
    <Panel aria-labelledby="how-topics" className="flex flex-col gap-3 p-5">
      <h2 id="how-topics" className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name="lightbulb" size={18} className="text-accent" />
        How topics work
      </h2>
      <ul className="flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point.icon} className="flex items-start gap-2.5 text-xs text-body">
            <Icon name={point.icon} size={16} className="mt-px shrink-0 text-secondary" />
            {point.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Explore / trending topics. Window, scope, list and search live in the URL. */
export default function TopicsPage({ searchParams }: PageProps<"/topics">) {
  return (
    <FollowProvider>
      <PageColumns
        left={<LeftRail />}
        right={
          <aside aria-label="Your topics and tips" className="flex w-80 shrink-0 flex-col gap-4">
            <Suspense fallback={<PanelSkeleton className="h-[300px]" lines={5} />}>
              <ExploreRight />
            </Suspense>
            <HowTopicsWork />
            <SiteFooter />
          </aside>
        }
      >
        <Suspense
          fallback={
            <>
              <LoadingStatus label="Loading topics" />
              <PanelSkeleton className="h-[164px]" lines={2} />
              <PanelSkeleton className="h-[520px]" lines={8} />
              <PanelSkeleton className="h-[420px]" lines={6} />
            </>
          }
        >
          <ExploreMain searchParams={searchParams} />
        </Suspense>
      </PageColumns>
    </FollowProvider>
  );
}
