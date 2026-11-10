import type { Metadata } from "next";
import { Suspense } from "react";
import type { FollowView, OwnProfile, Page } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { AccountOverview } from "@/components/settings/account-overview";
import { FollowedTopics } from "@/components/settings/followed-topics";
import { SettingsHeader, SettingsPageSkeleton } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Account settings") };
}

async function AccountSections() {
  const viewer = await requireViewer("/settings");
  const own = await apiGet<OwnProfile>("/me/profile").catch(() => null);
  let topics: Page<FollowView> | null = null;
  try {
    topics = await apiGet<Page<FollowView>>("/me/follows", { type: "hashtag", limit: 50 });
  } catch {
    topics = null;
  }
  return (
    <>
      <AccountOverview
        email={viewer.email}
        emailVerified={viewer.emailVerified}
        status={viewer.status}
        handle={own?.handle ?? viewer.handle}
        handleChangeAvailableAt={own?.handleChangeAvailableAt ?? null}
        mfaEnabled={viewer.mfa.enabled}
      />
      {topics ? <FollowedTopics initial={topics} /> : <LoadError title="Your followed topics didn’t load" />}
    </>
  );
}

export default function AccountSettingsPage() {
  return (
    <>
      <SettingsHeader title="Account" description="Your sign-in email, account status and the topics you follow." />
      <Suspense fallback={<SettingsPageSkeleton cards={2} rows={3} />}>
        <AccountSections />
      </Suspense>
    </>
  );
}
