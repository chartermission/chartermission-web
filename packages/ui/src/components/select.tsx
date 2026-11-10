import type { SelectHTMLAttributes } from "react";
import { Icon } from "../icons";
import { cn } from "../cn";

/** Compact filter dropdown ("All countries ▾"). A styled native <select>. */
export function FilterSelect({
  label,
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        className="appearance-none rounded-lg border border-line bg-card py-1.5 ps-2.5 pe-[30px] text-sm text-body hover:border-line-strong"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute end-2.5 inset-y-0 my-auto h-fit text-secondary" />
    </span>
  );
}
