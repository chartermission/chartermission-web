import type { Metadata } from "next";
import { Suspense } from "react";
import { MAX_DRAFTS, type DraftView, type Page } from "@chartermission/contracts";
import { DraftsView, type DraftsTab } from "@/components/drafts/drafts-view";
import { LeftRail } from "@/components/left-rail";
import { PageColumns } from "@/components/page-columns";
import { RightRail } from "@/components/right-rail";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Drafts") };
}

type SearchParams = PageProps<"/[locale]/drafts">["searchParams"];

async function DraftsMain({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: DraftsTab = raw === "scheduled" ? "scheduled" : "drafts";
  const viewer = await requireClientViewer(tab === "scheduled" ? "/drafts?tab=scheduled" : "/drafts");
  // A member has at most MAX_DRAFTS in all, so one page of each status gives exact tab counts.
  const result = await settle(
    Promise.all([
      apiGet<Page<DraftView>>("/me/drafts", { status: tab === "drafts" ? "draft" : "scheduled", limit: 20 }),
      apiGet<Page<DraftView>>("/me/drafts", { status: "draft", limit: MAX_DRAFTS }),
      apiGet<Page<DraftView>>("/me/drafts", { status: "scheduled", limit: MAX_DRAFTS }),
    ]),
  );
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref={tab === "scheduled" ? "/drafts?tab=scheduled" : "/drafts"} />;
  const [page, drafts, scheduled] = result.data;
  return <DraftsView key={tab} tab={tab} initial={page} counts={{ drafts: drafts.items.length, scheduled: scheduled.items.length }} viewer={viewer} />;
}

/** Drafts and scheduled posts (GET /me/drafts). The scheduled-post-failed notification links to ?tab=scheduled. */
export default function DraftsPage({ searchParams }: PageProps<"/[locale]/drafts">) {
  return (
    <PageColumns left={<LeftRail />} right={<RightRail />}>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Drafts</h1>
        <p className="text-sm text-secondary">Posts you’ve started and posts set to publish later. Only you can see them.</p>
      </div>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading your drafts" />
            <PanelSkeleton className="h-11 w-[240px]" lines={0} />
            <PanelSkeleton className="h-[180px]" lines={2} />
            <PanelSkeleton className="h-[180px]" lines={2} />
          </>
        }
      >
        <DraftsMain searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}
