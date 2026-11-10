import type { Metadata } from "next";
import { SHARE_IMAGE } from "@/lib/share-image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, cache } from "react";
import type {
  CommentView,
  MemberProfile,
  Page,
  PostView,
  RelatedArticles as Related,
} from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ArticleReader } from "@/components/articles/article-reader";
import {
  RelatedArticles,
  RelatedSkeleton,
} from "@/components/articles/related-articles";
import { getClientViewer } from "@/components/social/data";
import { GUEST_VIEWER } from "@/components/social/viewer";
import { pageHref } from "@/components/social/links";
import { stripMarkdown } from "@/components/social/post-types/markdown";
import {
  Bone,
  LoadingStatus,
  PanelSkeleton,
} from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { Comments } from "../../posts/[id]/comments";

type Params = PageProps<"/[locale]/articles/[id]">["params"];

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The post, if it exists, is visible to the viewer and is an article. Deduplicated per request. */
const getArticle = cache(async (id: string): Promise<PostView | null> => {
  if (!isUuid(id)) return null;
  const post = await apiGetOrNull<PostView>(`/posts/${id}`);
  return post?.type === "article" && post.article ? post : null;
});

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/articles/[id]">): Promise<Metadata> {
  const { id } = await params;
  const post = await getArticle(id).catch(() => null);
  if (!post?.article) return { title: "Article" };
  const description =
    post.article.subtitle ?? stripMarkdown(post.body).slice(0, 160);
  return {
    title: post.article.title,
    description,
    openGraph: {
      images: [SHARE_IMAGE],
      type: "article",
      title: post.article.title,
      description,
      publishedTime: post.createdAt,
      authors: [post.author.name],
    },
  };
}

async function RelatedShelves({ post }: { post: PostView }) {
  const related = await apiGet<Related>(`/articles/${post.id}/related`).catch(
    () => null,
  );
  if (!related || (!related.moreByAuthor.length && !related.related.length))
    return null;
  return (
    <RelatedArticles
      related={related}
      author={post.author}
      authorLink={post.page ? pageHref(post.page.slug) : undefined}
    />
  );
}

async function ArticleMain({ params }: { params: Params }) {
  const { id } = await params;
  const viewer = await getClientViewer().catch(() => null);
  const post = await getArticle(id);
  // Signed out: public articles are readable (read-only); anything else asks the visitor to sign in.
  if (!post) {
    if (!viewer)
      redirect(`/signin?next=${encodeURIComponent(`/articles/${id}`)}`);
    notFound();
  }
  if (!viewer) {
    return (
      <>
        <ArticleReader post={post} viewer={GUEST_VIEWER} author={null} guest />
        <Link
          href="/articles"
          className="mx-auto flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
        >
          <Icon name="book" size={16} />
          Browse all articles
        </Link>
      </>
    );
  }
  const [comments, author] = await Promise.all([
    apiGet<Page<CommentView>>(`/posts/${post.id}/comments`, {
      sort: "relevant",
    }).catch(() => null),
    // An article published as a page has no member profile to show under it.
    post.page
      ? null
      : apiGetOrNull<MemberProfile>(`/members/${post.author.handle}`).catch(
          () => null,
        ),
  ]);
  return (
    <>
      <ArticleReader post={post} viewer={viewer} author={author} />
      <div className="mx-auto w-full max-w-[680px]">
        <Comments
          postId={post.id}
          initial={comments}
          total={post.counts.comments}
          viewer={viewer}
          question={null}
        />
      </div>
      <div className="mt-4 flex flex-col gap-10 border-t border-line pt-10 max-sm:gap-8 max-sm:pt-8">
        <Suspense fallback={<RelatedSkeleton />}>
          <RelatedShelves post={post} />
        </Suspense>
        <Link
          href="/articles"
          className="mx-auto flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
        >
          <Icon name="book" size={16} />
          Browse all articles
        </Link>
      </div>
    </>
  );
}

function ReaderSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <Bone className="aspect-[2/1] max-h-[480px] w-full rounded-card" />
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
        <Bone className="h-4 w-24" />
        <Bone className="h-12 w-[90%]" />
        <Bone className="h-6 w-[70%]" />
        <div className="flex items-center gap-3 border-y border-line py-4">
          <Bone className="size-10 rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Bone className="h-4 w-1/3" />
            <Bone className="h-3 w-1/2" />
          </span>
        </div>
        {[96, 88, 92, 70].map((w, i) => (
          <Bone key={i} className="h-4" style={{ width: `${w}%` }} />
        ))}
        <PanelSkeleton className="mt-4 h-[200px]" lines={3} />
      </div>
    </div>
  );
}

/** Article reader: a focused reading layout with comments and related articles. */
export default function ArticlePage({
  params,
}: PageProps<"/[locale]/articles/[id]">) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-6 pb-16 pt-6 max-sm:gap-4 max-sm:px-3 max-sm:pt-4"
    >
      <Link
        href="/articles"
        className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
      >
        <Icon name="chevron-left" size={18} />
        All articles
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading article" />
            <ReaderSkeleton />
          </>
        }
      >
        <ArticleMain params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
