import Link from "next/link";
import { Avatar, Button, Panel } from "@chartermission/ui";
import { peopleToFollow, upcomingEvents } from "@/lib/mock-data";
import { TrendingTopics } from "./trending-topics";

export function PeopleToFollow() {
  return (
    <Panel className="flex flex-col gap-3.5 p-5">
      <h2 className="text-h3 text-ink">People to follow</h2>
      {peopleToFollow.map((person) => (
        <div key={person.handle} className="flex items-center gap-2.5">
          <Avatar name={person.name} tone={person.tone} />
          <Link href={`/members/${person.handle}`} className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-sm font-medium text-ink">{person.name}</span>
            <span className="text-xs text-secondary">{person.headline}</span>
          </Link>
          <Button variant="secondary" size="small">
            Follow
          </Button>
        </div>
      ))}
    </Panel>
  );
}

export function DateBadge({ month, day }: { month: string; day: string }) {
  return (
    <span className="flex shrink-0 flex-col items-center rounded-lg bg-accent-light px-2.5 py-1.5 font-semibold">
      <span className="text-label text-accent-hover">{month}</span>
      <span className="text-h3 text-ink">{day}</span>
    </span>
  );
}

export function UpcomingEvents() {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-ink">Upcoming events</h2>
        <Link href="/events" className="text-xs text-primary-light hover:underline">
          See all
        </Link>
      </div>
      {upcomingEvents.map((event) => (
        <Link key={event.slug} href={`/events/${event.slug}`} className="group flex items-center gap-3">
          <DateBadge month={event.month} day={event.day} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-ink group-hover:underline">{event.title}</span>
            <span className="text-xs text-secondary">{event.meta}</span>
          </span>
        </Link>
      ))}
    </Panel>
  );
}

export function SiteFooter() {
  return (
    <footer className="text-xs text-disabled">
      <nav aria-label="Footer" className="flex flex-wrap gap-x-1">
        <Link href="/about" className="hover:underline">About</Link>·
        <Link href="/guidelines" className="hover:underline">Guidelines</Link>·
        <Link href="/privacy" className="hover:underline">Privacy</Link>·
        <Link href="/terms" className="hover:underline">Terms</Link>·
        <Link href="/help" className="hover:underline">Help</Link>
      </nav>
      <p>© 2026 Charter Mission · Powered by Charter Center learning</p>
    </footer>
  );
}

/** Right column: trending topics, people to follow, upcoming events, footer. */
export function RightRail() {
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4">
      <TrendingTopics />
      <PeopleToFollow />
      <UpcomingEvents />
      <SiteFooter />
    </aside>
  );
}
