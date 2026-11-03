import { cn } from "@chartermission/ui";

/** Grey placeholder bar for loading skeletons. */
export function SkeletonBar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-muted", className)} />;
}

/** Card-shaped loading placeholder with a few text lines. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-card border border-line bg-card p-5", className)}>
      <SkeletonBar className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBar key={i} className={cn("h-4", i % 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Table-shaped loading placeholder. */
export function SkeletonTable({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-card border border-line bg-card">
      <div className="h-10 bg-muted" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-t border-line px-4 py-3.5 first:border-t-0">
          <SkeletonBar className="h-4 flex-1" />
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="h-4 w-16" />
          <SkeletonBar className="h-5 w-20 rounded-full" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
