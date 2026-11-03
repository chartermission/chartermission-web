import type { ReactNode } from "react";
import { cn } from "@chartermission/ui";
import { Toaster } from "./social/toast";

/**
 * Three-column member layout from the Figma feed screens:
 * 240px left rail · 600px main · 320px right rail, 24px gaps, centred.
 * Rails collapse below their breakpoints (left under lg, right under xl) so the
 * main column fills small screens.
 */
export function PageColumns({ left, right, children, className }: { left?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1232px] items-start justify-center gap-6 px-4 pb-12 pt-6 max-sm:px-3 max-sm:pt-4", className)}>
      {left && <div className="hidden shrink-0 lg:block">{left}</div>}
      <main id="main" className="flex w-full max-w-[600px] min-w-0 flex-col gap-4">
        {children}
      </main>
      {right && <div className="hidden shrink-0 xl:block">{right}</div>}
      <Toaster />
    </div>
  );
}
