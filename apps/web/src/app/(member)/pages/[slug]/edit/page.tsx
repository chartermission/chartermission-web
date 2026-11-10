import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { PageDetail, VerificationStatus } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { PageAdmins } from "@/components/pages/page-admins";
import { PageForm } from "@/components/pages/page-form";
import { VerificationPanel } from "@/components/pages/verification-panel";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";

export const metadata: Metadata = { title: "Manage page" };

type Params = PageProps<"/pages/[slug]/edit">["params"];

async function Manage({ params }: { params: Params }) {
  const { slug } = await params;
  const viewer = await requireViewer(`/pages/${slug}/edit`);
  const page = /^[a-z0-9-]{3,60}$/.test(slug) ? await apiGetOrNull<PageDetail>(`/pages/${slug}`) : null;
  if (!page) notFound();
  if (!page.viewer.canEdit) redirect(`/pages/${page.slug}`);
  const [taxonomies, verification] = await Promise.all([getTaxonomies(), apiGet<VerificationStatus>(`/pages/${page.slug}/verification`).catch(() => null)]);
  return (
    <>
      <Link href={`/pages/${page.slug}`} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        {page.name}
      </Link>
      <Panel className="flex flex-col gap-5 p-6 max-sm:p-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 text-ink">Manage {page.name}</h1>
          <p className="text-sm text-secondary">
            The page’s address is chartermission.com/pages/{page.slug} and stays the same when you rename it.
          </p>
        </div>
        <PageForm page={page} countries={groupCountries(taxonomies.countries)} />
      </Panel>

      <Panel id="verification" className="flex scroll-mt-24 flex-col gap-4 p-6 max-sm:p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-ink">Verification</h2>
          <p className="text-sm text-secondary">A verified tick tells members this is the organisation’s official page.</p>
        </div>
        {verification ? (
          <VerificationPanel endpoint={`/pages/${page.slug}/verification`} initial={verification} subject="page" defaultName={page.name} />
        ) : (
          <p className="text-sm text-secondary">Verification couldn’t load. Refresh to try again.</p>
        )}
      </Panel>

      <Panel id="admins" className="flex scroll-mt-24 flex-col gap-4 p-6 max-sm:p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-ink">Admins</h2>
          <p className="text-sm text-secondary">Admins can edit the page and post as it. Posts show the page’s name, not the admin’s.</p>
        </div>
        <PageAdmins page={page} viewerId={viewer.id} />
      </Panel>
    </>
  );
}

export default function ManagePage({ params }: PageProps<"/pages/[slug]/edit">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the page" />
            <PanelSkeleton className="h-[560px]" lines={8} />
          </>
        }
      >
        <Manage params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
