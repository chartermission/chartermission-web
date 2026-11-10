import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { EventSummary, Page } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { PageHeader } from "@/components/discover/page-shell";
import { MyEvents, type MyRole, type MyWhen } from "@/components/events/my-events";
import { requireClientViewer, settle } from "@/components/social/data";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { can } from "@/components/social/viewer";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("My events") };
}

type SearchParams = PageProps<"/[locale]/events/mine">["searchParams"];

async function Main({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireClientViewer("/events/mine");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const role: MyRole = one(params.role) === "hosting" ? "hosting" : "registered";
  const rawWhen = one(params.when);
  const when: MyWhen = rawWhen === "past" ? "past" : rawWhen === "all" && role === "hosting" ? "all" : "upcoming";
  const first = await settle(apiGet<Page<EventSummary>>("/me/events", { role, when, limit: 20 }));
  return <MyEvents initial={first.ok ? first.data : null} error={first.ok ? null : first.error} role={role} when={when} canHost={can(viewer, "event.create")} />;
}

async function HostAction() {
  const viewer = await requireClientViewer("/events/mine");
  if (!can(viewer, "event.create")) return null;
  return (
    <Link href="/events/new" className={buttonClasses({ variant: "accent" })}>
      <Icon name="plus" size={18} />
      Host an event
    </Link>
  );
}

/** Events the member registered for or hosts. */
export default function MyEventsPage({ searchParams }: PageProps<"/[locale]/events/mine">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 pb-12 pt-8 max-sm:gap-4 max-sm:px-3 max-sm:pt-5">
      <Link href="/events" className="-mb-2 flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        All events
      </Link>
      <PageHeader
        title="My events"
        description="Events you’ve registered for and events you host."
        actions={
          <Suspense fallback={null}>
            <HostAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading your events" />
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
