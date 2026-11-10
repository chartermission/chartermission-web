import type { Metadata } from "next";
import { Suspense } from "react";
import type { MyModerationAction, MyReport, Page } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { ModerationActions, MyReports } from "@/components/settings/moderation-history";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Moderation & reports" };

async function Actions() {
  const result = await settle(apiGet<MyModerationAction[]>("/me/moderation-actions"));
  if (!result.ok) return <LoadError title="Actions on your account didn’t load" message={result.error.message} />;
  return <ModerationActions actions={result.data} />;
}

async function Reports() {
  const result = await settle(apiGet<Page<MyReport>>("/me/reports", { limit: 20 }));
  if (!result.ok) return <LoadError title="Your reports didn’t load" message={result.error.message} />;
  return <MyReports initial={result.data} />;
}

/** The member's own moderation history and reports (spec 4.15); linked from banners and notifications. */
export default function ModerationSettingsPage() {
  return (
    <>
      <SettingsHeader
        title="Moderation & reports"
        description="Decisions about your account or content, how to appeal them, and the status of reports you made."
      />
      <Suspense fallback={<SettingsCardSkeleton rows={2} />}>
        <Actions />
      </Suspense>
      <Suspense fallback={<SettingsCardSkeleton rows={3} />}>
        <Reports />
      </Suspense>
    </>
  );
}
