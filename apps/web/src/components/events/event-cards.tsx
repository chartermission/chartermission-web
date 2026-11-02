import Link from "next/link";
import { Chip, Icon, buttonClasses, type ChipTone } from "@chartermission/ui";
import { dateBadge, formatWeekday, formatWeekdayDayMonth } from "@/components/discover/dates";
import type { CharterEvent, EventFormatLabel } from "@/lib/mock/events";

/*
 * App-local event cards for /events. The shared EventCard (packages/ui) maps
 * formats to different chip tones than this screen (Online/Hybrid = info,
 * In person = success) and renders its action as an inert <button>, so the
 * grid card is rebuilt here with the same structure and a real link.
 */

export const eventFormatTone: Record<EventFormatLabel, ChipTone> = {
  Online: "info",
  "In person": "success",
  Hybrid: "info",
};

/** Grid card — Figma "Event card" instances in node 10:1372. */
export function EventGridCard({ event }: { event: CharterEvent }) {
  const badge = dateBadge(event.date);
  return (
    <article className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-card">
      <div className="flex h-28 items-start bg-primary p-4">
        <span className="flex flex-col items-center rounded-lg bg-card px-2.5 py-1.5 font-semibold" aria-hidden="true">
          <span className="text-label text-accent">{badge.month}</span>
          <span className="text-h2 text-ink">{badge.day}</span>
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <Chip tone={eventFormatTone[event.format]} className="self-start">
          {event.format}
        </Chip>
        <h3 className="text-h3 text-ink">
          <Link href={`/events/${event.slug}`} className="hover:underline">
            {event.title}
          </Link>
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name="clock" size={16} className="shrink-0 text-secondary" />
          <time dateTime={event.date}>
            {formatWeekdayDayMonth(event.date)} · {event.time}
          </time>
        </p>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name="map-pin" size={16} className="shrink-0 text-secondary" />
          {event.where}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-secondary">{event.going} going</span>
          <Link href={`/events/${event.slug}#register`} className={buttonClasses({ size: "small" })}>
            Register<span className="sr-only"> for {event.title}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Featured event banner — Figma node 10:1333. */
export function FeaturedEvent({ event }: { event: CharterEvent }) {
  const badge = dateBadge(event.date);
  return (
    <article className="flex items-center gap-6 rounded-2xl bg-gradient-to-r from-primary-dark to-primary-light p-7">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex gap-2">
          <Chip tone="hashtag">Featured</Chip>
          <Chip tone={eventFormatTone[event.format]}>{event.format}</Chip>
        </div>
        <h2 className="text-h1 text-inverse">
          <Link href={`/events/${event.slug}`} className="hover:underline">
            {event.title}
          </Link>
        </h2>
        {event.summary && <p className="text-md text-primary-tint">{event.summary}</p>}
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-inverse">
          <li className="flex items-center gap-1.5">
            <Icon name="calendar" size={16} className="text-primary-tint" />
            <time dateTime={event.date}>
              {formatWeekdayDayMonth(event.date)} · {event.time}
            </time>
          </li>
          <li className="flex items-center gap-1.5">
            <Icon name="map-pin" size={16} className="text-primary-tint" />
            {event.where}
          </li>
          <li className="flex items-center gap-1.5">
            <Icon name="users" size={16} className="text-primary-tint" />
            {event.going} going
          </li>
        </ul>
        <div className="flex gap-2.5">
          <Link href={`/events/${event.slug}#register`} className={buttonClasses({ variant: "accent" })}>
            Register
          </Link>
          <a href={`/events/${event.slug}/calendar.ics`} download className={buttonClasses({ variant: "secondary" })}>
            Add to calendar
          </a>
        </div>
      </div>
      <p className="flex shrink-0 flex-col items-center rounded-card bg-card px-6 py-4" aria-hidden="true">
        <span className="text-label text-accent">{badge.month}</span>
        <span className="text-display text-ink">{Number(badge.day)}</span>
        <span className="text-xs text-secondary">{formatWeekday(event.date)}</span>
      </p>
    </article>
  );
}
