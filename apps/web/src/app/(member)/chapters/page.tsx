import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ChapterRef, FollowView, Page } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { FollowChapterButton } from "@/components/home/follow-buttons";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { settle } from "@/components/social/data";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getChapter } from "@/lib/mock/chapters";
import { getTaxonomies } from "@/lib/taxonomies";

export const metadata: Metadata = { title: "Chapters" };

function ChapterRow({ chapter, country, following }: { chapter: ChapterRef; country: string; following: boolean }) {
  const hasPage = !!getChapter(chapter.slug);
  return (
    <li className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
        <Icon name="globe" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        {hasPage ? (
          <Link href={`/chapters/${chapter.slug}`} className="text-md font-semibold text-ink hover:underline">
            {chapter.name}
          </Link>
        ) : (
          <p className="text-md font-semibold text-ink">{chapter.name}</p>
        )}
        <p className="text-sm text-secondary">{country}</p>
      </div>
      <FollowChapterButton chapter={chapter} following={following} />
    </li>
  );
}

async function ChaptersMain() {
  await requireViewer("/chapters");
  const [taxonomies, follows] = await Promise.all([
    settle(getTaxonomies()),
    settle(apiGet<Page<FollowView>>("/me/follows", { type: "chapter", limit: 50 })),
  ]);
  if (!taxonomies.ok) return <SectionError message={errorMessage(taxonomies.error)} retryHref="/chapters" />;
  const followed = new Set(follows.ok ? follows.data.items.map((f) => f.targetId) : []);
  const countryName = new Map(taxonomies.data.countries.map((c) => [c.code, c.name]));
  const byName = (a: ChapterRef, b: ChapterRef) => a.name.localeCompare(b.name, "en");
  const mine = taxonomies.data.chapters.filter((c) => followed.has(c.id)).sort(byName);
  const others = taxonomies.data.chapters.filter((c) => !followed.has(c.id)).sort(byName);
  const row = (chapter: ChapterRef) => (
    <ChapterRow key={chapter.id} chapter={chapter} country={countryName.get(chapter.countryCode) ?? chapter.countryCode} following={followed.has(chapter.id)} />
  );
  return (
    <>
      {mine.length > 0 && (
        <Panel aria-labelledby="my-chapters" className="flex flex-col gap-4 p-5">
          <h2 id="my-chapters" className="text-h3 text-ink">
            Your chapters
          </h2>
          <ul className="flex flex-col divide-y divide-line">{mine.map(row)}</ul>
        </Panel>
      )}
      <Panel aria-labelledby="all-chapters" className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 id="all-chapters" className="text-h3 text-ink">
            {mine.length ? "More chapters" : "Find your chapter"}
          </h2>
          <p className="text-sm text-secondary">Join a chapter to see its members, posts and meet-ups in your feed.</p>
        </div>
        {others.length ? (
          <ul className="flex flex-col divide-y divide-line">{others.map(row)}</ul>
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
