import type { ReactNode } from "react";
import { cn } from "../cn";

export type ChipTone = "hashtag" | "filter" | "active" | "neutral" | "success" | "warning" | "info" | "error";

const toneClasses: Record<ChipTone, string> = {
  hashtag: "bg-accent-light text-accent-hover",
  filter: "bg-card text-body border border-line",
  active: "bg-primary text-inverse",
  neutral: "bg-muted text-body",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  info: "bg-info-light text-info",
  error: "bg-error-light text-error",
};

export function chipClasses(tone: ChipTone = "neutral", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center rounded-full px-3 py-[5px] text-sm font-medium whitespace-nowrap",
    toneClasses[tone],
    className,
  );
}

/** Pill chip (Figma Chip, node 5:263). */
export function Chip({ tone = "neutral", className, children }: { tone?: ChipTone; className?: string; children: ReactNode }) {
  return <span className={chipClasses(tone, className)}>{children}</span>;
}
