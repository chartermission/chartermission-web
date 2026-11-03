import type { ReactNode } from "react";
import { Icon, Panel, cn, type IconName } from "@chartermission/ui";

/**
 * Loading placeholders shown while URL- or session-dependent content streams in.
 * Heights roughly match the panels they stand in for, so nothing jumps when data lands.
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

export function PostSkeleton() {
  return (
    <Panel aria-hidden="true" className="flex h-[220px] flex-col gap-3.5 p-5">
      <div className="flex items-center gap-3">
        <span className="size-10 animate-pulse rounded-full bg-muted" />
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <span className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </span>
      </div>
      <span className="h-3.5 w-[92%] animate-pulse rounded bg-muted" />
      <span className="h-3.5 w-[80%] animate-pulse rounded bg-muted" />
      <span className="h-3.5 w-[60%] animate-pulse rounded bg-muted" />
      <span className="mt-auto h-px w-full bg-line" />
      <span className="h-5 w-full animate-pulse rounded bg-muted" />
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

/** Empty state panel with an icon, title, text and optional actions. */
export function EmptyState({
  icon = "hash",
  title,
  children,
  actions,
  className,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-md font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-secondary">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </Panel>
  );
}

/** Error state for a server-rendered section; the retry reloads the page. */
export function SectionError({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <Panel role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <Icon name="alert" size={22} className="text-error" />
      <p className="text-sm text-ink">{message}</p>
      <a href={retryHref} className="text-sm font-medium text-primary-light hover:underline">
        Try again
      </a>
    </Panel>
  );
}
