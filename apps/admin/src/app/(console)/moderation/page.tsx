import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { AdminReportDetail, AdminReportRow, Page } from "@chartermission/contracts";
import { ModerationStats } from "@/components/moderation/moderation-stats";
import { ModerationTabs } from "@/components/moderation/moderation-tabs";
import { ModerationWorkspace, ModerationWorkspaceSkeleton } from "@/components/moderation/moderation-workspace";
import { StatCardsSkeleton } from "@/components/moderation/stat-card";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { PERM, can, landingPath } from "@/lib/permissions";
import { filtersKey, parseQueueFilters, queueApiQuery, queueSearch } from "@/lib/queue-filters";

export const metadata: Metadata = { title: "Moderation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Report queue and the selected case, both from the URL (filters + ?report=). */
async function ReportsQueue({ searchParams }: Pick<PageProps<"/moderation">, "searchParams">) {
  const params = await searchParams;
  const filters = parseQueueFilters(params);
  const requested = typeof params.report === "string" && UUID.test(params.report) ? params.report : null;
  const viewer = await requireViewer(`/moderation${queueSearch(filters, requested)}`);
  if (!can(viewer, PERM.moderationView)) {
    // The console's default page: send staff without moderation access to their own section.
    const home = landingPath(viewer);
    if (home !== "/moderation") redirect(home);
    return <NoAccess section="the moderation queue" />;
  }

  let page: Page<AdminReportRow>;
  let detail: AdminReportDetail | null = null;
  let detailError: string | null = null;
  try {
    const [list, requestedDetail] = await Promise.all([
      apiGet<Page<AdminReportRow>>("/admin/reports", queueApiQuery(filters)),
      requested
        ? apiGetOrNull<AdminReportDetail>(`/admin/reports/${requested}`).catch((e: unknown): ApiError => {
            if (e instanceof ApiError) return e;
            throw e;
          })
        : null,
    ]);
    page = list;
    if (requestedDetail instanceof ApiError) detailError = requestedDetail.message;
    else detail = requestedDetail;
    if (!requested && page.items[0]) {
      detail = await apiGetOrNull<AdminReportDetail>(`/admin/reports/${page.items[0].id}`).catch(() => null);
    }
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The moderation queue couldn’t be loaded."} />
      </div>
    );
  }

  return (
    <ModerationWorkspace
      key={filtersKey(filters)}
      filters={filters}
      initialRows={page.items}
      initialCursor={page.nextCursor}
      selectedId={requested ?? detail?.id ?? null}
      detail={detail}
      detailError={detailError ?? (requested && !detail ? "That report was not found." : null)}
      viewerId={viewer.id}
      canAct={can(viewer, PERM.moderationAct)}
    />
  );
}

/** Moderation queue — Figma "Web / Admin — Moderation queue" (node 12:1546). */
export default function ModerationPage(props: PageProps<"/moderation">) {
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from members, grouped by the content they’re about. Every action is written to the audit log."
      />
      <Suspense fallback={<StatCardsSkeleton />}>
        <ModerationStats next="/moderation" />
      </Suspense>
      <ModerationTabs active="reports" />
      <Suspense fallback={<ModerationWorkspaceSkeleton />}>
        <ReportsQueue searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
