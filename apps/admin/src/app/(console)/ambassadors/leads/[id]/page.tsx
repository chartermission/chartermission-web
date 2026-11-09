import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminLeadDetail, CountryRef, Taxonomies, TeamMember } from "@chartermission/contracts";
import { LeadDetailView } from "@/components/ambassadors/lead-detail";
import { SkeletonCard } from "@/components/skeletons";
import { EmptyState, ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Ambassador lead" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="users" title="Lead not found">
        It may belong to a country you don’t manage. <a href="/ambassadors" className="text-primary hover:underline">Back to all leads</a>
      </EmptyState>
    </div>
  );
}

async function Lead({ params }: Pick<PageProps<"/ambassadors/leads/[id]">, "params">) {
  const { id } = await params;
  const viewer = await requireViewer(`/ambassadors/leads/${id}`);
  if (!can(viewer, PERM.ambassadorManage)) return <NoAccess section="the ambassador pipeline" />;
  if (!UUID.test(id)) return <NotFound />;
  let data: [AdminLeadDetail | null, TeamMember[], Taxonomies];
  try {
    data = await Promise.all([
      apiGetOrNull<AdminLeadDetail>(`/admin/ambassadors/leads/${id}`),
      apiGet<TeamMember[]>("/admin/ambassadors/team"),
      apiGet<Taxonomies>("/taxonomies"),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="the ambassador pipeline" />;
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "This lead couldn’t be loaded."} />
      </div>
    );
  }
  const [lead, team, taxonomies] = data;
  if (!lead) return <NotFound />;
  const countries: CountryRef[] = taxonomies.countries.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  return <LeadDetailView key={lead.id} initial={lead} team={team} countries={countries} />;
}

/** One ambassador lead: pipeline, scoring, onboarding checklist and certification. */
export default function LeadPage(props: PageProps<"/ambassadors/leads/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-5">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={8} />
        </div>
      }
    >
      <Lead params={props.params} />
    </Suspense>
  );
}
