"use client";

import Link from "next/link";
import type { EventSummary } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { EventDateBadge, eventHref } from "./event-meta";
import { formatClock, formatDay, zoneAbbreviation } from "./time";
import { useViewerZone } from "./use-viewer-zone";
import type { Translate } from "@/i18n/translate";
import { useT, useIntlTag } from "@/i18n/client";

function statusNote(t: Translate, event: EventSummary): string | null {
  if (event.cancelledAt) return "Cancelled";
  if (event.viewer.status === "waitlisted") return (event.viewer.waitlistPosition ? t("Waitlisted #{position}", { position: event.viewer.waitlistPosition }) : t("Waitlisted"));
  return null;
}

/** Date badge + title + "Sat 21 Nov · 18:00 · Accra & online" rows for the right rails. */
export function RailEventList({ events, checks = false }: { events: EventSummary[]; checks?: boolean }) {
  const t = useT();
  const intl = useIntlTag();
  const viewer = useViewerZone();
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => {
        const zone = viewer ?? event.timezone;
        const note = statusNote(t, event);
        return (
          <li key={event.id}>
            <Link href={eventHref(event)} className="group flex items-center gap-3">
              {checks ? (
                <Icon name={note ? "clock" : "check"} size={18} className={note ? "shrink-0 text-warning" : "shrink-0 text-success"} />
              ) : (
                <EventDateBadge startsAt={event.startsAt} timezone={event.timezone} tone="accent" size="small" className="w-12" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-sm font-medium text-ink group-hover:underline">{event.title}</span>
                <span className="text-xs text-secondary">
                  {formatDay(event.startsAt, zone, { intl })} · {formatClock(event.startsAt, zone)}
                  {viewer ? "" : ` ${zoneAbbreviation(zone, event.startsAt)}`} · {event.location.shortLabel}
                  {note && <span className={event.cancelledAt ? "font-medium text-error" : "font-medium text-warning"}> · {note}</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
