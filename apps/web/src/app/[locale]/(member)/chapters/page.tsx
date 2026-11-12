import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ChapterSummary } from "@chartermission/contracts";
import { ChapterAvatar, Panel } from "@chartermission/ui";
import { FollowChapterButton } from "@/components/home/follow-buttons";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { errorMessage } from "@/components/social/error-message";
import {
  LoadingStatus,
  PanelSkeleton,
  SectionError,
} from "@/components/social/skeletons";
import { settle } from "@/components/social/data";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Chapters") };
}

const numberFormat = new Intl.NumberFormat("en-GB");

function ChapterRow({ chapter }: { chapter: ChapterSummary }) {
  return (
    <li className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
      <ChapterAvatar
        name={chapter.name}
        countryCode={chapter.countryCode}
        src={chapter.imageUrl}
        size={44}
        className="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/chapters/${chapter.slug}`}
          className="text-md font-semibold text-ink hover:underline"
        >
          {chapter.name}
        </Link>
        <p className="text-sm text-secondary">
          {chapter.countryName} · {numberFormat.format(chapter.followers)}{" "}
          {chapter.followers === 1 ? "member" : "members"}
        </p>
      </div>
      <FollowChapterButton
        chapter={chapter}
        following={chapter.viewer.following}
      />
    </li>
  );
}

async function ChaptersMain() {
  await requireViewer("/chapters");
  const result = await settle(apiGet<ChapterSummary[]>("/chapters"));
  if (!result.ok)
    return (
      <SectionError
        message={errorMessage(result.error)}
        retryHref="/chapters"
      />
    );
  const mine = result.data.filter((c) => c.viewer.following);
  const others = result.data.filter((c) => !c.viewer.following);
  const row = (chapter: ChapterSummary) => (
    <ChapterRow key={chapter.id} chapter={chapter} />
  );
  return (
    <>
      {mine.length > 0 && (
        <Panel
          aria-labelledby="my-chapters"
          className="flex flex-col gap-4 p-5"
        >
          <h2 id="my-chapters" className="text-h3 text-ink">
            Your chapters
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {mine.map(row)}
          </ul>
        </Panel>
      )}
      <Panel aria-labelledby="all-chapters" className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 id="all-chapters" className="text-h3 text-ink">
            {mine.length ? "More chapters" : "Find your chapter"}
          </h2>
          <p className="text-sm text-secondary">
            Join a chapter to see its posts, events and members in your feed.
          </p>
        </div>
        {others.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {others.map(row)}
          </ul>
        ) : (
          <p className="text-sm text-secondary">You’ve joined every chapter.</p>
        )}
      </Panel>
    </>
  );
}

/** Chapters index: every active chapter, with join/leave (follows). */
export default function ChaptersPage() {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="text-h2 text-ink">Chapters</h1>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading chapters" />
            <PanelSkeleton className="h-[320px]" lines={5} />
          </>
        }
      >
        <ChaptersMain />
      </Suspense>
    </PageColumns>
  );
}
