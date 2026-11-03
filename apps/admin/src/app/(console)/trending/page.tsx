import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminTrendingResponse, Taxonomies } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { TrendingConsole, TrendingSkeleton } from "@/components/trending/trending-controls";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";
import { parseTrendingView, trendingSearch } from "@/lib/trending-view";

export const metadata: Metadata = { title: "Trending controls" };

async function Trending({ searchParams }: Pick<PageProps<"/trending">, "searchParams">) {
  const view = parseTrendingView(await searchParams);
  const viewer = await requireViewer(`/trending${trendingSearch(view)}`);
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="trending controls" />;
  const needsScopeId = view.scope !== "global" && !view.scopeId;
  let data: AdminTrendingResponse | null = null;
  let taxonomies: Pick<Taxonomies, "countries" | "chapters">;
  try {
    const [tax, trending] = await Promise.all([
      apiGet<Taxonomies>("/taxonomies"),
      needsScopeId
        ? null
        : apiGet<AdminTrendingResponse>("/admin/trending", {
            scope: view.scope,
            scopeId: view.scopeId,
            window: view.window,
          }),
    ]);
    taxonomies = { countries: tax.countries, chapters: tax.chapters };
    data = trending;
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Trending couldn’t be loaded."} />
      </div>
    );
  }
  return (
    <TrendingConsole
      view={view}
      data={data}
      countries={taxonomies.countries}
      chapters={taxonomies.chapters}
      canManage={can(viewer, PERM.trendingManage)}
      canEditRules={can(viewer, PERM.settingsManage)}
      viewerId={viewer.id}
    />
  );
}

/** Trending controls — Figma "Web / Admin — Trending controls" (node 20:3372). */
export default function TrendingPage(props: PageProps<"/trending">) {
  return (
    <>
      <PageHeader
        title="Trending controls"
        description="Trending is computed on a schedule from how fast a topic’s use is rising against its normal level. Pins and suppressions apply at the next run."
      />
      <Suspense fallback={<TrendingSkeleton />}>
        <Trending searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
