"use client";

import { useId, type ReactNode } from "react";
import { Icon, cn } from "@chartermission/ui";

export type ChipOption = { id: string; label: string; badge?: ReactNode };

/**
 * Multi-select as a group of toggle buttons (aria-pressed). Stops adding at `max` and says so.
 */
export function ChipPicker({
  label,
  description,
  options,
  selected,
  onChange,
  max,
  tone = "primary",
  emptyText = "Nothing to choose from yet.",
}: {
  label: string;
  description?: string;
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  tone?: "primary" | "hashtag";
  emptyText?: string;
}) {
  const id = useId();
  const atMax = max !== undefined && selected.length >= max;

  function toggle(optionId: string) {
    if (selected.includes(optionId)) onChange(selected.filter((value) => value !== optionId));
    else if (!atMax) onChange([...selected, optionId]);
  }

  return (
    <fieldset className="flex flex-col gap-2.5" aria-describedby={`${id}-count`}>
      <legend className="contents">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-md font-medium text-ink">{label}</span>
          <span id={`${id}-count`} aria-live="polite" className={cn("text-xs", atMax ? "text-warning" : "text-secondary")}>
            {selected.length} selected{max !== undefined ? ` · up to ${max}` : ""}
          </span>
        </span>
      </legend>
      {description && <p className="-mt-1.5 text-sm text-secondary">{description}</p>}
      {options.length === 0 ? (
        <p className="text-sm text-secondary">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {options.map((option) => {
            const on = selected.includes(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!on && atMax}
                  onClick={() => toggle(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-sm font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-not-allowed disabled:opacity-50",
                    on
                      ? tone === "hashtag"
                        ? "border-accent bg-accent-light text-accent-hover"
                        : "border-primary bg-primary text-inverse"
                      : "border-line bg-card text-body hover:border-line-strong hover:bg-muted",
                  )}
                >
                  {on ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} className="text-secondary" />}
                  {option.label}
                  {option.badge}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
