import type { Metadata } from "next";
import { Suspense } from "react";
import type { ConsentRecordView } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { ConsentHistory, DataActions } from "@/components/settings/your-data";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Your data") };
}

async function Consents() {
  const result = await settle(apiGet<ConsentRecordView[]>("/me/consents"));
  if (!result.ok) return <LoadError title="Your consent history didn’t load" message={result.error.message} />;
  return <ConsentHistory consents={result.data} />;
}

async function Actions() {
  const viewer = await requireViewer("/settings/data");
  return <DataActions status={viewer.status} />;
}

/** Your data: consent history, export, deactivate and deletion (CM-AUTH-06, CM-AUTH-08, spec 8.3). */
export default function DataSettingsPage() {
  return (
    <>
      <SettingsHeader title="Your data" description="See what you agreed to, take a copy of your data, or close your account." />
      <Suspense fallback={<SettingsCardSkeleton rows={2} />}>
        <Actions />
      </Suspense>
      <Suspense fallback={<SettingsCardSkeleton rows={3} />}>
        <Consents />
      </Suspense>
    </>
  );
}
