import { Suspense, cache } from "react";
import type { Metadata } from "next";
import type { AdminBadge, AdminMembersPage } from "@chartermission/contracts";
import { MembersConsole, MembersTotal } from "@/components/members/members-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Members" };

/** The first page with its counts; the header and the list share one request. */
const firstPage = cache(() => apiGet<AdminMembersPage>("/admin/members"));

/** "12,345 members" beside the title: every account except deleted ones. */
async function HeaderTotal() {
  const viewer = await requireViewer("/members");
  if (!can(viewer, PERM.membersManage)) return null;
  const page = await firstPage().catch(() => null);
  return page?.counts ? <MembersTotal count={page.counts.all} /> : null;
}

async function Members() {
  const viewer = await requireViewer("/members");
  if (!can(viewer, PERM.membersManage)) return <NoAccess section="members" />;
  let data: [AdminMembersPage, AdminBadge[]];
  try {
    data = await Promise.all([firstPage(), apiGet<AdminBadge[]>("/admin/badges")]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Members couldn’t be loaded."} />;
  }
  return (
    <MembersConsole
      initial={data[0]}
      badges={data[1]}
      canManageBadges={can(viewer, PERM.badgesManage)}
      access={{ viewerId: viewer.id, canManageRoles: can(viewer, PERM.rolesManage), canAssignSuperAdmin: can(viewer, PERM.superadminAssign), canMessage: can(viewer, PERM.membersMessage) }}
    />
  );
}

/** Member controls: verified tick, badges and who's suggested to people signing up. */
export default function MembersPage() {
  return (
    <>
      <PageHeader
        title="Members"
        description="Verify members, award badges, give team access (moderator, admin) and choose who is suggested to new members when they sign up. Every change is in the audit log."
        actions={
          <Suspense fallback={null}>
            <HeaderTotal />
          </Suspense>
        }
      />
      <Suspense fallback={<SkeletonTable label="Loading members" rows={8} />}>
        <Members />
      </Suspense>
    </>
  );
}
