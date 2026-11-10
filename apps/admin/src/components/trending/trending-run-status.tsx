"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip } from "@chartermission/ui";
import { useNow } from "@/components/time";
import { formatDateTime, relativePhrase } from "@/lib/format";
import { T } from "@/i18n/client";

/**
 * When the ranking shown was computed (Figma node 20:3590). The API recomputes on its schedule and
 * after every override or rules change; "Refresh" re-reads the latest snapshot.
 */
export function TrendingRunStatus({ computedAt, recomputeMinutes }: { computedAt: string | null; recomputeMinutes: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const now = useNow();
  const stale = computedAt !== null && now !== null && now - new Date(computedAt).getTime() > recomputeMinutes * 3 * 60_000;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" aria-live="polite">
        {refreshing ? (
          <Chip tone="info">Refreshing…</Chip>
        ) : computedAt === null ? (
          <Chip tone="warning">Not computed yet</Chip>
        ) : (
          <Chip tone={stale ? "warning" : "success"}>
            <span title={now === null ? undefined : formatDateTime(computedAt)}>
              Snapshot {now === null ? formatDateTime(computedAt, "UTC") : relativePhrase(computedAt, now)}
              {stale ? " · overdue" : ""}
            </span>
          </Chip>
        )}
      </p>
      <span className="text-xs text-secondary"><T vars={{ recomputeMinutes }}>{"Recomputes every {recomputeMinutes} min"}</T></span>
      <Button variant="secondary" size="small" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} aria-busy={refreshing}>
        Refresh
      </Button>
    </div>
  );
}
