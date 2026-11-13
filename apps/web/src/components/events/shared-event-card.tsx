"use client";

import Link from "next/link";
import type { EventSummary } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";
import { EventCover } from "./event-cards";
import { AvailabilityNote, EventDateBadge, EventWhen, FormatChip, ViewerStatusChip, cardAction, eventHref, goingLabel } from "./event-meta";

/**
 * An event shared to the feed, inside its post: cover with the date, title, time in the event's
 * and the viewer's zone, place, who's going and the viewer's next step (Register, Join waitlist,
 * View). It is live: seats, cancellation and the viewer's registration are as of now.
 * `preview` is the copy in the Share to feed dialog: no links or buttons.
 */
export function SharedEventCard({ event, preview = false }: { event: EventSummary | null; preview?: boolean }) {
  const t = useT();
  if (!event) {
    return (
      <p className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-secondary">
        <Icon name="eye-off" size={16} />
        This event is no longer available.
      </p>
    );
  }
  const cancelled = Boolean(event.cancelledAt);
  const action = cardAction(event);
  const going = goingLabel(t, event);
  return (
    <article className={cn("relative flex w-full flex-col overflow-hidden rounded-[10px] border border-line", !preview && "hover:bg-surface")}>
      <EventCover event={event} className={cn("h-28", (cancelled || event.past) && "grayscale-[60%]")}>
        <div className="flex w-full items-start justify-between gap-2 p-3.5">
          <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} />
          <div className="flex flex-col items-end gap-1.5">
            {cancelled && <Chip tone="error">Cancelled</Chip>}
            <ViewerStatusChip event={event} />
          </div>
        </div>
      </EventCover>
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-label text-accent-hover">Event</span>
          <FormatChip format={event.format} />
        </div>
        <h3 className={cn("text-md font-semibold", cancelled ? "text-secondary line-through decoration-1" : "text-ink")}>
          {preview ? (
            event.title
          ) : (
            <Link href={eventHref(event)} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
              {event.title}
            </Link>
          )}
        </h3>
        <p className="flex items-start gap-1.5 text-sm text-body">
          <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-secondary" />
          <EventWhen startsAt={event.startsAt} timezone={event.timezone} withDay />
        </p>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name={event.format === "online" ? "video" : "map-pin"} size={16} className="shrink-0 text-secondary" />
          <span className="truncate">{event.location.label}</span>
        </p>
        <div className="flex items-end justify-between gap-2 pt-1.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            {going && <span className="text-sm font-medium text-secondary">{going}</span>}
            <AvailabilityNote event={event} />
          </span>
          {!preview && (
            <Link href={`${eventHref(event)}${action.hash}`} className={cn(buttonClasses({ size: "small", variant: action.variant }), "relative z-10 shrink-0")}>
              {action.label}
              <span className="sr-only"> {event.title}</span>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
