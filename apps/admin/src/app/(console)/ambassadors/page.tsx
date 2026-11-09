import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminLeadsPage, TeamMember } from "@chartermission/contracts";
import { LeadsWorkspace, LeadsWorkspaceSkeleton } from "@/components/ambassadors/leads-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { leadsApiQuery, leadsSearch, parseLeadsView } from "@/lib/ambassadors";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Ambassadors" };

async function Leads({ searchParams }: Pick<PageProps<"/ambassadors">, "searchParams">) {
  const view = parseLeadsView(await searchParams);
  const viewer = await requireViewer(`/ambassadors${leadsSearch(view)}`);
  if (!can(viewer, PERM.ambassadorManage)) return <NoAccess section="the ambassador pipeline" />;
  let data: [AdminLeadsPage, TeamMember[]];
  try {
    data = await Promise.all([apiGet<AdminLeadsPage>("/admin/ambassadors/leads", leadsApiQuery(view)), apiGet<TeamMember[]>("/admin/ambassadors/team")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="the ambassador pipeline" />;
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The ambassador leads couldn’t be loaded."} />
      </div>
    );
  }
  const [page, team] = data;
  return <LeadsWorkspace key={leadsSearch(view)} view={view} page={page} team={team} />;
}

/** Ambassador programme: leads, qualification pipeline and onboarding, scoped to the manager's countries. */
export default function AmbassadorsPage(props: PageProps<"/ambassadors">) {
  return (
    <>
      <PageHeader
        title="Ambassadors"
        description="Leads for country Ambassadors, from first contact through qualification and onboarding to certification. You see the countries you manage."
      />
      <Suspense fallback={<LeadsWorkspaceSkeleton />}>
        <Leads searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
