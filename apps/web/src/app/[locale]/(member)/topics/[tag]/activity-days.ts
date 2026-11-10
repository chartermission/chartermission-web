import type { Translate } from "@/i18n/translate";
import type { ChartDay } from "./activity-chart";

/**
 * Labels for the 7 UTC days the API buckets activity by (oldest first, last = today).
 * Called on the server so the labels match on hydration.
 */
export function activityDays(intl: string, t: Translate, now: Date): ChartDay[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today - (6 - index) * 86_400_000);
    const long = date.toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    if (index === 6) return { short: "Today", long: t("Today, {long}", { long }) };
    return { short: date.toLocaleDateString(intl, { weekday: "short", timeZone: "UTC" }), long };
  });
}
