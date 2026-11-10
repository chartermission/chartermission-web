import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { OwnProfile } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { ProfileForm } from "@/components/settings/profile-form";
import { ProfileMedia } from "@/components/settings/profile-media";
import { SettingsHeader, SettingsPageSkeleton } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Edit profile") };
}

async function Profile() {
  const viewer = await requireViewer("/settings/profile");
  const result = await settle(Promise.all([apiGet<OwnProfile>("/me/profile"), getTaxonomies()]));
  if (!result.ok) return <LoadError title="Your profile didn’t load" message={result.error.message} />;
  const [profile, taxonomies] = result.data;
  return (
    <>
      <ProfileForm
        profile={profile}
        taxonomies={taxonomies}
        countryGroups={groupCountries(taxonomies.countries)}
        tone={viewer.tone}
      />
      <ProfileMedia profile={profile} />
    </>
  );
}

/** Edit profile (CM-PRF-01, 04, 07). */
export default function ProfileSettingsPage() {
  return (
    <>
      <SettingsHeader
        title="Profile"
        description={
          <>
            What members see about you. Choose who sees each field in{" "}
            <Link href="/settings/privacy" className="font-medium text-primary-light hover:underline">
              Privacy &amp; visibility
            </Link>
            .
          </>
        }
      />
      <Suspense fallback={<SettingsPageSkeleton cards={3} rows={3} />}>
        <Profile />
      </Suspense>
    </>
  );
}
