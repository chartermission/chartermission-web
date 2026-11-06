"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, Panel, cn } from "@chartermission/ui";
import { formatDayMonth } from "@/components/discover/dates";
import { monthLabel, monthOf, monthWeeks, shiftMonth, weekdayInitials } from "./calendar";

type CalendarEvent = { slug: string; title: string; date: string };

/**
 * Right-rail month calendar (Figma node 10:1514). Days with events link to the
 * event; the highlighted day is the featured event.
 */
export function MiniCalendar({ events, highlight, initial }: { events: CalendarEvent[]; highlight?: string; initial: string }) {
  const [month, setMonth] = useState(() => monthOf(initial));
  const weeks = monthWeeks(month);
  const label = monthLabel(month);
  const byDate = new Map(events.map((event) => [event.date, event]));

  return (
    <Panel aria-label="Event calendar" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-ink" aria-live="polite">
          {label}
        </h2>
        <div className="flex gap-2 text-secondary">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded hover:text-ink">
            <Icon name="chevron-left" size={18} />
          </button>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded hover:text-ink">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 justify-items-center" aria-hidden="true">
        {weekdayInitials.map((day, index) => (
          <span key={index} className="w-9 text-center text-xs text-disabled">
            {day}
          </span>
        ))}
      </div>
      {weeks.map((week, index) => (
        <div key={index} className="grid grid-cols-7 justify-items-center">
          {week.map((date, dayIndex) => {
            if (!date) return <span key={`pad-${dayIndex}`} className="size-9" />;
            const event = byDate.get(date);
            const day = Number(date.slice(8));
            if (!event) {
              return (
                <span key={date} className="flex size-9 items-center justify-center text-sm text-ink">
                  {day}
                </span>
              );
            }
            const selected = date === highlight;
            return (
              <Link
                key={date}
                href={`/events/${event.slug}`}
                aria-label={`${formatDayMonth(date)}: ${event.title}`}
                className={cn(
                  "flex size-9 flex-col items-center justify-center gap-0.5 rounded-lg text-sm font-medium",
                  selected ? "bg-primary text-inverse" : "text-ink hover:bg-primary-tint-2",
                )}
              >
                {day}
                <span className={cn("size-1 rounded-full", selected ? "bg-inverse" : "bg-accent")} />
              </Link>
            );
          })}
        </div>
      ))}
    </Panel>
  );
}
