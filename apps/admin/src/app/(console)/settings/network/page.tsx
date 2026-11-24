import { Suspense } from "react";
import type { Metadata } from "next";
import type { GroupsSettings, NetworkSettings } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { GroupsSettingsForm } from "@/components/settings/groups-settings-form";
import { NetworkSettingsForm } from "@/components/settings/network-settings-form";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Network settings" };

async function NetworkSettingsSection() {
  const viewer = await requireViewer("/settings/network");
  if (!can(viewer, PERM.settingsManage)) return <NoAccess section="network settings" />;
  let settings: NetworkSettings | null = null;
  let groups: GroupsSettings | null = null;
  let failure: string | null = null;
  try {
    [settings, groups] = await Promise.all([apiGet<NetworkSettings>("/admin/settings/network"), apiGet<GroupsSettings>("/admin/settings/groups")]);
  } catch (e) {
    failure = e instanceof ApiError ? e.message : "Network settings couldn’t be loaded.";
  }
  if (!settings || !groups) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={failure ?? "Network settings couldn’t be loaded."} />
      </div>
    );
  }
  return (
    <>
      <NetworkSettingsForm initial={settings} />
      <GroupsSettingsForm initial={groups} />
    </>
  );
}

/** Network settings: how many connection requests a member can send a day, and who can create groups (Platform Admins). */
export default function NetworkSettingsPage() {
  return (
    <>
      <PageHeader title="Network settings" description="Limits on how members connect with each other and start groups. Changes are recorded in the audit log." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-card border border-line bg-card" />}>
        <NetworkSettingsSection />
      </Suspense>
    </>
  );
}
