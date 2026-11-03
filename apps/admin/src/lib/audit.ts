type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Audit log filters, kept in the URL. Dates are UTC calendar days (YYYY-MM-DD). */
export type AuditFilters = { actor?: string; action?: string; targetType?: string; from?: string; to?: string };

export function parseAuditFilters(params: Params): AuditFilters {
  const from = first(params.from);
  const to = first(params.to);
  return {
    actor: first(params.actor)?.slice(0, 80),
    action: first(params.action)?.slice(0, 60),
    targetType: first(params.target)?.slice(0, 40),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
}

export function auditSearch(f: AuditFilters): string {
  const qs = new URLSearchParams();
  if (f.actor) qs.set("actor", f.actor);
  if (f.action) qs.set("action", f.action);
  if (f.targetType) qs.set("target", f.targetType);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();

/**
 * Query for GET /admin/audit and the CSV export. Dates are whole UTC days: `from` starts at
 * 00:00 UTC, `to` includes the whole day (the API's upper bound is exclusive).
 */
export function auditApiQuery(f: AuditFilters) {
  return {
    actor: f.actor,
    action: f.action,
    targetType: f.targetType,
    from: f.from ? `${f.from}T00:00:00.000Z` : undefined,
    to: f.to ? nextDay(f.to) : undefined,
  };
}

export const AUDIT_PAGE_SIZE = 50;
