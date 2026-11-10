import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { CommentView, HelpOfferView, MemberProfile, Page, PostView, TopicView } from "@chartermission/contracts";
import { Chip, Icon, Panel } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { requireClientViewer } from "@/components/social/data";
import { articleHref, topicHref } from "@/components/social/links";
import { PostCard } from "@/components/social/post-card";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton, PostSkeleton } from "@/components/social/skeletons";
import { AuthorCard } from "@/components/social/author-card";
import { HelpOffersPanel } from "@/components/social/post-types/help-offers";
import { stripMarkdown } from "@/components/social/post-types/markdown";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { ArticleRedirect } from "./article-redirect";
import { Comments } from "./comments";
import { getT } from "@/i18n/server";

type Params = PageProps<"/[locale]/posts/[id]">["params"];

export async function generateMetadata({ params }: PageProps<"/[locale]/posts/[id]">): Promise<Metadata> {
  const t = await getT();
  const { id } = await params;
  if (!isUuid(id)) return { title: "Post" };
  const post = await apiGetOrNull<PostView>(`/posts/${id}`).catch(() => null);
  if (!post) return { title: "Post" };
  if (post.article) return { title: post.article.title, description: post.article.subtitle ?? stripMarkdown(post.body).slice(0, 160) };
  const lead = post.celebration?.headline ?? post.request?.title ?? stripMarkdown(post.body).slice(0, 70);
  return { title: lead ? `${post.author.name}: ${lead}` : t("Post by {name}", { name: post.author.name }) };
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function loadPost(params: Params) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const post = await apiGetOrNull<PostView>(`/posts/${id}`);
  if (!post) notFound();
  return post;
}

async function PostMain({ params }: { params: Params }) {
  const t = await getT();
  const { id } = await params;
  const viewer = await requireClientViewer(`/posts/${id}`);
  const post = await loadPost(params);
  // Articles are read on their own page; keep #comments / #comment-… anchors.
  if (post.type === "article") return <ArticleRedirect href={articleHref(post.id)} />;
  const isOwnRequest = post.type === "request" && !post.page && post.author.id === viewer.id;
  const [comments, offers] = await Promise.all([
    apiGet<Page<CommentView>>(`/posts/${post.id}/comments`, { sort: "relevant" }).catch(() => null),
    isOwnRequest ? apiGet<HelpOfferView[]>(`/posts/${post.id}/help`).catch(() => null) : Promise.resolve(null),
  ]);
  const heading =
    post.type === "question" ? t("Question from {name}", { name: post.author.name }) : post.type === "request" ? t("{name} is looking for help", { name: post.author.name }) : t("Post by {name}", { name: post.author.name });
  return (
    <>
      {/* Articles use their title as the page heading. */}
      {!post.article && <h1 className="sr-only">{heading}</h1>}
      <PostCard post={post} viewer={viewer} detail />
      {isOwnRequest && <HelpOffersPanel offers={offers} closed={post.request?.closed ?? false} />}
      <Comments
        postId={post.id}
        initial={comments}
        total={post.counts.comments}
        viewer={viewer}
        question={post.question ? { acceptedCommentId: post.question.acceptedCommentId, askerId: post.author.id } : null}
      />
    </>
  );
}

async function PostRightRail({ params }: { params: Params }) {
  const t = await getT();
  const post = await loadPost(params).catch(() => null);
  if (!post || post.type === "article") return null;
  const firstTag = post.hashtags[0];
  const [author, topic] = await Promise.all([
    post.page ? null : apiGetOrNull<MemberProfile>(`/members/${post.author.handle}`).catch(() => null),
    firstTag ? apiGetOrNull<TopicView>(`/topics/${encodeURIComponent(firstTag.toLowerCase())}`).catch(() => null) : null,
  ]);
  const tags = [...new Set([...post.hashtags, ...(topic?.related ?? [])])].slice(0, 8);
  return (
    <>
      {author && <AuthorCard member={author} />}
      {tags.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">{topic ? t("More like #{tag}", { tag: topic.tag }) : "Topics in this post"}</h2>
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
export default function PostPage({ params }: PageProps<"/[locale]/posts/[id]">) {
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
