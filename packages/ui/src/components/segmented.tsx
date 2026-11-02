"use client";

import { cn } from "../cn";

/**
 * Segmented control used for feed views (For You / Following / Latest) and
 * time windows (24h / 7d). Renders a tablist; the parent owns the value.
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  size = "default",
  label,
  className,
}: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "default" | "small";
  label: string;
  className?: string;
}) {
  const small = size === "small";
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("inline-flex items-start bg-muted", small ? "gap-0.5 rounded-md p-0.5" : "gap-1 rounded-[10px] p-1", className)}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              "whitespace-nowrap transition-colors",
              small ? "rounded-[5px] px-2 py-[3px] text-xs" : "rounded-[7px] px-3.5 py-1.5 text-sm",
              selected
                ? cn("bg-card text-primary", !small && "font-medium shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)]")
                : "text-secondary hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
