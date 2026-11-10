import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { CreatorAnalytics, ManagedPage } from "@chartermission/contracts";
import { Icon, Panel, cn } from "@chartermission/ui";
import { DailyChart } from "@/components/analytics/daily-chart";
import { RangeTabs, StatTile, change, formatCount, formatRate } from "@/components/analytics/parts";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { absoluteDate } from "@/components/social/format";
import { postAnalyticsHref } from "@/components/social/links";
import { EmptyState, LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Analytics" };

type Props = PageProps<"/analytics">;

async function Overview({ searchParams }: Props) {
  const query = await searchParams;
  const viewer = await requireViewer("/analytics");
  const days = [7, 28, 90].includes(Number(query.days)) ? Number(query.days) : 28;
  const pageSlug = typeof query.page === "string" && /^[a-z0-9-]{3,60}$/.test(query.page) ? query.page : undefined;
  const [result, pages] = await Promise.all([
    settle(apiGet<CreatorAnalytics>("/me/analytics", { days, page: pageSlug })),
    apiGet<ManagedPage[]>("/me/pages").catch(() => [] as ManagedPage[]),
  ]);
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref="/analytics" />;
  const data = result.data;
  const href = (next: { days?: number; page?: string | null }) => {
    const params = new URLSearchParams();
    const page = next.page === undefined ? pageSlug : next.page;
    if (page) params.set("page", page);
    params.set("days", String(next.days ?? days));
    return `/analytics?${params}`;
  };
  const livePages = pages.filter((p) => p.status === "active");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {livePages.length > 0 ? (
          <nav aria-label="Whose posts" className="flex flex-wrap gap-2">
            {[{ slug: null as string | null, name: `${viewer.name} (you)` }, ...livePages].map((item) => {
              const current = (item.slug ?? undefined) === pageSlug;
              return (
                <Link
                  key={item.slug ?? "me"}
                  href={href({ page: item.slug })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
                    current ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted",
                  )}
                >
                  <Icon name={item.slug ? "building" : "user"} size={14} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        ) : (
          <span />
        )}
        <RangeTabs days={days} hrefFor={(value) => href({ days: value })} />
      </div>

      <section aria-label="Totals" className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <StatTile icon="eye" label="Impressions" value={formatCount(data.totals.impressions)} trend={change(data.totals.impressions, data.previous.impressions)} note={`In the last ${days} days`} />
        <StatTile icon="like" label="Engagements" value={formatCount(data.totals.engagements)} trend={change(data.totals.engagements, data.previous.engagements)} note="Reactions, comments, reposts" />
        <StatTile icon="trending" label="Engagement rate" value={formatRate(data.totals.engagementRate)} note="Engagements ÷ new viewers" />
        <StatTile
          icon="users"
          label="Followers"
          value={formatCount(data.totals.followers)}
          note={data.totals.newFollowers ? `${formatCount(data.totals.newFollowers)} new in this period` : "No new followers in this period"}
        />
      </section>

      <Panel className="p-5">
        <DailyChart days={data.daily} title={data.page ? `${data.page.name}: day by day` : "Your posts: day by day"} />
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-h3 text-ink">Top posts</h2>
          <p className="text-xs text-secondary">
            By impressions in the last {days} days · {data.totals.posts} post{data.totals.posts === 1 ? "" : "s"} published
          </p>
        </div>
        {data.topPosts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-secondary">
                  <th scope="col" className="pb-2 font-medium">
                    Post
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Impressions
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    New viewers
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Engagements
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.topPosts.map((post) => (
                  <tr key={post.id}>
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      <Link href={postAnalyticsHref(post.id)} className="group flex min-w-0 flex-col">
                        <span className="truncate font-medium text-ink group-hover:underline">{post.title ?? (post.excerpt || "Post without text")}</span>
                        <span className="text-xs text-secondary">
                          {post.type === "article" ? "Article" : post.type === "question" ? "Question" : "Post"} · {absoluteDate(post.createdAt)}
                        </span>
                      </Link>
                    </th>
                    <td className="py-3 text-right tabular-nums text-ink">{formatCount(post.impressions)}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{formatCount(post.reach)}</td>
                    <td className="py-3 text-right tabular-nums text-ink">{formatCount(post.engagements)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="chart" title="Nothing to show yet">
            Publish a post and its numbers appear here as members see it.
          </EmptyState>
        )}
      </Panel>

      <p className="flex items-start gap-2 text-xs text-secondary">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
        Only you{data.page ? " and the page’s other admins" : ""} can see this. The numbers are counts; nobody can see who viewed a post.
      </p>
    </>
  );
}

/** How the member's posts (or one of their pages') are doing. */
export default function AnalyticsPage(props: Props) {
  return (
    <PageShell className="max-w-[1008px]">
      <PageHeader title="Analytics" description="How your posts are doing: who they reach and how members respond." />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading analytics" />
            <PanelSkeleton className="h-[120px]" lines={2} />
            <PanelSkeleton className="h-[320px]" lines={6} />
          </>
        }
      >
        <Overview {...props} />
      </Suspense>
    </PageShell>
  );
}
