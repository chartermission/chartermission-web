import { Suspense, type ReactNode } from "react";
import type { UnreadCount } from "@chartermission/contracts";
import { AccountBanners, AccountGate } from "@/components/account/account-notices";
import { TopNav, TopNavBar } from "@/components/top-nav";
import { apiGet, getViewer } from "@/lib/api/server";

/**
 * Reads the session, so it streams in behind the boundary while the page shell renders: the top
 * nav, account banners (unverified, suspended, restricted, deactivated) and the gate that sends
 * members to re-accept policies or finish onboarding.
 */
async function ViewerChrome() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return <TopNavBar viewer={null} pathname={null} />;
  const unread = await apiGet<UnreadCount>("/notifications/unread-count").catch(() => ({ unread: 0 }));
  const account = {
    email: viewer.email,
    emailVerified: viewer.emailVerified,
    status: viewer.status,
    restrictions: viewer.restrictions,
    needsPolicyReaccept: viewer.needsPolicyReaccept,
    onboarding: viewer.onboarding,
    mfa: viewer.mfa,
  };
  return (
    <>
      <TopNav
        viewer={{ name: viewer.name, handle: viewer.handle, avatarUrl: viewer.avatarUrl, tone: viewer.tone }}
        unread={unread.unread}
      />
      <AccountBanners viewer={account} />
      <AccountGate viewer={account} />
    </>
  );
}

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<TopNavBar viewer={null} pathname={null} />}>
        <ViewerChrome />
      </Suspense>
      {children}
    </>
  );
}
