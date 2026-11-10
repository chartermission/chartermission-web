import { z } from "zod";
import { ChapterRef, MemberRef } from "./common.js";
import type { PostView } from "./social.js";

/*
 * Chapters (one per country). Members join a chapter by following it. Serving Ambassadors
 * and Chapter Leads run the chapter page: they host events as the chapter, pin up to three
 * posts and edit the About text.
 */

/** Most posts a chapter can pin at once. */
export const CHAPTER_PIN_LIMIT = 3;
export const CHAPTER_ABOUT_MAX_CHARS = 1000;

export const ChapterTeamRole = z.enum(["founding_ambassador", "ambassador", "chapter_lead"]);
export type ChapterTeamRole = z.infer<typeof ChapterTeamRole>;

export type ChapterTeamMember = { member: MemberRef; role: ChapterTeamRole; label: string };

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
  followers: number;
  viewer: { following: boolean };
};

/** GET /chapters/{slug} */
export type ChapterDetail = ChapterSummary & {
  team: ChapterTeamMember[];
  /** Pinned posts, newest pin first (at most CHAPTER_PIN_LIMIT). */
  pinned: PostView[];
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
  };
};

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
