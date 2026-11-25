import type { ProfileViewsSummary } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";

const PLOT = 120;

/**
 * Profile views per day for the last 30 days: plain bars, each with its date and count for screen readers and on hover.
 * `dayLabel` formats a day (YYYY-MM-DD) in the reader's language.
 */
export function ViewsChart({ daily, dayLabel, countLabel }: { daily: ProfileViewsSummary["daily"]; dayLabel: (day: string) => string; countLabel: (count: number) => string }) {
  const top = Math.max(4, ...daily.map((d) => d.views));
  return (
    <figure className="flex flex-col gap-2">
      <div dir="ltr" className="flex items-end gap-[3px]" style={{ height: PLOT }}>
        {daily.map((d) => {
          const label = `${dayLabel(d.day)}: ${countLabel(d.views)}`;
          return (
            <span key={d.day} className="flex h-full flex-1 items-end" title={label}>
              <span
                className={cn("w-full rounded-t-[3px]", d.views ? "bg-primary-light" : "bg-muted")}
                style={{ height: d.views ? Math.max(4, Math.round((d.views / top) * PLOT)) : 2 }}
              />
              <span className="sr-only">{label}</span>
            </span>
          );
        })}
      </div>
      <figcaption dir="ltr" className="flex justify-between text-xs text-secondary">
        <span>{dayLabel(daily[0]!.day)}</span>
        <span>{dayLabel(daily[daily.length - 1]!.day)}</span>
      </figcaption>
    </figure>
  );
}
