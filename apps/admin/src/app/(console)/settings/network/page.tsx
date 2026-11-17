import { Suspense } from "react";
import type { Metadata } from "next";
import type { NetworkSettings } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
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
  let failure: string | null = null;
  try {
    settings = await apiGet<NetworkSettings>("/admin/settings/network");
  } catch (e) {
    failure = e instanceof ApiError ? e.message : "Network settings couldn’t be loaded.";
  }
  if (!settings) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={failure ?? "Network settings couldn’t be loaded."} />
      </div>
    );
  }
  return <NetworkSettingsForm initial={settings} />;
}

/** Network settings: how many connection requests a member can send a day (Platform Admins). */
export default function NetworkSettingsPage() {
  return (
    <>
      <PageHeader title="Network settings" description="Limits on how members connect with each other. Changes are recorded in the audit log." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-card border border-line bg-card" />}>
        <NetworkSettingsSection />
      </Suspense>
    </>
  );
}
