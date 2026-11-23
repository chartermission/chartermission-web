"use client";

import type { ReactNode } from "react";
import { Button, Icon } from "@chartermission/ui";
import { useT } from "@/i18n/client";

/**
 * Action bar for the rows picked in a list. It sticks to the bottom of the window while anything
 * is picked, so the actions stay in reach on long lists. Put Buttons (size="small") in `children`.
 */
export function BulkBar({ count, busy, onClear, children }: { count: number; busy?: boolean; onClear: () => void; children: ReactNode }) {
  const t = useT();
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Batch actions"
      className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-card border border-line-strong bg-card px-3 py-2 shadow-[0_8px_28px_rgba(25,37,80,0.18)]"
      aria-busy={busy}
    >
      <span className="flex items-center gap-2 pe-2 text-sm font-medium text-ink tabular-nums">
        <Icon name="check" size={16} className="text-primary" />
        {t("{count} selected", { count })}
      </span>
      <span className="h-5 w-px bg-line" aria-hidden />
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      <span className="h-5 w-px bg-line" aria-hidden />
      <Button variant="ghost" size="small" disabled={busy} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
