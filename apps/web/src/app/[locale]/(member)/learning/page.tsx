import type { Metadata } from "next";
import { Suspense, cache } from "react";
import type { CourseSummary, LearningHub, LearningPathSummary, Page } from "@chartermission/contracts";
import { Chip, Icon } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { BrandPattern } from "@/components/illustrations";
import { YourExams } from "@/components/exams/your-exams";
import { CourseTile, CourseTileSkeleton, featuredGridClass } from "@/components/learning/course-tile";
import { filtersToQuery, parseCourseFilters } from "@/components/learning/format";
import { PathCard } from "@/components/learning/path-card";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { relativeTime } from "@/components/social/format";
import { Bone, LoadingStatus, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { CatalogueSkeleton, LearningBrowser } from "./learning-browser";
import { getT, getIntlTag } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Learning"),
    description: t("Short, practical courses and learning paths from Charter Center, picked for Charter Mission members."),
  };
}

/** GET /learning, shared by the header note, the hub sections and the filters. */
const getHub = cache(() => settle(apiGet<LearningHub>("/learning")));

async function SyncedNote() {
  const intl = await getIntlTag();
  const t = await getT();
  await requireViewer("/learning");
  const hub = await getHub();
  const syncedAt = hub.ok ? hub.data.syncedAt : null;
  if (!syncedAt) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-secondary">
      <Icon name="repeat" size={14} />
      Catalogue updated from Charter Center{" "}
      <time dateTime={syncedAt} suppressHydrationWarning>
        {relativeTime(intl, t, syncedAt) === "now" ? "just now" : t("{time} ago", { time: relativeTime(intl, t, syncedAt) })}
      </time>
    </p>
  );
}

function PathsBand({ paths }: { paths: LearningPathSummary[] }) {
  return (
    <section
      aria-labelledby="learning-paths-heading"
      className="relative isolate overflow-hidden rounded-2xl bg-linear-to-r from-primary-dark via-primary via-70% to-accent p-8 max-sm:-mx-1 max-sm:p-5"
    >
      <BrandPattern tone="text-inverse" opacity={0.07} fade="left" className="-z-10" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex max-w-2xl flex-col items-start gap-2">
            <Chip tone="hashtag">Learning paths</Chip>
            <h2 id="learning-paths-heading" className="text-h1 text-inverse max-sm:text-h2">
              Follow a guided path
            </h2>
            <p className="text-md text-primary-tint">
              Curated sequences of Charter Center courses. Take them in order, at your own pace.
            </p>
          </div>
        </div>
        <ul className="relative grid grid-cols-3 gap-4 max-lg:-mx-8 max-lg:flex max-lg:snap-x max-lg:snap-mandatory max-lg:overflow-x-auto max-lg:px-8 max-lg:pb-1 max-sm:-mx-5 max-sm:px-5">
          {paths.map((path) => (
            <li key={path.id} className="flex max-lg:w-[300px] max-lg:shrink-0 max-lg:snap-start max-sm:w-[82%]">
              <PathCard path={path} className="w-full" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeaturedCourses({ courses }: { courses: CourseSummary[] }) {
  return (
    <section aria-labelledby="featured-courses-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="featured-courses-heading" className="text-h2 text-ink max-sm:text-h3">
          Featured courses
        </h2>
        <p className="text-sm text-secondary">Picked by the Charter Mission team this month.</p>
      </div>
      <ul className={featuredGridClass}>
        {courses.slice(0, 3).map((course) => (
          <li key={course.id} className="flex">
            <CourseTile course={course} eager />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Learning paths band and featured courses (GET /learning). */
async function HubTop() {
  const t = await getT();
  await requireViewer("/learning");
  const hub = await getHub();
  if (!hub.ok) return <SectionError message={t("Learning couldn’t load. {error}", { error: errorMessage(hub.error) })} retryHref="/learning" />;
  const { paths, featured } = hub.data;
  return (
    <>
      {paths.length > 0 && <PathsBand paths={paths} />}
      {featured.length > 0 && <FeaturedCourses courses={featured} />}
    </>
  );
}

function HubSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <Bone className="h-[300px] w-full rounded-2xl" />
      <div className="flex flex-col gap-4">
        <Bone className="h-7 w-52" />
        <div className={featuredGridClass}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
              <CourseTileSkeleton />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Topic chips, filters, sort and the paginated grid for the URL's filters. */
async function Catalogue({ searchParams }: { searchParams: PageProps<"/[locale]/learning">["searchParams"] }) {
  await requireViewer("/learning");
  const filters = parseCourseFilters(await searchParams);
  const [first, hub] = await Promise.all([settle(apiGet<Page<CourseSummary>>("/courses", filtersToQuery(filters))), getHub()]);
  return (
    <LearningBrowser
      filters={filters}
      initial={first.ok ? first.data : null}
      error={first.ok ? null : errorMessage(first.error)}
      facets={
        hub.ok
          ? { topics: hub.data.topics, languages: hub.data.languages, levels: hub.data.levels, total: hub.data.total }
          : { topics: [], languages: [], levels: [], total: 0 }
      }
    />
  );
}

/** Learning — Figma "Web / Learning" (node 19:2189) on the synced Charter Center catalogue. */
export default function LearningPage({ searchParams }: PageProps<"/[locale]/learning">) {
  return (
    <PageShell className="gap-8 max-sm:gap-6 max-sm:px-4 max-sm:pt-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-h1 text-ink">Learning</h1>
            <Chip tone="hashtag">From Charter Center</Chip>
          </div>
          <p className="text-md text-secondary">
            Short, practical courses and learning paths picked for members. Courses run on Charter Center.
          </p>
        </div>
        <Suspense fallback={null}>
          <SyncedNote />
        </Suspense>
      </header>
      <Suspense fallback={null}>
        <YourExams />
      </Suspense>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading learning paths and featured courses" />
            <HubSkeleton />
          </>
        }
      >
        <HubTop />
      </Suspense>
      <Suspense fallback={<CatalogueSkeleton />}>
        <Catalogue searchParams={searchParams} />
      </Suspense>
      <p className="flex items-start gap-2.5 rounded-[10px] bg-info-light p-3.5 text-sm text-body">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-info" />
        <span>
          Courses are run and kept up to date on Charter Center. When you select Start learning, the course opens there in a new tab.
          We record which course you opened so we can see what members find useful. Nothing else is shared, and nothing comes
          back from your Charter Center account.
        </span>
      </p>
      <Toaster />
    </PageShell>
  );
}
