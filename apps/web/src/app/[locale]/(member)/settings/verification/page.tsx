import type { Metadata } from "next";
import { Suspense } from "react";
import type { VerificationStatus } from "@chartermission/contracts";
import { VerificationPanel } from "@/components/pages/verification-panel";
import { SettingsCard, SettingsHeader } from "@/components/settings/settings-card";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Verification" };

async function Verification() {
  const viewer = await requireViewer("/settings/verification");
  const status = await settle(apiGet<VerificationStatus>("/me/verification"));
  if (!status.ok) return <SectionError message={errorMessage(status.error)} retryHref="/settings/verification" />;
  return (
    <SettingsCard id="verified-badge" title="Verified badge" description="Free, and reviewed by the Charter Mission team." list={false}>
      <VerificationPanel endpoint="/me/verification" initial={status.data} subject="member" defaultName={viewer.name} />
    </SettingsCard>
  );
}

export default function VerificationSettingsPage() {
  return (
    <>
      <SettingsHeader title="Verification" description="The tick beside your name tells members your profile really is you." />
      <Suspense fallback={<PanelSkeleton className="h-[420px]" lines={6} />}>
        <Verification />
      </Suspense>
    </>
  );
}
