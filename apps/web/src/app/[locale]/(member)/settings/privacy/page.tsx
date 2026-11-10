import type { Metadata } from "next";
import { Suspense } from "react";
import type { OwnProfile } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { PrivacySettingsForm } from "@/components/settings/privacy-settings-form";
import { SettingsHeader, SettingsPageSkeleton } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Privacy & visibility settings") };
}

async function PrivacyData() {
  const viewer = await requireViewer("/settings/privacy");
  const result = await settle(Promise.all([apiGet<OwnProfile>("/me/profile"), getTaxonomies()]));
  if (!result.ok) return <LoadError title="Your privacy settings didn’t load" message={result.error.message} />;
  const [profile, taxonomies] = result.data;
  const country = taxonomies.countries.find((c) => c.code === profile.countryCode);
  return <PrivacySettingsForm profile={profile} email={viewer.email} countryName={country?.name ?? null} />;
}

/** Settings — Figma "Web / Settings — privacy & notifications" (node 20:3056, body 20:3109). */
export default function PrivacySettingsPage() {
  return (
    <>
      <SettingsHeader
        title="Privacy & visibility"
        description="You decide who sees each part of your profile. The platform enforces these settings everywhere — profile, search and the API."
      />
      <Suspense fallback={<SettingsPageSkeleton cards={3} rows={4} />}>
        <PrivacyData />
      </Suspense>
    </>
  );
}
