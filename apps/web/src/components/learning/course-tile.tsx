import { Chip, Icon, buttonClasses } from "@chartermission/ui";
import { courseLevels, courseUrl, type Course } from "@/lib/mock/learning";
import { CharterCenterLink } from "./charter-center-link";

/**
 * Course card — Figma "Course card" (node 19:94) as used on /learning.
 * App-local because the shared CourseCard has a fixed thumbnail gradient and
 * book icon, while the catalogue varies both per course, and its link cannot
 * record the click the design discloses.
 */
export function CourseTile({ course }: { course: Course }) {
  const [from, to] = course.gradient;
  return (
    <article className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-card">
      <div
        className="flex h-[140px] items-center justify-center p-4 text-inverse"
        style={{ backgroundImage: `linear-gradient(146.5deg, ${from} 0%, ${to} 71.43%)` }}
      >
        <Icon name={course.icon} size={36} />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <Chip tone={courseLevels[course.level]} className="self-start">
          {course.level}
        </Chip>
        <h3 className="text-md font-medium text-ink">{course.title}</h3>
        <p className="flex items-center gap-1.5 text-xs text-secondary">
          <Icon name="clock" size={14} className="shrink-0" />
          {course.duration}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-body">
          <Icon name="verified" size={14} className="shrink-0 text-accent" />
          {course.provider}
        </p>
        <CharterCenterLink
          kind="course"
          slug={course.slug}
          href={courseUrl(course.slug)}
          className={buttonClasses({ variant: "secondary", size: "small", block: true })}
        >
          Start learning<span aria-hidden="true"> ↗</span>
          <span className="sr-only">: {course.title}</span>
        </CharterCenterLink>
      </div>
    </article>
  );
}
