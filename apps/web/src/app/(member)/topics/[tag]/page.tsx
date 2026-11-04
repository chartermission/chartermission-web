import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Page, PostView, TopicView } from "@chartermission/contracts";
import { Icon, Panel, chipClasses, cn } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { requireClientViewer } from "@/components/social/data";
import { topicHref } from "@/components/social/links";
import { SectionRail } from "@/components/social/section-nav";
import { EmptyState, LoadingStatus, PanelSkeleton, PostSkeleton } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { activityDays } from "./activity-chart";
import { TopicHeader } from "./topic-header";
import { TopicTabs } from "./topic-tabs";

export async function generateMetadata({ params }: PageProps<"/topics/[tag]">): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${decodeURIComponent(tag)}` };
}

type Params = PageProps<"/topics/[tag]">["params"];

async function slugOf(params: Params) {
  const { tag } = await params;
  return decodeURIComponent(tag).replace(/^#/, "").toLowerCase();
}

async function loadTopic(params: Params) {
  const slug = await slugOf(params);
  if (!/^[a-z0-9_]{2,50}$/.test(slug)) notFound();
  const topic = await apiGetOrNull<TopicView>(`/topics/${encodeURIComponent(slug)}`);
  if (!topic) notFound();
  return topic;
}

async function TopicMain({ params }: { params: Params }) {
  const slug = await slugOf(params);
  const viewer = await requireClientViewer(`/topics/${slug}`);
  const topic = await loadTopic(params);
  const top = await apiGet<Page<PostView>>(`/topics/${encodeURIComponent(slug)}/posts`, { sort: "top" }).catch(() => null);
  const empty = (title: string) => (
    <EmptyState icon="hash" title={title}>
      Use #{topic.tag} in a post to start the conversation.
    </EmptyState>
  );
  return (
    <>
      <TopicHeader topic={topic} days={activityDays(new Date())} />
      <TopicTabs
        tag={topic.tag}
        initialTop={top}
        viewer={viewer}
        empties={{
          top: empty(`No posts tagged #${topic.tag} yet`),
          latest: empty(`No posts tagged #${topic.tag} yet`),
          media: empty(`No images or documents tagged #${topic.tag} yet`),
        }}
      />
    </>
  );
}

async function TopicRightRail({ params }: { params: Params }) {
  const topic = await loadTopic(params).catch(() => null);
  if (!topic) return null;
  return (
    <Panel className="flex flex-col gap-3 p-5">
      {topic.related.length > 0 && (
        <>
          <h2 className="text-h3 text-ink">Related topics</h2>
          <ul className="flex flex-wrap gap-2">
            {topic.related.map((tag) => (
              <li key={tag}>
                <Link href={topicHref(tag)} className={chipClasses("hashtag", "hover:bg-accent hover:text-inverse")}>
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link
        href="/topics"
        className={cn("flex items-center gap-1 text-sm font-medium text-primary-light hover:underline", topic.related.length > 0 && "border-t border-line pt-3")}
      >
        Explore all topics
        <Icon name="chevron-right" size={16} />
      </Link>
    </Panel>
  );
}

/** Hashtag topic page — Figma "Web / Hashtag topic page" (node 9:496, body 9:549). */
export default function TopicPage({ params }: PageProps<"/topics/[tag]">) {
  return (
    <PageColumns
      left={<SectionRail />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton lines={2} />}>
            <TopicRightRail params={params} />
          </Suspense>
        </aside>
      }
    >
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading topic" />
            <PanelSkeleton className="h-[318px]" lines={5} />
            <PostSkeleton />
          </>
        }
      >
        <TopicMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
