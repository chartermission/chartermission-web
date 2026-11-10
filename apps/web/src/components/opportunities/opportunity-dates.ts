import type { OpportunitySummary } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";
import { addDays, formatDayMonth } from "@/components/discover/dates";
import type { Translate } from "@/i18n/translate";

/** Today in UTC, matching the API's whole-day deadlines. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** "Closes 14 Nov" (warning within a week), "Closed", or "Rolling". */
export function deadlineChip(intl: string, t: Translate, o: Pick<OpportunitySummary, "deadline" | "status">): { label: string; tone: ChipTone } {
  if (o.status === "closed") return { label: t("Closed"), tone: "neutral" };
  if (!o.deadline) return { label: t("Rolling deadline"), tone: "neutral" };
  const today = todayIso();
  if (o.deadline === today) return { label: t("Closes today"), tone: "warning" };
  return { label: t("Closes {date}", { date: formatDayMonth(intl, o.deadline) }), tone: o.deadline <= addDays(today, 7) ? "warning" : "neutral" };
}
