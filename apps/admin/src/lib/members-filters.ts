import type { AdminMemberRoleFilter, AdminMembersSort, AdminMemberStatus, AdminMembersQuery } from "@chartermission/contracts";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuickFilter = Exclude<AdminMembersQuery["filter"], "badge">;

/**
 * Members page filters, kept in the URL so a filtered view can be shared and survives a reload.
 * Names match the API query (GET /admin/members); dates are UTC days (YYYY-MM-DD).
 */
export type MembersFilters = {
  q?: string;
  /** Quick filter (the segments above the list). */
  filter?: QuickFilter;
  /** Badge slug. */
  badge?: string;
  country?: string;
  chapter?: string;
  status?: AdminMemberStatus;
  role?: AdminMemberRoleFilter;
  joinedFrom?: string;
  joinedTo?: string;
  emailVerified?: "yes" | "no";
  twoStep?: "on" | "off";
  photo?: "yes" | "no";
  referred?: "yes" | "no";
  skill?: string;
  sector?: string;
  interest?: string;
  language?: string;
  sort?: AdminMembersSort;
};

/** The filters in the Filters panel, in the order their chips show. */
export const PANEL_FILTERS = [
  "country",
  "chapter",
  "status",
  "role",
  "joinedFrom",
  "joinedTo",
  "emailVerified",
  "twoStep",
  "photo",
  "referred",
  "skill",
  "sector",
  "interest",
  "language",
] as const;
export type PanelFilter = (typeof PANEL_FILTERS)[number];

const QUICK: readonly QuickFilter[] = ["all", "verified", "unverified", "featured", "claude"];
export const MEMBER_STATUSES: readonly AdminMemberStatus[] = ["active", "unverified", "suspended", "deactivated", "deletion_pending"];
export const MEMBER_ROLES: readonly AdminMemberRoleFilter[] = ["moderator", "platform_admin", "super_admin", "event_host", "team", "official"];
export const MEMBER_SORTS: readonly AdminMembersSort[] = ["newest", "oldest", "name"];

const pick = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
const yesNo = (v: string | undefined) => pick(v, ["yes", "no"] as const);
const uuid = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);
const day = (v: string | undefined) => (v && DATE.test(v) ? v : undefined);

export function parseMembersFilters(params: Params): MembersFilters {
  const country = first(params.country)?.toUpperCase();
  return {
    q: first(params.q)?.slice(0, 100),
    filter: pick(first(params.filter), QUICK),
    badge: first(params.badge)?.slice(0, 60),
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    chapter: uuid(first(params.chapter)),
    status: pick(first(params.status), MEMBER_STATUSES),
    role: pick(first(params.role), MEMBER_ROLES),
    joinedFrom: day(first(params.joinedFrom)),
    joinedTo: day(first(params.joinedTo)),
    emailVerified: yesNo(first(params.emailVerified)),
    twoStep: pick(first(params.twoStep), ["on", "off"] as const),
    photo: yesNo(first(params.photo)),
    referred: yesNo(first(params.referred)),
    skill: uuid(first(params.skill)),
    sector: uuid(first(params.sector)),
    interest: uuid(first(params.interest)),
    language: uuid(first(params.language)),
    sort: pick(first(params.sort), MEMBER_SORTS),
  };
}

/** Query for GET /admin/members and the CSV export: only what is set, defaults left out. */
export function membersApiQuery(f: MembersFilters): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(f) as [keyof MembersFilters, string | undefined][]) {
    if (!value || (key === "filter" && value === "all") || (key === "sort" && value === "newest")) continue;
    out[key] = key === "q" ? value.trim() || undefined : value;
  }
  // The API names the badge filter "badge" with filter=badge.
  if (f.badge) out.filter = "badge";
  return out;
}

/** "?country=NG&status=active…" for the page URL (empty when nothing is set). */
export function membersSearch(f: MembersFilters): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(membersApiQuery(f))) {
    if (value && !(key === "filter" && value === "badge")) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** How many Filters-panel filters are set (for the button's count). */
export const panelCount = (f: MembersFilters) => PANEL_FILTERS.filter((k) => !!f[k]).length;

export const MEMBERS_PAGE_SIZE = 25;
