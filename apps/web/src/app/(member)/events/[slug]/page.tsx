import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import type { EventDetail, EventHostOptions } from "@chartermission/contracts";
import { Chip, Icon } from "@chartermission/ui";
import { EventCover, EventGridCard } from "@/components/events/event-cards";
import { EventDateBadge, FormatChip, HostLine } from "@/components/events/event-meta";
import { AgendaTimeline, SectionPanel, SpeakersGrid, WhereBlock } from "@/components/events/event-sections";
import { HostStatusBanner, HostTools } from "@/components/events/host-tools";
import { RegistrationPanel } from "@/components/events/registration-panel";
import { requireClientViewer } from "@/components/social/data";
import { Markdown } from "@/components/social/post-types/markdown";
import { Bone, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";

type Params = PageProps<"/events/[slug]">["params"];

const SLUG = /^[A-Za-z0-9-]{1,120}$/;

/** GET /events/:idOrSlug, deduplicated per request (metadata + page). */
const getEvent = cache(async (slug: string): Promise<EventDetail | null> => {
  if (!SLUG.test(slug)) return null;
  return apiGetOrNull<EventDetail>(`/events/${slug}`);
});

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug).catch(() => null);
  if (!event) return { title: "Event" };
  return {
    title: event.title,
    description: event.summary,
    // No og:image: media is only served to signed-in members, so link previews couldn't load the cover anyway.
    openGraph: { type: "website", title: event.title, description: event.summary },
  };
}

async function EventMain({ params }: { params: Params }) {
  const { slug } = await params;
  await requireClientViewer(`/events/${slug}`);
  const event = await getEvent(slug);
  if (!event) notFound();
  const [hostOptions, taxonomies] = await Promise.all([
    event.viewer.canManage ? apiGet<EventHostOptions>("/events/host-options").catch(() => null) : Promise.resolve(null),
    getTaxonomies().catch(() => null),
  ]);
  const canPublishDirectly = hostOptions?.canPublishDirectly ?? false;
  const countryName = event.venue ? (taxonomies?.countries.find((c) => c.code === event.venue!.countryCode)?.name ?? event.venue.countryCode) : null;
  const description = event.description.trim();
  const related = (event.related ?? []).filter((e) => e.id !== event.id);

  return (
    <>
      <HostStatusBanner event={event} canPublishDirectly={canPublishDirectly} />
      {event.cancelledAt && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-error/30 bg-error-light px-5 py-4">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-error" />
          <div className="flex flex-col gap-0.5">
            <p className="text-md font-semibold text-ink">This event was cancelled</p>
            {event.cancelReason && <p className="text-sm text-body">{event.cancelReason}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-x-6 gap-y-5 max-lg:grid-cols-1">
        <header className="flex flex-col gap-5">
          <EventCover event={event} className={`rounded-card ${event.coverUrl ? "aspect-[40/21]" : "aspect-[3/1] max-sm:aspect-[2/1]"} ${event.cancelledAt || event.past ? "grayscale-[50%]" : ""}`}>
            <div className="flex w-full items-start p-6 max-sm:p-4">
              <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} size="large" className="shadow-[0px_8px_24px_0px_rgba(0,0,0,0.18)] max-sm:hidden" />
              <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} className="sm:hidden" />
            </div>
          </EventCover>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {event.featured && <Chip tone="hashtag">Featured</Chip>}
              <FormatChip format={event.format} />
              {event.category && (
                <Link href={`/events?category=${event.category.slug}`} className="rounded-full">
                  <Chip tone="neutral" className="hover:bg-line">
                    {event.category.name}
                  </Chip>
                </Link>
              )}
              {event.past && <Chip tone="neutral">Past event</Chip>}
            </div>
            <h1 className="text-h1 text-ink max-sm:text-h2">{event.title}</h1>
            <p className="text-md text-body">{event.summary}</p>
            <HostLine host={event.host} size={40} className="text-sm" />
          </div>
        </header>

        <div className="flex flex-col gap-4 lg:row-span-2">
          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <RegistrationPanel key={`${event.viewer.status}-${event.registeredCount}-${event.waitlistCount}-${event.updatedAt}`} event={event} />
            <HostTools event={event} canPublishDirectly={canPublishDirectly} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <SectionPanel id="about-heading" title="About this event">
            {description ? <Markdown text={description} headingOffset={1} /> : <p className="text-md text-secondary">The host hasn’t added a description yet.</p>}
          </SectionPanel>
          {event.speakers.length > 0 && (
            <SectionPanel id="speakers-heading" title={event.speakers.length === 1 ? "Speaker" : "Speakers"}>
              <SpeakersGrid speakers={event.speakers} />
            </SectionPanel>
          )}
          {event.agenda.length > 0 && (
            <SectionPanel id="agenda-heading" title="Agenda">
              <AgendaTimeline agenda={event.agenda} timezone={event.timezone} />
            </SectionPanel>
          )}
          {(event.venue || event.online) && (
            <SectionPanel id="where-heading" title="Where">
              <WhereBlock event={event} countryName={countryName} />
            </SectionPanel>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-4 flex flex-col gap-4 border-t border-line pt-8">
          <h2 id="related-heading" className="text-h2 text-ink max-sm:text-h3">
            More events like this
          </h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {related.slice(0, 3).map((item) => (
              <li key={item.id} className="flex">
                <EventGridCard event={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function EventSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_360px] gap-6 max-lg:grid-cols-1">
      <div className="flex flex-col gap-5">
        <Bone className="aspect-[21/8] w-full rounded-card" />
        <Bone className="h-6 w-40 rounded-full" />
        <Bone className="h-10 w-4/5" />
        <Bone className="h-5 w-3/5" />
        <PanelSkeleton className="h-[240px]" lines={5} />
      </div>
      <PanelSkeleton className="h-[380px]" lines={6} />
    </div>
  );
}

/** Event page: details, registration (all states), host tools. */
export default function EventPage({ params }: PageProps<"/events/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[1256px] flex-col gap-5 px-6 pb-16 pt-6 max-sm:gap-4 max-sm:px-3 max-sm:pt-4">
      <Link href="/events" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        All events
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading event" />
            <EventSkeleton />
          </>
        }
      >
        <EventMain params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}
