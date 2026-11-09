import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { ApplicationsPage, OpportunityDetail } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ApplicantsView } from "@/components/opportunities/applicants-view";
import { requireClientViewer } from "@/components/social/data";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";

export const metadata: Metadata = { title: "Applicants" };

async function Applicants({ params }: Pick<PageProps<"/opportunities/[slug]/applicants">, "params">) {
  const { slug } = await params;
  await requireClientViewer(`/opportunities/${slug}/applicants`);
  const o = await apiGetOrNull<OpportunityDetail>(`/opportunities/${encodeURIComponent(slug)}`);
  if (!o) notFound();
  if (!o.viewer.canManage) redirect(`/opportunities/${o.slug}`);
  const initial = await apiGet<ApplicationsPage>(`/opportunities/${o.id}/applications`);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-ink max-sm:text-h2">Applicants</h1>
        <p className="text-md text-secondary">
          <Link href={`/opportunities/${o.slug}`} className="hover:underline">
            {o.title}
          </Link>{" "}
          · {o.organisation}
        </p>
      </header>
      <ApplicantsView opportunityId={o.id} title={o.title} initial={initial} />
    </>
  );
}

/** The poster reviews applicants: profile, note, shortlist, accept or decline. */
export default function ApplicantsPage({ params }: PageProps<"/opportunities/[slug]/applicants">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-6 pb-12 pt-6 max-sm:px-3">
      <Link href="/opportunities/mine" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        My opportunities
      </Link>
      <Suspense fallback={<PanelSkeleton className="h-[480px]" lines={8} />}>
        <Applicants params={params} />
      </Suspense>
    </main>
  );
}
