import { InviteKind, ReferralPeriod, type AdminReferralsQuery } from "@chartermission/contracts";

type Params = Record<string, string | string[] | undefined>;

/** Referrals page filters, kept in the URL so a filtered view can be shared and reloaded. */
export type ReferralFilters = {
  q?: string;
  kind?: InviteKind;
  inviter?: string;
  from?: string;
  to?: string;
  confirmed?: "yes" | "no";
  period: ReferralPeriod;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReferralFilters(params: Params): ReferralFilters {
  const q = first(params.q)?.trim().slice(0, 100);
  const from = first(params.from);
  const to = first(params.to);
  const inviter = first(params.inviter);
  const confirmed = first(params.confirmed);
  return {
    q: q || undefined,
    kind: InviteKind.safeParse(first(params.kind)).data,
    inviter: inviter && UUID.test(inviter) ? inviter : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    confirmed: confirmed === "yes" || confirmed === "no" ? confirmed : undefined,
    period: ReferralPeriod.safeParse(first(params.period)).data ?? "30d",
  };
}

/** Query for GET /admin/referrals (and, without period/cursor/limit, its CSV export). */
export function referralsApiQuery(f: ReferralFilters, cursor?: string | null): Partial<Record<keyof AdminReferralsQuery, string | number>> {
  return {
    q: f.q,
    kind: f.kind,
    inviter: f.inviter,
    from: f.from,
    to: f.to,
    confirmed: f.confirmed,
    period: f.period,
    cursor: cursor ?? undefined,
    limit: 50,
  };
}

/** URL search string for the referrals page; defaults are left out. */
export function referralsSearch(f: ReferralFilters): string {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  if (f.kind) qs.set("kind", f.kind);
  if (f.inviter) qs.set("inviter", f.inviter);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.confirmed) qs.set("confirmed", f.confirmed);
  if (f.period !== "30d") qs.set("period", f.period);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** True when any filter on the sign-ups is set (the period only changes Top inviters). */
export const hasReferralFilters = (f: ReferralFilters) => !!(f.q || f.kind || f.inviter || f.from || f.to || f.confirmed);

/** Query for GET /admin/referrals/export.csv: the sign-up filters only. */
export function referralsExportQuery(f: ReferralFilters): Record<string, string | undefined> {
  return { q: f.q, kind: f.kind, inviter: f.inviter, from: f.from, to: f.to, confirmed: f.confirmed };
}
