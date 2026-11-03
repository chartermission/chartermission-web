"use client";

import type { SelectHTMLAttributes } from "react";
import { FieldVisibility } from "@chartermission/contracts";
import { Icon, cn, type IconName } from "@chartermission/ui";

/** 40×22 toggle (Figma "Toggle", nodes 20:3247 on / 20:3254 off) exposed as an ARIA switch. */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  describedBy?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-primary enabled:hover:bg-primary-light" : "bg-line-strong enabled:hover:bg-disabled",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 size-[18px] rounded-full bg-card shadow-[0px_1px_2px_0px_rgba(26,32,44,0.15)] transition-transform",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

const visibilityMeta: Record<FieldVisibility, { label: string; icon: IconName }> = {
  public: { label: "Public", icon: "globe" },
  members: { label: "Members", icon: "users" },
  connections: { label: "Connections", icon: "user" },
  only_me: { label: "Only me", icon: "eye-off" },
};

/** Options derived from the contracts enum so they can never drift from the API. */
export const visibilityOptions = FieldVisibility.options.map((value) => ({ value, ...visibilityMeta[value] }));

const selectClasses =
  "w-[180px] appearance-none rounded-lg border border-line bg-card py-2 pr-9 text-sm text-body hover:border-line-strong focus:border-primary-light focus:outline-none";

/** Per-field visibility dropdown with the option's icon (Figma 20:3162). Native <select>. */
export function VisibilitySelect({
  value,
  onChange,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: FieldVisibility;
  onChange: (value: FieldVisibility) => void;
}) {
  const current = visibilityOptions.find((option) => option.value === value) ?? visibilityOptions[0];
  return (
    <span className="relative inline-flex shrink-0">
      <Icon
        name={current.icon}
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary-light"
      />
      <select
        value={value}
        onChange={(event) => {
          const parsed = FieldVisibility.safeParse(event.target.value);
          if (parsed.success) onChange(parsed.data);
        }}
        className={cn(selectClasses, "pl-9")}
        {...rest}
      >
        {visibilityOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Chevron />
    </span>
  );
}

/** Plain settings dropdown (Figma 20:3261). */
export function SettingsSelect({
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: readonly { value: string; label: string }[] }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <select className={cn(selectClasses, "pl-3")} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Chevron />
    </span>
  );
}

function Chevron() {
  return (
    <Icon
      name="chevron-down"
      size={16}
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-secondary"
    />
  );
}
