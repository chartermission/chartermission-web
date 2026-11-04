"use client";

import { useState } from "react";
import { cn } from "@chartermission/ui";

/**
 * A number that ticks (slides in from below when it grows, from above when it shrinks)
 * when it changes after the first render. Tabular figures keep the width steady; under
 * reduced motion the new value simply fades in.
 */
export function TickNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  // Derive the direction from the previous render's value (no effect, no extra paint).
  if (value !== shown) {
    setDirection(value > shown ? "up" : "down");
    setShown(value);
  }
  return (
    <span className={cn("inline-flex overflow-hidden align-bottom tabular-nums", className)}>
      <span key={value} className={direction === "up" ? "motion-tick-up" : direction === "down" ? "motion-tick-down" : undefined}>
        {value}
      </span>
    </span>
  );
}
