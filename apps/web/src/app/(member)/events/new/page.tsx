import type { Metadata } from "next";
import { Suspense } from "react";
import { EventFormLoader, FormShell } from "@/components/events/form-page";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";

export const metadata: Metadata = { title: "Host an event" };

/** Host flow: create an event (draft → submit for review or publish). */
export default function NewEventPage() {
  return (
    <FormShell back={{ href: "/events", label: "All events" }} title="Host an event" description="Save a draft any time. Events are reviewed by the Charter Mission team before they’re listed.">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the event form" />
            <PanelSkeleton className="h-[420px]" lines={6} />
            <PanelSkeleton className="h-[260px]" lines={4} />
          </>
        }
      >
        <EventFormLoader mode="create" next="/events/new" />
      </Suspense>
      <Toaster />
    </FormShell>
  );
}
