"use client";

import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@chartermission/ui";

/**
 * Follow/Connect-style toggle with aria-pressed. Keeps local state until the
 * API exists. `onVariant` restyles the pressed state (e.g. Follow → Following).
 */
export function ToggleButton({
  label,
  pressedLabel,
  srSuffix,
  variant,
  onVariant = "secondary",
  ...rest
}: Omit<ButtonProps, "children" | "onClick"> & {
  label: ReactNode;
  pressedLabel: ReactNode;
  /** Visually hidden context, e.g. the person's name. */
  srSuffix?: string;
  onVariant?: ButtonProps["variant"];
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Button {...rest} variant={pressed ? onVariant : variant} aria-pressed={pressed} onClick={() => setPressed((value) => !value)}>
      {pressed ? pressedLabel : label}
      {srSuffix && <span className="sr-only"> {srSuffix}</span>}
    </Button>
  );
}
