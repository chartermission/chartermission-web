import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { Page, PostView } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState, LoadingStatus, PostSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Saved posts") };
}

async function BookmarksMain() {
  const viewer = await requireClientViewer("/bookmarks");
  const page = await settle(apiGet<Page<PostView>>("/me/bookmarks"));
  if (!page.ok) return <SectionError message={errorMessage(page.error)} retryHref="/bookmarks" />;
  return (
    <PostStream
      path="/me/bookmarks"
      label="Saved posts"
      initial={page.data}
      viewer={viewer}
      dropUnbookmarked
      empty={
        <EmptyState
          icon="bookmark"
          title="No saved posts yet"
          actions={
            <Link href="/feed" className={buttonClasses({ size: "small" })}>
              Go to your feed
            </Link>
          }
        >
          Select Save on any post to keep it here. Only you can see what you’ve saved.
        </EmptyState>
      }
    />
  );
}

/** Saved posts (GET /me/bookmarks). Opportunities and other types arrive with their modules. */
export default function BookmarksPage() {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Saved posts</h1>
        <p className="text-sm text-secondary">Posts you’ve saved, newest first. Saved opportunities and events arrive in a later release.</p>
      </div>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading saved posts" />
            <PostSkeleton />
            <PostSkeleton />
          </>
        }
      >
        <BookmarksMain />
      </Suspense>
    </PageColumns>
  );
}
