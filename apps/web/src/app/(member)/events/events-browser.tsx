"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Icon, Panel, cn, type IconName } from "@chartermission/ui";
import { ToggleChip } from "@/components/discover/filter-controls";
import { isWithinDays } from "@/components/discover/dates";
import type { CharterEvent } from "@/lib/mock/events";
import { monthLabel, monthOf, monthWeeks, shiftMonth, weekdayShort, type MonthRef } from "./calendar";

/** An event plus its server-rendered card. */
export type EventEntry = { event: CharterEvent; card: ReactNode };

const filters = [
  { value: "all", label: "All events" },
  { value: "online", label: "Online" },
  { value: "in-person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
  { value: "week", label: "This week" },
  { value: "chapters", label: "My chapters" },
] as const;

type Filter = (typeof filters)[number]["value"];
type View = "list" | "calendar";

const views: { value: View; label: string; icon: IconName }[] = [
  { value: "list", label: "List", icon: "menu" },
  { value: "calendar", label: "Calendar", icon: "calendar" },
];

function matches(event: CharterEvent, filter: Filter, today: string) {
  switch (filter) {
    case "online":
      return event.format === "Online";
    case "in-person":
      return event.format === "In person";
    case "hybrid":
      return event.format === "Hybrid";
    case "week":
      return isWithinDays(event.date, today, 7);
    case "chapters":
      return Boolean(event.myChapter);
    default:
      return true;
  }
}

/** Format chips, List/Calendar switch and the event list or month calendar for /events. */
export function EventsBrowser({
  entries,
  featured,
  today,
  rail,
}: {
  entries: EventEntry[];
  featured: { event: CharterEvent; banner: ReactNode };
  today: string;
  rail: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("list");

  const visible = useMemo(() => entries.filter((entry) => matches(entry.event, filter, today)), [entries, filter, today]);
  const showFeatured = matches(featured.event, filter, today);
  const allVisibleEvents = [...(showFeatured ? [featured.event] : []), ...visible.map((entry) => entry.event)];

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div role="group" aria-label="Filter events" className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <ToggleChip key={item.value} active={filter === item.value} onClick={() => setFilter(item.value)}>
              {item.label}
            </ToggleChip>
          ))}
        </div>
        <div role="tablist" aria-label="Events view" className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-[3px]">
          {views.map((item) => {
            const selected = view === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="events-panel"
                onClick={() => setView(item.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  selected ? "bg-card text-primary" : "text-secondary hover:text-ink",
                )}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-6">
        <div id="events-panel" role="tabpanel" className="flex min-w-0 flex-1 flex-col gap-5">
          {view === "list" ? (
            <>
              {showFeatured && featured.banner}
              {visible.length > 0 ? (
                <section aria-labelledby="events-this-month" className="flex flex-col gap-5">
                  <h2 id="events-this-month" className="text-h3 text-ink">
                    This month
                  </h2>
                  <ul className="grid grid-cols-2 items-start gap-6 xl:grid-cols-3">
                    {visible.map((entry) => (
                      <li key={entry.event.slug} className="flex">
                        {entry.card}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                !showFeatured && <EmptyState onReset={() => setFilter("all")} />
              )}
            </>
          ) : (
            <MonthCalendar events={allVisibleEvents} initial={monthOf(today)} />
          )}
        </div>
        {rail}
      </div>
    </>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <Panel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-md font-medium text-ink">No events match this filter</p>
      <p className="text-sm text-secondary">Check back soon, or browse every upcoming event.</p>
      <button type="button" onClick={onReset} className="text-sm font-medium text-primary-light hover:underline">
        Show all events
      </button>
    </Panel>
  );
}

const pillTone: Record<CharterEvent["format"], string> = {
  Online: "bg-info-light text-info",
  "In person": "bg-success-light text-success",
  Hybrid: "bg-info-light text-info",
};

/** Full month calendar view of the filtered events. */
function MonthCalendar({ events, initial }: { events: CharterEvent[]; initial: MonthRef }) {
  const [month, setMonth] = useState(initial);
  const byDate = useMemo(() => {
    const map = new Map<string, CharterEvent[]>();
    for (const event of events) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [events]);
  const weeks = monthWeeks(month);
  const label = monthLabel(month);

  return (
    <Panel aria-label={`Events in ${label}`} className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-ink" aria-live="polite">
          {label}
        </h2>
        <div className="flex gap-1">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-md p-1 text-secondary hover:bg-muted" aria-label="Previous month">
            <Icon name="chevron-left" size={18} />
          </button>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-md p-1 text-secondary hover:bg-muted" aria-label="Next month">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {weekdayShort.map((day) => (
              <th key={day} scope="col" className="pb-2 text-left text-xs font-normal text-disabled">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((date, dayIndex) => (
                <td key={date ?? `pad-${dayIndex}`} className="h-24 border border-line p-1.5 align-top">
                  {date && (
                    <div className="flex h-full flex-col gap-1">
                      <span className="text-xs text-secondary">{Number(date.slice(8))}</span>
                      {(byDate.get(date) ?? []).map((event) => (
                        <Link
                          key={event.slug}
                          href={`/events/${event.slug}`}
                          className={cn("truncate rounded px-1.5 py-0.5 text-xs font-medium hover:underline", pillTone[event.format])}
                          title={`${event.title} · ${event.time}`}
                        >
                          {event.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
