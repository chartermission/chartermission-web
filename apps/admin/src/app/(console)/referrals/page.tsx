import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminReferrals } from "@chartermission/contracts";
import { ReferralsConsole } from "@/components/referrals/referrals-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState, ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";
import { parseReferralFilters, referralsApiQuery, referralsSearch } from "@/lib/referral-filters";

export const metadata: Metadata = { title: "Referrals" };

async function Referrals({ searchParams }: Pick<PageProps<"/referrals">, "searchParams">) {
  const filters = parseReferralFilters(await searchParams);
  const viewer = await requireViewer(`/referrals${referralsSearch(filters)}`);
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="referrals" />;
  let data: AdminReferrals;
  try {
    data = await apiGet<AdminReferrals>("/admin/referrals", referralsApiQuery(filters));
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Referrals couldn’t be loaded."} />
      </div>
    );
  }
  if (!data.stats.total) {
    return (
      <div className="rounded-card border border-line bg-card">
        <EmptyState icon="user-plus" title="No one has joined through an invitation yet">
          When someone signs up with a member’s invitation link, it shows here.
        </EmptyState>
      </div>
    );
  }
  return <ReferralsConsole filters={filters} data={data} />;
}

/** Who invited whom: every member who joined through an invitation link. */
export default function ReferralsPage(props: PageProps<"/referrals">) {
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Members who joined through someone’s invitation link (personal, chapter or event), and who brought the most people."
      />
      <Suspense fallback={<SkeletonTable label="Loading referrals" rows={8} />}>
        <Referrals searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
