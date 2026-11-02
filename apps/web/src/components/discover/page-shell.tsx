import type { ReactNode } from "react";
import { cn } from "@chartermission/ui";

/**
 * Full-width directory layout shared by Opportunities, Events, Network and
 * Learning: a centred 1208px column (32px top / 48px bottom padding, 20px gap).
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={cn("mx-auto flex w-full max-w-[1256px] flex-col gap-5 px-6 pb-12 pt-8", className)}>
      {children}
    </main>
  );
}

/** Page title block: H1 + secondary description, optional adornment and actions on the right. */
export function PageHeader({
  title,
  description,
  adornment,
  actions,
}: {
  title: string;
  description: string;
  adornment?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-h1 text-ink">{title}</h1>
          {adornment}
        </div>
        <p className="text-md text-secondary">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  );
}
