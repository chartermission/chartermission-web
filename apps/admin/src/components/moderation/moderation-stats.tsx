import type { QueueStats } from "@chartermission/contracts";
import { apiGet, requireViewer } from "@/lib/api/server";
import { ApiError } from "@/lib/api/errors";
import { formatCount, formatMinutes } from "@/lib/format";
import { getT } from "@/i18n/server";
import { PERM, can } from "@/lib/permissions";
import { ErrorState } from "@/components/states";
import { StatCard, type ModerationStat } from "./stat-card";

/** Summary cards (Figma node 12:1648) from GET /admin/queue/stats. */
export async function ModerationStats({ next }: { next: string }) {
  const viewer = await requireViewer(next);
  const t = await getT();
  if (!can(viewer, PERM.moderationView)) return null;
  let stats: QueueStats;
  try {
    stats = await apiGet<QueueStats>("/admin/queue/stats");
  } catch (e) {
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "Queue statistics couldn’t be loaded."} />
      </div>
    );
  }
  const cards: ModerationStat[] = [
    {
      label: "Open reports",
      value: formatCount(stats.openReports),
      note: stats.highPriority ? t("{count} high priority", { count: stats.highPriority }) : "None high priority",
      tone: stats.highPriority ? "error" : "success",
    },
    {
      label: "Median time to resolve",
      value: stats.medianResolveMinutes === null ? "—" : formatMinutes(stats.medianResolveMinutes),
      note:
        stats.medianResolveMinutes === null
          ? "No reports resolved in 30 days"
          : stats.medianResolveMinutes <= 24 * 60
            ? "Last 30 days · target under 24h"
            : "Last 30 days · over the 24h target",
      tone: stats.medianResolveMinutes !== null && stats.medianResolveMinutes > 24 * 60 ? "warning" : "success",
    },
    {
      label: "Open appeals",
      value: formatCount(stats.openAppeals),
      note: "Decided by a different moderator",
      tone: "info",
    },
    {
      label: "Hidden content",
      value: formatCount(stats.hiddenContent),
      note: stats.blockedUploads
        ? t("{count} uploads blocked by scanning", { count: stats.blockedUploads })
        : "Posts and comments hidden or removed",
      tone: "neutral",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {cards.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </dl>
  );
}
