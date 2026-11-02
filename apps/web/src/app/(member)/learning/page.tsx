import type { Metadata } from "next";
import { Chip, Icon, buttonClasses } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { CharterCenterLink } from "@/components/learning/charter-center-link";
import { CourseTile } from "@/components/learning/course-tile";
import { courses, featuredPath, pathUrl } from "@/lib/mock/learning";
import { LearningBrowser } from "./learning-browser";

export const metadata: Metadata = { title: "Learning" };

function FeaturedPath() {
  const percent = Math.round((featuredPath.completed / featuredPath.total) * 100);
  return (
    <section
      aria-labelledby="featured-path-title"
      className="flex items-center gap-8 rounded-2xl bg-gradient-to-r from-primary-dark via-primary via-70% to-accent p-8"
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
        <Chip tone="hashtag">{featuredPath.label}</Chip>
        <h2 id="featured-path-title" className="text-h1 text-inverse">
          {featuredPath.title}
        </h2>
        <p className="text-md text-primary-tint">{featuredPath.summary}</p>
        <div className="flex gap-2.5">
          <CharterCenterLink
            kind="path"
            slug={featuredPath.slug}
            href={pathUrl(featuredPath.slug)}
            className={buttonClasses({ variant: "accent" })}
          >
            Start the path<span aria-hidden="true"> ↗</span>
          </CharterCenterLink>
          <a href="#course-catalogue" className={buttonClasses({ variant: "secondary" })}>
            View courses
          </a>
        </div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col gap-2 rounded-card bg-card p-5">
        <p className="text-sm font-medium text-secondary">Your progress</p>
        <p className="text-h2 text-ink">
          {featuredPath.completed} of {featuredPath.total} courses
        </p>
        <div
          role="progressbar"
          aria-label={`${featuredPath.title} progress`}
          aria-valuenow={featuredPath.completed}
          aria-valuemin={0}
          aria-valuemax={featuredPath.total}
          aria-valuetext={`${featuredPath.completed} of ${featuredPath.total} courses`}
          className="h-2 w-full overflow-hidden rounded bg-muted"
        >
          <div className="h-full rounded bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-secondary">Progress syncs from Charter Center when you’re signed in there.</p>
      </div>
    </section>
  );
}

/** Learning catalogue — Figma "Web / Learning" (node 19:2189). */
export default function LearningPage() {
  return (
    <PageShell>
      <LearningBrowser
        featured={<FeaturedPath />}
        entries={courses.map((course) => ({ course, card: <CourseTile course={course} /> }))}
      />
      <p className="flex items-center gap-2.5 rounded-[10px] bg-info-light p-3.5 text-sm text-body">
        <Icon name="alert" size={18} className="shrink-0 text-info" />
        When you start a course you’ll go to Charter Center. We record that you clicked so we can see which courses
        members find useful — nothing else is shared.
      </p>
    </PageShell>
  );
}
