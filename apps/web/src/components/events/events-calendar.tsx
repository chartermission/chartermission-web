"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventSummary, EventsCalendar as CalendarData, Page } from "@chartermission/contracts";
import { Icon, Panel, cn } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { Bone } from "@/components/social/skeletons";
import { api } from "@/lib/api/client";
import { EventRow } from "./event-cards";
import { eventHref } from "./event-meta";
import { apiFilters, type EventFilters } from "./filters";
import { dateHeading, monthKey, monthLabel, monthOf, monthWeeks, nextDate, shiftMonth, weekdayShort } from "./month-grid";
import { dayKey, formatClock, fromZonedInput } from "./time";
import { useViewerZone } from "./use-viewer-zone";
import { T, useT, useIntlTag } from "@/i18n/client";

const pillTone: Record<EventSummary["format"], string> = {
  online: "bg-info-light text-info",
  in_person: "bg-success-light text-success",
  hybrid: "bg-info-light text-info",
};

type Loaded<T> = { key: string; data: T } | { key: string; error: unknown };

/** Events that start on one day in the viewer's zone (GET /events with from/to). */
function DayList({ day, zone, filters }: { day: string; zone: string; filters: EventFilters }) {
  const intl = useIntlTag();
  const key = `${day}|${zone}|${JSON.stringify(apiFilters(filters))}`;
  const [state, setState] = useState<Loaded<EventSummary[]> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const from = fromZonedInput(`${day}T00:00`, zone);
    const to = fromZonedInput(`${nextDate(day)}T00:00`, zone);
    api<Page<EventSummary>>("/events", { query: { when: "all", from, to, ...apiFilters(filters), limit: 50 }, signal: controller.signal })
      .then((page) => setState({ key, data: page.items.filter((e) => dayKey(e.startsAt, zone) === day) }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, error });
      });
    return () => controller.abort();
  }, [day, zone, filters, key]);

  const current = state?.key === key ? state : null;
  return (
    <Panel aria-labelledby="calendar-day-heading" className="flex flex-col">
      <h3 id="calendar-day-heading" className="px-5 pt-4 pb-2 text-h3 text-ink">
        {dateHeading(intl, day)}
      </h3>
      <div aria-live="polite">
        {!current ? (
          <div className="flex flex-col gap-2 px-5 pb-5" aria-hidden="true">
            <Bone className="h-14 w-full" />
            <Bone className="h-14 w-full" />
          </div>
        ) : "error" in current ? (
          <div className="px-5 pb-5">
            <ErrorNotice error={current.error} />
          </div>
        ) : current.data.length ? (
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {current.data.map((event) => (
              <li key={event.id}>
                <EventRow event={event} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-5 text-sm text-secondary">No events start on this day.</p>
        )}
      </div>
    </Panel>
  );
}

/** Month grid (GET /events/calendar) bucketed in the viewer's zone, with the selected day's events below. */
export function EventsCalendar({ filters, onNavigate }: { filters: EventFilters; onNavigate: (patch: Partial<EventFilters>) => void }) {
  const intl = useIntlTag();
  const t = useT();
  const zone = useViewerZone();
  const today = zone ? dayKey(new Date(), zone) : null;
  const month = filters.month ? monthOf(filters.month) : today ? monthOf(today) : null;
  const monthId = month ? monthKey(month) : null;
  const key = `${monthId}|${zone}|${JSON.stringify(apiFilters(filters))}`;
  const [state, setState] = useState<Loaded<CalendarData> | null>(null);

  useEffect(() => {
    if (!monthId || !zone) return;
    const controller = new AbortController();
    api<CalendarData>("/events/calendar", { query: { month: monthId, tz: zone, ...apiFilters(filters) }, signal: controller.signal })
      .then((data) => setState({ key, data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, error });
      });
    return () => controller.abort();
  }, [monthId, zone, filters, key]);

  if (!month || !zone) return <Bone className="h-[640px] w-full rounded-card" />;

  const current = state?.key === key ? state : null;
  const days = current && "data" in current ? new Map(current.data.days.map((d) => [d.date, d])) : new Map();
  const label = monthLabel(intl, month);
  const selected = filters.day && filters.day.startsWith(monthKey(month)) ? filters.day : null;
  const total = current && "data" in current ? current.data.total : null;

  return (
    <div className="flex flex-col gap-5">
      <Panel aria-label={t("Events in {label}", { label })} className="flex flex-col gap-4 p-5 max-sm:p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-h3 text-ink" aria-live="polite">
              {label}
            </h2>
            <p className="text-xs text-secondary">
              {total === null ? "Loading…" : t("{count} events · times in your zone ({zone})", { count: total, zone: zone.replace(/_/g, " ") })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {today && monthKey(month) !== today.slice(0, 7) && (
              <button type="button" onClick={() => onNavigate({ month: today.slice(0, 7), day: today })} className="me-1 rounded-md px-2 py-1 text-sm font-medium text-primary-light hover:bg-muted">
                Today
              </button>
            )}
            <button type="button" onClick={() => onNavigate({ month: monthKey(shiftMonth(month, -1)), day: null })} className="rounded-md p-1 text-secondary hover:bg-muted" aria-label="Previous month">
              <Icon name="chevron-left" size={18} />
            </button>
            <button type="button" onClick={() => onNavigate({ month: monthKey(shiftMonth(month, 1)), day: null })} className="rounded-md p-1 text-secondary hover:bg-muted" aria-label="Next month">
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
        </div>
        {current && "error" in current ? (
          <ErrorNotice error={current.error} />
        ) : (
          <table className={cn("w-full table-fixed border-collapse", !current && "opacity-60")}>
            <thead>
              <tr>
                {weekdayShort.map((day) => (
                  <th key={day} scope="col" className="pb-2 text-start text-xs font-normal text-disabled max-sm:text-center">
                    <span className="max-sm:hidden">{day}</span>
                    <span className="sm:hidden" aria-hidden="true">
                      {day[0]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(month).map((week, index) => (
                <tr key={index}>
                  {week.map((date, dayIndex) => {
                    if (!date) return <td key={`pad-${dayIndex}`} className="h-24 border border-line bg-surface/60 max-sm:h-14" />;
                    const entry = days.get(date);
                    const isToday = date === today;
                    const isSelected = date === selected;
                    const count = entry?.count ?? 0;
                    return (
                      <td key={date} className={cn("h-24 border border-line p-1.5 align-top max-sm:h-14 max-sm:p-0.5", isSelected && "bg-primary-tint-2")}>
                        <div className="flex h-full flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => onNavigate({ day: isSelected ? null : date })}
                            aria-pressed={isSelected}
                            aria-label={(count ? t("{date}, {count} events", { date: dateHeading(intl, date), count }) : dateHeading(intl, date))}
                            className={cn(
                              "flex size-6 items-center justify-center self-start rounded-full text-xs hover:bg-muted max-sm:self-center",
                              isToday ? "bg-primary font-semibold text-inverse hover:bg-primary-light" : "text-secondary",
                            )}
                          >
                            {Number(date.slice(8))}
                          </button>
                          {count > 0 && (
                            <span className="flex justify-center gap-0.5 sm:hidden" aria-hidden="true">
                              {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                                <span key={i} className="size-1.5 rounded-full bg-accent" />
                              ))}
                            </span>
                          )}
                          {entry?.events.map((event: EventSummary) => (
                            <Link
                              key={event.id}
                              href={eventHref(event)}
                              className={cn(
                                "line-clamp-2 rounded px-1.5 py-0.5 text-xs leading-4 font-medium break-words hover:underline max-sm:hidden",
                                event.cancelledAt ? "bg-error-light text-error line-through" : pillTone[event.format],
                              )}
                              title={`${event.title} · ${formatClock(event.startsAt, zone)}`}
                            >
                              <span className="font-normal opacity-80">{formatClock(event.startsAt, zone)}</span> {event.title}
                            </Link>
                          ))}
                          {count > (entry?.events.length ?? 0) && (
                            <button type="button" onClick={() => onNavigate({ day: date })} className="self-start rounded px-1 text-xs font-medium text-primary-light hover:underline max-sm:hidden">
                              <T vars={{ count: count - entry!.events.length }}>{"+{count} more"}</T>
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {selected && <DayList day={selected} zone={zone} filters={filters} />}
    </div>
  );
}
