import { z } from "zod";
import { CountryCode, MemberRef, PageRef } from "./common.js";
import { ReactionCounts } from "./social.js";

/*
 * Pages (organisations, companies, institutions and initiatives), verification requests for the
 * verified tick, post analytics and the public landing numbers.
 */

/* ------------------------------- Pages ------------------------------- */

export const PageCategory = z.enum(["organisation", "company", "nonprofit", "government", "education", "media", "community", "initiative"]);
export type PageCategory = z.infer<typeof PageCategory>;

export const PAGE_CATEGORY_LABELS: Record<PageCategory, string> = {
  organisation: "Organisation",
  company: "Company",
  nonprofit: "Non-profit",
  government: "Government body",
  education: "Education",
  media: "Media",
  community: "Community group",
  initiative: "Initiative",
};

/**
 * pending: created by a member and waiting for review (only its admins and staff see it);
 * active: live; rejected: not approved; suspended: taken down by staff.
 */
export const PageStatus = z.enum(["pending", "active", "rejected", "suspended"]);
export type PageStatus = z.infer<typeof PageStatus>;

/** Who may create pages from the member app (admin console → Pages → Settings). */
export const PageCreationPolicy = z.enum(["open", "review", "closed"]);
export type PageCreationPolicy = z.infer<typeof PageCreationPolicy>;

/** GET /admin/settings/pages, PUT /admin/settings/pages (settings.manage); GET /pages/settings for members. */
export const PagesSettings = z.object({
  /** open: pages go live straight away; review: staff approve each page first; closed: only staff create pages. */
  memberCreation: PageCreationPolicy,
  /** Most pages one member can own. */
  maxPagesPerMember: z.number().int().min(1).max(50),
});
export type PagesSettings = z.infer<typeof PagesSettings>;

export const PAGES_SETTINGS_DEFAULTS: PagesSettings = { memberCreation: "review", maxPagesPerMember: 5 };

export const PageSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, "Use 3 to 60 lowercase letters, numbers and hyphens");

const Website = z
  .string()
  .trim()
  .max(300)
  .url("Enter a full web address, starting with https://")
  .refine((v) => /^https?:\/\//i.test(v), "Enter a full web address, starting with https://");

/** POST /pages (verified members; subject to PagesSettings.memberCreation). */
export const PageInput = z.object({
  name: z.string().trim().min(2, "Enter the page name").max(80),
  /** Defaults to one made from the name. Can't be changed later. */
  slug: PageSlug.optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  about: z.string().trim().max(2000).nullable().optional(),
  category: PageCategory,
  website: Website.nullable().optional(),
  countryCode: CountryCode.nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  /** Clean page_logo / page_cover uploads owned by the caller; null removes the picture. */
  logoFileId: z.string().uuid().nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});
export type PageInput = z.infer<typeof PageInput>;

/** PATCH /pages/{slug} (page admins). The slug stays as it is. */
export const PageUpdateInput = PageInput.omit({ slug: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type PageUpdateInput = z.infer<typeof PageUpdateInput>;

/** GET /pages */
export const PagesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: PageCategory.optional(),
  country: z.string().length(2).optional(),
  /** Only pages the viewer follows. Same boolean encoding as FeedQuery.announcements. */
  following: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type PagesQuery = z.infer<typeof PagesQuery>;

export const PageSummary = PageRef.extend({
  category: PageCategory,
  country: z.object({ code: z.string(), name: z.string() }).nullable(),
  followers: z.number().int(),
  /** The viewer follows this page. */
  following: z.boolean(),
  status: PageStatus,
});
export type PageSummary = z.infer<typeof PageSummary>;

export const PageAdminRole = z.enum(["owner", "admin"]);
export type PageAdminRole = z.infer<typeof PageAdminRole>;

export const PageAdminView = z.object({ member: MemberRef, role: PageAdminRole, addedAt: z.string() });
export type PageAdminView = z.infer<typeof PageAdminView>;

/** GET /pages/{slug} */
export const PageDetail = PageSummary.extend({
  about: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  coverUrl: z.string().nullable(),
  posts: z.number().int(),
  createdAt: z.string(),
  viewer: z.object({
    /** The viewer's role on this page, or null. */
    role: PageAdminRole.nullable(),
    canEdit: z.boolean(),
    /** Add and remove admins, delete the page (owner or staff). */
    canManageAdmins: z.boolean(),
    /** The page is live, so its admins can post as it. */
    canPost: z.boolean(),
  }),
  /** For the page's admins only: why it was rejected or suspended, and who manages it. */
  reviewNote: z.string().nullable().optional(),
  admins: z.array(PageAdminView).optional(),
});
export type PageDetail = z.infer<typeof PageDetail>;

/** POST /pages/{slug}/admins (owner): add a member by handle. */
export const PageAdminInput = z.object({ handle: z.string().trim().min(2).max(60) });
export type PageAdminInput = z.infer<typeof PageAdminInput>;

/** GET /me/pages: pages the viewer manages, for "post as" and the Pages hub. */
export const ManagedPage = PageSummary.extend({ role: PageAdminRole });
export type ManagedPage = z.infer<typeof ManagedPage>;

/* ------------------------------- Pages: admin console ------------------------------- */

/** GET /admin/pages (pages.manage) */
export const AdminPagesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "pending", "active", "rejected", "suspended"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminPagesQuery = z.infer<typeof AdminPagesQuery>;

export type AdminPageRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  about: string | null;
  category: PageCategory;
  website: string | null;
  countryCode: string | null;
  city: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  status: PageStatus;
  reviewNote: string | null;
  verified: boolean;
  official: boolean;
  owner: (MemberRef & { email: string }) | null;
  admins: number;
  followers: number;
  posts: number;
  createdAt: string;
};

/** POST /admin/pages (pages.manage): live straight away. */
export const AdminPageCreateInput = PageInput.extend({
  /** Handle or email of the member who will own the page. Leave out to own it yourself. */
  owner: z.string().trim().max(200).optional(),
  official: z.boolean().default(false),
  verified: z.boolean().default(false),
});
export type AdminPageCreateInput = z.infer<typeof AdminPageCreateInput>;

/** PATCH /admin/pages/{id} (pages.manage). */
export const AdminPageUpdateInput = PageInput.omit({ slug: true })
  .extend({
    official: z.boolean(),
    verified: z.boolean(),
    /** Handle or email of the new owner. */
    owner: z.string().trim().min(2).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type AdminPageUpdateInput = z.infer<typeof AdminPageUpdateInput>;

/**
 * POST /admin/pages/{id}/status (pages.manage). approve: pending/rejected → active;
 * reject: pending → rejected; suspend: active → suspended; restore: suspended → active.
 * A note is required to reject or suspend, and is shown to the page's admins.
 */
export const AdminPageStatusInput = z
  .object({ action: z.enum(["approve", "reject", "suspend", "restore"]), note: z.string().trim().max(500).optional() })
  .refine((v) => (v.action !== "reject" && v.action !== "suspend") || !!v.note, { path: ["note"], message: "Say why, so the page’s admins know what to fix" });
export type AdminPageStatusInput = z.infer<typeof AdminPageStatusInput>;

/* ------------------------------- Verification ------------------------------- */

export const VerificationCategory = z.enum(["individual", "public_figure", "journalist", "official", "organisation"]);
export type VerificationCategory = z.infer<typeof VerificationCategory>;

export const VERIFICATION_CATEGORY_LABELS: Record<VerificationCategory, string> = {
  individual: "Professional or practitioner",
  public_figure: "Public figure or community leader",
  journalist: "Journalist or creator",
  official: "Government or institutional official",
  organisation: "Organisation",
};

/** Days before a declined applicant can apply again. */
export const VERIFICATION_REAPPLY_DAYS = 30;

/** POST /me/verification and POST /pages/{slug}/verification. */
export const VerificationApplyInput = z.object({
  category: VerificationCategory,
  /** Your full legal name, or the organisation's registered name. Only staff see it. */
  legalName: z.string().trim().min(2, "Enter the full name").max(120),
  statement: z.string().trim().min(40, "Tell us a little more (at least 40 characters)").max(1000),
  /** Public links that show who you are: website, LinkedIn, press, a registry entry. */
  links: z
    .array(z.string().trim().url("Enter a full link, starting with https://").max(300))
    .min(1, "Add at least one link")
    .max(5),
});
export type VerificationApplyInput = z.infer<typeof VerificationApplyInput>;

export const VerificationRequestStatus = z.enum(["pending", "approved", "declined"]);
export type VerificationRequestStatus = z.infer<typeof VerificationRequestStatus>;

export const VerificationRequestView = z.object({
  id: z.string().uuid(),
  subjectType: z.enum(["member", "page"]),
  status: VerificationRequestStatus,
  category: VerificationCategory,
  legalName: z.string(),
  statement: z.string(),
  links: z.array(z.string()),
  /** The reviewer's note, shown with the outcome. */
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type VerificationRequestView = z.infer<typeof VerificationRequestView>;

/** GET /me/verification and GET /pages/{slug}/verification (page admins). */
export const VerificationStatus = z.object({
  verified: z.boolean(),
  /** What must be in place before applying; all must be met. */
  requirements: z.array(z.object({ key: z.string(), label: z.string(), met: z.boolean(), href: z.string().nullable() })),
  eligible: z.boolean(),
  /** The latest request, if any. */
  request: VerificationRequestView.nullable(),
  /** After a decline: when a new request can be sent. */
  canApplyAt: z.string().nullable(),
});
export type VerificationStatus = z.infer<typeof VerificationStatus>;

/** GET /admin/verification (members.manage) */
export const AdminVerificationQuery = z.object({
  status: z.enum(["pending", "approved", "declined", "all"]).default("pending"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminVerificationQuery = z.infer<typeof AdminVerificationQuery>;

export type AdminVerificationRow = VerificationRequestView & {
  applicant: MemberRef & { email: string };
  page: PageRef | null;
  /** Facts that help the reviewer: the applicant's (or page's) standing on the platform. */
  facts: { joinedAt: string; followers: number; connections: number; posts: number; twoStep: boolean; openReports: number };
  decidedBy: string | null;
};

/** POST /admin/verification/{id}/decision (members.manage). A note is required to decline. */
export const AdminVerificationDecisionInput = z
  .object({ decision: z.enum(["approve", "decline"]), note: z.string().trim().max(500).optional() })
  .refine((v) => v.decision !== "decline" || !!v.note, { path: ["note"], message: "Say why, so the applicant knows what to change" });
export type AdminVerificationDecisionInput = z.infer<typeof AdminVerificationDecisionInput>;

/** GET /admin/queues: open items per review queue, for the console sidebar. */
export type AdminQueueCounts = { pages: number; verification: number };

/* ------------------------------- Post analytics ------------------------------- */

/** POST /posts/views: posts that were on screen (the feed sends these in small batches). */
export const PostViewsInput = z.object({ postIds: z.array(z.string().uuid()).min(1).max(50) });
export type PostViewsInput = z.infer<typeof PostViewsInput>;

export const AnalyticsRange = z.coerce
  .number()
  .int()
  .refine((v) => [7, 28, 90].includes(v), "Choose 7, 28 or 90 days")
  .default(28);

/** GET /posts/{id}/analytics?days= (the author, or an admin of the page it was published as). */
export const PostAnalyticsQuery = z.object({ days: AnalyticsRange });
export type PostAnalyticsQuery = z.infer<typeof PostAnalyticsQuery>;

export const AnalyticsDay = z.object({
  /** UTC day, YYYY-MM-DD. */
  day: z.string(),
  impressions: z.number().int(),
  /** Members who saw it for the first time that day. */
  viewers: z.number().int(),
  /** Reactions, comments and reposts made that day. */
  engagements: z.number().int(),
});
export type AnalyticsDay = z.infer<typeof AnalyticsDay>;

export const PostAnalytics = z.object({
  post: z.object({
    id: z.string().uuid(),
    type: z.string(),
    title: z.string().nullable(),
    excerpt: z.string(),
    createdAt: z.string(),
    page: PageRef.nullable(),
  }),
  totals: z.object({
    /** Times the post was shown (a member counts again after 30 minutes). */
    impressions: z.number().int(),
    /** Different members who saw it. */
    reach: z.number().int(),
    reactions: z.number().int(),
    comments: z.number().int(),
    reposts: z.number().int(),
    saves: z.number().int(),
    /** reactions + comments + reposts + saves. */
    engagements: z.number().int(),
    /** engagements ÷ reach, 0 to 1 (0 when nobody has seen it yet). */
    engagementRate: z.number(),
  }),
  reactions: ReactionCounts,
  /** One entry per day of the range, oldest first, zeros included. */
  daily: z.array(AnalyticsDay),
  audience: z.object({
    connections: z.number().int(),
    followers: z.number().int(),
    others: z.number().int(),
    /** Up to 6 countries by members reached. Countries with fewer than 3 viewers are grouped as "Other". */
    countries: z.array(z.object({ code: z.string().nullable(), name: z.string(), viewers: z.number().int() })),
  }),
  /** Views are counted from this date (posts older than the feature start with what was seen since). */
  trackedSince: z.string(),
});
export type PostAnalytics = z.infer<typeof PostAnalytics>;

/** GET /me/analytics?days=&page= : everything the member (or one of their pages) posted. */
export const CreatorAnalyticsQuery = z.object({ days: AnalyticsRange, page: z.string().trim().max(80).optional() });
export type CreatorAnalyticsQuery = z.infer<typeof CreatorAnalyticsQuery>;

export const CreatorAnalytics = z.object({
  days: z.number().int(),
  page: PageRef.nullable(),
  totals: z.object({
    posts: z.number().int(),
    impressions: z.number().int(),
    engagements: z.number().int(),
    engagementRate: z.number(),
    followers: z.number().int(),
    newFollowers: z.number().int(),
  }),
  /** The same numbers for the period before this one, for "up 12%" comparisons. */
  previous: z.object({ impressions: z.number().int(), engagements: z.number().int(), newFollowers: z.number().int() }),
  daily: z.array(AnalyticsDay),
  topPosts: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string(),
      title: z.string().nullable(),
      excerpt: z.string(),
      createdAt: z.string(),
      impressions: z.number().int(),
      reach: z.number().int(),
      engagements: z.number().int(),
    }),
  ),
});
export type CreatorAnalytics = z.infer<typeof CreatorAnalytics>;

/* ------------------------------- Public landing page ------------------------------- */

/** GET /public/overview: live numbers and a few public names for the landing page. No sign-in needed. */
export const PublicOverview = z.object({
  members: z.number().int(),
  countries: z.number().int(),
  chapters: z.number().int(),
  courses: z.number().int(),
  upcomingEvents: z.number().int(),
  pages: z.number().int(),
  /** Largest active chapters, for the "find your chapter" strip. */
  topChapters: z.array(z.object({ slug: z.string(), name: z.string(), countryCode: z.string(), members: z.number().int() })),
  /** Topics members are discussing now. */
  trending: z.array(z.object({ tag: z.string(), posts: z.number().int() })),
  /** Next published public events. */
  events: z.array(z.object({ slug: z.string(), title: z.string(), startsAt: z.string(), format: z.string(), location: z.string().nullable() })),
});
export type PublicOverview = z.infer<typeof PublicOverview>;
