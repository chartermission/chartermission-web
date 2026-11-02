import type { Metadata } from "next";
import Link from "next/link";
import { Icon, Panel, buttonClasses } from "@chartermission/ui";
import { formatWeekdayDayMonth } from "@/components/discover/dates";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { EventGridCard, FeaturedEvent } from "@/components/events/event-cards";
import { events, eventsToday, type CharterEvent } from "@/lib/mock/events";
import { EventsBrowser } from "./events-browser";
import { MiniCalendar } from "./mini-calendar";

export const metadata: Metadata = { title: "Events" };

function EventsRail({ featured }: { featured: CharterEvent }) {
  const registrations = events.filter((event) => event.registered);
  return (
    <aside aria-label="Calendar and registrations" className="flex w-72 shrink-0 flex-col gap-4 xl:w-80">
      <MiniCalendar
        events={events.map(({ slug, title, date }) => ({ slug, title, date }))}
        highlight={featured.date}
        initial={eventsToday}
      />
      <Panel className="flex flex-col gap-3 p-5">
        <h2 className="text-h3 text-ink">Your registrations</h2>
        <ul className="flex flex-col gap-3">
          {registrations.map((event) => (
            <li key={event.slug} className="flex items-center gap-2.5">
              <Icon name="check" size={18} className="shrink-0 text-success" />
              <Link href={`/events/${event.slug}`} className="group flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink group-hover:underline">
                  {event.title.replace(/ \d{4}$/, "")}
                </span>
                <span className="text-xs text-secondary">
                  {formatWeekdayDayMonth(event.date)} · {event.shortWhere ?? event.where}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </aside>
  );
}

/** Events — Figma "Web / Events" (node 10:1242). */
export default function EventsPage() {
  const featured = events.find((event) => event.featured) ?? events[0];
  const rest = events.filter((event) => event !== featured);

  return (
    <PageShell>
      <PageHeader
        title="Events"
        description="Online, in-person and hybrid events from members, chapters and partner organisations."
        actions={
          <Link href="/events/new" className={buttonClasses({ variant: "accent" })}>
            Host an event
          </Link>
        }
      />
      <EventsBrowser
        featured={{ event: featured, banner: <FeaturedEvent event={featured} /> }}
        entries={rest.map((event) => ({ event, card: <EventGridCard event={event} /> }))}
        today={eventsToday}
        rail={<EventsRail featured={featured} />}
      />
    </PageShell>
  );
}
