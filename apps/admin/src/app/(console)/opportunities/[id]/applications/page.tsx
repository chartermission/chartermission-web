import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminApplicationsPage, AdminOpportunityRow } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ApplicationsConsole } from "@/components/opportunities/applications-console";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState, LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Applications" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Missing({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="briefcase" title={title}>
        {children ?? (
          <Link href="/opportunities" className="text-primary hover:underline">
            Back to all opportunities
          </Link>
        )}
      </EmptyState>
    </div>
  );
}

async function Applications({ params }: Pick<PageProps<"/opportunities/[id]/applications">, "params">) {
  const { id } = await params;
  const viewer = await requireViewer(`/opportunities/${id}/applications`);
  if (!can(viewer, PERM.opportunityManage)) return <NoAccess section="opportunities" />;
  if (!UUID.test(id)) return <Missing title="Opportunity not found" />;
  let listing: AdminOpportunityRow | null;
  let page: AdminApplicationsPage | null = null;
  try {
    listing = await apiGetOrNull<AdminOpportunityRow>(`/admin/opportunities/${id}`);
    if (listing?.source === "import") page = await apiGet<AdminApplicationsPage>(`/admin/opportunities/${id}/applications`, { limit: 50 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="opportunities" />;
    return <LoadError message={e instanceof ApiError ? e.message : "The applications couldn’t be loaded."} />;
  }
  if (!listing) return <Missing title="Opportunity not found" />;
  if (!page) {
    return (
      <Missing title="Reviewed by the member who posted it">
        Applications to members’ own listings are reviewed by their poster on the member site.
      </Missing>
    );
  }
  return <ApplicationsConsole key={listing.id} listing={listing} initial={page} />;
}

/** Applications to an imported opportunity: review, shortlist, accept or decline, and export as CSV. */
export default function OpportunityApplicationsPage(props: PageProps<"/opportunities/[id]/applications">) {
  return (
    <>
      <Link href="/opportunities" className="flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        All opportunities
      </Link>
      <Suspense fallback={<SkeletonTable label="Loading applications" rows={5} />}>
        <Applications params={props.params} />
      </Suspense>
    </>
  );
}
