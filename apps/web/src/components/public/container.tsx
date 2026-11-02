import type { ReactNode } from "react";
import { cn } from "@chartermission/ui";

/** 1208px content column used by every public section (116px gutters at 1440). */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1272px] px-8", className)}>{children}</div>;
}
