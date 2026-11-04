import { z } from "zod";
import { ChapterRef, MemberRef } from "./common.js";
import { PostView } from "./social.js";

/*
 * Home feed "character": the personal welcome strip, community moment cards woven into the
 * stream, and the Articles section. All read-only; actions reuse existing endpoints
 * (POST /follows, the composer, GET /posts/:id).
 */

/** The daily prompt hashtag: answering a prompt is a normal post carrying it. */
export const DAILY_PROMPT_TAG = "DailyPrompt";

/** A member counts as new for this many days after joining. */
export const NEW_MEMBER_DAYS = 14;

/** A visit counts as a new one after this many minutes away from the home feed. */
export const HOME_VISIT_GAP_MINUTES = 30;

export const WelcomeNudgeKind = z.enum(["complete_profile", "first_post", "follow_chapter", "answer_question"]);
export type WelcomeNudgeKind = z.infer<typeof WelcomeNudgeKind>;

/** GET /home/welcome — also records this visit (the previous one becomes `lastVisitAt`). */
export const WelcomeSummary = z.object({
  /** First word of the display name. The greeting itself ("Good morning") is chosen on the device, in local time. */
  firstName: z.string(),
  memberSince: z.string(),
  /** Joined within NEW_MEMBER_DAYS. */
  isNewMember: z.boolean(),
  /** The visit before this one; null on the first visit. */
  lastVisitAt: z.string().nullable(),
  /** The viewer's main chapter (the first one they followed), if any. */
  chapter: ChapterRef.nullable(),
  stats: z.object({
    /** Posts by others since lastVisitAt (last 24 hours on the first visit). */
    newPosts: z.number().int(),
    /** Questions from the last 14 days with no accepted answer, not by the viewer. */
    openQuestions: z.number().int(),
    /** Members who joined in the last 7 days: in the viewer's chapter when they have one, otherwise everywhere. */
    newMembers: z.number().int(),
    /** Celebration posts in the last 7 days. */
    celebrations: z.number().int(),
  }),
  /** One suggested next step, or null when there is nothing to suggest. */
  nudge: z
    .object({
      kind: WelcomeNudgeKind,
      label: z.string(),
      href: z.string(),
    })
    .nullable(),
});
export type WelcomeSummary = z.infer<typeof WelcomeSummary>;

/** A member shown on a moment card, with the viewer's follow state. */
export const MomentMember = MemberRef.extend({
  isFollowing: z.boolean(),
  countryCode: z.string().nullable(),
});
export type MomentMember = z.infer<typeof MomentMember>;

export const SpotlightMoment = z.object({
  kind: z.literal("spotlight"),
  /** Stable for the day, e.g. "spotlight:2026-11-05". Used to remember dismissals. */
  id: z.string(),
  member: MomentMember.extend({
    bio: z.string().nullable(),
    sectors: z.array(z.string()),
    followers: z.number().int(),
    posts: z.number().int(),
  }),
  /** Their most recent public post, as a short excerpt. */
  recentPost: z.object({ id: z.string().uuid(), excerpt: z.string() }).nullable(),
});

export const NewMembersMoment = z.object({
  kind: z.literal("new_members"),
  id: z.string(),
  /** Where the members come from: the viewer's chapter, their country, or the whole network. */
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("chapter"), chapter: ChapterRef }),
    z.object({ type: z.literal("country"), countryCode: z.string(), countryName: z.string() }),
    z.object({ type: z.literal("global") }),
  ]),
  members: z.array(MomentMember.extend({ joinedAt: z.string() })),
  /** All new members in scope (may be more than shown). */
  total: z.number().int(),
});

export const PromptMoment = z.object({
  kind: z.literal("prompt"),
  id: z.string(),
  prompt: z.string(),
  hashtag: z.string(),
  /** Posts with the hashtag today (UTC). */
  responses: z.number().int(),
  responders: z.array(MemberRef),
  /** The viewer has already answered today. */
  answered: z.boolean(),
});

export const ChapterHighlightMoment = z.object({
  kind: z.literal("chapter_highlight"),
  id: z.string(),
  chapter: ChapterRef,
  isFollowing: z.boolean(),
  members: z.number().int(),
  postsThisWeek: z.number().int(),
  topPost: z
    .object({
      id: z.string().uuid(),
      excerpt: z.string(),
      author: MemberRef,
      reactions: z.number().int(),
      comments: z.number().int(),
    })
    .nullable(),
});

export const Moment = z.discriminatedUnion("kind", [SpotlightMoment, NewMembersMoment, PromptMoment, ChapterHighlightMoment]);
export type Moment = z.infer<typeof Moment>;
export type SpotlightMoment = z.infer<typeof SpotlightMoment>;
export type NewMembersMoment = z.infer<typeof NewMembersMoment>;
export type PromptMoment = z.infer<typeof PromptMoment>;
export type ChapterHighlightMoment = z.infer<typeof ChapterHighlightMoment>;

/** GET /home/moments — at most one of each kind, in suggested display order; kinds with nothing to show are left out. */
export const MomentsResponse = z.object({ moments: z.array(Moment) });
export type MomentsResponse = z.infer<typeof MomentsResponse>;

/* ---------------- Articles ---------------- */

export const ArticleSort = z.enum(["latest", "popular"]);
export type ArticleSort = z.infer<typeof ArticleSort>;

/** GET /articles?sort=&tag=&cursor=&limit= — Page<PostView>, articles only. `popular` ranks the last 30 days. */
export const ArticlesQuery = z.object({
  sort: ArticleSort.default("latest"),
  tag: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N}_]{1,60}$/u)
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});
export type ArticlesQuery = z.infer<typeof ArticlesQuery>;

/** GET /articles/hub */
export const ArticlesHub = z.object({
  /** The most engaged-with article of the last 30 days (latest article as a fallback). */
  featured: PostView.nullable(),
  /** Top articles of the last 7 days, featured excluded (up to 5). */
  popular: z.array(PostView),
  /** Hashtags used on articles, most used first (up to 12). */
  topics: z.array(z.object({ tag: z.string(), articles: z.number().int() })),
  /** Members who have written the most articles (up to 5). */
  authors: z.array(z.object({ member: MomentMember, articles: z.number().int() })),
  total: z.number().int(),
});
export type ArticlesHub = z.infer<typeof ArticlesHub>;

/** GET /articles/:id/related */
export const RelatedArticles = z.object({
  /** Other articles by the same author (up to 3). */
  moreByAuthor: z.array(PostView),
  /** Articles sharing a hashtag, otherwise the latest (up to 3), excluding the above. */
  related: z.array(PostView),
});
export type RelatedArticles = z.infer<typeof RelatedArticles>;
