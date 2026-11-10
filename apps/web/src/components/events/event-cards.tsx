"use client";

import Link from "next/link";
import type { EventSummary } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";
import { BrandCover } from "@/components/illustrations";
import { Bone } from "@/components/social/skeletons";
import {
  AvailabilityNote,
  EventDateBadge,
  EventWhen,
  FormatChip,
  HostLine,
  LifecycleChip,
  ViewerStatusChip,
  cardAction,
  eventHref,
  goingLabel,
} from "./event-meta";

/*
 * Event cards for /events, My events and related events, in the Figma "Web / Events" language
 * (node 10:1242): navy cover band with a white date badge, format chip, title, time and place,
 * then the going count and one action.
 */

/** Cover image, or the patterned navy band when the host didn't upload one. */
export function EventCover({ event, className, children }: { event: Pick<EventSummary, "coverUrl">; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden bg-primary", className)}>
      {event.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.coverUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <div className="absolute inset-0 flex">
          <BrandCover variant="navy" className="h-full" />
        </div>
      )}
      {event.coverUrl && <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-primary-dark/35 to-transparent" />}
      {children && <div className="relative flex h-full">{children}</div>}
    </div>
  );
}

/** Grid card — Figma "Event card" instances in node 10:1372. */
export function EventGridCard({ event, showLifecycle = false }: { event: EventSummary; showLifecycle?: boolean }) {
  const action = cardAction(event);
  const t = useT();
  const going = goingLabel(t, event);
  const cancelled = Boolean(event.cancelledAt);
  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-card border border-line bg-card transition-shadow hover:shadow-[0px_8px_24px_0px_rgba(26,32,44,0.08)]">
      <EventCover event={event} className={cn("h-28", (cancelled || event.past) && "grayscale-[60%]")}>
        <div className="flex w-full items-start justify-between gap-2 p-4">
          <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} />
          <div className="flex flex-col items-end gap-1.5">
            {cancelled && <Chip tone="error">Cancelled</Chip>}
            <ViewerStatusChip event={event} />
          </div>
        </div>
      </EventCover>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <FormatChip format={event.format} />
          {event.category && <Chip tone="neutral">{event.category.name}</Chip>}
          {showLifecycle && event.status !== "published" && <LifecycleChip status={event.status} />}
        </div>
        <h3 className={cn("text-h3", cancelled ? "text-secondary line-through decoration-1" : "text-ink")}>
          <Link href={eventHref(event)} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
            {event.title}
          </Link>
        </h3>
        <p className="flex items-start gap-1.5 text-sm text-body">
          <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-secondary" />
          <EventWhen startsAt={event.startsAt} timezone={event.timezone} stacked />
        </p>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name={event.format === "online" ? "video" : "map-pin"} size={16} className="shrink-0 text-secondary" />
          <span className="truncate">{event.location.label}</span>
        </p>
        <HostLine host={event.host} className="text-xs" />
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            {going && <span className="text-sm font-medium text-secondary">{going}</span>}
            <AvailabilityNote event={event} />
          </span>
          <Link
            href={`${eventHref(event)}${action.hash}`}
            className={cn(buttonClasses({ size: "small", variant: action.variant }), "relative z-10 shrink-0")}
          >
            {action.label}
            <span className="sr-only"> {event.title}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

export function EventGridCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-card">
      <Bone className="h-28 rounded-none" />
      <div className="flex flex-col gap-2.5 p-4">
        <Bone className="h-6 w-20 rounded-full" />
        <Bone className="h-5 w-4/5" />
        <Bone className="h-4 w-3/5" />
        <Bone className="h-4 w-2/5" />
        <div className="flex items-center justify-between pt-2">
          <Bone className="h-4 w-16" />
          <Bone className="h-8 w-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Featured event banner — Figma node 10:1333. */
export function FeaturedEvent({ event }: { event: EventSummary }) {
  const action = cardAction(event);
  const t = useT();
  const going = goingLabel(t, event);
  return (
    <article className="relative isolate flex items-center gap-6 overflow-hidden rounded-2xl bg-linear-to-r from-primary-dark to-primary-light p-7 max-sm:flex-col-reverse max-sm:items-stretch max-sm:gap-4 max-sm:p-5">
      {event.coverUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.coverUrl} alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-25 mix-blend-luminosity" />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          <Chip tone="hashtag">Featured</Chip>
          <FormatChip format={event.format} />
          <ViewerStatusChip event={event} />
        </div>
        <h2 className="text-h1 text-inverse max-sm:text-h2">
          <Link href={eventHref(event)} className="hover:underline">
            {event.title}
          </Link>
        </h2>
        <p className="text-md text-primary-tint">{event.summary}</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-inverse">
          <li className="flex items-center gap-1.5">
            <Icon name="calendar" size={16} className="shrink-0 text-primary-tint" />
            <EventWhen startsAt={event.startsAt} timezone={event.timezone} localClassName="text-primary-tint" />
          </li>
          <li className="flex items-center gap-1.5">
            <Icon name="map-pin" size={16} className="shrink-0 text-primary-tint" />
            {event.location.label}
          </li>
          {going && (
            <li className="flex items-center gap-1.5">
              <Icon name="users" size={16} className="shrink-0 text-primary-tint" />
              {going}
            </li>
          )}
        </ul>
        <div className="mt-1 flex flex-wrap gap-2.5">
          <Link href={`${eventHref(event)}${action.hash}`} className={buttonClasses({ variant: action.variant === "primary" ? "accent" : "secondary" })}>
            {action.label === "View" ? "View event" : action.label}
          </Link>
          <a href={`/api/v1/events/${event.id}.ics`} download className={buttonClasses({ variant: "secondary" })}>
            <Icon name="calendar" size={18} />
            Add to calendar
          </a>
        </div>
      </div>
      <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} size="large" className="max-sm:hidden" />
    </article>
  );
}

/** Compact row for My events, the rail and the calendar's day list. */
export function EventRow({ event, showLifecycle = false, trailing }: { event: EventSummary; showLifecycle?: boolean; trailing?: React.ReactNode }) {
  const t = useT();
  const going = goingLabel(t, event);
  return (
    <article className="relative flex items-start gap-4 px-5 py-4 max-sm:gap-3 max-sm:px-4">
      <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} tone="accent" size="small" className="w-12" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {showLifecycle && <LifecycleChip status={event.status} />}
          {event.cancelledAt && <Chip tone="error">Cancelled</Chip>}
          <ViewerStatusChip event={event} />
        </div>
        <h3 className="text-md font-medium text-ink">
          <Link href={eventHref(event)} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
            {event.title}
          </Link>
        </h3>
        <p className="text-sm text-body">
          <EventWhen startsAt={event.startsAt} timezone={event.timezone} />
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-secondary">
          <span className="flex items-center gap-1">
            <Icon name={event.format === "online" ? "video" : "map-pin"} size={14} />
            {event.location.label}
          </span>
          {going && (
            <span className="flex items-center gap-1">
              <Icon name="users" size={14} />
              {going}
            </span>
          )}
        </p>
      </div>
      {trailing && <div className="relative z-10 flex shrink-0 items-center gap-2 self-center">{trailing}</div>}
    </article>
  );
}
