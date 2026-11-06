import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminCourseView, Page, SyncRunView } from "@chartermission/contracts";
import { CoursesWorkspace, CoursesWorkspaceSkeleton } from "@/components/courses/courses-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Courses" };

/** The catalogue is small (tens to a few hundred courses): load it whole and filter in the browser. */
const MAX_PAGES = 10;

async function allCourses(): Promise<{ items: AdminCourseView[]; truncated: boolean }> {
  const items: AdminCourseView[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page: Page<AdminCourseView> = await apiGet<Page<AdminCourseView>>("/admin/courses", { status: "all", limit: 100, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: true };
}

async function Courses() {
  const viewer = await requireViewer("/courses");
  if (!can(viewer, PERM.courseCurate)) return <NoAccess section="course curation" />;
  let data: [Awaited<ReturnType<typeof allCourses>>, Page<SyncRunView>];
  try {
    data = await Promise.all([allCourses(), apiGet<Page<SyncRunView>>("/admin/learning/sync-runs", { limit: 20 })]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="course curation" />;
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The course catalogue couldn’t be loaded."} />
      </div>
    );
  }
  const [courses, runs] = data;
  return <CoursesWorkspace courses={courses.items} truncated={courses.truncated} runs={runs.items} />;
}

/** Learning catalogue curation (spec 4.10): hide / feature, link status and Charter Center sync. */
export default function CoursesPage() {
  return (
    <>
      <PageHeader
        title="Courses"
        description="The Learning catalogue, synced from Charter Center every 6 hours. Curate what members see here; course content is edited on Charter Center."
      />
      <Suspense fallback={<CoursesWorkspaceSkeleton />}>
        <Courses />
      </Suspense>
    </>
  );
}
