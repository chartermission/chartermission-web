"use client";

import type { ContentCalendarItem } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { useIntlTag, useT } from "@/i18n/client";
import { ENTRY_CLASSES, addDays, byDay, dayKey, monthGrid, startOfWeek, stateMeta, timeOf, utcTitle } from "./shared";

/** Most entries a month cell shows before "+N more". */
const PER_DAY = 3;

function weekdayNames(tag: string, style: "short" | "long"): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(tag, { weekday: style }).format(new Date(2024, 0, 1 + i)));
}

/** One compact entry: time and excerpt, coloured by state. */
function Entry({ item, onOpen, showTime = true }: { item: ContentCalendarItem; onOpen: (item: ContentCalendarItem) => void; showTime?: boolean }) {
  const tag = useIntlTag();
  const meta = stateMeta(item.state);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`${meta.label} · ${item.author.name} · ${utcTitle(item.at, tag)}`}
      className={cn("flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-start text-xs hover:brightness-95", ENTRY_CLASSES[item.state])}
    >
      {showTime && <span className="shrink-0 font-medium tabular-nums">{timeOf(item.at, tag)}</span>}
      <span dir="auto" className="truncate text-ink">{item.excerpt}</span>
      <span className="sr-only">
        {" "}
        · {meta.label} · {item.author.name}
      </span>
    </button>
  );
}

/** Month grid, Monday first, today highlighted; each day lists up to three items. */
export function MonthView({
  anchor,
  today,
  items,
  onOpen,
  onShowDay,
}: {
  anchor: Date;
  today: string;
  items: ContentCalendarItem[];
  onOpen: (item: ContentCalendarItem) => void;
  /** "+N more": show that day's week. */
  onShowDay: (day: string) => void;
}) {
  const t = useT();
  const tag = useIntlTag();
  const days = monthGrid(anchor);
  const grouped = byDay(items);
  const names = weekdayNames(tag, "short");
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <div role="grid" aria-label="Month" className="grid min-w-[760px] grid-cols-7">
        {names.map((name) => (
          <div key={name} role="columnheader" className="border-b border-line bg-muted px-2 py-2 text-label text-secondary uppercase">
            {name}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const list = grouped.get(key) ?? [];
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = key === today;
          return (
            <div
              key={key}
              role="gridcell"
              aria-current={isToday ? "date" : undefined}
              className={cn("flex min-h-[112px] flex-col gap-1 border-b border-s border-line p-1.5 first:border-s-0 [&:nth-child(7n+8)]:border-s-0", !inMonth && "bg-muted/50", isToday && "bg-primary-tint/50")}
            >
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums",
                  isToday ? "bg-primary font-semibold text-inverse" : inMonth ? "text-ink" : "text-disabled",
                )}
              >
                {day.getDate()}
              </span>
              {list.slice(0, PER_DAY).map((item) => (
                <Entry key={item.key} item={item} onOpen={onOpen} />
              ))}
              {list.length > PER_DAY && (
                <button type="button" onClick={() => onShowDay(key)} className="self-start rounded px-1 text-xs font-medium text-primary-light hover:underline">
                  {t("+{count} more", { count: list.length - PER_DAY })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Seven columns with every item of the week, by time. */
export function WeekView({ anchor, today, items, onOpen }: { anchor: Date; today: string; items: ContentCalendarItem[]; onOpen: (item: ContentCalendarItem) => void }) {
  const tag = useIntlTag();
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const grouped = byDay(items);
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <div className="grid min-w-[900px] grid-cols-7">
        {days.map((day, i) => {
          const key = dayKey(day);
          const list = grouped.get(key) ?? [];
          const isToday = key === today;
          return (
            <section key={key} aria-label={new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long" }).format(day)} className={cn("flex min-h-[360px] flex-col", i > 0 && "border-s border-line", isToday && "bg-primary-tint/40")}>
              <header className="flex items-baseline gap-1.5 border-b border-line bg-muted px-2 py-2">
                <span className="text-label text-secondary uppercase">{new Intl.DateTimeFormat(tag, { weekday: "short" }).format(day)}</span>
                <span className={cn("text-sm tabular-nums", isToday ? "font-semibold text-primary" : "text-ink")}>{day.getDate()}</span>
              </header>
              <ol className="flex flex-col gap-1.5 p-1.5">
                {list.map((item) => (
                  <li key={item.key}>
                    <WeekCard item={item} onOpen={onOpen} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WeekCard({ item, onOpen }: { item: ContentCalendarItem; onOpen: (item: ContentCalendarItem) => void }) {
  const tag = useIntlTag();
  const meta = stateMeta(item.state);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={utcTitle(item.at, tag)}
      className={cn("flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-start text-xs hover:brightness-95", ENTRY_CLASSES[item.state])}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="font-semibold tabular-nums">{timeOf(item.at, tag)}</span>
        <span className="truncate">{meta.label}</span>
      </span>
      <span dir="auto" className="line-clamp-2 text-ink">{item.excerpt}</span>
      <span className="truncate text-secondary">{item.author.name}</span>
    </button>
  );
}
