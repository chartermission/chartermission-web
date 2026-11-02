"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Chip, Panel } from "@chartermission/ui";
import { SearchField, ToggleChip } from "@/components/discover/filter-controls";
import { PageHeader } from "@/components/discover/page-shell";
import { courseCategories, type Course } from "@/lib/mock/learning";

/** A course plus its server-rendered card. */
export type CourseEntry = { course: Course; card: ReactNode };

type Category = (typeof courseCategories)[number]["value"];

/** Header search, featured path slot, category chips and course grid for /learning. */
export function LearningBrowser({ entries, featured }: { entries: CourseEntry[]; featured: ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(({ course }) => {
      if (category !== "all" && !course.categories.includes(category)) return false;
      if (q && ![course.title, course.level, course.provider].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, query, category]);

  return (
    <>
      <PageHeader
        title="Learning"
        adornment={<Chip tone="hashtag">Curated from Charter Center</Chip>}
        description="Short, practical courses picked for members. Courses open on Charter Center."
        actions={
          <div role="search" className="w-[360px] max-w-full">
            <SearchField label="Search courses" placeholder="Search courses" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        }
      />

      {featured}

      <section id="course-catalogue" aria-labelledby="course-catalogue-heading" className="flex scroll-mt-24 flex-col gap-5">
        <h2 id="course-catalogue-heading" className="sr-only">
          Course catalogue
        </h2>
        <div role="group" aria-label="Filter by topic" className="flex flex-wrap gap-2">
          {courseCategories.map((item) => (
            <ToggleChip key={item.value} active={category === item.value} onClick={() => setCategory(item.value)}>
              {item.label}
            </ToggleChip>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {results.length} course{results.length === 1 ? "" : "s"}
        </p>
        {results.length > 0 ? (
          <ul className="grid grid-cols-3 items-start gap-6 xl:grid-cols-4">
            {results.map((entry) => (
              <li key={entry.course.slug} className="flex">
                {entry.card}
              </li>
            ))}
          </ul>
        ) : (
          <Panel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-md font-medium text-ink">No courses match</p>
            <p className="text-sm text-secondary">Try a different topic or search term.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
              className="text-sm font-medium text-primary-light hover:underline"
            >
              Show all courses
            </button>
          </Panel>
        )}
      </section>
    </>
  );
}
