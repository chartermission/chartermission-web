import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { EventDetail } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { EventWhen, FormatChip, LifecycleChip } from "@/components/events/event-meta";
import { RegistrationsView } from "@/components/events/registrations-view";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Registrations") };
}

async function RegistrationsMain({ params }: { params: PageProps<"/[locale]/events/[slug]/registrations">["params"] }) {
  const { slug } = await params;
  await requireViewer(`/events/${slug}/registrations`);
  const event = /^[A-Za-z0-9-]{1,120}$/.test(slug) ? await apiGetOrNull<EventDetail>(`/events/${slug}`) : null;
  if (!event || !event.viewer.canManage) notFound();
  return (
    <>
      <Link href={`/events/${event.slug}`} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Back to the event
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FormatChip format={event.format} />
          {event.status !== "published" && <LifecycleChip status={event.status} />}
          {event.cancelledAt && <span className="text-sm font-medium text-error">Cancelled</span>}
        </div>
        <h1 className="text-h1 text-ink max-sm:text-h2">Registrations</h1>
        <p className="text-md text-secondary">
          <Link href={`/events/${event.slug}`} className="font-medium text-ink hover:underline">
            {event.title}
          </Link>{" "}
          · <EventWhen startsAt={event.startsAt} timezone={event.timezone} />
        </p>
      </header>
      {event.registrationMode === "external" ? (
        <p className="text-md text-body">This event uses external registration, so the list lives on the host’s site.</p>
      ) : (
        <RegistrationsView event={event} />
      )}
    </>
  );
}

/** Host / admin list of an event's registrations. */
export default function RegistrationsPage({ params }: PageProps<"/[locale]/events/[slug]/registrations">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 pb-16 pt-6 max-sm:gap-4 max-sm:px-3 max-sm:pt-4">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading registrations" />
            <PanelSkeleton className="h-[120px]" lines={2} />
            <PanelSkeleton className="h-[360px]" lines={6} />
          </>
        }
      >
        <RegistrationsMain params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
