import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsQuery, type NotificationView, type Page, type UnreadCount } from "@chartermission/contracts";
import { LeftRail } from "@/components/left-rail";
import { NotificationList } from "@/components/notifications/notification-list";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";

export const metadata: Metadata = { title: "Notifications" };

async function NotificationsMain({ searchParams }: { searchParams: PageProps<"/notifications">["searchParams"] }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter = raw === "mentions" ? "mentions" : "all";
  await requireClientViewer("/notifications");
  const result = await settle(
    Promise.all([
      apiGet<Page<NotificationView>>("/notifications", { filter: NotificationsQuery.shape.filter.parse(filter) }),
      apiGet<UnreadCount>("/notifications/unread-count"),
    ]),
  );
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref="/notifications" />;
  const [page, unread] = result.data;
  return <NotificationList key={filter} initial={page} initialFilter={filter} unread={unread.unread} />;
}

/** Notifications (spec 4.13). */
export default function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <h1 className="text-h2 text-ink">Notifications</h1>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading notifications" />
            <PanelSkeleton className="h-11" lines={0} />
            <PanelSkeleton className="h-[480px]" lines={8} />
          </>
        }
      >
        <NotificationsMain searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}
