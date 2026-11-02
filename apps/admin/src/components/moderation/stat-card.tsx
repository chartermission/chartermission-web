import { cn } from "@chartermission/ui";
import type { ModerationStat } from "@/lib/mock/moderation";

const noteTone: Record<ModerationStat["tone"], string> = {
  error: "text-error",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
};

/** Summary metric card (Figma "Card", node 12:1649). */
export function StatCard({ stat }: { stat: ModerationStat }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-card p-[18px]">
      <dt className="text-sm text-secondary">{stat.label}</dt>
      <dd className="text-h1 text-ink">{stat.value}</dd>
      <dd className={cn("text-xs", noteTone[stat.tone])}>{stat.note}</dd>
    </div>
  );
}
