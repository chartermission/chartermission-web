import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AdminGroupsPage, Taxonomies } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { GroupsConsole } from "@/components/groups/groups-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Groups" };

async function Groups() {
  const viewer = await requireViewer("/groups");
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="groups" />;
  let data: [AdminGroupsPage, Taxonomies | null];
  try {
    data = await Promise.all([apiGet<AdminGroupsPage>("/admin/groups", { limit: 50 }), apiGet<Taxonomies>("/taxonomies").catch(() => null)]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Groups couldn’t be loaded."} />;
  }
  return <GroupsConsole initial={data[0]} chapters={data[1]?.chapters ?? []} canManage={can(viewer, PERM.groupsManage)} />;
}

async function SettingsLink() {
  const viewer = await requireViewer("/groups");
  if (!can(viewer, PERM.settingsManage)) return null;
  return (
    <Link href="/settings/network#groups" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
      <Icon name="filter" size={16} />
      Who can create groups
    </Link>
  );
}

/** Groups members, pages and chapters run: suspend, restore, feature, delete, change owner (groups.manage); moderators look. */
export default function GroupsPage() {
  return (
    <>
      <PageHeader
        title="Groups"
        description="Groups members, pages and chapters run. Private groups’ posts are visible to staff here."
        actions={
          <Suspense fallback={null}>
            <SettingsLink />
          </Suspense>
        }
      />
      <Suspense fallback={<SkeletonTable label="Loading groups" rows={6} />}>
        <Groups />
      </Suspense>
    </>
  );
}
