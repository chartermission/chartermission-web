import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { BookingView, ManagedPage, Page } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { PageHeader } from "@/components/discover/page-shell";
import { BookingsView, type BookingsRole, type BookingsWhen } from "@/components/services/bookings-view";
import { requireClientViewer, settle } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Bookings") };
}

type SearchParams = PageProps<"/[locale]/bookings">["searchParams"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Main({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireClientViewer("/bookings");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const role: BookingsRole = one(params.role) === "host" ? "host" : "booker";
  const rawWhen = one(params.when);
  const when: BookingsWhen = rawWhen === "past" || rawWhen === "cancelled" ? rawWhen : "upcoming";
  const rawPage = one(params.page);
  const pageId = role === "host" && rawPage && UUID.test(rawPage) ? rawPage : null;
  const [first, pages] = await Promise.all([
    settle(apiGet<Page<BookingView>>("/bookings", { role, when, pageId, limit: 20 })),
    apiGet<ManagedPage[]>("/me/pages").catch(() => [] as ManagedPage[]),
  ]);
  return (
    <BookingsView
      initial={first.ok ? first.data : null}
      error={first.ok ? null : first.error}
      role={role}
      when={when}
      pageId={pageId}
      pages={pages.filter((p) => p.status !== "rejected").map((p) => ({ id: p.id, name: p.name }))}
      viewerHandle={viewer.handle}
    />
  );
}

/** Free consultations the member booked, and ones booked with them or with a page they manage. */
export default function BookingsPage({ searchParams }: PageProps<"/[locale]/bookings">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 pb-12 pt-8 max-sm:gap-4 max-sm:px-3 max-sm:pt-5">
      <PageHeader
        title="Bookings"
        description="Free consultations you’ve booked, and the ones people booked with you."
        actions={
          <Link href="/settings/availability" className={buttonClasses({ variant: "secondary", className: "max-sm:hidden" })}>
            <Icon name="clock" size={18} />
            Availability
          </Link>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading your bookings" />
            <PanelSkeleton className="h-[320px]" lines={6} />
          </>
        }
      >
        <Main searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </main>
  );
}
