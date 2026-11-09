import { Suspense, type ReactNode } from "react";
import type { AdminEventRow, Page, QueueStats } from "@chartermission/contracts";
import { AdminBar } from "@/components/shell/admin-bar";
import { AdminSidebar } from "@/components/shell/admin-sidebar";
import { Toaster } from "@/components/toast";
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

/** Sections the admin’s permissions allow, with open-work counts (reports, appeals, events awaiting review). */
async function ViewerSidebar() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.mfa.verifiedThisSession) return <AdminSidebar items={[]} />;
  const [stats, eventQueue] = await Promise.all([
    can(viewer, PERM.moderationView) ? apiGet<QueueStats>("/admin/queue/stats").catch(() => null) : null,
    // The review queue's length (one page of 100 is plenty for a badge).
    can(viewer, PERM.eventReview)
      ? apiGet<Page<AdminEventRow>>("/admin/events", { status: "queue", limit: 100 }).catch(() => null)
      : null,
  ]);
  const counts: Partial<Record<string, number>> = {
    ...(stats ? { moderation: stats.openReports, appeals: stats.openAppeals } : {}),
    ...(eventQueue ? { events: eventQueue.items.length } : {}),
  };
  const items = CONSOLE_NAV.filter((item) => can(viewer, item.permission)).map((item) => ({
    ...item,
    count: counts[item.key],
  }));
  return <AdminSidebar items={items} />;
}

/** Empty sidebar frame shown while the pathname is not yet known. */
function SidebarPlaceholder() {
  return (
    <nav
      aria-label="Console sections"
      className="shrink-0 border-b border-line bg-card px-3 py-2 lg:w-[248px] lg:border-r lg:border-b-0 lg:py-5"
    />
  );
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
        {/* The sidebar reads the pathname, so its loading state also needs a boundary for dynamic routes to prerender. */}
        <Suspense fallback={<SidebarPlaceholder />}>
          <Suspense fallback={<AdminSidebar />}>
            <ViewerSidebar />
          </Suspense>
        </Suspense>
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-10 sm:px-7 sm:pt-7">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
