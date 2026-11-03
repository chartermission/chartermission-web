import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminAppealRow, Page } from "@chartermission/contracts";
import { AppealsWorkspace, AppealsSkeleton, type AppealsTab } from "@/components/appeals/appeals-workspace";
import { ModerationStats } from "@/components/moderation/moderation-stats";
import { ModerationTabs } from "@/components/moderation/moderation-tabs";
import { StatCardsSkeleton } from "@/components/moderation/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Appeals" };

async function Appeals({ searchParams }: Pick<PageProps<"/appeals">, "searchParams">) {
  const params = await searchParams;
  const tab: AppealsTab = params.status === "decided" ? "decided" : "open";
  const selected = typeof params.appeal === "string" ? params.appeal : null;
  const viewer = await requireViewer(`/appeals${tab === "decided" ? "?status=decided" : ""}`);
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="appeals" />;
  let page: Page<AdminAppealRow>;
  try {
    page = await apiGet<Page<AdminAppealRow>>("/admin/appeals", { status: tab, limit: 50 });
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Appeals couldn’t be loaded."} />
      </div>
    );
  }
  return (
    <AppealsWorkspace
      key={tab}
      tab={tab}
      initialRows={page.items}
      initialCursor={page.nextCursor}
      initialSelected={selected}
      viewerId={viewer.id}
      canDecidePermission={can(viewer, PERM.appealDecide)}
    />
  );
}

/** Appeals against moderation actions; decided by a different moderator (CM-ADM-06). */
export default function AppealsPage(props: PageProps<"/appeals">) {
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from members, grouped by the content they’re about. Every action is written to the audit log."
      />
      <Suspense fallback={<StatCardsSkeleton />}>
        <ModerationStats next="/appeals" />
      </Suspense>
      <ModerationTabs active="appeals" />
      <Suspense fallback={<AppealsSkeleton />}>
        <Appeals searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
