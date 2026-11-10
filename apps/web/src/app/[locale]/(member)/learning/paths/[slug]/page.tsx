import type { Metadata } from "next";
import { SHARE_IMAGE } from "@/lib/share-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import type { CourseSummary, LearningPath } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { BrandPattern } from "@/components/illustrations";
import { CharterCenterLink } from "@/components/learning/charter-center-link";
import { CopyLinkButton } from "@/components/learning/copy-link-button";
import { CourseThumbnail } from "@/components/learning/course-thumbnail";
import { CourseChips } from "@/components/learning/course-tile";
import { courseHref, formatMinutes, levelLabel, pathHref } from "@/components/learning/format";
import { SaveCourseButton } from "@/components/learning/save-course-button";

import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { T } from "@/i18n/client";
import { getT } from "@/i18n/server";

type Params = PageProps<"/[locale]/learning/paths/[slug]">["params"];

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;

/** The path with its visible courses; null when unknown or when none of its courses are visible. */
const getPath = cache(async (slug: string): Promise<LearningPath | null> => {
  if (!SLUG.test(slug)) return null;
  return apiGetOrNull<LearningPath>(`/learning/paths/${encodeURIComponent(slug)}`);
});

export async function generateMetadata({ params }: PageProps<"/[locale]/learning/paths/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const path = await getPath(slug).catch(() => null);
  if (!path) return { title: "Learning path" };
  return { title: path.title, description: path.description.slice(0, 160), openGraph: { images: [SHARE_IMAGE], title: path.title, description: path.description.slice(0, 160) } };
}

async function PathHeader({ path }: { path: LearningPath }) {
  const t = await getT();
  const facts = [
    path.level ? { icon: "chart" as const, label: levelLabel(path.level) } : null,
    path.totalMinutes > 0 ? { icon: "clock" as const, label: t("About {duration} in total", { duration: formatMinutes(path.totalMinutes) }) } : null,
    { icon: "book" as const, label: t("{count} courses", { count: path.courseCount }) },
  ].filter((f): f is { icon: "chart" | "clock" | "book"; label: string } => !!f);

  return (
    <header className="relative isolate overflow-hidden rounded-2xl bg-linear-to-r from-primary-dark via-primary via-70% to-accent p-8 max-sm:p-5">
      <BrandPattern tone="text-inverse" opacity={0.07} fade="left" className="-z-10" />
      <div className="flex max-w-3xl flex-col items-start gap-3">
        <Chip tone="hashtag">Learning path</Chip>
        <h1 className="text-h1 text-inverse max-sm:text-h2">{path.title}</h1>
        {path.description && <p className="text-md text-primary-tint">{path.description}</p>}
        <ul aria-label="About this path" className="flex flex-wrap gap-2 pt-1">
          {facts.map((fact) => (
            <li key={fact.label} className="flex items-center gap-1.5 rounded-full bg-inverse/12 px-3 py-[5px] text-sm font-medium text-inverse ring-1 ring-inverse/20">
              <Icon name={fact.icon} size={16} />
              {fact.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2.5 pt-2">
          {path.sourceUrl && (
            <a href={path.sourceUrl} target="_blank" rel="noopener" className={buttonClasses({ variant: "accent" })}>
              View path on Charter Center
              <Icon name="arrow-up-right" size={18} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <CopyLinkButton path={pathHref(path.slug)} title={path.title} />
        </div>
      </div>
    </header>
  );
}

function PathStep({ course, index, last }: { course: CourseSummary; index: number; last: boolean }) {
  return (
    <li className="relative flex gap-5 max-sm:gap-3">
      <div aria-hidden="true" className="flex flex-col items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card text-md font-semibold text-primary shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] max-sm:size-8 max-sm:text-sm">
          {index + 1}
        </span>
        {!last && <span className="w-px flex-1 bg-line-strong" />}
      </div>
      <article className="group relative mb-5 flex min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0px_8px_20px_-8px_rgba(25,37,80,0.18)] max-sm:flex-col">
        <CourseThumbnail course={course} className="w-[200px] shrink-0 max-sm:hidden" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-5 max-sm:p-4">
          <p className="text-label uppercase text-secondary"><T vars={{ count: index + 1 }}>{"Step {count}"}</T></p>
          <h3 dir="auto" className="text-h3 text-ink">
            <Link href={courseHref(course.slug)} className="rounded-sm hover:text-primary-light hover:underline">
              {course.title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-secondary">
            <span className="flex items-center gap-1.5 text-body">
              <Icon name="verified" size={14} className="text-accent" />
              {course.provider}
            </span>
            {course.durationLabel && (
              <span className="flex items-center gap-1.5">
                <Icon name="clock" size={14} />
                {course.durationLabel}
              </span>
            )}
            <CourseChips course={course} />
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-2">
            {course.startUrl ? (
              <CharterCenterLink courseId={course.id} href={course.startUrl} className={buttonClasses({ variant: "secondary", size: "small" })}>
                Start on Charter Center
                <Icon name="arrow-up-right" size={16} />
                <span className="sr-only">: {course.title}</span>
              </CharterCenterLink>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg bg-warning-light px-3 py-1.5 text-sm text-ink">
                <Icon name="clock" size={16} className="text-warning" />
                Course link is being fixed. Check back soon.
              </span>
            )}
            <SaveCourseButton course={course} size="small" />
            <Link href={courseHref(course.slug)} className="ms-auto flex items-center gap-1 rounded-sm text-sm font-medium text-primary-light hover:underline max-sm:ms-0">
              Course details
              <Icon name="chevron-right" size={16} />
              <span className="sr-only">: {course.title}</span>
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}

async function PathMain({ params }: { params: Params }) {
  const { slug } = await params;
  await requireViewer(`/learning/paths/${slug}`);
  const path = await getPath(slug);
  if (!path) notFound();
  return (
    <>
      <PathHeader path={path} />
      <section aria-labelledby="path-courses" className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="path-courses" className="text-h2 text-ink max-sm:text-h3">
            Courses in this path
          </h2>
          <p className="text-sm text-secondary">In the order Charter Center suggests. Each course opens on Charter Center in a new tab.</p>
        </div>
        <ol className="flex flex-col">
          {path.courses.map((course, index) => (
            <PathStep key={course.id} course={course} index={index} last={index === path.courses.length - 1} />
          ))}
        </ol>
      </section>
    </>
  );
}

function PathSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <Bone className="h-[260px] w-full rounded-2xl" />
      <Bone className="h-7 w-56" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-5">
          <Bone className="size-10 shrink-0 rounded-full" />
          <Bone className="h-[150px] flex-1 rounded-card" />
        </div>
      ))}
    </div>
  );
}

/** A Charter Center learning path: the courses in order, each with Start and Save. No progress (CM-LRN-06). */
export default function LearningPathPage({ params }: PageProps<"/[locale]/learning/paths/[slug]">) {
  return (
    <PageShell className="max-w-[1000px] gap-6 max-sm:px-4 max-sm:pt-4">
      <Link href="/learning" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Learning
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading learning path" />
            <PathSkeleton />
          </>
        }
      >
        <PathMain params={params} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
