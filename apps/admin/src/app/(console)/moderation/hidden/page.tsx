import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminHiddenRow, Page } from "@chartermission/contracts";
import { HiddenList, HiddenListSkeleton, type HiddenType } from "@/components/hidden/hidden-list";
import { ModerationStats } from "@/components/moderation/moderation-stats";
import { ModerationTabs } from "@/components/moderation/moderation-tabs";
import { StatCardsSkeleton } from "@/components/moderation/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Hidden content" };

async function Hidden({ searchParams }: Pick<PageProps<"/moderation/hidden">, "searchParams">) {
  const params = await searchParams;
  const type: HiddenType = params.type === "post" || params.type === "comment" ? params.type : "all";
  const viewer = await requireViewer(`/moderation/hidden${type === "all" ? "" : `?type=${type}`}`);
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="hidden content" />;
  let page: Page<AdminHiddenRow>;
  try {
    page = await apiGet<Page<AdminHiddenRow>>("/admin/hidden", { targetType: type === "all" ? undefined : type, limit: 25 });
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Hidden content couldn’t be loaded."} />
      </div>
    );
  }
  return (
    <HiddenList
      key={type}
      type={type}
      initialRows={page.items}
      initialCursor={page.nextCursor}
      viewerId={viewer.id}
      canAct={can(viewer, PERM.moderationAct)}
    />
  );
}

/** Posts and comments that moderators hid or removed, with restore. */
export default function HiddenContentPage(props: PageProps<"/moderation/hidden">) {
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from members, grouped by the content they’re about. Every action is written to the audit log."
      />
      <Suspense fallback={<StatCardsSkeleton />}>
        <ModerationStats next="/moderation/hidden" />
      </Suspense>
      <ModerationTabs active="hidden" />
      <Suspense fallback={<HiddenListSkeleton />}>
        <Hidden searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
