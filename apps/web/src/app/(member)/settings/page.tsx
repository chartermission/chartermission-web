import type { Metadata } from "next";
import { Suspense } from "react";
import type { FollowView, Page } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { AccountOverview } from "@/components/settings/account-overview";
import { FollowedTopics } from "@/components/settings/followed-topics";
import { SettingsHeader, SettingsPageSkeleton } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Account settings" };

async function AccountSections() {
  const viewer = await requireViewer("/settings");
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
        handle={viewer.handle}
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
