import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { PostAnalytics } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { DailyChart } from "@/components/analytics/daily-chart";
import { AudienceSplit, CountryBars, RangeTabs, StatTile, formatCount, formatRate } from "@/components/analytics/parts";
import { absoluteDate } from "@/components/social/format";
import { postHref } from "@/components/social/links";
import { reactionKinds, reactionMeta } from "@/components/social/reaction-meta";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Post analytics" };

type Props = PageProps<"/posts/[id]/analytics">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function Analytics({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await requireViewer(`/posts/${id}/analytics`);
  if (!UUID.test(id)) notFound();
  const days = [7, 28, 90].includes(Number(query.days)) ? Number(query.days) : 28;
  let data: PostAnalytics;
  try {
    data = await apiGet<PostAnalytics>(`/posts/${id}/analytics`, { days });
  } catch (error) {
    // Not the author (or a repost): there is nothing to show here.
    if (error instanceof ApiError && (error.status === 404 || error.status === 409)) notFound();
    throw error;
  }
  const { post, totals, audience } = data;
  const partialHistory = new Date(data.trackedSince).getTime() - new Date(post.createdAt).getTime() > 60_000;

  return (
    <>
      <Panel className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-h2 text-ink">Post analytics</h1>
            <p className="text-sm text-secondary">
              {post.page ? `Published as ${post.page.name}` : "Your post"} on {absoluteDate(post.createdAt)}
            </p>
          </div>
          <RangeTabs days={days} hrefFor={(value) => `/posts/${post.id}/analytics?days=${value}`} />
        </div>
        <Link href={postHref({ id: post.id, type: post.type })} className="group flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:bg-primary-tint-2">
          <Icon name={post.type === "article" ? "book" : "message"} size={18} className="mt-0.5 shrink-0 text-secondary" />
          <span className="min-w-0 flex-1 text-sm text-body">
            {post.title && <span className="block font-medium text-ink">{post.title}</span>}
            <span className="line-clamp-2">{post.excerpt || "Open the post"}</span>
          </span>
          <Icon name="chevron-right" size={18} className="mt-0.5 shrink-0 text-secondary group-hover:text-primary" />
        </Link>
      </Panel>

      <section aria-label="Totals" className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <StatTile icon="eye" label="Impressions" value={formatCount(totals.impressions)} note="Times it was shown" />
        <StatTile icon="users" label="Members reached" value={formatCount(totals.reach)} note="Different people who saw it" />
        <StatTile icon="like" label="Engagements" value={formatCount(totals.engagements)} note="Reactions, comments, reposts, saves" />
        <StatTile icon="trending" label="Engagement rate" value={formatRate(totals.engagementRate)} note="Engagements ÷ members reached" />
      </section>

      <Panel className="p-5">
        <DailyChart days={data.daily} />
      </Panel>

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="text-h3 text-ink">How members engaged</h2>
          <dl className="flex flex-col divide-y divide-line">
            {reactionKinds.map((kind) => (
              <div key={kind} className="flex items-center gap-2.5 py-2 first:pt-0">
                <Icon name={reactionMeta[kind].icon} size={16} className={reactionMeta[kind].color} />
                <dt className="flex-1 text-sm text-body">{reactionMeta[kind].label}</dt>
                <dd className="text-sm font-medium text-ink tabular-nums">{formatCount(data.reactions[kind])}</dd>
              </div>
            ))}
            {(
              [
                ["message", "Comments", totals.comments],
                ["repeat", "Reposts", totals.reposts],
                ["bookmark", "Saves", totals.saves],
              ] as const
            ).map(([icon, label, value]) => (
              <div key={label} className="flex items-center gap-2.5 py-2 last:pb-0">
                <Icon name={icon} size={16} className="text-secondary" />
                <dt className="flex-1 text-sm text-body">{label}</dt>
                <dd className="text-sm font-medium text-ink tabular-nums">{formatCount(value)}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="text-h3 text-ink">Who it reached</h2>
          <AudienceSplit connections={audience.connections} followers={audience.followers} others={audience.others} forPage={!!post.page} />
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="text-sm font-medium text-ink">By country</h3>
            <CountryBars countries={audience.countries} />
          </div>
        </Panel>
      </div>

      <p className="flex items-start gap-2 text-xs text-secondary">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
        <span>
          Only you{post.page ? " and the page’s other admins" : ""} can see these numbers. They are counts: Charter Mission never shows who viewed a post, and countries with
          fewer than three viewers are grouped as “Other”. A member counts as a new impression after 30 minutes; your own views aren’t counted.
          {partialHistory && ` Views have been counted since ${absoluteDate(data.trackedSince)}, so earlier views of this post aren’t included.`}
        </span>
      </p>
    </>
  );
}

/** A post's numbers, for its author or the admins of the page it was published as. */
export default function PostAnalyticsPage(props: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Link href="/analytics" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        All analytics
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading analytics" />
            <PanelSkeleton className="h-[140px]" lines={3} />
            <PanelSkeleton className="h-[320px]" lines={6} />
          </>
        }
      >
        <Analytics {...props} />
      </Suspense>
    </main>
  );
}
