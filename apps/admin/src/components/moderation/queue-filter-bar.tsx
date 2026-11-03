"use client";

import { FilterSelect } from "@chartermission/ui";
import type { ReportPriority, ReportReason, ReportTargetType } from "@chartermission/contracts";
import { REASON_OPTIONS, TARGET_LABELS } from "@/lib/labels";
import type { Assignee, QueueFilters, QueueStatus } from "@/lib/queue-filters";

const STATUS_OPTIONS: { value: QueueStatus; label: string }[] = [
  { value: "open", label: "Open and in review" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All statuses" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "high", label: "High priority" },
  { value: "medium", label: "Medium priority" },
  { value: "low", label: "Low priority" },
];

const TYPE_OPTIONS = [
  { value: "", label: "All content types" },
  ...(Object.keys(TARGET_LABELS) as ReportTargetType[]).map((value) => ({ value, label: `${TARGET_LABELS[value]}s` })),
];

const ASSIGNEE_OPTIONS: { value: Assignee; label: string }[] = [
  { value: "any", label: "Anyone’s" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];

/** Queue filters; each change navigates so the filtered view lives in the URL. */
export function QueueFilterBar({
  filters,
  onChange,
  busy,
}: {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  busy?: boolean;
}) {
  const set = <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => onChange({ ...filters, [key]: value });
  const filtered =
    filters.status !== "open" || !!filters.priority || !!filters.targetType || !!filters.reason || filters.assignee !== "any";
  return (
    <div role="group" aria-label="Filter reports" aria-busy={busy} className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Status"
        options={STATUS_OPTIONS}
        value={filters.status}
        onChange={(e) => set("status", e.target.value as QueueStatus)}
      />
      <FilterSelect
        label="Priority"
        options={PRIORITY_OPTIONS}
        value={filters.priority ?? ""}
        onChange={(e) => set("priority", (e.target.value || undefined) as ReportPriority | undefined)}
      />
      <FilterSelect
        label="Content type"
        options={TYPE_OPTIONS}
        value={filters.targetType ?? ""}
        onChange={(e) => set("targetType", (e.target.value || undefined) as ReportTargetType | undefined)}
      />
      <FilterSelect
        label="Reason"
        options={[{ value: "", label: "All reasons" }, ...REASON_OPTIONS]}
        value={filters.reason ?? ""}
        onChange={(e) => set("reason", (e.target.value || undefined) as ReportReason | undefined)}
      />
      <FilterSelect
        label="Assignee"
        options={ASSIGNEE_OPTIONS}
        value={filters.assignee}
        onChange={(e) => set("assignee", e.target.value as Assignee)}
      />
      {filtered && (
        <button
          type="button"
          onClick={() => onChange({ status: "open", assignee: "any" })}
          className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
