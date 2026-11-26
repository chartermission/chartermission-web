import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminOpportunitiesPage } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { OpportunitiesConsole } from "@/components/opportunities/opportunities-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Opportunities" };

async function Opportunities() {
  const viewer = await requireViewer("/opportunities");
  if (!can(viewer, PERM.opportunityManage)) return <NoAccess section="opportunities" />;
  let data: AdminOpportunitiesPage;
  try {
    data = await apiGet<AdminOpportunitiesPage>("/admin/opportunities", { limit: 50 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="opportunities" />;
    return <LoadError message={e instanceof ApiError ? e.message : "Opportunities couldn’t be loaded."} />;
  }
  return <OpportunitiesConsole initial={data} />;
}

/** Every opportunity members post and staff import: close, reopen, remove; and the way into the import from text. */
export default function OpportunitiesPage() {
  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Jobs, fellowships, grants and other openings members post, and the ones you bring in from WhatsApp groups and forums."
        actions={
          <Link href="/opportunities/import" className={buttonClasses({ variant: "primary", size: "small" })}>
            <Icon name="plus" size={16} />
            Import from text
          </Link>
        }
      />
      <Suspense fallback={<SkeletonTable label="Loading opportunities" rows={6} />}>
        <Opportunities />
      </Suspense>
    </>
  );
}
