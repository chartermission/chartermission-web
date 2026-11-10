"use client";

import Link from "next/link";
import type { AgendaItem, EventDetail, EventSpeaker } from "@chartermission/contracts";
import { Avatar, Icon, Panel, cn } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { dayKey, formatClock, formatDay, formatLongDay, formatRange, sameWallClock, zoneAbbreviation, zoneCity } from "./time";
import { useViewerZone } from "./use-viewer-zone";

/* Read-only sections of the event page: when, speakers, agenda, where. */

export function SectionHeading({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 id={id} className="text-h2 text-ink max-sm:text-h3">
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** Date and time in the event's zone and, when different, the viewer's. */
export function WhenBlock({ event }: { event: Pick<EventDetail, "startsAt" | "endsAt" | "timezone"> }) {
  const viewer = useViewerZone();
  const differs = viewer && !sameWallClock(viewer, event.timezone, event.startsAt);
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-tint-2 text-primary">
        <Icon name="calendar" size={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-md font-medium text-ink">{formatLongDay(event.startsAt, event.timezone)}</p>
        <p className="text-sm text-body">
          <time dateTime={event.startsAt}>{formatRange(event.startsAt, event.endsAt, event.timezone)}</time>
          <span className="text-secondary"> · {zoneCity(event.timezone)} time</span>
        </p>
        {differs && viewer && (
          <p className="text-sm text-body">
            {dayKey(event.startsAt, viewer) !== dayKey(event.startsAt, event.timezone) && `${formatDay(event.startsAt, viewer)}, `}
            {formatRange(event.startsAt, event.endsAt, viewer)}
            <span className="text-secondary"> · your time ({zoneCity(viewer)})</span>
          </p>
        )}
      </div>
    </div>
  );
}

function SpeakerCard({ speaker }: { speaker: EventSpeaker }) {
  const role = [speaker.title, speaker.organisation].filter(Boolean).join(", ");
  const name = speaker.member ? (
    <Link href={memberHref(speaker.member.handle)} className="after:absolute after:inset-0 hover:underline">
      {speaker.name}
    </Link>
  ) : (
    speaker.name
  );
  return (
    <li className="relative flex items-center gap-3 rounded-card border border-line bg-card p-4 transition-colors has-[a:hover]:border-line-strong">
      <Avatar name={speaker.name} src={speaker.avatarUrl ?? undefined} tone={speaker.member?.tone ?? "tint"} size={56} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex items-center gap-1 text-md font-medium text-ink">
          <span className="truncate">{name}</span>
          {speaker.member?.verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
        </p>
        {role && <p className="line-clamp-2 text-sm text-secondary">{role}</p>}
      </div>
    </li>
  );
}

export function SpeakersGrid({ speakers }: { speakers: EventSpeaker[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      {speakers.map((speaker, index) => (
        <SpeakerCard key={`${speaker.name}-${index}`} speaker={speaker} />
      ))}
    </ul>
  );
}

/** Agenda timeline: each slot in the event's time and the viewer's (CM-EVT-08 keeps it after the event). */
export function AgendaTimeline({ agenda, timezone }: { agenda: AgendaItem[]; timezone: string }) {
  const viewer = useViewerZone();
  const multiDay = agenda.length > 1 && dayKey(agenda[0]!.startsAt, timezone) !== dayKey(agenda[agenda.length - 1]!.startsAt, timezone);
  return (
    <ol className="relative flex flex-col">
      {agenda.map((item, index) => {
        const differs = viewer && !sameWallClock(viewer, timezone, item.startsAt);
        const showDay = multiDay && (index === 0 || dayKey(agenda[index - 1]!.startsAt, timezone) !== dayKey(item.startsAt, timezone));
        const last = index === agenda.length - 1;
        return (
          <li key={`${item.startsAt}-${index}`} className="flex flex-col">
            {showDay && <p className="mb-3 text-label uppercase text-secondary">{formatLongDay(item.startsAt, timezone)}</p>}
            <div className="flex gap-4 max-sm:gap-3">
              <div className="flex w-[104px] shrink-0 flex-col items-end pt-0.5 text-end max-sm:w-[76px]">
                <time dateTime={item.startsAt} className="text-sm font-semibold text-ink">
                  {formatClock(item.startsAt, timezone)}
                  {item.endsAt && <span className="font-normal text-secondary">–{formatClock(item.endsAt, timezone)}</span>}
                </time>
                <span className="text-xs text-secondary">{zoneAbbreviation(timezone, item.startsAt)}</span>
                {differs && viewer && <span className="text-xs text-secondary">{formatClock(item.startsAt, viewer)} yours</span>}
              </div>
              <div className="relative flex flex-col items-center" aria-hidden="true">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-accent bg-card" />
                {!last && <span className="w-px flex-1 bg-line" />}
              </div>
              <div className={cn("flex min-w-0 flex-1 flex-col gap-1", !last && "pb-6")}>
                <p className="text-md font-medium text-ink">{item.title}</p>
                {item.description && <p className="whitespace-pre-line text-sm text-body">{item.description}</p>}
                {item.speakerNames.length > 0 && (
                  <p className="flex items-center gap-1 text-xs text-secondary">
                    <Icon name="user" size={14} />
                    {item.speakerNames.join(", ")}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Venue (with a map link) and/or online platform for the "Where" section. */
export function WhereBlock({ event, countryName }: { event: Pick<EventDetail, "venue" | "online" | "format" | "past">; countryName: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {event.venue && (
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-light text-success">
            <Icon name="map-pin" size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-md font-medium text-ink">{event.venue.name}</p>
            {event.venue.address && <p className="text-sm text-body">{event.venue.address}</p>}
            <p className="text-sm text-body">
              {event.venue.city}
              {countryName ? `, ${countryName}` : ""}
            </p>
            {event.venue.mapUrl && (
              <a href={event.venue.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 flex w-fit items-center gap-1 text-sm font-medium text-primary-light hover:underline">
                Open in maps
                <Icon name="arrow-up-right" size={14} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      )}
      {event.online && (
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-light text-info">
            <Icon name="video" size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-md font-medium text-ink">Online · {event.online.platform}</p>
            <p className="text-sm text-secondary">
              {event.past
                ? "The online session has ended."
                : "Registered members get the join link on this page from 24 hours before the start."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function SectionPanel({ id, title, children, aside }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Panel aria-labelledby={id} className="flex flex-col gap-4 p-6 max-sm:p-4">
      <SectionHeading id={id} aside={aside}>
        {title}
      </SectionHeading>
      {children}
    </Panel>
  );
}
