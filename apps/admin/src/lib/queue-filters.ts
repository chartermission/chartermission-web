import {
  ReportPriority,
  ReportReason,
  ReportTargetType,
  type AdminQueueQuery,
} from "@chartermission/contracts";

type Params = Record<string, string | string[] | undefined>;

export type QueueStatus = AdminQueueQuery["status"];
export type Assignee = AdminQueueQuery["assignee"];

/** Moderation queue filters, kept in the URL so a filtered view can be shared and reloaded. */
export type QueueFilters = {
  status: QueueStatus;
  priority?: ReportPriority;
  targetType?: ReportTargetType;
  /** Not supported by GET /admin/reports; applied to the loaded rows in the browser. */
  reason?: ReportReason;
  assignee: Assignee;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATUSES: QueueStatus[] = ["open", "in_review", "resolved", "all"];
const ASSIGNEES: Assignee[] = ["any", "me", "unassigned"];

export function parseQueueFilters(params: Params): QueueFilters {
  const status = first(params.status) as QueueStatus | undefined;
  const assignee = first(params.assignee) as Assignee | undefined;
  return {
    status: status && STATUSES.includes(status) ? status : "open",
    priority: ReportPriority.safeParse(first(params.priority)).data,
    targetType: ReportTargetType.safeParse(first(params.type)).data,
    reason: ReportReason.safeParse(first(params.reason)).data,
    assignee: assignee && ASSIGNEES.includes(assignee) ? assignee : "any",
  };
}

/** Query for GET /admin/reports. */
export function queueApiQuery(f: QueueFilters, cursor?: string | null) {
  return {
    status: f.status,
    priority: f.priority,
    targetType: f.targetType,
    reason: f.reason,
    assignee: f.assignee,
    cursor: cursor ?? undefined,
    limit: 25,
  };
}

/** URL search string for the queue page; defaults are omitted. */
export function queueSearch(f: QueueFilters, report?: string | null): string {
  const qs = new URLSearchParams();
  if (f.status !== "open") qs.set("status", f.status);
  if (f.priority) qs.set("priority", f.priority);
  if (f.targetType) qs.set("type", f.targetType);
  if (f.reason) qs.set("reason", f.reason);
  if (f.assignee !== "any") qs.set("assignee", f.assignee);
  if (report) qs.set("report", report);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Stable key for "these filters" (resets loaded pages when it changes). */
export const filtersKey = (f: QueueFilters) => queueSearch(f) || "default";
