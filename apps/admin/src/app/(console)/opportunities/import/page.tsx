import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminOpportunityPages, Taxonomies } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ImportFlow } from "@/components/opportunities/import-flow";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonCard } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Import opportunities" };

async function Import() {
  const viewer = await requireViewer("/opportunities/import");
  if (!can(viewer, PERM.opportunityManage)) return <NoAccess section="opportunities" />;
  let data: [AdminOpportunityPages, Taxonomies];
  try {
    data = await Promise.all([apiGet<AdminOpportunityPages>("/admin/opportunities/pages"), apiGet<Taxonomies>("/taxonomies")]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="opportunities" />;
    return <LoadError message={e instanceof ApiError ? e.message : "The import couldn’t be loaded."} />;
  }
  const [pages, taxonomies] = data;
  return <ImportFlow pages={pages.items} sectors={taxonomies.sectors} countries={taxonomies.countries} />;
}

/** Opportunities shared as text in WhatsApp groups and forums: paste, let Claude write a CSV, review, post. */
export default function ImportOpportunitiesPage() {
  return (
    <>
      <Link href="/opportunities" className="flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        All opportunities
      </Link>
      <PageHeader
        title="Import opportunities from text"
        description="Turn opportunities shared in WhatsApp groups and forums into listings: paste the messages, let Claude put them in a CSV, review the rows and post them."
      />
      <Suspense fallback={<SkeletonCard lines={6} />}>
        <Import />
      </Suspense>
    </>
  );
}
