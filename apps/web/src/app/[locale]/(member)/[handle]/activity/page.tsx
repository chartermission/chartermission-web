import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { MemberProfile, Page, PostView } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer } from "@/components/social/data";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState, LoadingStatus, PostSkeleton } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/[handle]/activity">;

const POSTS_PAGE = 10;
const LOOKS_LIKE_MEMBER = /^(?:[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

async function member(handle: string) {
  if (!LOOKS_LIKE_MEMBER.test(handle)) notFound();
  const profile = await apiGetOrNull<MemberProfile>(`/members/${encodeURIComponent(handle.toLowerCase())}`);
  if (!profile) notFound();
  return profile;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const t = await getT();
  const profile = await apiGetOrNull<MemberProfile>(`/members/${encodeURIComponent(handle.toLowerCase())}`).catch(() => null);
  return { title: profile ? t("Posts by {name}", { name: profile.name }) : t("Posts") };
}

/** /{handle}/activity: all of a member's posts as a feed ("Show all posts" from their profile's Activity). */
async function ActivityMain({ params }: Props) {
  const { handle } = await params;
  const viewer = await requireClientViewer(`/${handle}/activity`);
  const profile = await member(handle);
  const t = await getT();
  const own = viewer.id === profile.id;
  const query = { author: profile.id, limit: POSTS_PAGE };
  const page = await apiGet<Page<PostView>>("/feed", query).catch(() => undefined);
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/${profile.handle}`} className="flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
          <Icon name="chevron-left" size={16} />
          {t("Back to {name}’s profile", { name: profile.name })}
        </Link>
        <h1 className="text-h2 text-ink">{t("Posts by {name}", { name: profile.name })}</h1>
      </header>
      <PostStream
        path="/feed"
        query={query}
        initial={page}
        acceptNew={own}
        viewer={viewer}
        label={t("Posts by {name}", { name: profile.name })}
        empty={
          <EmptyState icon="message" title="No posts yet">
            {own ? "Posts you share appear here." : t("{name} hasn’t posted yet.", { name: profile.name })}
          </EmptyState>
        }
      />
    </>
  );
}

export default function MemberActivityPage(props: Props) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading posts" />
            <PostSkeleton />
            <PostSkeleton />
          </>
        }
      >
        <ActivityMain {...props} />
      </Suspense>
    </PageColumns>
  );
}
