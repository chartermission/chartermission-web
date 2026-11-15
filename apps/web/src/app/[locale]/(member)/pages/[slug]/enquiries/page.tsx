import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { EnquiriesQuery, EnquiryView, Page, PageDetail } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { PageEnquiries } from "@/components/pages/page-enquiries";
import { toPageRef } from "@/components/pages/page-ref";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { NoTranslate } from "@/i18n/auto";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/pages/[slug]/enquiries">;

const STATUSES: EnquiriesQuery["status"][] = ["new", "replied", "closed", "all"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Enquiries") };
}

async function Enquiries({ params, searchParams }: Props) {
  const { slug } = await params;
  const asked = (await searchParams).status;
  const status = STATUSES.find((s) => s === asked) ?? "new";
  await requireViewer(`/pages/${slug}/enquiries`);
  const page = /^[a-z0-9-]{3,60}$/.test(slug) ? await apiGetOrNull<PageDetail>(`/pages/${slug}`) : null;
  if (!page) notFound();
  if (!page.viewer.canEdit) redirect(`/pages/${page.slug}`);
  const list = await settle(apiGet<Page<EnquiryView>>(`/pages/${page.slug}/enquiries`, { status, limit: 20 }));

  return (
    <>
      <Link href={`/pages/${page.slug}`} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
        <NoTranslate>{page.name}</NoTranslate>
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Enquiries</h1>
        <p className="text-md text-secondary">Messages members send the page about its products and services. Your reply goes to them in Messages.</p>
      </header>
      {list.ok ? (
        <PageEnquiries page={toPageRef(page)} initial={list.data} initialStatus={status} />
      ) : (
        <SectionError message={errorMessage(list.error)} retryHref={`/pages/${page.slug}/enquiries`} />
      )}
    </>
  );
}

/** A page's enquiries, for its admins. */
export default function EnquiriesPage({ params, searchParams }: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading enquiries" />
            <PanelSkeleton lines={4} />
            <PanelSkeleton lines={4} />
          </>
        }
      >
        <Enquiries params={params} searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </main>
  );
}
