import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { EventDetail } from "@chartermission/contracts";
import { buttonClasses } from "@chartermission/ui";
import { EventFormLoader, FormShell } from "@/components/events/form-page";
import { canEditEvent } from "@/components/events/rules";
import { EmptyState, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Edit event" };

async function EditMain({ params }: { params: PageProps<"/[locale]/events/[slug]/edit">["params"] }) {
  const { slug } = await params;
  await requireViewer(`/events/${slug}/edit`);
  const event = /^[A-Za-z0-9-]{1,120}$/.test(slug) ? await apiGetOrNull<EventDetail>(`/events/${slug}`) : null;
  if (!event || !event.viewer.canManage) notFound();
  if (!canEditEvent(event)) {
    return (
      <EmptyState
        icon="calendar"
        title={event.cancelledAt ? "Cancelled events can’t be edited" : "Past events can’t be edited"}
        actions={
          <Link href={`/events/${event.slug}`} className={buttonClasses({ variant: "secondary", size: "small" })}>
            Back to the event
          </Link>
        }
      >
        The page stays as it was for the record.
      </EmptyState>
    );
  }
  return <EventFormLoader mode="edit" event={event} next={`/events/${slug}/edit`} />;
}

export default function EditEventPage({ params }: PageProps<"/[locale]/events/[slug]/edit">) {
  return (
    <FormShell back={{ href: "/events/mine?role=hosting", label: "My events" }} title="Edit event" description="Changes to a published event go live straight away.">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the event" />
            <PanelSkeleton className="h-[420px]" lines={6} />
          </>
        }
      >
        <EditMain params={params} />
      </Suspense>
      <Toaster />
    </FormShell>
  );
}
