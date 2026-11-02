import { Panel, cn } from "@chartermission/ui";

/**
 * Loading placeholders shown in the App Shell while URL-dependent content
 * (params) streams in. Heights roughly match the panels they stand in for.
 */
export function PanelSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <Panel aria-hidden="true" className={cn("flex flex-col gap-3 p-5", className)}>
      <span className="h-5 w-2/5 animate-pulse rounded bg-muted" />
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${90 - index * 15}%` }} />
      ))}
    </Panel>
  );
}

export function LoadingStatus({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}
