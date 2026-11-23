import { Suspense } from "react";
import type { Metadata } from "next";
import type { ProfileOptionsList, ProfileOptionsSummary } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { ProfileOptionsConsole } from "@/components/profile-options/profile-options-console";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Profile options" };

async function ProfileOptions() {
  const viewer = await requireViewer("/settings/profile-options");
  if (!can(viewer, PERM.settingsManage)) return <NoAccess section="profile options" />;
  let summary: ProfileOptionsSummary;
  let first: ProfileOptionsList;
  try {
    [summary, first] = await Promise.all([
      apiGet<ProfileOptionsSummary>("/admin/profile-options"),
      apiGet<ProfileOptionsList>("/admin/profile-options/skills"),
    ]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Profile options couldn’t be loaded."} />;
  }
  return <ProfileOptionsConsole summary={summary} initial={first} />;
}

/** Profile options: the lists members pick on their profile and hosts pick for events (Platform Admins). */
export default function ProfileOptionsPage() {
  return (
    <>
      <PageHeader
        title="Profile options"
        description="The skills, sectors, interests and languages members pick on their profile, and the categories hosts pick for events. Changes apply straight away."
      />
      <Suspense fallback={<SkeletonTable label="Loading profile options" rows={8} />}>
        <ProfileOptions />
      </Suspense>
    </>
  );
}
