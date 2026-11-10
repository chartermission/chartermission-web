import { z } from "zod";
import { ChapterRef, MemberRef } from "./common.js";
import type { PostView } from "./social.js";

/*
 * Chapters (one per country). Members join a chapter by following it. Serving Ambassadors
 * and Chapter Leads run the chapter page: they host events as the chapter, pin up to three
 * posts, edit the About text and moderate the chapter (approve, hold or remove posts, bar
 * members from the chapter and report fraud to the platform team).
 */

/** Most posts a chapter can pin at once. */
export const CHAPTER_PIN_LIMIT = 3;
export const CHAPTER_ABOUT_MAX_CHARS = 1000;

export const ChapterTeamRole = z.enum(["founding_ambassador", "ambassador", "chapter_lead"]);
export type ChapterTeamRole = z.infer<typeof ChapterTeamRole>;

export type ChapterTeamMember = { member: MemberRef; role: ChapterTeamRole; label: string };

/** A photograph from a free image library, shown with its photographer's name. */
export type ChapterPhoto = { url: string; credit: string | null; creditUrl: string | null };

/** GET /chapters — every active chapter. */
export type ChapterSummary = ChapterRef & {
  countryName: string;
  region: string;
  /** Uploaded display picture; null means show the generated chapter avatar (ChapterAvatar). */
  imageUrl: string | null;
  /** Uploaded cover banner for the chapter page; null means show the generated cover (ChapterCover). */
  coverUrl: string | null;
  about: string | null;
  /** The chapter's own hashtag in display form, without "#" (e.g. "Nigeria"); links to /topics/{tag}. */
  hashtag: string | null;
  /** A photograph of the chapter's country, shown on the cover when there is no uploaded cover. */
  photo: ChapterPhoto | null;
  followers: number;
  viewer: { following: boolean };
};

/** GET /chapters/{slug} */
export type ChapterDetail = ChapterSummary & {
  team: ChapterTeamMember[];
  /** Pinned posts, newest pin first (at most CHAPTER_PIN_LIMIT). */
  pinned: PostView[];
  /** Who pinned each post and when. Only for the chapter team; empty for everyone else. */
  pins: ChapterPin[];
  /** "review": members' posts wait for the chapter team's approval before they appear here. */
  postApproval: ChapterPostApproval;
  /** Newest followers, for the header and Members preview. */
  recentMembers: MemberRef[];
  /** Other active chapters in the same region. */
  nearby: ChapterRef[];
  counts: { followers: number; posts: number; upcomingEvents: number };
  viewer: {
    following: boolean;
    /** Ambassador or Chapter Lead of this chapter, or platform staff with chapter.manage. */
    canManage: boolean;
    /** Can propose an event hosted by this chapter. */
    canHostAsChapter: boolean;
    /** Barred from this chapter by its team: can read it, but can't join or post. */
    banned: boolean;
  };
  /** For the chapter team: posts waiting for approval and members barred. Null for everyone else. */
  moderation: { pendingPosts: number; bannedMembers: number } | null;
};

export const ChapterPostApproval = z.enum(["direct", "review"]);
export type ChapterPostApproval = z.infer<typeof ChapterPostApproval>;

export type ChapterPin = { postId: string; pinnedBy: MemberRef | null; pinnedAt: string };

/** Platform setting (GET/PUT /admin/settings/chapter-posts): the rule for chapters that don't set their own. */
export const ChapterPostsSettings = z.object({ approval: ChapterPostApproval });
export type ChapterPostsSettings = z.infer<typeof ChapterPostsSettings>;
export const CHAPTER_POSTS_DEFAULTS: ChapterPostsSettings = { approval: "direct" };

export const CHAPTER_NOTE_MAX_CHARS = 500;
const ReviewNote = z.string().trim().max(CHAPTER_NOTE_MAX_CHARS, `Keep it under ${CHAPTER_NOTE_MAX_CHARS} characters`);

/**
 * POST /chapters/{slug}/posts/{postId}/review — the chapter team's decision on a post.
 * approve: show it in the chapter. decline: turn down a waiting post. hold: take a live post back
 * for review. remove: take a live post out of the chapter for good. A note is sent to the author.
 */
export const ChapterPostReviewInput = z.object({
  action: z.enum(["approve", "decline", "hold", "remove"]),
  note: ReviewNote.optional(),
});
export type ChapterPostReviewInput = z.infer<typeof ChapterPostReviewInput>;

/** GET /chapters/{slug}/review — posts waiting for approval, oldest first. */
export type ChapterReviewQueue = { items: PostView[] };

/** POST /chapters/{slug}/bans */
export const ChapterBanInput = z.object({ userId: z.string().uuid(), reason: ReviewNote.optional() });
export type ChapterBanInput = z.infer<typeof ChapterBanInput>;

/** GET /chapters/{slug}/bans */
export type ChapterBan = { member: MemberRef; bannedBy: MemberRef | null; reason: string | null; createdAt: string };

/**
 * POST /chapters/{slug}/fraud-reports — the chapter team flags a post or a member to the platform's
 * moderators as suspected fraud. It joins the moderation queue at high priority.
 */
export const ChapterFraudReportInput = z.object({
  targetType: z.enum(["post", "member"]),
  targetId: z.string().uuid(),
  detail: z.string().trim().min(10, "Say what makes you suspect fraud (at least 10 characters)").max(1000),
});
export type ChapterFraudReportInput = z.infer<typeof ChapterFraudReportInput>;

/** POST /chapters/{slug}/pins */
export const PinChapterPostInput = z.object({ postId: z.string().uuid() });
export type PinChapterPostInput = z.infer<typeof PinChapterPostInput>;

/** PATCH /chapters/{slug} */
export const UpdateChapterInput = z.object({
  about: z.string().trim().max(CHAPTER_ABOUT_MAX_CHARS, `Keep it under ${CHAPTER_ABOUT_MAX_CHARS} characters`),
});
export type UpdateChapterInput = z.infer<typeof UpdateChapterInput>;

/** GET /chapters/{slug}/members — followers, newest first. */
export const ChapterMembersQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type ChapterMembersQuery = z.infer<typeof ChapterMembersQuery>;

export function chapterTeamLabel(role: ChapterTeamRole): string {
  return role === "founding_ambassador" ? "Founding Ambassador" : role === "ambassador" ? "Ambassador" : "Chapter Lead";
}
