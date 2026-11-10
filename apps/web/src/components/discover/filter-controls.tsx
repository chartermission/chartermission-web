import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Icon, chipClasses, cn } from "@chartermission/ui";

/*
 * Form controls for the directory filter panels (Figma Opportunities 10:977,
 * Network 17:1712). Native inputs styled to match the design so keyboard and
 * screen-reader behaviour comes for free.
 */

/** "TYPE", "LOCATION"… group heading + its controls. Renders a fieldset. */
export function FilterGroup({
  legend,
  tight = false,
  children,
  className,
}: {
  legend: string;
  /** 8px rhythm (Network panel) instead of 10px (Opportunities panel). */
  tight?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col", tight ? "gap-2" : "gap-2.5", className)}>
      <legend className={cn("text-label uppercase text-secondary", tight ? "mb-2" : "mb-2.5")}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * 16px square checkbox row. Pass type="radio" for mutually exclusive options
 * (same square look as the design).
 */
export function CheckRow({
  label,
  count,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "checkbox" | "radio";
  label: string;
  count?: number;
}) {
  return (
    <label className={cn("group flex cursor-pointer items-center justify-between gap-2.5", className)}>
      <span className="flex items-center gap-2.5">
        <span className="relative flex size-4 shrink-0">
          <input
            type="checkbox"
            {...input}
            className="peer size-4 cursor-pointer appearance-none rounded-[4px] border border-line-strong bg-card checked:border-primary checked:bg-primary"
          />
          <Icon
            name="check"
            size={12}
            className="pointer-events-none absolute start-0.5 top-0.5 hidden text-inverse peer-checked:block"
          />
        </span>
        <span className="text-sm text-body group-has-checked:text-ink">{label}</span>
      </span>
      {count !== undefined && <span className="text-xs text-disabled">{count}</span>}
    </label>
  );
}

/** Full-width bordered select ("Any country ▾"), 12px / 9px padding. */
export function SelectField({
  label,
  options,
  hideLabel = true,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hideLabel?: boolean;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className={cn("relative flex items-center gap-2", className)}>
      <span className={hideLabel ? "sr-only" : "whitespace-nowrap text-sm text-secondary"}>{label}</span>
      <select
        className="w-full cursor-pointer appearance-none rounded-lg border border-line bg-card py-[9px] ps-3 pe-9 text-sm text-body hover:border-line-strong"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-secondary" />
    </label>
  );
}

/** 44px search box with a leading icon (Figma search field on Opportunities / Learning). */
export function SearchField({
  label,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label
      className={cn(
        "flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 text-disabled focus-within:border-primary-light focus-within:ring-2 focus-within:ring-primary-light/20",
        className,
      )}
    >
      <Icon name="search" size={18} className="shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        {...input}
        className="h-full w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
      />
    </label>
  );
}

/** Pill toggle (filter chip ↔ active chip). */
export function ToggleChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={chipClasses(active ? "active" : "filter", cn("cursor-pointer transition-colors", !active && "hover:border-line-strong hover:text-ink", className))}
    >
      {children}
    </button>
  );
}

/** Removable active-filter pill ("Jobs ✕"). */
export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint py-[5px] ps-3 pe-2 text-sm font-medium text-primary">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter: ${label}`} className="rounded-full hover:bg-primary/10">
        <Icon name="x" size={14} />
      </button>
    </span>
  );
}
