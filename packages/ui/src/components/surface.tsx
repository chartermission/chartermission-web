import type { HTMLAttributes } from "react";
import { cn } from "../cn";

/** White bordered panel used for sidebars, widgets and sections. */
export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-card border border-line bg-card", className)} {...rest} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("h-px w-full border-0 bg-line", className)} />;
}
