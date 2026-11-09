import { Suspense } from "react";
import type { Metadata } from "next";
import type { MediaSettings } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { MediaSettingsForm } from "@/components/settings/media-settings-form";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Media settings" };

async function MediaSettingsSection() {
  const viewer = await requireViewer("/settings/media");
  if (!can(viewer, PERM.settingsManage)) return <NoAccess section="media settings" />;
  let settings: MediaSettings | null = null;
  let failure: string | null = null;
  try {
    settings = await apiGet<MediaSettings>("/admin/settings/media");
  } catch (e) {
    failure = e instanceof ApiError ? e.message : "Media settings couldn’t be loaded.";
  }
  if (!settings) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={failure ?? "Media settings couldn’t be loaded."} />
      </div>
    );
  }
  return <MediaSettingsForm initial={settings} />;
}

/** Media settings: video length limits for feed posts and stories (Platform Admins). */
export default function MediaSettingsPage() {
  return (
    <>
      <PageHeader title="Media settings" description="Limits for videos members upload to posts and stories. Changes are recorded in the audit log." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-card border border-line bg-card" />}>
        <MediaSettingsSection />
      </Suspense>
    </>
  );
}
