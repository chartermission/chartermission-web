"use client";

import { useId, type ReactNode } from "react";
import { Panel, cn } from "@chartermission/ui";
import { Switch } from "./controls";

/** Page heading for a settings section. */
export function SettingsHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-h1 text-ink max-sm:text-h2">{title}</h1>
      {description && <p className="text-md text-secondary">{description}</p>}
    </header>
  );
}

/** Bordered card with a heading row and a divided list body (Figma 20:3109 cards). */
export function SettingsCard({
  id,
  title,
  description,
  aside,
  headerClassName,
  children,
  list = true,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  headerClassName?: string;
  children: ReactNode;
  /** Render children inside a divided <ul> (rows must be <li>). */
  list?: boolean;
  className?: string;
}) {
  return (
    <Panel id={id} aria-labelledby={`${id}-heading`} className={cn("flex scroll-mt-24 flex-col px-5 py-2", className)}>
      <div className={cn("flex items-center justify-between gap-4 py-3", headerClassName)}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={`${id}-heading`} className="text-h3 text-ink">
            {title}
          </h2>
          {description && <p className="text-xs text-secondary">{description}</p>}
        </div>
        {aside}
      </div>
      {list ? (
        <ul className="flex flex-col divide-y divide-line border-t border-line">{children}</ul>
      ) : (
        <div className="flex flex-col gap-4 border-t border-line py-4">{children}</div>
      )}
    </Panel>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </span>
        {description && (
          <span id={`${id}-description`} className="text-xs text-secondary">
            {description}
          </span>
        )}
      </div>
      <Switch
        label={label}
        describedBy={description ? `${id}-description` : undefined}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
    </li>
  );
}

/** Skeleton for a settings card while its data streams in. */
export function SettingsCardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <Panel aria-hidden="true" className={cn("flex flex-col px-5 py-2", className)}>
      <span className="my-4 h-5 w-1/3 animate-pulse rounded bg-muted" />
      <div className="flex flex-col divide-y divide-line border-t border-line">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 py-4">
            <span className="h-4 flex-1 animate-pulse rounded bg-muted" style={{ maxWidth: `${70 - index * 8}%` }} />
            <span className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function SettingsPageSkeleton({ cards = 2, rows = 3 }: { cards?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-5">
      <p role="status" className="sr-only">
        Loading settings…
      </p>
      {Array.from({ length: cards }, (_, index) => (
        <SettingsCardSkeleton key={index} rows={rows} />
      ))}
    </div>
  );
}
