import type { CSSProperties, ReactNode } from "react";
import { Icon, Panel, cn, type IconName } from "@chartermission/ui";
import { Illustration, illustrationForIcon, type IllustrationName } from "@/components/illustrations";

/** One placeholder shape with the shared shimmer sweep (static under reduced motion). */
export function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cn("motion-shimmer block rounded", className)} style={style} />;
}

/**
 * Loading placeholders shown while URL- or session-dependent content streams in.
 * Heights roughly match the panels they stand in for, so nothing jumps when data lands.
 */
export function PanelSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <Panel aria-hidden="true" className={cn("flex flex-col gap-3 p-5", className)}>
      <Bone className="h-5 w-2/5" />
      {Array.from({ length: lines }, (_, index) => (
        <Bone key={index} className="h-3.5" style={{ width: `${90 - index * 15}%` }} />
      ))}
    </Panel>
  );
}

export function PostSkeleton() {
  return (
    <Panel aria-hidden="true" className="flex h-[220px] flex-col gap-3.5 p-5">
      <div className="flex items-center gap-3">
        <Bone className="size-10 shrink-0 rounded-full" />
        <span className="flex flex-1 flex-col gap-1.5">
          <Bone className="h-4 w-1/3" />
          <Bone className="h-3 w-1/2" />
        </span>
      </div>
      <Bone className="h-3.5 w-[92%]" />
      <Bone className="h-3.5 w-[80%]" />
      <Bone className="h-3.5 w-[60%]" />
      <span className="mt-auto h-px w-full bg-line" />
      <span className="flex items-center justify-between">
        {[0, 1, 2, 3, 4].map((index) => (
          <Bone key={index} className="h-5 w-16 max-sm:w-10" />
        ))}
      </span>
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

/**
 * Empty state panel with an illustration (or icon), title, text and optional actions.
 * The illustration defaults from `icon` (see illustrationForIcon); pass `illustration`
 * to choose one, or `illustration={false}` for the small icon bubble.
 */
export function EmptyState({
  icon = "hash",
  illustration,
  title,
  children,
  actions,
  className,
}: {
  icon?: IconName;
  illustration?: IllustrationName | false;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const art = illustration === false ? undefined : (illustration ?? illustrationForIcon[icon]);
  return (
    <Panel className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", art && "pt-8", className)}>
      {art ? (
        <Illustration name={art} size={120} className="mb-1" />
      ) : (
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
          <Icon name={icon} size={22} />
        </span>
      )}
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
