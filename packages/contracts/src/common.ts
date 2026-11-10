import { z } from "zod";

/*
 * API-wide conventions (spec section 6.1).
 * JSON, camelCase, ISO 8601 UTC timestamps, opaque cursors.
 */

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_DEACTIVATED",
  "ACCOUNT_RESTRICTED",
  "INVALID_TOKEN",
  "MFA_REQUIRED",
  "MFA_SETUP_REQUIRED",
  "INVALID_MFA_CODE",
  "POLICY_REACCEPT_REQUIRED",
  "CSRF_FAILED",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA",
  "BLOCKED",
  /** Learning is locked until the member meets the admin-set requirements (GET /learning/access). */
  "LEARNING_LOCKED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Field-level messages for form errors, keyed by input field name. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Seconds until retry is allowed, for RATE_LIMITED. */
    retryAfter: z.number().int().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const CursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

/** Avatar tone used when a member has no photo (matches @chartermission/ui AvatarTone). */
export const AvatarTone = z.enum(["tint", "primary", "accent", "success", "warning", "info"]);
export type AvatarTone = z.infer<typeof AvatarTone>;

/**
 * Role badge beside a member's name (Ambassador programme). Shown with the verified tick.
 *  - ambassador / founding_ambassador: serving Ambassador of a country chapter (shield)
 *  - alumni_ambassador: term ended in good standing (grey shield)
 */
export const MemberBadge = z.object({
  kind: z.enum(["ambassador", "founding_ambassador", "alumni_ambassador"]),
  /** "Ambassador", "Founding Ambassador" or "Alumni Ambassador". */
  label: z.string(),
  /** Chapter or country, e.g. "Nigeria Chapter". */
  place: z.string(),
});
export type MemberBadge = z.infer<typeof MemberBadge>;

/**
 * The compact member shape used everywhere a person is shown
 * (post author, comment author, notification actor, suggestion).
 */
export const MemberRef = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  name: z.string(),
  headline: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tone: AvatarTone,
  /** Admin-verified member or official account. Email verification alone never sets this (decision D2). */
  verified: z.boolean(),
  /** Official Charter Mission staff account. */
  staff: z.boolean(),
  /** Ambassador programme badge, when they hold one. */
  badge: MemberBadge.nullable().optional(),
});
export type MemberRef = z.infer<typeof MemberRef>;

/**
 * The compact page shape (an organisation's page), used wherever a page is shown:
 * as the author of a post published as the page, in lists and in follow rows.
 */
export const PageRef = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** Verified by staff. */
  verified: z.boolean(),
  /** One of Charter Mission's own pages. */
  official: z.boolean(),
});
export type PageRef = z.infer<typeof PageRef>;

/** Colour of a profile badge (design-system tones). */
export const BadgeTone = z.enum(["primary", "accent", "warning", "info", "success"]);
export type BadgeTone = z.infer<typeof BadgeTone>;

/** An admin-awarded profile badge (Top Voice, Founding Member, Partner ...). */
export const ProfileBadge = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  tone: BadgeTone,
  /** An icon name from @chartermission/ui. */
  icon: z.string(),
});
export type ProfileBadge = z.infer<typeof ProfileBadge>;

export const Uuid = z.string().uuid();

/** ISO 3166-1 alpha-2 country code. */
export const CountryCode = z.string().length(2).toUpperCase();

export const FieldVisibility = z.enum(["public", "members", "connections", "only_me"]);
export type FieldVisibility = z.infer<typeof FieldVisibility>;

export const ProfileVisibility = z.enum(["members", "public"]);
export type ProfileVisibility = z.infer<typeof ProfileVisibility>;

export const TaxonomyItem = z.object({ id: z.string(), slug: z.string(), name: z.string() });
export type TaxonomyItem = z.infer<typeof TaxonomyItem>;

export const Country = z.object({ code: z.string(), name: z.string(), region: z.string() });
export type Country = z.infer<typeof Country>;

export const ChapterRef = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), countryCode: z.string() });
export type ChapterRef = z.infer<typeof ChapterRef>;

/** GET /taxonomies — reference data for forms and filters. */
export const Taxonomies = z.object({
  countries: z.array(Country),
  sectors: z.array(TaxonomyItem),
  skills: z.array(TaxonomyItem),
  interests: z.array(TaxonomyItem),
  languages: z.array(TaxonomyItem),
  chapters: z.array(ChapterRef),
});
export type Taxonomies = z.infer<typeof Taxonomies>;

/**
 * Query-string boolean: "true"/"1" or "false"/"0" (z.coerce.boolean would read "false" as true).
 * Also accepts a real boolean so the same schema validates JSON bodies.
 */
export const QueryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

/** Longest outbound link we store (opportunity links, event registration links). */
export const EXTERNAL_URL_MAX_CHARS = 2000;

/**
 * An outbound link a member types in (opportunity links, external event registration, online
 * meeting links): https only, no user:password@, a real host name, at most 2000 characters.
 * Reachability is checked later by a worker, never at validation time.
 */
export const ExternalUrl = z
  .string()
  .trim()
  .min(1, "Add a link")
  .max(EXTERNAL_URL_MAX_CHARS, `Links can be up to ${EXTERNAL_URL_MAX_CHARS} characters`)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full link starting with https://" });
      return;
    }
    if (url.protocol !== "https:") ctx.addIssue({ code: "custom", message: "Links must start with https://" });
    else if (url.username || url.password) ctx.addIssue({ code: "custom", message: "Links cannot contain a user name or password" });
    else if (!url.hostname.includes(".") || url.hostname.endsWith(".")) ctx.addIssue({ code: "custom", message: "Enter a link to a public website" });
  });

let timeZones: Set<string> | null = null;

/** True for an IANA time zone name this runtime knows (Intl.supportedValuesOf plus UTC and aliases). */
export function isIanaTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  timeZones ??= new Set(Intl.supportedValuesOf("timeZone"));
  if (timeZones.has(value) || value === "UTC" || value === "Etc/UTC") return true;
  // Older aliases (e.g. Asia/Calcutta) are not listed but are valid; the formatter accepts them.
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value.includes("/");
  } catch {
    return false;
  }
}

/** IANA time zone name, e.g. "Africa/Lagos". */
export const TimeZone = z.string().trim().min(1).max(64).refine(isIanaTimeZone, "Choose a valid time zone");

/** ISO 8601 timestamp with an offset or Z; the API stores and returns UTC. */
export const IsoDateTime = z.string().datetime({ offset: true });

/** Organisation as an event host. Organisations are a later module: no table yet, so this is read-only. */
export const OrganisationRef = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string(), logoUrl: z.string().nullable() });
export type OrganisationRef = z.infer<typeof OrganisationRef>;
