import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminCourseView, AmbassadorTrainingView, CountryRef, ManagerView, Page, Taxonomies } from "@chartermission/contracts";
import { TeamWorkspace } from "@/components/ambassadors/team-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Ambassador team" };

/** Visible catalogue courses to choose the required training from (small catalogue: a few pages). */
async function visibleCourses(): Promise<AdminCourseView[]> {
  const items: AdminCourseView[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const page: Page<AdminCourseView> = await apiGet<Page<AdminCourseView>>("/admin/courses", { status: "visible", limit: 100, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items;
}

async function Team() {
  const viewer = await requireViewer("/ambassadors/team");
  if (!can(viewer, PERM.ambassadorManagers)) return <NoAccess section="ambassador team settings" />;
  let data: [ManagerView[], Taxonomies, AmbassadorTrainingView, AdminCourseView[] | null];
  try {
    data = await Promise.all([
      apiGet<ManagerView[]>("/admin/ambassadors/managers"),
      apiGet<Taxonomies>("/taxonomies"),
      apiGet<AmbassadorTrainingView>("/admin/ambassadors/training"),
      can(viewer, PERM.courseCurate) ? visibleCourses() : Promise.resolve(null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="ambassador team settings" />;
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The ambassador team couldn’t be loaded."} />
      </div>
    );
  }
  const [managers, taxonomies, training, catalogue] = data;
  const countries: CountryRef[] = taxonomies.countries.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  return <TeamWorkspace initialManagers={managers} countries={countries} training={training} catalogue={catalogue} viewerId={viewer.id} />;
}

/** Manager sub-accounts (who can run the pipeline, for which countries) and the required training. */
export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Ambassador team"
        description="Give managers access to create ambassador leads and onboard them for their countries, and choose the Charter Center courses every new Ambassador completes."
      />
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <SkeletonTable label="Loading managers" rows={4} />
            <SkeletonCard lines={4} />
          </div>
        }
      >
        <Team />
      </Suspense>
    </>
  );
}
