import { z } from "zod";
import { EXTERNAL_URL_MAX_CHARS, MemberRef, QueryBoolean, type PageRef, type TaxonomyItem } from "./common.js";
import { OpportunityType, RemoteMode } from "./listings.js";

/*
 * Opportunities: jobs, fellowships, grants and other openings posted by verified members.
 * Listings go live straight away; members report bad ones and moderators remove them.
 * Members apply inside Charter Mission with their profile and a note; the poster reviews
 * applicants in the app — unless the listing has an `applyUrl` (a link or an email address on
 * the organisation's side), as listings staff bring in from WhatsApp groups and forums do.
 * Staff can post listings as one of Charter Mission's official pages (`page`).
 * New listings are shared to the feed as a post carrying the listing's card (`shareToFeed`).
 */

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  employment: "Job",
  internship: "Internship",
  fellowship: "Fellowship",
  scholarship: "Scholarship",
  grant: "Grant",
  training: "Training",
  mentorship: "Mentorship",
  volunteering: "Volunteering",
  competition: "Competition",
  call_for_proposals: "Call for proposals",
};

export const REMOTE_MODE_LABELS: Record<RemoteMode, string> = {
  remote: "Remote",
  in_person: "On-site",
  hybrid: "Hybrid",
};

export const OpportunityStatus = z.enum(["open", "closed"]);
export type OpportunityStatus = z.infer<typeof OpportunityStatus>;

export const ApplicationStatus = z.enum(["submitted", "shortlisted", "accepted", "declined", "withdrawn"]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Applied",
  shortlisted: "Shortlisted",
  accepted: "Accepted",
  declined: "Not selected",
  withdrawn: "Withdrawn",
};

export const OPPORTUNITY_LIMITS = {
  title: 120,
  organisation: 120,
  summary: 280,
  description: 8000,
  compensation: 120,
  city: 80,
  note: 2000,
  /** Shortest application note, so applicants say something about why they fit. */
  noteMin: 20,
} as const;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31");

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

/**
 * Where to apply outside Charter Mission, as stored: an https link, or mailto: for an email address
 * ("jobs@acme.org" and "mailto:jobs@acme.org" both become "mailto:jobs@acme.org"). Null when it's
 * neither.
 */
export function normalizeApplyUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const email = value.replace(/^mailto:/i, "");
  if (EMAIL.test(email) && !/^https?:/i.test(value)) return `mailto:${email}`;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** POST /opportunities and PATCH /opportunities/{id} (the whole listing each time). */
export const OpportunityInput = z
  .object({
    type: OpportunityType,
    title: z.string().trim().min(5, "Give it a title of at least 5 characters").max(OPPORTUNITY_LIMITS.title),
    organisation: z.string().trim().min(2, "Add the organisation").max(OPPORTUNITY_LIMITS.organisation),
    summary: z.string().trim().min(10, "Add a one-line summary").max(OPPORTUNITY_LIMITS.summary),
    description: z.string().trim().min(30, "Describe the opportunity in at least 30 characters").max(OPPORTUNITY_LIMITS.description),
    remoteMode: RemoteMode,
    countryCode: z.string().length(2).toUpperCase().nullable().default(null),
    city: z.string().trim().max(OPPORTUNITY_LIMITS.city).nullable().default(null),
    sectorId: z.string().uuid().nullable().default(null),
    /** Last day to apply (in the listing's own sense of the day; applications close after it). */
    deadline: IsoDate.nullable().default(null),
    compensation: z.string().trim().max(OPPORTUNITY_LIMITS.compensation).nullable().default(null),
    /** Optional page with more detail. Applications still happen in Charter Mission. */
    moreInfoUrl: z.string().trim().url("Enter a full link starting with https://").max(EXTERNAL_URL_MAX_CHARS).nullable().default(null),
    /**
     * Apply on the organisation's side instead of in Charter Mission: a link or an email address
     * (stored as mailto:). Null keeps applications in Charter Mission.
     */
    applyUrl: z.string().trim().max(EXTERNAL_URL_MAX_CHARS).nullable().default(null),
    /** POST only: also share the new listing to the feed (on by default). Ignored by PATCH. */
    shareToFeed: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.remoteMode !== "remote" && !v.countryCode) {
      ctx.addIssue({ code: "custom", path: ["countryCode"], message: "Choose the country for on-site or hybrid work" });
    }
    if (v.moreInfoUrl && !/^https?:\/\//i.test(v.moreInfoUrl)) {
      ctx.addIssue({ code: "custom", path: ["moreInfoUrl"], message: "Enter a full link starting with https://" });
    }
    if (v.applyUrl && !normalizeApplyUrl(v.applyUrl)) {
      ctx.addIssue({ code: "custom", path: ["applyUrl"], message: "Enter a link starting with https:// or an email address" });
    }
  })
  .transform((v) => ({ ...v, applyUrl: normalizeApplyUrl(v.applyUrl) }));
export type OpportunityInput = z.input<typeof OpportunityInput>;
export type OpportunityInputParsed = z.output<typeof OpportunityInput>;

export const OpportunityDeadlineFilter = z.enum(["any", "week", "month"]);
export type OpportunityDeadlineFilter = z.infer<typeof OpportunityDeadlineFilter>;

export const OpportunitySort = z.enum(["newest", "closing"]);
export type OpportunitySort = z.infer<typeof OpportunitySort>;

/** GET /opportunities — open listings. `type` is a comma-separated list of OpportunityType. */
export const OpportunitiesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.string().max(200).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  remote: QueryBoolean.optional(),
  sector: z.string().max(80).optional(),
  deadline: OpportunityDeadlineFilter.default("any"),
  sort: OpportunitySort.default("newest"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type OpportunitiesQuery = z.infer<typeof OpportunitiesQuery>;

/** GET /me/opportunities?tab= */
export const MyOpportunitiesQuery = z.object({
  tab: z.enum(["posted", "applied", "saved"]).default("posted"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MyOpportunitiesQuery = z.infer<typeof MyOpportunitiesQuery>;

export type OpportunitySummary = {
  id: string;
  slug: string;
  type: OpportunityType;
  title: string;
  organisation: string;
  summary: string;
  remoteMode: RemoteMode;
  country: { code: string; name: string } | null;
  city: string | null;
  sector: TaxonomyItem | null;
  deadline: string | null;
  compensation: string | null;
  status: OpportunityStatus;
  /** Hidden or removed by a moderator (only the poster and moderators see these). */
  moderationState: "visible" | "hidden" | "removed";
  applicationCount: number;
  /** The member who posted it (for page listings, the staff member or page admin who did). */
  poster: MemberRef;
  /** Posted as this page: show the page as the poster. */
  page: PageRef | null;
  /** Apply here instead of in Charter Mission (https link or mailto:). */
  applyUrl: string | null;
  createdAt: string;
  viewer: {
    saved: boolean;
    isOwner: boolean;
    applicationStatus: ApplicationStatus | null;
  };
};

export type MyApplication = {
  id: string;
  status: ApplicationStatus;
  note: string;
  phone: string | null;
  link: string | null;
  cv: ApplicationCv | null;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityDetail = OpportunitySummary & {
  /**
   * "import": brought in by Charter Mission staff from the admin console. Applications made in
   * Charter Mission go to the Charter Mission team (reviewed in the admin console), not to a member.
   */
  source: "member" | "import";
  description: string;
  moreInfoUrl: string | null;
  sectorId: string | null;
  countryCode: string | null;
  viewer: OpportunitySummary["viewer"] & {
    canApply: boolean;
    /** Why applying is unavailable (closed, deadline passed, own listing, email not verified). */
    cannotApplyReason: string | null;
    canManage: boolean;
    canReport: boolean;
    application: MyApplication | null;
  };
};

/**
 * POST /opportunities/{id}/applications — the application form: a note, plus an optional phone
 * number, CV (a clean application_cv upload of the applicant's own) and link (portfolio, LinkedIn).
 * The applicant's name, profile and email go with it.
 */
export const ApplyInput = z.object({
  note: z
    .string()
    .trim()
    .min(OPPORTUNITY_LIMITS.noteMin, `Tell the poster why you’re a fit in at least ${OPPORTUNITY_LIMITS.noteMin} characters`)
    .max(OPPORTUNITY_LIMITS.note),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 ()\-.]{6,30}$/, "Enter a phone number with digits, like +234 803 555 0199")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  cvFileId: z.string().uuid().nullable().optional(),
  link: z
    .string()
    .trim()
    .url("Enter a full link starting with https://")
    .max(EXTERNAL_URL_MAX_CHARS)
    .refine((v) => /^https?:\/\//i.test(v), "Enter a full link starting with https://")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});
export type ApplyInput = z.infer<typeof ApplyInput>;

/** GET /opportunities/{id}/applications — for the poster. */
export const ApplicationsQuery = z.object({
  status: ApplicationStatus.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ApplicationsQuery = z.infer<typeof ApplicationsQuery>;

/** A CV attached to an application: open it at /media/{id} (applicant, poster and reviewing staff only). */
export type ApplicationCv = { id: string; name: string; sizeBytes: number };

/**
 * POST /me/application-cv/from-resume — "Use the résumé on my profile": copies the member's profile
 * résumé into a new application_cv file of theirs (so who can open it follows the application, not
 * the profile's privacy settings) and returns it, ready to send as ApplyInput.cvFileId.
 * 404 when the profile has no résumé.
 */
export type ApplicationCvFromResume = ApplicationCv;

export type ApplicationView = {
  id: string;
  applicant: MemberRef;
  /** Applicant's country name, when their profile shows it. */
  location: string | null;
  /** The applicant's account email: it goes to the poster with the application (the form says so). */
  email: string;
  note: string;
  phone: string | null;
  link: string | null;
  cv: ApplicationCv | null;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationsPage = {
  items: ApplicationView[];
  nextCursor: string | null;
  counts: Record<ApplicationStatus, number>;
};

/** PATCH /opportunities/{id}/applications/{applicationId} — the poster's decision. */
export const DecideApplicationInput = z.object({
  status: z.enum(["submitted", "shortlisted", "accepted", "declined"]),
  /** Optional message included in the applicant's notification and email. */
  message: z.string().trim().max(1000).optional(),
});
export type DecideApplicationInput = z.infer<typeof DecideApplicationInput>;

/** Where a listing sits in the applicant's or poster's place line, e.g. "Lagos, Nigeria · Hybrid". */
export function opportunityPlace(o: Pick<OpportunitySummary, "city" | "country" | "remoteMode">): string {
  const where = [o.city, o.country?.name].filter(Boolean).join(", ");
  const mode = REMOTE_MODE_LABELS[o.remoteMode];
  return where ? `${where} · ${mode}` : mode;
}
