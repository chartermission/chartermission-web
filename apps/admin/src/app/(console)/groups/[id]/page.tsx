import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminGroupDetail } from "@chartermission/contracts";
import { GroupDetailView } from "@/components/groups/group-detail";
import { SkeletonCard } from "@/components/skeletons";
import { EmptyState, LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Group" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="users" title="Group not found">
        <Link href="/groups" className="text-primary hover:underline">
          Back to all groups
        </Link>
      </EmptyState>
    </div>
  );
}

async function Group({ params }: Pick<PageProps<"/groups/[id]">, "params">) {
  const { id } = await params;
  const viewer = await requireViewer(`/groups/${id}`);
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="groups" />;
  if (!UUID.test(id)) return <NotFound />;
  let group: AdminGroupDetail | null;
  try {
    group = await apiGetOrNull<AdminGroupDetail>(`/admin/groups/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="groups" />;
    return <LoadError message={e instanceof ApiError ? e.message : "This group couldn’t be loaded."} />;
  }
  if (!group) return <NotFound />;
  return (
    <GroupDetailView
      key={group.id}
      initial={group}
      canManage={can(viewer, PERM.groupsManage)}
      canExport={can(viewer, PERM.groupsManage) || can(viewer, PERM.membersManage)}
    />
  );
}

/** One group: summary, settings, admins, members, recent posts (private ones marked), reports and history. */
export default function GroupPage(props: PageProps<"/groups/[id]">) {
  return (
    <Suspense fallback={<SkeletonCard lines={10} />}>
      <Group params={props.params} />
    </Suspense>
  );
}
