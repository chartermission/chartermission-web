"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventsCalendar } from "@chartermission/contracts";
import { Icon, Panel, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { dateHeading, monthKey, monthLabel, monthOf, monthWeeks, shiftMonth, weekdayInitials, type MonthRef } from "./month-grid";
import { dayKey } from "./time";
import { useViewerZone } from "./use-viewer-zone";
import { useIntlTag } from "@/i18n/client";

/**
 * Right-rail month calendar (Figma node 10:1514). Days with events (in the viewer's zone, from
 * GET /events/calendar) carry an orange dot and open that day in the calendar view.
 */
export function MiniCalendar() {
  const intl = useIntlTag();
  const zone = useViewerZone();
  const today = zone ? dayKey(new Date(), zone) : null;
  const [picked, setPicked] = useState<MonthRef | null>(null);
  const month = picked ?? (today ? monthOf(today) : null);
  const id = month ? monthKey(month) : null;
  const [loaded, setLoaded] = useState<{ id: string; counts: Map<string, number> } | null>(null);

  useEffect(() => {
    if (!id || !zone) return;
    const controller = new AbortController();
    api<EventsCalendar>("/events/calendar", { query: { month: id, tz: zone }, signal: controller.signal })
      .then((data) => setLoaded({ id: `${id}|${zone}`, counts: new Map(data.days.map((d) => [d.date, d.count])) }))
      .catch(() => {});
    return () => controller.abort();
  }, [id, zone]);

  if (!month) return <Panel aria-hidden="true" className="h-[340px]" />;
  const counts = loaded?.id === `${id}|${zone}` ? loaded.counts : new Map<string, number>();
  const label = monthLabel(intl, month);

  return (
    <Panel aria-label="Event calendar" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-ink" aria-live="polite">
          {label}
        </h2>
        <div className="flex gap-2 text-secondary">
          <button type="button" onClick={() => setPicked(shiftMonth(month, -1))} aria-label="Previous month" className="rounded hover:text-ink">
            <Icon name="chevron-left" size={18} />
          </button>
          <button type="button" onClick={() => setPicked(shiftMonth(month, 1))} aria-label="Next month" className="rounded hover:text-ink">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 justify-items-center" aria-hidden="true">
        {weekdayInitials(intl).map((day, index) => (
          <span key={index} className="w-9 text-center text-xs text-disabled">
            {day}
          </span>
        ))}
      </div>
      {monthWeeks(month).map((week, index) => (
        <div key={index} className="grid grid-cols-7 justify-items-center">
          {week.map((date, dayIndex) => {
            if (!date) return <span key={`pad-${dayIndex}`} className="size-9" />;
            const count = counts.get(date) ?? 0;
            const day = Number(date.slice(8));
            const isToday = date === today;
            if (!count) {
              return (
                <span key={date} className={cn("flex size-9 items-center justify-center rounded-lg text-sm", isToday ? "bg-primary-tint-2 font-semibold text-primary" : "text-ink")}>
                  {day}
                </span>
              );
            }
            return (
              <Link
                key={date}
                href={`/events?view=calendar&month=${date.slice(0, 7)}&day=${date}`}
                aria-label={`${dateHeading(intl, date)}: ${count} ${count === 1 ? "event" : "events"}`}
                className={cn(
                  "flex size-9 flex-col items-center justify-center gap-0.5 rounded-lg text-sm font-medium",
                  isToday ? "bg-primary text-inverse" : "text-ink hover:bg-primary-tint-2",
                )}
              >
                {day}
                <span className={cn("size-1 rounded-full", isToday ? "bg-inverse" : "bg-accent")} />
              </Link>
            );
          })}
        </div>
      ))}
    </Panel>
  );
}
