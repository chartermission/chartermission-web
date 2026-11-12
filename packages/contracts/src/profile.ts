import { z } from "zod";
import { AvatarTone, ChapterRef, CountryCode, FieldVisibility, MemberRef, PageRef, ProfileBadge, ProfileVisibility, TaxonomyItem } from "./common.js";

/*
 * Member profiles, onboarding, directory and relationships
 * (spec 4.3 PRF, 4.2 CM-AUTH-07, 4.6 NET).
 */

/** Fields whose visibility the member controls (CM-PRF-02). Name, handle, avatar and headline are always visible to members. */
export const ProfileField = z.enum([
  "email",
  "location",
  "bio",
  "organisation",
  "website",
  "links",
  "skills",
  "sectors",
  "interests",
  "languages",
  "experience",
  /** The intro video and the résumé at the top of the profile. */
  "introVideo",
  "resume",
  /** Who can open the lists of this member's connections, followers and the members they follow. */
  "network",
]);
export type ProfileField = z.infer<typeof ProfileField>;

export const FieldVisibilityMap = z.record(ProfileField, FieldVisibility);
export type FieldVisibilityMap = z.infer<typeof FieldVisibilityMap>;

/** Privacy defaults (spec 8.3): contact details hidden, profile members-only. */
export const DEFAULT_FIELD_VISIBILITY: Record<ProfileField, FieldVisibility> = {
  email: "only_me",
  location: "members",
  bio: "members",
  organisation: "members",
  website: "members",
  links: "members",
  skills: "members",
  sectors: "members",
  interests: "members",
  languages: "members",
  experience: "members",
  introVideo: "members",
  // A résumé carries contact details: connections only until the member chooses otherwise.
  resume: "connections",
  network: "members",
};

export const ProfileLink = z.object({ label: z.string().max(40), url: z.string().url().max(300) });
export type ProfileLink = z.infer<typeof ProfileLink>;
export const PROFILE_LINKS_MAX = 10;

/**
 * Networks members commonly link to. Used to offer a ready-made row in the profile editor and to
 * name a link from its address on the profile ("linkedin.com/in/…" → LinkedIn).
 */
export const SOCIAL_NETWORKS = [
  { key: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"], example: "https://www.linkedin.com/in/your-name" },
  { key: "x", label: "X (Twitter)", hosts: ["x.com", "twitter.com"], example: "https://x.com/your-name" },
  { key: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com"], example: "https://www.facebook.com/your-name" },
  { key: "instagram", label: "Instagram", hosts: ["instagram.com"], example: "https://www.instagram.com/your-name" },
  { key: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"], example: "https://www.youtube.com/@your-channel" },
  { key: "tiktok", label: "TikTok", hosts: ["tiktok.com"], example: "https://www.tiktok.com/@your-name" },
  { key: "github", label: "GitHub", hosts: ["github.com"], example: "https://github.com/your-name" },
  { key: "whatsapp", label: "WhatsApp", hosts: ["wa.me", "whatsapp.com"], example: "https://wa.me/234800000000" },
  { key: "telegram", label: "Telegram", hosts: ["t.me", "telegram.me"], example: "https://t.me/your-name" },
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** The network a link points to, from its address; null for any other site. */
export function socialNetworkOf(url: string): SocialNetwork | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return SOCIAL_NETWORKS.find((n) => n.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}

/** A member's intro video, once it has been converted and checked. */
export const ProfileVideo = z.object({ url: z.string(), posterUrl: z.string().nullable(), durationSeconds: z.number().nullable() });
export type ProfileVideo = z.infer<typeof ProfileVideo>;

/** A member's résumé (PDF). */
export const ProfileResume = z.object({ url: z.string(), name: z.string(), sizeBytes: z.number().int() });
export type ProfileResume = z.infer<typeof ProfileResume>;

export const ExperienceItem = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(120),
  organisation: z.string().max(120),
  location: z.string().max(120).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  endDate: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});
export type ExperienceItem = z.infer<typeof ExperienceItem>;

export const ConnectionState = z.enum(["none", "pending_outgoing", "pending_incoming", "connected"]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const Relationship = z.object({
  self: z.boolean(),
  connection: ConnectionState,
  connectionId: z.string().uuid().nullable(),
  following: z.boolean(),
  followsYou: z.boolean(),
  blocked: z.boolean(),
  /** The viewer muted this member (their posts are left out of the viewer's feeds). */
  muted: z.boolean(),
  /**
   * False when the two can't connect: official Charter Mission accounts are follow-only, in both
   * directions. Treat a missing value as true.
   */
  canConnect: z.boolean().optional(),
});
export type Relationship = z.infer<typeof Relationship>;

/**
 * GET /members/{handle} — built from a per-viewer field allow-list.
 * Fields the viewer may not see are omitted, never sent as null.
 */
export const MemberProfile = MemberRef.extend({
  joinedAt: z.string(),
  /** Profile cover photo; omitted when the member has none. */
  coverUrl: z.string().optional(),
  country: z.object({ code: z.string(), name: z.string() }).optional(),
  city: z.string().optional(),
  email: z.string().optional(),
  bio: z.string().optional(),
  organisation: z.string().optional(),
  website: z.string().optional(),
  links: z.array(ProfileLink).optional(),
  introVideo: ProfileVideo.optional(),
  resume: ProfileResume.optional(),
  skills: z.array(TaxonomyItem).optional(),
  sectors: z.array(TaxonomyItem).optional(),
  interests: z.array(TaxonomyItem).optional(),
  languages: z.array(TaxonomyItem).optional(),
  experience: z.array(ExperienceItem).optional(),
  chapters: z.array(ChapterRef),
  /** Badges awarded by admins (active badges only). */
  badges: z.array(ProfileBadge),
  counts: z.object({ connections: z.number().int(), followers: z.number().int(), posts: z.number().int() }),
  relationship: Relationship,
});
export type MemberProfile = z.infer<typeof MemberProfile>;

/** GET /me/profile — the owner's full editable profile, including visibility settings. */
export const OwnProfile = z.object({
  handle: z.string(),
  name: z.string(),
  headline: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  tone: AvatarTone,
  countryCode: z.string().nullable(),
  city: z.string().nullable(),
  bio: z.string().nullable(),
  organisation: z.string().nullable(),
  website: z.string().nullable(),
  links: z.array(ProfileLink),
  /** With the file id, so the editor can keep or replace it. Null when there is none. */
  introVideo: ProfileVideo.extend({ fileId: z.string().uuid() }).nullable(),
  resume: ProfileResume.extend({ fileId: z.string().uuid() }).nullable(),
  skills: z.array(TaxonomyItem),
  sectors: z.array(TaxonomyItem),
  interests: z.array(TaxonomyItem),
  languages: z.array(TaxonomyItem),
  experience: z.array(ExperienceItem),
  profileVisibility: ProfileVisibility,
  fieldVisibility: FieldVisibilityMap,
  /** Usernames can be changed once every 30 days: when the next change is allowed, or null if now. */
  handleChangeAvailableAt: z.string().nullable(),
  discoverable: z.boolean(),
  findableByEmail: z.boolean(),
  connectionRequestsFrom: z.enum(["members", "nobody"]),
  completeness: z.object({ percent: z.number().int(), missing: z.array(z.string()) }),
});
export type OwnProfile = z.infer<typeof OwnProfile>;

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** GET /me/handle-availability?handle= */
export const HandleAvailabilityQuery = z.object({ handle: z.string().trim().toLowerCase().regex(HANDLE_PATTERN, "Use 3–30 letters, numbers or hyphens") });
export type HandleAvailabilityQuery = z.infer<typeof HandleAvailabilityQuery>;
export type HandleAvailability = { handle: string; available: boolean; reason: string | null };

/** PATCH /me/profile — any subset. Taxonomy fields take ids. */
export const UpdateProfileInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    handle: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, "Use 3–30 letters, numbers or hyphens"),
    headline: z.string().trim().max(120).nullable(),
    countryCode: CountryCode.nullable(),
    city: z.string().trim().max(80).nullable(),
    bio: z.string().trim().max(2000).nullable(),
    organisation: z.string().trim().max(120).nullable(),
    website: z.string().trim().url().max(300).nullable(),
    links: z.array(ProfileLink).max(PROFILE_LINKS_MAX),
    skillIds: z.array(z.string()).max(30),
    sectorIds: z.array(z.string()).max(10),
    interestIds: z.array(z.string()).max(20),
    languageIds: z.array(z.string()).max(10),
    experience: z.array(ExperienceItem).max(20),
    avatarFileId: z.string().uuid().nullable(),
    /** A clean profile_cover upload of the member's own, or null to remove it. */
    coverFileId: z.string().uuid().nullable(),
    /** A finished profile_video upload of the member's own, or null to remove it. */
    introVideoFileId: z.string().uuid().nullable(),
    /** A checked profile_resume upload (PDF) of the member's own, or null to remove it. */
    resumeFileId: z.string().uuid().nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/** PUT /me/privacy */
export const PrivacySettingsInput = z
  .object({
    profileVisibility: ProfileVisibility,
    fieldVisibility: FieldVisibilityMap,
    discoverable: z.boolean(),
    findableByEmail: z.boolean(),
    connectionRequestsFrom: z.enum(["members", "nobody"]),
  })
  .partial();
export type PrivacySettingsInput = z.infer<typeof PrivacySettingsInput>;

/** GET /me/profile/preview?as=public|member|connection (CM-PRF-05) returns MemberProfile. */
export const PreviewAs = z.enum(["public", "member", "connection"]);
export type PreviewAs = z.infer<typeof PreviewAs>;

/*
 * Onboarding wizard (CM-AUTH-07): steps saved server-side, skippable, resumable.
 * 0 welcome/about you · 1 interests & topics · 2 skills & sectors · 3 chapters & people · 4 done
 */
export const ONBOARDING_STEPS = ["about", "topics", "skills", "community"] as const;
export const OnboardingStepKey = z.enum(ONBOARDING_STEPS);

export const OnboardingState = z.object({
  step: z.number().int().min(0).max(ONBOARDING_STEPS.length),
  completed: z.boolean(),
  data: z.object({
    headline: z.string().nullable(),
    countryCode: z.string().nullable(),
    city: z.string().nullable(),
    interestIds: z.array(z.string()),
    followedHashtags: z.array(z.string()),
    skillIds: z.array(z.string()),
    sectorIds: z.array(z.string()),
    followedChapterIds: z.array(z.string()),
    followedMemberIds: z.array(z.string()),
  }),
  suggestions: z.object({
    hashtags: z.array(z.object({ tag: z.string(), posts: z.number().int(), trending: z.boolean() })),
    members: z.array(MemberRef.extend({ reason: z.string() })),
  }),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

/** PUT /me/onboarding — save one step (or skip it) and move on. */
export const OnboardingUpdateInput = z.object({
  step: OnboardingStepKey,
  action: z.enum(["save", "skip"]),
  data: z
    .object({
      headline: z.string().trim().max(120).nullable(),
      countryCode: CountryCode.nullable(),
      city: z.string().trim().max(80).nullable(),
      interestIds: z.array(z.string()).max(20),
      followedHashtags: z.array(z.string().regex(/^[A-Za-z0-9_]{2,50}$/)).max(30),
      skillIds: z.array(z.string()).max(30),
      sectorIds: z.array(z.string()).max(10),
      followedChapterIds: z.array(z.string()).max(10),
      followedMemberIds: z.array(z.string().uuid()).max(30),
    })
    .partial()
    .default({}),
});
export type OnboardingUpdateInput = z.infer<typeof OnboardingUpdateInput>;

/* ---------- Directory and relationships (4.6) ---------- */

export const DirectoryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  country: z.string().length(2).optional(),
  sector: z.string().optional(),
  skill: z.string().optional(),
  /** Only members of this chapter (its slug): the chapter's Members page. */
  chapter: z.string().trim().max(120).optional(),
  sort: z.enum(["relevance", "recent", "name"]).default("relevance"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type DirectoryQuery = z.infer<typeof DirectoryQuery>;

export const DirectoryMember = MemberRef.extend({
  location: z.string().nullable(),
  mutualConnections: z.number().int(),
  relationship: Relationship,
});
export type DirectoryMember = z.infer<typeof DirectoryMember>;

export const ConnectionView = z.object({
  id: z.string().uuid(),
  member: MemberRef,
  status: z.enum(["pending", "accepted", "declined", "withdrawn", "removed"]),
  direction: z.enum(["incoming", "outgoing"]),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type ConnectionView = z.infer<typeof ConnectionView>;

/** POST /connections */
export const CreateConnectionInput = z.object({ memberId: z.string().uuid(), note: z.string().trim().max(300).optional() });
export type CreateConnectionInput = z.infer<typeof CreateConnectionInput>;

export const FollowTargetType = z.enum(["member", "hashtag", "chapter", "page"]);
export type FollowTargetType = z.infer<typeof FollowTargetType>;

/** POST /follows and DELETE /follows (same body). Hashtag targets use the tag without "#". */
export const FollowInput = z.object({ targetType: FollowTargetType, targetId: z.string().min(1).max(80) });
export type FollowInput = z.infer<typeof FollowInput>;

/** `canConnect` false: an official account (or the viewer is one), so only Follow is offered. */
export const SuggestedMember = MemberRef.extend({ reason: z.string(), canConnect: z.boolean().optional() });
export type SuggestedMember = z.infer<typeof SuggestedMember>;

/* ---------- Lists and inputs added by the identity workstream ---------- */

/** GET /me/connections?filter=connected|incoming|outgoing */
export const ConnectionsQuery = z.object({
  filter: z.enum(["connected", "incoming", "outgoing"]).default("connected"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ConnectionsQuery = z.infer<typeof ConnectionsQuery>;

/** GET /me/follows?type= → Page<FollowView> */
export const FollowsQuery = z.object({
  type: FollowTargetType.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FollowsQuery = z.infer<typeof FollowsQuery>;

export const FollowView = z.object({
  targetType: FollowTargetType,
  /** Member id, chapter id or lower-cased hashtag. */
  targetId: z.string(),
  member: MemberRef.optional(),
  chapter: ChapterRef.optional(),
  page: PageRef.optional(),
  hashtag: z.object({ tag: z.string(), display: z.string() }).optional(),
  createdAt: z.string(),
});
export type FollowView = z.infer<typeof FollowView>;

/** GET /me/blocks → BlockView[] (members the viewer blocked). */
export const BlockView = z.object({ member: MemberRef, createdAt: z.string() });
export type BlockView = z.infer<typeof BlockView>;

export const MuteTargetType = z.enum(["member", "hashtag"]);
export type MuteTargetType = z.infer<typeof MuteTargetType>;

/** POST /mutes and DELETE /mutes (same body). Hashtags without "#"; members by id. */
export const MuteInput = z.object({ targetType: MuteTargetType, targetId: z.string().min(1).max(60) });
export type MuteInput = z.infer<typeof MuteInput>;

/** GET /me/mutes → MuteView[] */
export const MuteView = z.object({
  targetType: MuteTargetType,
  targetId: z.string(),
  member: MemberRef.optional(),
  createdAt: z.string(),
});
export type MuteView = z.infer<typeof MuteView>;

/** GET /me/profile/preview?as= */
export const ProfilePreviewQuery = z.object({ as: PreviewAs });
export type ProfilePreviewQuery = z.infer<typeof ProfilePreviewQuery>;

/** GET /me/export — the member's own data (spec 8.3). */
export const AccountExport = z.object({
  exportedAt: z.string(),
  account: z.object({
    id: z.string().uuid(),
    email: z.string(),
    status: z.string(),
    emailVerifiedAt: z.string().nullable(),
    createdAt: z.string(),
    lastLoginAt: z.string().nullable(),
  }),
  profile: OwnProfile,
  posts: z.array(z.object({ id: z.string().uuid(), body: z.string(), createdAt: z.string(), editedAt: z.string().nullable() })),
  comments: z.array(
    z.object({ id: z.string().uuid(), postId: z.string().uuid(), body: z.string(), createdAt: z.string(), editedAt: z.string().nullable() }),
  ),
  connections: z.array(
    z.object({ handle: z.string(), name: z.string(), status: z.string(), direction: z.enum(["incoming", "outgoing"]), createdAt: z.string() }),
  ),
  follows: z.array(z.object({ targetType: z.string(), targetId: z.string(), createdAt: z.string() })),
  consents: z.array(z.object({ policyType: z.string(), policyVersion: z.string(), acceptedAt: z.string() })),
});
export type AccountExport = z.infer<typeof AccountExport>;

/*
 * Member lists behind the counts: who reacted, commented or reposted, and a member's
 * connections and followers.
 *   GET /posts/{id}/reactions?kind=      GET /comments/{id}/reactions?kind=
 *   GET /posts/{id}/commenters           GET /posts/{id}/reposts
 *   GET /members/{handle}/connections    GET /members/{handle}/followers    GET /members/{handle}/following
 *   GET /pages/{slug}/followers          (the page's admins and platform admins)
 * All need a signed-in member, leave out anyone blocked either way, and return PeoplePage.
 */
export const PeopleQuery = z.object({
  kind: z.enum(["like", "insightful", "support"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PeopleQuery = z.infer<typeof PeopleQuery>;

export const PersonEntry = DirectoryMember.extend({
  /** Their reaction, in reaction lists. */
  reaction: z.enum(["like", "insightful", "support"]).nullable(),
  at: z.string(),
});
export type PersonEntry = z.infer<typeof PersonEntry>;

export type PeoplePage = {
  items: PersonEntry[];
  nextCursor: string | null;
  /** Everyone in the list, before filtering by reaction. */
  total: number;
  /** Reaction lists: how many of each (the tabs). */
  byReaction?: { like: number; insightful: number; support: number };
};
