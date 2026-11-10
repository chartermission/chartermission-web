import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { EventCategory, EventSummary, Page } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { EventGridCardSkeleton } from "@/components/events/event-cards";
import { EVENTS_PAGE, apiFilters, parseEventFilters } from "@/components/events/filters";
import { MiniCalendar } from "@/components/events/mini-calendar";
import { RailEventList } from "@/components/events/rail-events";
import { can } from "@/components/social/viewer";
import { requireClientViewer, settle } from "@/components/social/data";
import { Bone, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { EventsBrowser, MyEventsLink, type FilterOptions } from "./events-browser";

export const metadata: Metadata = {
  title: "Events",
  description: "Online, in-person and hybrid events from Charter Mission members, chapters and partner organisations.",
};

/** "Your registrations": the viewer's next registered or waitlisted events. */
async function Registrations() {
  const mine = await apiGet<Page<EventSummary>>("/me/events", { role: "registered", when: "upcoming", limit: 5 }).catch(() => null);
  const events = (mine?.items ?? []).filter((e) => e.viewer.status === "registered" || e.viewer.status === "waitlisted");
  return (
    <Panel aria-labelledby="rail-registrations" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 id="rail-registrations" className="text-h3 text-ink">
          Your registrations
        </h2>
        <Link href="/events/mine" className="text-xs text-primary-light hover:underline">
          My events
        </Link>
      </div>
      {events.length ? (
        <RailEventList events={events} checks />
      ) : (
        <p className="text-sm text-secondary">Events you register for appear here, with reminders a day and an hour before they start.</p>
      )}
    </Panel>
  );
}

function EventsRail() {
  return (
    <aside aria-label="Calendar and registrations" className="flex w-72 shrink-0 flex-col gap-4 max-lg:hidden xl:w-80">
      <MiniCalendar />
      <Suspense fallback={<PanelSkeleton className="h-[180px]" lines={3} />}>
        <Registrations />
      </Suspense>
    </aside>
  );
}

async function HeaderActions() {
  const viewer = await requireClientViewer("/events");
  return (
    <>
      <MyEventsLink />
      {can(viewer, "event.create") && (
        <Link href="/events/new" className={buttonClasses({ variant: "accent", className: "max-sm:px-3" })}>
          <Icon name="plus" size={18} />
          <span className="max-sm:sr-only">Host an event</span>
        </Link>
      )}
    </>
  );
}

async function EventsMain({ searchParams }: { searchParams: PageProps<"/[locale]/events">["searchParams"] }) {
  await requireClientViewer("/events");
  const filters = parseEventFilters(await searchParams);
  const [first, featured, categories, taxonomies] = await Promise.all([
    filters.view === "list"
      ? settle(apiGet<Page<EventSummary>>("/events", { when: filters.when, ...apiFilters(filters), limit: EVENTS_PAGE }))
      : Promise.resolve({ ok: true as const, data: { items: [], nextCursor: null } }),
    apiGet<Page<EventSummary>>("/events", { featured: true, limit: 1 }).catch(() => null),
    apiGet<EventCategory[]>("/events/categories").catch(() => []),
    getTaxonomies().catch(() => null),
  ]);
  const collator = new Intl.Collator("en");
  const options: FilterOptions = {
    categories,
    countries: (taxonomies?.countries ?? []).map((c) => ({ value: c.code, label: c.name })).sort((a, b) => collator.compare(a.label, b.label)),
    chapters: (taxonomies?.chapters ?? []).map((c) => ({ value: c.slug, label: c.name })).sort((a, b) => collator.compare(a.label, b.label)),
  };
  return (
    <EventsBrowser
      filters={filters}
      initial={first.ok ? first.data : null}
      error={first.ok ? null : first.error}
      featured={featured?.items[0] ?? null}
      options={options}
      rail={<EventsRail />}
    />
  );
}

function BrowserSkeleton() {
  return (
    <>
      <LoadingStatus label="Loading events" />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Bone className="h-8 w-48" />
        <Bone className="h-9 w-full max-w-3xl" />
      </div>
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Bone className="h-[260px] w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <EventGridCardSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="flex w-72 shrink-0 flex-col gap-4 max-lg:hidden xl:w-80">
          <PanelSkeleton className="h-[340px]" lines={6} />
          <PanelSkeleton className="h-[160px]" lines={3} />
        </div>
      </div>
    </>
  );
}

/** Events — Figma "Web / Events" (node 10:1242), on GET /events and /events/calendar. */
export default function EventsPage({ searchParams }: PageProps<"/[locale]/events">) {
  return (
    <PageShell className="max-sm:gap-4 max-sm:px-3 max-sm:pt-5">
      <PageHeader
        title="Events"
        description="Online, in-person and hybrid events from members, chapters and partner organisations."
        actions={
          <Suspense fallback={<span className="h-11 w-60" />}>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense fallback={<BrowserSkeleton />}>
        <EventsMain searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
