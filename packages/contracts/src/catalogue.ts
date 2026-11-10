import { z } from "zod";
import { BadgeTone, CountryCode, ProfileBadge } from "./common.js";

/*
 * Admin console catalogues: chapters, topics (hashtags), profile badges and member controls
 * (verified tick, badges, featured suggestions). Every route is under /admin and needs an admin
 * session; the permission is noted on each.
 */

/* ------------------------------- Chapters ------------------------------- */

/** active = listed everywhere; dormant = deactivated (hidden from lists, page still reachable by link). */
export const AdminChapterStatus = z.enum(["active", "dormant"]);
export type AdminChapterStatus = z.infer<typeof AdminChapterStatus>;

/** GET /admin/chapters (chapters.admin) */
export const AdminChaptersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "dormant"]).default("all"),
});
export type AdminChaptersQuery = z.infer<typeof AdminChaptersQuery>;

export type AdminChapterRow = {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  countryName: string;
  region: string;
  status: string;
  about: string | null;
  imageUrl: string | null;
  coverUrl: string | null;
  followers: number;
  posts: number;
  createdAt: string;
};

const ChapterSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens");

/** POST /admin/chapters (chapters.admin) */
export const AdminChapterCreateInput = z.object({
  name: z.string().trim().min(2).max(80),
  countryCode: CountryCode,
  /** Defaults to one made from the name. */
  slug: ChapterSlug.optional(),
  status: AdminChapterStatus.default("active"),
});
export type AdminChapterCreateInput = z.infer<typeof AdminChapterCreateInput>;

/** PATCH /admin/chapters/{id} (chapters.admin). File ids are clean chapter_image / chapter_cover uploads; null resets to the generated design. */
export const AdminChapterUpdateInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    status: AdminChapterStatus,
    about: z.string().trim().max(1000).nullable(),
    imageFileId: z.string().uuid().nullable(),
    coverFileId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type AdminChapterUpdateInput = z.infer<typeof AdminChapterUpdateInput>;

/* -------------------------------- Topics -------------------------------- */

/** GET /admin/topics (trending.manage) */
export const AdminTopicsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "disabled"]).default("all"),
  featured: z.enum(["all", "featured"]).default("all"),
});
export type AdminTopicsQuery = z.infer<typeof AdminTopicsQuery>;

export type AdminTopicRow = {
  id: string;
  tag: string;
  display: string;
  description: string | null;
  status: "active" | "disabled";
  featured: boolean;
  postCount: number;
  followerCount: number;
  createdAt: string;
};

/** Letters, numbers and underscores, as in posts; a leading # is ignored. */
export const TopicTag = z
  .string()
  .trim()
  .transform((v) => v.replace(/^#/, ""))
  .pipe(z.string().regex(/^[\p{L}\p{N}_]{2,50}$/u, "Use 2–50 letters, numbers or underscores"));

/** POST /admin/topics (trending.manage) */
export const AdminTopicCreateInput = z.object({
  tag: TopicTag,
  description: z.string().trim().max(300).optional(),
  featured: z.boolean().default(true),
});
export type AdminTopicCreateInput = z.infer<typeof AdminTopicCreateInput>;

/** PATCH /admin/topics/{id} (trending.manage). `display` may only change letter case. */
export const AdminTopicUpdateInput = z
  .object({
    display: TopicTag,
    description: z.string().trim().max(300).nullable(),
    status: z.enum(["active", "disabled"]),
    featured: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type AdminTopicUpdateInput = z.infer<typeof AdminTopicUpdateInput>;

/* -------------------------------- Badges -------------------------------- */

export type AdminBadge = ProfileBadge & { status: "active" | "disabled"; position: number; holders: number };

/** Icons a badge may use (names from @chartermission/ui). */
export const BADGE_ICONS = [
  "verified",
  "flame",
  "flag",
  "building",
  "lightbulb",
  "message",
  "users",
  "chart",
  "target",
  "shield",
  "book",
  "briefcase",
  "globe",
  "like",
  "trending",
] as const;
export const BadgeIcon = z.enum(BADGE_ICONS);

/** POST /admin/badges (badges.manage) */
export const AdminBadgeInput = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(""),
  tone: BadgeTone.default("primary"),
  icon: BadgeIcon.default("verified"),
  status: z.enum(["active", "disabled"]).default("active"),
});
export type AdminBadgeInput = z.infer<typeof AdminBadgeInput>;

/** PATCH /admin/badges/{id} (badges.manage) */
export const AdminBadgeUpdateInput = z
  .object({
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(200),
    tone: BadgeTone,
    icon: BadgeIcon,
    status: z.enum(["active", "disabled"]),
    position: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type AdminBadgeUpdateInput = z.infer<typeof AdminBadgeUpdateInput>;

/* -------------------------------- Members -------------------------------- */

/** GET /admin/members (members.manage) */
export const AdminMembersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "verified", "unverified", "featured", "badge"]).default("all"),
  /** Badge slug, with filter=badge. */
  badge: z.string().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type AdminMembersQuery = z.infer<typeof AdminMembersQuery>;

export type AdminMemberRow = {
  id: string;
  handle: string;
  name: string;
  email: string;
  headline: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  status: string;
  /** Verified tick (admin-granted). */
  verified: boolean;
  staff: boolean;
  /** Suggested first to new members during sign-up. */
  featured: boolean;
  badges: ProfileBadge[];
  joinedAt: string;
};

/** PUT /admin/members/{id}/verified (members.manage) */
export const AdminSetVerifiedInput = z.object({ verified: z.boolean() });
export type AdminSetVerifiedInput = z.infer<typeof AdminSetVerifiedInput>;

/** PUT /admin/members/{id}/featured (members.manage) */
export const AdminSetFeaturedInput = z.object({ featured: z.boolean() });
export type AdminSetFeaturedInput = z.infer<typeof AdminSetFeaturedInput>;

/** POST /admin/members/{id}/badges (members.manage) */
export const AdminAwardBadgeInput = z.object({ badgeId: z.string().uuid(), note: z.string().trim().max(200).optional() });
export type AdminAwardBadgeInput = z.infer<typeof AdminAwardBadgeInput>;
