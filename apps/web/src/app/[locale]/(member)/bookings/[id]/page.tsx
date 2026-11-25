import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { BookingView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { BookingRow } from "@/components/services/bookings-view";
import { requireClientViewer } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Booking") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Booking({ params }: { params: PageProps<"/[locale]/bookings/[id]">["params"] }) {
  const { id } = await params;
  await requireClientViewer(`/bookings/${id}`);
  if (!UUID.test(id)) notFound();
  const booking = await apiGetOrNull<BookingView>(`/bookings/${id}`);
  if (!booking) notFound();
  return (
    <Panel className="overflow-hidden">
      <BookingRow booking={booking} />
    </Panel>
  );
}

/** One booking (GET /bookings/{id}), for links from notifications and reminders. */
export default function BookingPage({ params }: PageProps<"/[locale]/bookings/[id]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pb-12 pt-8 max-sm:gap-4 max-sm:px-3 max-sm:pt-5">
      <Link href="/bookings" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        All bookings
      </Link>
      <h1 className="text-h1 text-ink max-sm:text-h2">Booking</h1>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the booking" />
            <PanelSkeleton className="h-[200px]" lines={4} />
          </>
        }
      >
        <Booking params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
