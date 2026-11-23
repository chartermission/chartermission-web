"use client";

import { useEffect, useRef } from "react";
import { cn } from "@chartermission/ui";

/** Checkbox for picking a row, or every shown row ("some" shows the mixed state). */
export function SelectBox({
  checked,
  label,
  onChange,
  disabled,
  className,
}: {
  checked: boolean | "some";
  /** Read by screen readers: "Select Ada Obi", "Select all shown". */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === "some";
  }, [checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked === true}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={cn("size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed", className)}
    />
  );
}

/** Header checkbox for a list: picks or clears every row shown. */
export function SelectAllBox({
  state,
  onToggle,
  disabled,
}: {
  state: "all" | "some" | "none";
  onToggle: () => void;
  disabled?: boolean;
}) {
  return <SelectBox checked={state === "all" ? true : state === "some" ? "some" : false} label="Select all shown" onChange={onToggle} disabled={disabled} />;
}
