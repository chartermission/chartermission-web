import Link from "next/link";
import type { CourseSummary } from "@chartermission/contracts";
import { Chip, Icon, cn } from "@chartermission/ui";
import { Bone } from "@/components/social/skeletons";
import { CourseThumbnail } from "./course-thumbnail";
import { courseHref, levelLabel, levelTone } from "./format";
import { SaveCourseButton } from "./save-course-button";

const smallChip = "px-2.5 py-0.5 text-xs";

/** Level, language (when not English) and Free chips. */
export function CourseChips({ course, className }: { course: CourseSummary; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Chip tone={levelTone[course.level]} className={smallChip}>
        {levelLabel(course.level)}
      </Chip>
      {course.free && (
        <Chip tone="hashtag" className={smallChip}>
          Free
        </Chip>
      )}
      {!course.language.toLowerCase().startsWith("en") && (
        <Chip tone="neutral" className={cn(smallChip, "gap-1")}>
          <Icon name="globe" size={12} />
          <span className="sr-only">Language: </span>
          {course.languageName}
        </Chip>
      )}
    </div>
  );
}

/**
 * Course card — Figma "Course card" (node 19:94) on real CourseSummary data. The whole card
 * opens our course page (stretched title link); the page has the Charter Center button. The
 * save toggle sits above the link on the thumbnail.
 */
export function CourseTile({ course, headingLevel = 3, eager = false }: { course: CourseSummary; headingLevel?: 2 | 3; eager?: boolean }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group relative flex w-full flex-col overflow-hidden max-sm:flex-row rounded-card border border-line bg-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0px_8px_20px_-8px_rgba(25,37,80,0.18)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary-light">
      <CourseThumbnail course={course} eager={eager} className="h-[140px] shrink-0 max-sm:h-auto max-sm:min-h-[132px] max-sm:w-[104px]" />
      <div className="absolute right-3 top-3 z-10 max-sm:left-2 max-sm:right-auto max-sm:top-2">
        <SaveCourseButton course={course} variant="overlay" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 max-sm:p-3.5">
        <CourseChips course={course} />
        <Heading dir="auto" className="text-md font-medium text-ink">
          <Link
            href={courseHref(course.slug)}
            className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary-light"
          >
            {course.title}
          </Link>
        </Heading>
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {course.durationLabel && (
            <p className="flex items-center gap-1.5 text-xs text-secondary">
              <Icon name="clock" size={14} className="shrink-0" />
              {course.durationLabel}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-body">
            <Icon name="verified" size={14} className="shrink-0 text-accent" />
            {course.provider}
          </p>
        </div>
      </div>
    </article>
  );
}

export function CourseTileSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-card">
      <Bone className="h-[140px] rounded-none max-sm:hidden" />
      <div className="flex flex-col gap-2.5 p-4">
        <Bone className="h-5 w-20 rounded-full" />
        <Bone className="h-4 w-[85%]" />
        <Bone className="h-4 w-[55%]" />
        <Bone className="mt-2 h-3 w-1/2" />
        <Bone className="h-3 w-2/5" />
      </div>
    </div>
  );
}

/** Responsive grid for course tiles. */
export const courseGridClass = "grid grid-cols-4 items-stretch gap-6 max-xl:grid-cols-3 max-lg:grid-cols-2 max-lg:gap-4 max-sm:grid-cols-1";

/** Three-up grid for the featured row. */
export const featuredGridClass = "grid grid-cols-3 items-stretch gap-6 max-lg:grid-cols-2 max-lg:gap-4 max-sm:grid-cols-1";
