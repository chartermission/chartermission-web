import { cn } from "@chartermission/ui";

/** Plot height for the tallest bar, in px. */
const PLOT = 56;
/** Non-zero days never draw shorter than this, so a single post is still visible. */
const MIN_BAR = 6;

export type ChartDay = { short: string; long: string };

/**
 * Labels for the 7 UTC days the API buckets activity by (oldest first, last = today).
 * Called on the server so the labels match on hydration.
 */
export function activityDays(now: Date): ChartDay[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today - (6 - index) * 86_400_000);
    const long = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    if (index === 6) return { short: "Today", long: `Today, ${long}` };
    return { short: date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), long };
  });
}

const fallbackDays: ChartDay[] = ["6 days ago", "5 days ago", "4 days ago", "3 days ago", "2 days ago", "Yesterday", "Today"].map((label, index) => ({
  short: index === 6 ? "Today" : index === 5 ? "Yest." : `-${6 - index}d`,
  long: label,
}));

const posts = (n: number) => `${n.toLocaleString("en-US")} post${n === 1 ? "" : "s"}`;

/**
 * Posts per day over the last 7 days: day columns on a baseline with weekday labels, the count
 * over each bar, today highlighted (colour and label). Screen readers get a table instead.
 */
export function ActivityChart({ values, days = fallbackDays }: { values: number[]; days?: ChartDay[] }) {
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  const last = values.length - 1;

  return (
    <figure className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface px-4 pb-3 pt-3.5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-secondary">Activity · last 7 days</span>
        <span className="text-sm font-semibold text-ink">{posts(total)}</span>
      </figcaption>

      <div aria-hidden="true" className="flex flex-col">
        <div className="flex items-end gap-2 border-b border-line-strong" style={{ height: PLOT + 20 }}>
          {values.map((value, index) => {
            const today = index === last;
            const height = value > 0 ? Math.max(MIN_BAR, Math.round((value / max) * PLOT)) : 2;
            return (
              <div key={index} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${days[index]?.long}: ${posts(value)}`}>
                {value > 0 && (
                  <span className={cn("text-xs tabular-nums", today ? "font-semibold text-accent-hover" : "text-body")}>{value.toLocaleString("en-US")}</span>
                )}
                <span
                  className={cn(
                    "w-full max-w-9 rounded-t-[4px]",
                    value === 0 ? "bg-line-strong/70" : today ? "bg-accent" : "bg-primary-light",
                  )}
                  style={{ height }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 pt-1.5">
          {values.map((_, index) => (
            <span
              key={index}
              className={cn("min-w-0 flex-1 truncate text-center text-xs", index === last ? "font-semibold text-ink" : "text-secondary")}
            >
              {days[index]?.short}
            </span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>Posts per day, last 7 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Posts</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value, index) => (
            <tr key={index}>
              <th scope="row">{days[index]?.long}</th>
              <td>{value.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
