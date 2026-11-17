import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { MessagingSettingsView } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { MessagingSettingsForm } from "@/components/messages/messaging-settings-form";
import { PageHeader } from "@/components/shell/page-header";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Messaging settings" };

async function MessagingSettingsSection() {
  const viewer = await requireViewer("/settings/messaging");
  const canEdit = can(viewer, PERM.settingsManage);
  if (!can(viewer, PERM.membersMessage) && !canEdit) return <NoAccess section="messaging settings" />;
  let settings: MessagingSettingsView;
  try {
    settings = await apiGet<MessagingSettingsView>("/admin/settings/messaging");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="messaging settings" />;
    return <LoadError message={e instanceof ApiError ? e.message : "Messaging settings couldn’t be loaded."} />;
  }
  return <MessagingSettingsForm initial={settings} canEdit={canEdit} />;
}

/** The official account Charter Mission's bulk messages and inbox replies come from. */
export default function MessagingSettingsPage() {
  return (
    <>
      <nav aria-label="Breadcrumb" className="-mb-2 text-sm">
        <Link href="/messages" className="inline-flex items-center gap-1 text-secondary hover:text-ink">
          <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
          Messages
        </Link>
      </nav>
      <PageHeader title="Messaging settings" description="The account members see Charter Mission’s messages come from." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-card border border-line bg-card" />}>
        <MessagingSettingsSection />
      </Suspense>
    </>
  );
}
