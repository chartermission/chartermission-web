import { cn } from "@chartermission/ui";
import { SkeletonBar } from "@/components/skeletons";

export type ModerationStat = {
  label: string;
  value: string;
  note: string;
  tone: "error" | "success" | "warning" | "info" | "neutral";
};

const noteTone: Record<ModerationStat["tone"], string> = {
  error: "text-error",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  neutral: "text-secondary",
};

/** Summary metric card (Figma "Card", node 12:1649). */
export function StatCard({ stat }: { stat: ModerationStat }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-card p-4 sm:p-[18px]">
      <dt className="text-sm text-secondary">{stat.label}</dt>
      <dd className="text-h2 text-ink sm:text-h1">{stat.value}</dd>
      <dd className={cn("text-xs", noteTone[stat.tone])}>{stat.note}</dd>
    </div>
  );
}

export function StatCardsSkeleton() {
  return (
    <div role="status" aria-label="Loading queue statistics" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-4 sm:p-[18px]">
          <SkeletonBar className="h-4 w-28" />
          <SkeletonBar className="h-8 w-16" />
          <SkeletonBar className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
