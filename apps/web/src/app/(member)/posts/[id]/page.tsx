import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { CommentView, MemberProfile, Page, PostView, TopicView } from "@chartermission/contracts";
import { Chip, Icon, Panel } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { requireClientViewer } from "@/components/social/data";
import { topicHref } from "@/components/social/links";
import { PostCard } from "@/components/social/post-card";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton, PostSkeleton } from "@/components/social/skeletons";
import { AuthorCard } from "@/components/social/author-card";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { Comments } from "./comments";

export const metadata: Metadata = { title: "Post" };

type Params = PageProps<"/posts/[id]">["params"];

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function loadPost(params: Params) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const post = await apiGetOrNull<PostView>(`/posts/${id}`);
  if (!post) notFound();
  return post;
}

async function PostMain({ params }: { params: Params }) {
  const { id } = await params;
  const viewer = await requireClientViewer(`/posts/${id}`);
  const post = await loadPost(params);
  const comments = await apiGet<Page<CommentView>>(`/posts/${post.id}/comments`, { sort: "relevant" }).catch(() => null);
  return (
    <>
      <h1 className="sr-only">Post by {post.author.name}</h1>
      <PostCard post={post} viewer={viewer} detail />
      <Comments postId={post.id} initial={comments} total={post.counts.comments} viewer={viewer} />
    </>
  );
}

async function PostRightRail({ params }: { params: Params }) {
  const post = await loadPost(params).catch(() => null);
  if (!post) return null;
  const firstTag = post.hashtags[0];
  const [author, topic] = await Promise.all([
    apiGetOrNull<MemberProfile>(`/members/${post.author.handle}`).catch(() => null),
    firstTag ? apiGetOrNull<TopicView>(`/topics/${encodeURIComponent(firstTag.toLowerCase())}`).catch(() => null) : null,
  ]);
  const tags = [...new Set([...post.hashtags, ...(topic?.related ?? [])])].slice(0, 8);
  return (
    <>
      {author && <AuthorCard member={author} />}
      {tags.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">{topic ? `More like #${topic.tag}` : "Topics in this post"}</h2>
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag}>
                <Link href={topicHref(tag)}>
                  <Chip tone="hashtag" className="hover:bg-accent hover:text-inverse">
                    #{tag}
                  </Chip>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
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
            <PostSkeleton />
            <PanelSkeleton className="h-[300px]" lines={4} />
          </>
        }
      >
        <PostMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
