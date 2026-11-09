import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache, type ReactNode } from "react";
import type { CourseDetail, CourseSummary, Page } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses, chipClasses, type IconName } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { CharterCenterLink } from "@/components/learning/charter-center-link";
import { CopyLinkButton } from "@/components/learning/copy-link-button";
import { CourseThumbnail } from "@/components/learning/course-thumbnail";
import { CourseChips, CourseTile, CourseTileSkeleton, courseGridClass } from "@/components/learning/course-tile";
import { courseHref, formatMinutes, levelLabel } from "@/components/learning/format";
import { PathCard } from "@/components/learning/path-card";
import { SaveCourseButton } from "@/components/learning/save-course-button";
import { absoluteDate } from "@/components/social/format";
import { Markdown, stripMarkdown } from "@/components/social/post-types/markdown";
import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";

type Params = PageProps<"/learning/courses/[slug]">["params"];

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;

/** The course, if it exists and is visible (hidden and removed courses are NOT_FOUND). Deduplicated per request. */
const getCourse = cache(async (slug: string): Promise<CourseDetail | null> => {
  if (!SLUG.test(slug)) return null;
  return apiGetOrNull<CourseDetail>(`/courses/${encodeURIComponent(slug)}`);
});

export async function generateMetadata({ params }: PageProps<"/learning/courses/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const course = await getCourse(slug).catch(() => null);
  if (!course) return { title: "Course" };
  const description = stripMarkdown(course.description).replace(/\s+/g, " ").trim().slice(0, 160);
  return { title: course.title, description, openGraph: { title: course.title, description } };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-h3 text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-secondary" />
      <dt className="w-24 shrink-0 text-sm text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Start learning (or the broken-link notice), save, share and the course facts. */
function CourseActions({ course }: { course: CourseDetail }) {
  return (
    <Panel className="flex flex-col overflow-hidden">
      <CourseThumbnail course={course} eager iconSize={36} className="h-[180px] max-lg:h-[140px] max-sm:hidden" />
      <div className="flex flex-col gap-4 p-5">
        {course.startUrl ? (
          <div className="flex flex-col gap-2">
            <CharterCenterLink courseId={course.id} href={course.startUrl} className={buttonClasses({ variant: "accent", block: true })}>
              Start learning on Charter Center
              <Icon name="arrow-up-right" size={18} />
            </CharterCenterLink>
            <p className="text-center text-xs text-secondary">Opens the course on Charter Center in a new tab.</p>
          </div>
        ) : (
          <div role="status" className="flex items-start gap-2.5 rounded-[10px] bg-warning-light p-3.5 text-sm text-ink">
            <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-warning" />
            <span>
              <span className="font-medium">This course link is being fixed.</span> Check back soon — you can save the course so it’s easy to find.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <SaveCourseButton course={course} className="w-full" />
          <CopyLinkButton path={courseHref(course.slug)} title={course.title} className="w-full" />
        </div>
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          <Fact icon="chart" label="Level">
            {levelLabel(course.level)}
          </Fact>
          {course.durationMinutes ? (
            <Fact icon="clock" label="Duration">
              {formatMinutes(course.durationMinutes)}
            </Fact>
          ) : null}
          {course.lessons ? (
            <Fact icon="book" label="Lessons">
              {course.lessons}
            </Fact>
          ) : null}
          <Fact icon="globe" label="Language">
            {course.languageName}
          </Fact>
          <Fact icon="shield" label="Access">
            {course.free ? "Free" : "Paid"}
          </Fact>
          <Fact icon="verified" label="Provider">
            {course.provider}
          </Fact>
        </dl>
        {course.sourceUpdatedAt && (
          <p className="flex items-center gap-1.5 text-xs text-secondary">
            <Icon name="repeat" size={14} className="shrink-0" />
            Last updated on Charter Center{" "}
            <time dateTime={course.sourceUpdatedAt} suppressHydrationWarning>
              {absoluteDate(course.sourceUpdatedAt)}
            </time>
          </p>
        )}
      </div>
    </Panel>
  );
}

async function RelatedCourses({ course }: { course: CourseDetail }) {
  const topic = course.topics[0];
  if (!topic) return null;
  const page = await apiGet<Page<CourseSummary>>("/courses", { topic: topic.slug, limit: 5 }).catch(() => null);
  const related = page?.items.filter((c) => c.id !== course.id).slice(0, 4) ?? [];
  if (!related.length) return null;
  return (
    <section aria-labelledby="related-courses" className="flex flex-col gap-4 border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="related-courses" className="text-h2 text-ink max-sm:text-h3">
          More in {topic.name}
        </h2>
        <Link href={`/learning?topic=${encodeURIComponent(topic.slug)}#courses`} className="flex items-center gap-1 rounded-sm text-sm font-medium text-primary-light hover:underline">
          See all {topic.name} courses
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      <ul className={courseGridClass}>
        {related.map((c) => (
          <li key={c.id} className="flex">
            <CourseTile course={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

async function CourseMain({ params }: { params: Params }) {
  const { slug } = await params;
  await requireViewer(`/learning/courses/${slug}`);
  const course = await getCourse(slug);
  if (!course) notFound();

  return (
    <>
      <header className="flex flex-col gap-3">
        <ul aria-label="Topics" className="flex flex-wrap gap-2">
          {course.topics.map((topic) => (
            <li key={topic.id}>
              <Link href={`/learning?topic=${encodeURIComponent(topic.slug)}#courses`} className={chipClasses("hashtag", "hover:bg-accent/15")}>
                {topic.name}
              </Link>
            </li>
          ))}
        </ul>
        <h1 dir="auto" className="max-w-3xl text-h1 text-ink max-sm:text-h2">
          {course.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-body">
          <span className="flex items-center gap-1.5">
            <Icon name="verified" size={16} className="text-accent" />
            {course.provider}
          </span>
          {course.durationLabel && (
            <span className="flex items-center gap-1.5 text-secondary">
              <Icon name="clock" size={16} />
              {course.durationLabel}
            </span>
          )}
          <CourseChips course={course} />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-8 max-lg:grid-cols-1 max-lg:gap-6">
        <aside aria-label="Start this course" className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
          <CourseActions course={course} />
        </aside>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <Section id="about-course" title="About this course">
            {course.description ? (
              <Markdown text={course.description} headingOffset={1} className="text-md leading-7" />
            ) : (
              <p className="text-md text-secondary">Charter Center hasn’t added a description yet.</p>
            )}
          </Section>

          {course.outcomes.length > 0 && (
            <Section id="course-outcomes" title="What you’ll learn">
              <Panel className="p-5">
                <ul className="grid grid-cols-2 gap-x-6 gap-y-3 max-sm:grid-cols-1">
                  {course.outcomes.map((outcome, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-body">
                      <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                      {outcome}
                    </li>
                  ))}
                </ul>
              </Panel>
            </Section>
          )}

          <Section id="course-access" title="Who it’s for and how to join">
            <Panel className="flex flex-col divide-y divide-line">
              <div className="flex items-start gap-3 p-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
                  <Icon name="users" size={18} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-medium text-ink">Eligibility</h3>
                  <p className="whitespace-pre-line text-sm text-body">{course.eligibility ?? "Open to everyone. Charter Center hasn’t listed any requirements."}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
                  <Icon name="shield" size={18} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-medium text-ink">Access</h3>
                  <p className="text-sm text-body">
                    {course.accessConditions ?? (course.free ? "Free on Charter Center." : "Charter Center sets the price and access for this course.")}
                  </p>
                </div>
              </div>
            </Panel>
          </Section>

          {course.paths.length > 0 && (
            <Section id="course-paths" title={course.paths.length === 1 ? "Part of this learning path" : "Part of these learning paths"}>
              <ul className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                {course.paths.map((path) => (
                  <li key={path.id} className="flex">
                    <PathCard path={path} className="w-full" />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <p className="flex items-start gap-2.5 rounded-[10px] bg-info-light p-3.5 text-sm text-body">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-info" />
            <span>
              This course is run on Charter Center, which keeps its content up to date. When you start it, we record that you opened
              this course. Nothing else is shared, and nothing comes back from your Charter Center account.
            </span>
          </p>
        </div>
      </div>

      <Suspense
        fallback={
          <div aria-hidden="true" className={courseGridClass}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
                <CourseTileSkeleton />
              </div>
            ))}
          </div>
        }
      >
        <RelatedCourses course={course} />
      </Suspense>
    </>
  );
}

function CourseSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Bone className="h-7 w-48 rounded-full" />
        <Bone className="h-10 w-[60%]" />
        <Bone className="h-5 w-[40%]" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-8 max-lg:grid-cols-1">
        <div className="flex flex-col gap-3">
          {[92, 86, 90, 60].map((w, i) => (
            <Bone key={i} className="h-4" style={{ width: `${w}%` }} />
          ))}
          <Bone className="mt-4 h-40 w-full rounded-card" />
        </div>
        <Bone className="h-[420px] w-full rounded-card max-lg:order-first max-lg:h-[260px]" />
      </div>
    </div>
  );
}

/** A Charter Center course: what it covers, who it's for, and the button that opens it there. */
export default function CoursePage({ params }: PageProps<"/learning/courses/[slug]">) {
  return (
    <PageShell className="gap-6 max-sm:px-4 max-sm:pt-4">
      <Link href="/learning" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Learning
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading course" />
            <CourseSkeleton />
          </>
        }
      >
        <CourseMain params={params} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
