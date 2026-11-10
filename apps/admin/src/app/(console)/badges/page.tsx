import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminBadge } from "@chartermission/contracts";
import { BadgesConsole } from "@/components/members/badges-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Badges" };

async function Badges() {
  const viewer = await requireViewer("/badges");
  if (!can(viewer, PERM.badgesManage)) return <NoAccess section="badges" />;
  let rows: AdminBadge[];
  try {
    rows = await apiGet<AdminBadge[]>("/admin/badges");
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Badges couldn’t be loaded."} />;
  }
  return <BadgesConsole initial={rows} />;
}

/** Profile badge catalogue; award badges from Members. */
export default function BadgesPage() {
  return (
    <>
      <PageHeader
        title="Badges"
        description="Badges appear on member profiles. Create them here, then award them from Members. Turning a badge off hides it everywhere without taking it away."
      />
      <Suspense fallback={<SkeletonTable label="Loading badges" rows={6} />}>
        <Badges />
      </Suspense>
    </>
  );
}
