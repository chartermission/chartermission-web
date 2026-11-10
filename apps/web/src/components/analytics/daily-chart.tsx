"use client";

import { useState } from "react";
import type { AnalyticsDay } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { T } from "@/i18n/client";

type Metric = "impressions" | "engagements";

const metricLabel: Record<Metric, string> = { impressions: "Impressions", engagements: "Engagements" };

/** Plot height in px. */
const PLOT = 148;

const number = new Intl.NumberFormat("en-GB");
const dayLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A round number at or above `max`, so the top gridline has a clean label. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}

/**
 * Per-day bars for one measure at a time (impressions or engagements: two measures of different
 * size never share an axis). Hover or focus a day for its numbers; screen readers get a table.
 */
export function DailyChart({ days, title = "Day by day" }: { days: AnalyticsDay[]; title?: string }) {
  const [metric, setMetric] = useState<Metric>("impressions");
  const [active, setActive] = useState<number | null>(null);
  const values = days.map((d) => d[metric]);
  const top = niceMax(Math.max(...values, 0));
  const total = values.reduce((sum, v) => sum + v, 0);
  const shown = active !== null ? days[active] : null;
  // A label under roughly every seventh day keeps the axis readable at 7, 28 and 90 days.
  const labelEvery = days.length <= 7 ? 1 : days.length <= 28 ? 7 : 15;
  const dense = days.length > 40;

  return (
    <figure dir="ltr" className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-h3 text-ink">{title}</span>
        <span role="radiogroup" aria-label="Measure" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(Object.keys(metricLabel) as Metric[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={metric === value}
              onClick={() => setMetric(value)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium",
                metric === value ? "bg-card text-primary shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]" : "text-secondary hover:text-ink",
              )}
            >
              {metricLabel[value]}
            </button>
          ))}
        </span>
      </figcaption>

      {/* The readout: the hovered day, or the total for the period. */}
      <p className="flex items-baseline gap-2 text-sm text-secondary" aria-live="off">
        <span className="text-h2 text-ink tabular-nums">{number.format(shown ? shown[metric] : total)}</span>
        <span>
          {metricLabel[metric].toLowerCase()} {shown ? `on ${dayLong(shown.day)}` : `in the last ${days.length} days`}
        </span>
        {shown && metric === "impressions" && <span><T vars={{ count: number.format(shown.viewers) }}>{"· {count} new viewers"}</T></span>}
      </p>

      <div aria-hidden="true" className="flex gap-2">
        <div className="flex flex-col justify-between text-end text-[11px] leading-none text-secondary tabular-nums" style={{ height: PLOT }}>
          <span>{number.format(top)}</span>
          <span>{number.format(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative flex items-end border-b border-line-strong"
            style={{ height: PLOT, gap: dense ? 1 : 2 }}
            onPointerLeave={() => setActive(null)}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
            {days.map((day, index) => {
              const value = day[metric];
              const height = value > 0 ? Math.max(3, Math.round((value / top) * PLOT)) : 0;
              return (
                // The whole column is the hit target, so thin and empty days are still easy to point at.
                <button
                  key={day.day}
                  type="button"
                  tabIndex={-1}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                >
                  <span
                    className={cn(
                      "w-full max-w-7 rounded-t-[4px] transition-colors",
                      active === index ? "bg-primary-dark" : "bg-primary-light",
                      active !== null && active !== index && "opacity-60",
                    )}
                    style={{ height }}
                  />
                </button>
              );
            })}
          </div>
          <div className="flex pt-1.5" style={{ gap: dense ? 1 : 2 }}>
            {days.map((day, index) => {
              const last = index === days.length - 1;
              const show = last || (index % labelEvery === 0 && days.length - 1 - index >= labelEvery / 2);
              return (
                <span key={day.day} className="relative h-4 min-w-0 flex-1">
                  {show && (
                    <span className={cn("absolute top-0 text-[11px] whitespace-nowrap text-secondary", last ? "end-0" : index === 0 ? "start-0" : "left-1/2 -translate-x-1/2")}>
                      {last ? "Today" : dayShort(day.day)}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>
          <T vars={{ value: metricLabel[metric], count: days.length }}>{"{value} per day, last {count} days"}</T>
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Impressions</th>
            <th scope="col">New viewers</th>
            <th scope="col">Engagements</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{dayLong(day.day)}</th>
              <td>{day.impressions}</td>
              <td>{day.viewers}</td>
              <td>{day.engagements}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
