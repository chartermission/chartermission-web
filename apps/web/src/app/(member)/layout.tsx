import { Suspense, type ReactNode } from "react";
import type { UnreadCount } from "@chartermission/contracts";
import { TopNav } from "@/components/top-nav";
import { apiGet, getViewer } from "@/lib/api/server";

/** Reads the session, so it streams in behind the boundary while the page shell renders. */
async function ViewerTopNav() {
  const viewer = await getViewer();
  if (!viewer) return <TopNav viewer={null} />;
  const unread = await apiGet<UnreadCount>("/notifications/unread-count").catch(() => ({ unread: 0 }));
  return (
    <TopNav
      viewer={{ name: viewer.name, handle: viewer.handle, avatarUrl: viewer.avatarUrl, tone: viewer.tone }}
      unread={unread.unread}
    />
  );
}

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<TopNav viewer={null} />}>
        <ViewerTopNav />
      </Suspense>
      {children}
    </>
  );
}
