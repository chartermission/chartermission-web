import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { AvailabilityView, PageDetail } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { AvailabilityEditor } from "@/components/services/availability-editor";
import { settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import { NoTranslate } from "@/i18n/auto";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/pages/[slug]/availability">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Availability") };
}

async function Availability({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  await requireViewer(`/pages/${slug}/availability`);
  const page = /^[a-z0-9-]{3,60}$/.test(slug) ? await apiGetOrNull<PageDetail>(`/pages/${slug}`) : null;
  if (!page) notFound();
  if (!page.viewer.canEdit) redirect(`/pages/${page.slug}`);
  const availability = await settle(apiGet<AvailabilityView>("/availability", { host: "page", pageId: page.id }));

  return (
    <>
      <Link href={`/pages/${page.slug}#services`} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        <NoTranslate>{page.name}</NoTranslate>
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Availability</h1>
        <p className="text-md text-secondary">The hours when members can book the page’s consultations. Every admin of the page shares them.</p>
      </header>
      {availability.ok ? (
        <AvailabilityEditor host={{ type: "page", pageId: page.id }} initial={availability.data} />
      ) : (
        <SectionError message={errorMessage(availability.error)} retryHref={`/pages/${page.slug}/availability`} />
      )}
    </>
  );
}

/** When members can book a page's consultations, for its admins. */
export default function AvailabilityPage({ params }: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading availability" />
            <PanelSkeleton className="h-[420px]" lines={6} />
          </>
        }
      >
        <Availability params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
