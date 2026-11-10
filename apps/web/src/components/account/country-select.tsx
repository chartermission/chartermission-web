"use client";

import type { SelectHTMLAttributes } from "react";
import { Icon, cn } from "@chartermission/ui";
import { boxClasses, focusRing } from "@/components/auth/fields";
import type { CountryGroup } from "@/lib/taxonomies";

/** Country select grouped by region (from GET /taxonomies). Value is the ISO alpha-2 code. */
export function CountrySelect({
  groups,
  invalid = false,
  placeholder = "Select a country",
  className,
  value,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  groups: CountryGroup[];
  invalid?: boolean;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        aria-invalid={invalid || undefined}
        className={cn(
          boxClasses(invalid),
          focusRing(invalid),
          "cursor-pointer appearance-none pe-10 ps-3.5",
          value ? "text-ink" : "text-disabled",
        )}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label} className="text-ink">
            {group.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={18}
        className="pointer-events-none absolute top-1/2 end-3.5 -translate-y-1/2 text-secondary"
      />
    </div>
  );
}
