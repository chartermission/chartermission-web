import type { ReactNode } from "react";
import { cn } from "@chartermission/ui";
import { Illustration } from "./illustrations";
import { BrandPattern } from "./pattern";

/**
 * End-of-list moment: "You're all caught up", with the sunrise illustration over a faint
 * brand pattern. Compact (about 88px tall) so it rewards without taking over the page.
 */
export function CaughtUpNote({
  title = "You’re all caught up",
  children = "You’ve seen everything here. Check back later for new posts.",
  className,
}: {
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex items-center justify-center gap-4 overflow-hidden rounded-card border border-line bg-card px-5 py-3 max-sm:px-4", className)}>
      <BrandPattern fade="radial" opacity={0.07} />
      <Illustration name="caught-up" size={88} className="relative -my-1" />
      <div className="relative flex min-w-0 flex-col gap-0.5">
        <p className="text-md font-medium text-ink">{title}</p>
        {children && <p className="text-xs text-secondary">{children}</p>}
      </div>
    </div>
  );
}
