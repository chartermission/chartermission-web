import type { ReactNode } from "react";
import { cn } from "@chartermission/ui";

/**
 * Three-column member layout from the Figma feed screens:
 * 240px left rail · 600px main · 320px right rail, 24px gaps, centred.
 */
export function PageColumns({ left, right, children, className }: { left?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1232px] items-start justify-center gap-6 px-4 pb-12 pt-6", className)}>
      {left}
      <main id="main" className="flex w-full max-w-[600px] min-w-0 flex-col gap-4">
        {children}
      </main>
      {right}
    </div>
  );
}
