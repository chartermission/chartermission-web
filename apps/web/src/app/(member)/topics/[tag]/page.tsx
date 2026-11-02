import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Avatar, Button, Icon, Panel, chipClasses } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { topicHref } from "@/components/feed-list";
import { SectionRail } from "@/components/social/section-nav";
import { LinkedPostList } from "@/components/social/post-list";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { getTopic, knownTopicSlugs, postsForTopic, type Topic } from "@/lib/mock/topics";
import { postIds } from "@/lib/mock/posts";
import { TopicActions } from "./topic-actions";
import { TopicTabs } from "./topic-tabs";

export function generateStaticParams() {
  return knownTopicSlugs().map((tag) => ({ tag }));
}

export async function generateMetadata({ params }: PageProps<"/topics/[tag]">): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${getTopic(decodeURIComponent(tag)).tag}` };
}

function ActivityChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const days = ["6 days ago", "5 days ago", "4 days ago", "3 days ago", "2 days ago", "yesterday", "today"].slice(-values.length);
  return (
    <div className="flex h-14 w-full items-end gap-1.5" role="img" aria-label="Posts per day over the last 7 days, with today the highest">
        {values.map((value, index) => (
          <span
            key={days[index]}
            title={`${days[index]}: ${value}`}
            className={index === values.length - 1 ? "flex-1 rounded-[3px] bg-accent" : "flex-1 rounded-[3px] bg-primary-tint"}
            style={{ height: `${(value / max) * 100}%` }}
          />
        ))}
    </div>
  );
}

function TopicHeader({ topic }: { topic: Topic }) {
  const stats = [
    { value: topic.posts, label: "posts" },
    topic.followers && { value: topic.followers, label: "followers" },
    topic.growth && { value: topic.growth, label: "vs. usual, last 24h", positive: true },
  ].filter(Boolean) as { value: string; label: string; positive?: boolean }[];

  return (
    <Panel className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-[14px] bg-accent-light text-accent">
          <Icon name="hash" size={32} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h1 text-ink">#{topic.tag}</h1>
            {topic.badge && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-label text-inverse">
                <Icon name="flame" size={14} />
                {topic.badge}
              </span>
            )}
          </div>
          <p className="text-sm text-body">{topic.description}</p>
        </div>
      </div>

      <dl className="flex gap-7">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse">
            <dt className="text-xs text-secondary">{stat.label}</dt>
            <dd className={stat.positive ? "text-h3 text-success" : "text-h3 text-ink"}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {topic.activity.length > 0 && <ActivityChart values={topic.activity} />}

      <TopicActions tag={topic.tag} />
    </Panel>
  );
}

function RelatedTopics({ tags }: { tags: string[] }) {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="text-h3 text-ink">Related topics</h2>
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li key={tag}>
            <Link href={topicHref(tag)} className={chipClasses("hashtag", "hover:bg-accent hover:text-inverse")}>
              #{tag}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ContributorList({ contributors }: { contributors: Topic["contributors"] }) {
  return (
    <ul className="flex flex-col gap-3">
      {contributors.map((person) => (
        <li key={person.handle} className="flex items-center gap-2.5">
          <Avatar name={person.name} size={32} tone={person.tone} />
          <Link href={`/members/${person.handle}`} className="group flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-ink group-hover:underline">{person.name}</span>
            <span className="text-xs text-secondary">{person.posts} posts</span>
          </Link>
          <Button variant="secondary" size="small">
            Follow<span className="sr-only"> {person.name}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function OpportunityList({ opportunities }: { opportunities: Topic["opportunities"] }) {
  return (
    <ul className="flex flex-col gap-3">
      {opportunities.map((item) => (
        <li key={item.slug}>
          <Link href={`/opportunities/${item.slug}`} className="group flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
              <Icon name="briefcase" size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink group-hover:underline">{item.title}</span>
              <span className="text-xs text-secondary">{item.meta}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Panel className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <Icon name="hash" size={24} className="text-disabled" />
      <p className="text-sm text-secondary">{children}</p>
    </Panel>
  );
}

async function resolveSlug(params: PageProps<"/topics/[tag]">["params"]) {
  const { tag } = await params;
  return decodeURIComponent(tag).toLowerCase();
}

async function TopicMain({ params }: Pick<PageProps<"/topics/[tag]">, "params">) {
  const slug = await resolveSlug(params);
  const topic = getTopic(slug);
  const posts = postsForTopic(slug);
  const mediaPosts = posts.filter((post) => post.image);
  const noPosts = (label: string) => <EmptyState>No {label} tagged #{topic.tag} yet.</EmptyState>;

  return (
    <>
      <TopicHeader topic={topic} />
      <TopicTabs
        label={`#${topic.tag} content`}
        panels={{
          top: posts.length ? <LinkedPostList posts={posts} linkedIds={postIds} /> : noPosts("posts"),
          latest: posts.length ? <LinkedPostList posts={[...posts].reverse()} linkedIds={postIds} /> : noPosts("posts"),
          media: mediaPosts.length ? <LinkedPostList posts={mediaPosts} linkedIds={postIds} /> : noPosts("photos or videos"),
          people: topic.contributors.length ? (
            <Panel className="p-5">
              <ContributorList contributors={topic.contributors} />
            </Panel>
          ) : (
            noPosts("members")
          ),
          opportunities: topic.opportunities.length ? (
            <Panel className="p-5">
              <OpportunityList opportunities={topic.opportunities} />
            </Panel>
          ) : (
            noPosts("opportunities")
          ),
        }}
      />
    </>
  );
}

async function TopicRightRail({ params }: Pick<PageProps<"/topics/[tag]">, "params">) {
  const topic = getTopic(await resolveSlug(params));
  return (
    <>
      {topic.related.length > 0 && <RelatedTopics tags={topic.related} />}
      {topic.contributors.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Top contributors this week</h2>
          <ContributorList contributors={topic.contributors} />
        </Panel>
      )}
      {topic.opportunities.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Opportunities tagged #{topic.tag}</h2>
          <OpportunityList opportunities={topic.opportunities} />
        </Panel>
      )}
    </>
  );
}

/** Hashtag topic page — Figma "Web / Hashtag topic page" (node 9:496, body 9:549). */
export default function TopicPage({ params }: PageProps<"/topics/[tag]">) {
  return (
    <PageColumns
      left={<SectionRail />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton lines={4} />}>
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
            <PanelSkeleton className="h-[400px]" lines={6} />
          </>
        }
      >
        <TopicMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
