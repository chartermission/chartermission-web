import type { ReactNode } from "react";

/** Console page title row: H1, one-line description and right-aligned actions. */
export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 text-ink">{title}</h1>
        <p className="text-sm text-secondary">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
