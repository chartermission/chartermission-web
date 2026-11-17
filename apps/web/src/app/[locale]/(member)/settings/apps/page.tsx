import type { Metadata } from "next";
import { Suspense } from "react";
import type { ConnectedAppsView, McpActivityView, Page } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { ClaudeAccessOff, ConnectedApps } from "@/components/settings/connected-apps";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Connected apps") };
}

async function Apps() {
  const view = await settle(apiGet<ConnectedAppsView>("/me/connected-apps"));
  if (!view.ok) return <LoadError title="Your connected apps didn’t load" message={view.error.message} />;
  if (!view.data.mcpAccess) return <ClaudeAccessOff />;
  const activity = await settle(apiGet<Page<McpActivityView>>("/me/connected-apps/activity", { limit: 20 }));
  return <ConnectedApps initial={view.data.apps} activity={activity.ok ? activity.data : null} activityError={activity.ok ? null : activity.error.message} />;
}

/** Claude (MCP) connections to the member's account: how to connect, disconnect, and what Claude did. */
export default function ConnectedAppsSettingsPage() {
  return (
    <>
      <SettingsHeader title="Connected apps" description="Apps you’ve allowed to use your Charter Mission account, and what they did." />
      <Suspense fallback={<SettingsCardSkeleton rows={3} />}>
        <Apps />
      </Suspense>
    </>
  );
}
