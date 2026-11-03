import { Suspense, type ReactNode } from "react";
import type { QueueStats } from "@chartermission/contracts";
import { AdminBar } from "@/components/shell/admin-bar";
import { AdminSidebar } from "@/components/shell/admin-sidebar";
import { apiGet, getViewer } from "@/lib/api/server";
import { CONSOLE_NAV, PERM, can, roleLabel } from "@/lib/permissions";

/** Reads the session, so it streams in behind the boundary while the shell renders. */
async function ViewerAdminBar() {
  const viewer = await getViewer().catch(() => null);
  return (
    <AdminBar
      viewer={
        viewer
          ? { name: viewer.name, role: roleLabel(viewer.roles), avatarUrl: viewer.avatarUrl, tone: viewer.tone }
          : null
      }
    />
  );
}

/** Sections the admin's permissions allow, with open-work counts from the queue stats. */
async function ViewerSidebar() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.mfa.verifiedThisSession) return <AdminSidebar items={[]} />;
  const stats = can(viewer, PERM.moderationView)
    ? await apiGet<QueueStats>("/admin/queue/stats").catch(() => null)
    : null;
  const counts: Partial<Record<string, number>> = stats
    ? { moderation: stats.openReports, appeals: stats.openAppeals }
    : {};
  const items = CONSOLE_NAV.filter((item) => can(viewer, item.permission)).map((item) => ({
    ...item,
    count: counts[item.key],
  }));
  return <AdminSidebar items={items} />;
}

/** Admin console shell: admin bar over sidebar + main column (Figma nodes 12:1547 / 12:1569). */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Suspense fallback={<AdminBar />}>
        <ViewerAdminBar />
      </Suspense>
      <div className="flex flex-1 flex-col items-stretch lg:flex-row">
        <Suspense fallback={<AdminSidebar />}>
          <ViewerSidebar />
        </Suspense>
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-10 sm:px-7 sm:pt-7">
          {children}
        </main>
      </div>
    </div>
  );
}
