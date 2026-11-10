import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminBadge, AdminMemberRow, Page } from "@chartermission/contracts";
import { MembersConsole } from "@/components/members/members-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Members" };

async function Members() {
  const viewer = await requireViewer("/members");
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="members" />;
  let data: [Page<AdminMemberRow>, AdminBadge[]];
  try {
    data = await Promise.all([apiGet<Page<AdminMemberRow>>("/admin/members"), apiGet<AdminBadge[]>("/admin/badges")]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Members couldn’t be loaded."} />;
  }
  return <MembersConsole initial={data[0]} badges={data[1]} canManageBadges={can(viewer, PERM.badgesManage)} />;
}

/** Member controls: verified tick, badges and who's suggested to people signing up. */
export default function MembersPage() {
  return (
    <>
      <PageHeader
        title="Members"
        description="Verify members, award badges and choose who is suggested to new members when they sign up. Every change is in the audit log."
      />
      <Suspense fallback={<SkeletonTable label="Loading members" rows={8} />}>
        <Members />
      </Suspense>
    </>
  );
}
