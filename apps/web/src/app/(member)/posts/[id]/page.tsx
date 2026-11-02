import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar, Icon, Panel, PostCard, TrendingItem, buttonClasses } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { topicHref } from "@/components/feed-list";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { ToggleButton } from "@/components/social/toggle-button";
import { members } from "@/lib/mock/members";
import { getPostDetail, postIds, type PostDetail } from "@/lib/mock/posts";
import { getTopic, topicSummary } from "@/lib/mock/topics";
import { viewer } from "@/lib/mock-data";
import { Comments } from "./comments";

export function generateStaticParams() {
  return postIds.map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/posts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const post = getPostDetail(id);
  if (!post) return { title: "Post not found" };
  const text = typeof post.body === "string" ? post.body : "";
  return { title: `${post.author.name} on Charter Mission`, description: text.slice(0, 160) };
}

const mentionables = Object.values(members).map(({ name, handle }) => ({ name, handle }));

function AboutAuthor({ post }: { post: PostDetail }) {
  const profileHref = post.authorHandle ? `/members/${post.authorHandle}` : post.author.href;
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="sr-only">About the author</h2>
      <div className="flex items-center gap-3">
        <Avatar name={post.author.name} size={56} tone={post.author.tone} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-md font-medium text-ink">{post.author.name}</p>
          <p className="text-xs text-secondary">{post.authorSummary}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <ToggleButton size="small" className="flex-1" label="Follow" pressedLabel="Following" srSuffix={post.author.name} />
        {profileHref && (
          <Link href={profileHref} className={buttonClasses({ variant: "secondary", size: "small", className: "flex-1" })}>
            View profile
          </Link>
        )}
      </div>
    </Panel>
  );
}

function MoreInTopic({ post }: { post: PostDetail }) {
  const first = post.tags?.[0];
  if (!first) return null;
  const tags = post.moreTopics ?? [...new Set([first, ...getTopic(first).related, ...(post.tags ?? [])])].slice(0, 3);
  return (
    <Panel className="flex flex-col gap-1 p-5">
      <h2 className="text-h3 text-ink">More in #{getTopic(first).tag}</h2>
      <ol>
        {tags.map((tag, index) => (
          <li key={tag}>
            <TrendingItem rank={index + 1} {...topicSummary(tag)} href={topicHref(tag)} linkAs={Link} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

async function PostMain({ params }: Pick<PageProps<"/posts/[id]">, "params">) {
  const { id } = await params;
  const post = getPostDetail(id);
  if (!post) notFound();
  const { fullBody, comments, commentCount, ...card } = post;

  return (
    <>
      <h1 className="sr-only">Post by {post.author.name}</h1>
      <PostCard
        {...card}
        body={fullBody ? <p className="whitespace-pre-line">{fullBody.join("\n")}</p> : card.body}
        linkAs={Link}
        tagHref={topicHref}
      />
      <Comments
        initialComments={comments}
        total={commentCount}
        viewer={{ name: viewer.name, handle: viewer.handle }}
        people={mentionables}
      />
    </>
  );
}

async function PostRightRail({ params }: Pick<PageProps<"/posts/[id]">, "params">) {
  const { id } = await params;
  const post = getPostDetail(id);
  if (!post) return null;
  return (
    <>
      <AboutAuthor post={post} />
      <MoreInTopic post={post} />
    </>
  );
}

/** Post detail with comments — Figma "Web / Post detail with comments" (node 19:2487, body 19:2540). */
export default function PostPage({ params }: PageProps<"/posts/[id]">) {
  return (
    <PageColumns
      left={<SectionRail active="/feed" />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton lines={2} />}>
            <PostRightRail params={params} />
          </Suspense>
        </aside>
      }
    >
      <Link href="/feed" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Back to feed
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading post" />
            <PanelSkeleton className="h-[460px]" lines={6} />
            <PanelSkeleton className="h-[300px]" lines={4} />
          </>
        }
      >
        <PostMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
