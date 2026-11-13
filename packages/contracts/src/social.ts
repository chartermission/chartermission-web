import { z } from "zod";
import { ChapterRef, MemberRef, PageRef } from "./common.js";
import { EventSummary } from "./events.js";

/*
 * Feed, posts, comments, reactions, bookmarks, polls, hashtags, trending and uploads
 * (spec 4.5 FED, Figma feed / post detail / create-post / topic screens).
 */

export const POST_MAX_CHARS = 3000;
/** Articles (long-form posts) allow a longer body. */
export const ARTICLE_MAX_CHARS = 20000;
/** Shortest article body worth publishing as an article. */
export const ARTICLE_MIN_CHARS = 200;
export const COMMENT_MAX_CHARS = 1500;
export const ALT_TEXT_MAX_CHARS = 300;
/** Article reading time: words per minute, rounded up, at least 1 minute. */
export const READING_WPM = 220;

export const ReactionKind = z.enum(["like", "insightful", "support"]);
export type ReactionKind = z.infer<typeof ReactionKind>;

export const PostKind = z.enum(["standard", "announcement"]);
export type PostKind = z.infer<typeof PostKind>;

/**
 * What a post is. "kind" says who it comes from (an announcement is a platform-team
 * post); "type" says what shape it has:
 *  - standard: text, photos, a document, a poll, a link, or an event shared to the feed (eventId);
 *  - question: Ask the community; comments are answers and the author can mark the best one;
 *  - celebration: a milestone (new role, launch, funding, award, graduation);
 *  - request: "Looking for…" a co-founder, mentor, volunteers, partners, a hire or advice;
 *  - article: long-form, with a title, an optional cover image and headings.
 */
export const PostType = z.enum(["standard", "question", "celebration", "request", "article"]);
export type PostType = z.infer<typeof PostType>;

export const CelebrationCategory = z.enum(["new_role", "launch", "funding", "award", "graduation", "milestone", "certification"]);
export type CelebrationCategory = z.infer<typeof CelebrationCategory>;

export const CELEBRATION_LABELS: Record<CelebrationCategory, string> = {
  new_role: "New role",
  launch: "Launch",
  funding: "Funding",
  award: "Award",
  graduation: "Graduation",
  milestone: "Milestone",
  certification: "Certification",
};

export const RequestCategory = z.enum(["cofounder", "mentor", "volunteers", "partner", "hire", "advice"]);
export type RequestCategory = z.infer<typeof RequestCategory>;

export const REQUEST_LABELS: Record<RequestCategory, string> = {
  cofounder: "Co-founder",
  mentor: "Mentor",
  volunteers: "Volunteers",
  partner: "Partners",
  hire: "Hiring",
  advice: "Advice",
};

export const CelebrationDetails = z.object({
  category: CelebrationCategory,
  /** e.g. "Started as Head of Partnerships at GreenGrid Africa". */
  headline: z.string().trim().min(3, "Add a headline").max(120),
  organisation: z.string().trim().max(80).optional(),
});
export type CelebrationDetails = z.infer<typeof CelebrationDetails>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31");

export const RequestDetails = z.object({
  category: RequestCategory,
  /** e.g. "Looking for a technical co-founder for a cold-chain startup". */
  title: z.string().trim().min(3, "Say what you are looking for").max(120),
  skills: z.array(z.string().trim().min(1).max(40)).max(8, "Up to 8 skills").default([]),
  location: z.string().trim().max(80).optional(),
  remote: z.boolean().default(false),
  /** Optional last day to respond (YYYY-MM-DD). */
  closesOn: isoDate.optional(),
});
export type RequestDetails = z.infer<typeof RequestDetails>;

export const ArticleDetails = z.object({
  title: z.string().trim().min(5, "Give the article a title").max(150),
  subtitle: z.string().trim().max(200).optional(),
});
export type ArticleDetails = z.infer<typeof ArticleDetails>;

/** Words in a text, for article reading time. */
export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / READING_WPM));
}

export const ModerationState = z.enum(["visible", "hidden", "removed"]);
export type ModerationState = z.infer<typeof ModerationState>;

export const AttachmentView = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "document", "video"]),
  url: z.string(),
  name: z.string().nullable(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Description for screen readers; null when the author left it empty. */
  alt: z.string().nullable(),
  /** Videos: length in seconds and a still frame for the player before it starts. */
  durationSeconds: z.number().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
});
export type AttachmentView = z.infer<typeof AttachmentView>;

export const PollView = z.object({
  id: z.string().uuid(),
  question: z.string(),
  closesAt: z.string(),
  closed: z.boolean(),
  totalVotes: z.number().int(),
  options: z.array(z.object({ id: z.string().uuid(), label: z.string(), votes: z.number().int(), percent: z.number().int() })),
  /** Results are shown after voting or once the poll closes. */
  myVoteOptionId: z.string().uuid().nullable(),
});
export type PollView = z.infer<typeof PollView>;

/* ---------- Video links (YouTube, Vimeo, Loom, TikTok, Dailymotion) ---------- */

export const VideoProvider = z.enum(["youtube", "vimeo", "loom", "tiktok", "dailymotion"]);
export type VideoProvider = z.infer<typeof VideoProvider>;

export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
  tiktok: "TikTok",
  dailymotion: "Dailymotion",
};

/** A link that plays in an embedded player. Built only by parseVideoEmbed, never taken from clients. */
export const VideoEmbed = z.object({
  provider: VideoProvider,
  videoId: z.string(),
  /** The iframe src: privacy-friendly player URLs (youtube-nocookie.com for YouTube). */
  embedUrl: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Portrait players (YouTube Shorts, TikTok) are shown 9:16. */
  vertical: z.boolean(),
});
export type VideoEmbed = z.infer<typeof VideoEmbed>;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function startSeconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Recognise a video link from a supported platform and build its player. Returns null for
 * anything else (it stays an ordinary link preview). Shared by the API and the composer.
 */
export function parseVideoEmbed(raw: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    let vertical = false;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (parts[0] === "shorts") {
      id = parts[1] ?? null;
      vertical = true;
    } else if (parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") id = parts[1] ?? null;
    if (!id || !YT_ID.test(id)) return null;
    const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return {
      provider: "youtube",
      videoId: id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ""}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      vertical,
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const idx = parts.findIndex((p) => /^\d{5,12}$/.test(p));
    if (idx < 0) return null;
    const id = parts[idx]!;
    const next = parts[idx + 1];
    const hash = url.searchParams.get("h") ?? (next && /^[0-9a-f]{6,20}$/i.test(next) ? next : null);
    return {
      provider: "vimeo",
      videoId: id,
      embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`,
      thumbnailUrl: null,
      vertical: false,
    };
  }
  if (host === "loom.com") {
    const id = (parts[0] === "share" || parts[0] === "embed") && parts[1] && /^[0-9a-f]{32}$/i.test(parts[1]) ? parts[1] : null;
    if (!id) return null;
    return { provider: "loom", videoId: id, embedUrl: `https://www.loom.com/embed/${id}`, thumbnailUrl: null, vertical: false };
  }
  if (host === "tiktok.com") {
    const idx = parts.indexOf("video");
    const id = idx >= 0 ? parts[idx + 1] : null;
    if (!id || !/^\d{8,25}$/.test(id)) return null;
    return { provider: "tiktok", videoId: id, embedUrl: `https://www.tiktok.com/embed/v2/${id}`, thumbnailUrl: null, vertical: true };
  }
  if (host === "dailymotion.com" || host === "dai.ly") {
    const id = host === "dai.ly" ? parts[0] : parts[0] === "video" ? parts[1]?.split("_")[0] : null;
    if (!id || !/^[a-z0-9]{5,12}$/i.test(id)) return null;
    return {
      provider: "dailymotion",
      videoId: id,
      embedUrl: `https://www.dailymotion.com/embed/video/${id}`,
      thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${id}`,
      vertical: false,
    };
  }
  return null;
}

export const LinkPreview = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /** Set when the link is a supported video: the post shows a player instead of a link card. */
  embed: VideoEmbed.nullable().optional(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const ReactionCounts = z.object({ like: z.number().int(), insightful: z.number().int(), support: z.number().int() });

export type QuestionState = {
  /** The comment the author marked as the best answer. */
  acceptedCommentId: string | null;
  answered: boolean;
};

export type RequestState = RequestDetails & {
  /** Closed by the author, or past closesOn. */
  closed: boolean;
  helpOffers: number;
  viewerOffered: boolean;
};

export type ArticleState = {
  title: string;
  subtitle: string | null;
  readingMinutes: number;
  /** First image attachment, used as the cover. */
  coverUrl: string | null;
  coverAlt: string | null;
};

/**
 * "pending_media": files are still being checked. "in_review": waiting for the chapter team to
 * approve it. "declined": not approved, or taken out of the chapter. Only "published" posts are
 * seen by other members.
 */
export const PostStatus = z.enum(["published", "pending_media", "in_review", "declined"]);
export type PostStatus = z.infer<typeof PostStatus>;

export const ChapterReviewInfo = z.object({
  state: z.enum(["pending", "approved", "declined"]),
  /** The reviewer's note to the author. */
  note: z.string().nullable(),
  /** Who decided or held it, for the chapter team; null for the author's own view. */
  by: MemberRef.nullable(),
  at: z.string().nullable(),
});
export type ChapterReviewInfo = z.infer<typeof ChapterReviewInfo>;

export type PostView = {
  id: string;
  /**
   * Who the post is shown as. For a post published as a page this carries the page's name, logo and
   * tick (id = page id, handle = page slug) and `page` is set; the admin who wrote it is not exposed.
   */
  author: MemberRef;
  /** Set when the post was published as a page: link to /pages/{slug} instead of a member profile. */
  page: PageRef | null;
  /**
   * The page a member's post is about (a Charter Center certificate names Charter Center's page):
   * the celebration links to it and the post is also listed on that page.
   */
  aboutPage: PageRef | null;
  body: string;
  kind: PostKind;
  type: PostType;
  question: QuestionState | null;
  celebration: CelebrationDetails | null;
  request: RequestState | null;
  article: ArticleState | null;
  pinned: boolean;
  chapter: ChapterRef | null;
  hashtags: string[];
  mentions: MemberRef[];
  attachments: AttachmentView[];
  poll: PollView | null;
  linkPreview: LinkPreview | null;
  /** One level only: a repost of a repost shows the original. Null when the original was removed. */
  repostOf: PostView | null;
  isRepost: boolean;
  /**
   * The event this post shares, as the viewer sees it now (date, place, seats, their registration).
   * Null when the post shares no event, or the event is no longer public (unpublished): see isEventShare.
   */
  event: EventSummary | null;
  /** The post was written to share an event (true even when the event has since been taken down). */
  isEventShare: boolean;
  status: PostStatus;
  /** Chapter approval, shown to the author and the chapter's reviewers; absent when the post never needed it. */
  chapterReview?: ChapterReviewInfo;
  createdAt: string;
  editedAt: string | null;
  counts: { reactions: number; comments: number; reposts: number };
  reactionBreakdown: z.infer<typeof ReactionCounts>;
  viewer: {
    reaction: ReactionKind | null;
    bookmarked: boolean;
    reposted: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReport: boolean;
    /** The viewer wrote this post, or manages the page it was published as (they can open its analytics). */
    canViewAnalytics: boolean;
  };
  /** Present only for the author or moderators when the post is not visible to others. */
  moderationState?: ModerationState;
};

export const QuestionState = z.object({ acceptedCommentId: z.string().uuid().nullable(), answered: z.boolean() });
export const RequestState = RequestDetails.extend({
  closed: z.boolean(),
  helpOffers: z.number().int(),
  viewerOffered: z.boolean(),
});
export const ArticleState = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  readingMinutes: z.number().int(),
  coverUrl: z.string().nullable(),
  coverAlt: z.string().nullable(),
});

export const PostView: z.ZodType<PostView> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    author: MemberRef,
    page: PageRef.nullable(),
    aboutPage: PageRef.nullable(),
    body: z.string(),
    kind: PostKind,
    type: PostType,
    question: QuestionState.nullable(),
    celebration: CelebrationDetails.nullable(),
    request: RequestState.nullable(),
    article: ArticleState.nullable(),
    pinned: z.boolean(),
    chapter: ChapterRef.nullable(),
    hashtags: z.array(z.string()),
    mentions: z.array(MemberRef),
    attachments: z.array(AttachmentView),
    poll: PollView.nullable(),
    linkPreview: LinkPreview.nullable(),
    repostOf: PostView.nullable(),
    isRepost: z.boolean(),
    event: EventSummary.nullable(),
    isEventShare: z.boolean(),
    status: PostStatus,
    chapterReview: ChapterReviewInfo.optional(),
    createdAt: z.string(),
    editedAt: z.string().nullable(),
    counts: z.object({ reactions: z.number().int(), comments: z.number().int(), reposts: z.number().int() }),
    reactionBreakdown: ReactionCounts,
    viewer: z.object({
      reaction: ReactionKind.nullable(),
      bookmarked: z.boolean(),
      reposted: z.boolean(),
      canEdit: z.boolean(),
      canDelete: z.boolean(),
      canReport: z.boolean(),
      canViewAnalytics: z.boolean(),
    }),
    moderationState: ModerationState.optional(),
  }),
);

/** Poll as written in the composer. */
export const PollInput = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
  durationHours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(72),
});
export type PollInput = z.infer<typeof PollInput>;

/** Everything a post is made from. Shared by POST /posts and drafts. */
export const PostComposition = z.object({
  type: PostType.default("standard"),
  body: z.string().trim().max(ARTICLE_MAX_CHARS),
  attachmentIds: z.array(z.string().uuid()).max(4).default([]),
  /** Alt text per attachment id (images). */
  altTexts: z.record(z.string().uuid(), z.string().trim().max(ALT_TEXT_MAX_CHARS)).optional(),
  poll: PollInput.optional(),
  linkUrl: z.string().url().max(500).optional(),
  repostOfId: z.string().uuid().optional(),
  /** Share an event to the feed: the post shows the event's card. Standard posts only, without media, a poll or a repost. */
  eventId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  /** Publish as a page the member manages (the page must be live). */
  pageId: z.string().uuid().optional(),
  visibility: z.enum(["members", "public"]).default("public"),
  /** Only for accounts with post.announce. */
  kind: PostKind.default("standard"),
  celebration: CelebrationDetails.optional(),
  request: RequestDetails.optional(),
  article: ArticleDetails.optional(),
});
export type PostComposition = z.infer<typeof PostComposition>;

type Issue = { path: (string | number)[]; message: string };

/** Rules for each post type. Returned as issues so drafts can show them without failing. */
export function compositionIssues(v: PostComposition): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path: [path], message });
  const max = v.type === "article" ? ARTICLE_MAX_CHARS : POST_MAX_CHARS;
  if (v.body.length > max) add("body", `Posts can be up to ${max.toLocaleString("en")} characters`);
  if (!v.body.length && !v.repostOfId && !v.eventId && v.attachmentIds.length === 0 && v.type === "standard") {
    add("body", "Write something or attach a file");
  }
  if (v.type !== "standard") {
    if (v.poll) add("poll", "Polls can only be added to standard posts");
    if (v.repostOfId) add("repostOfId", "Only standard posts can quote another post");
    if (v.eventId) add("eventId", "Only standard posts can share an event");
  }
  if (v.eventId) {
    if (v.repostOfId) add("eventId", "A post can share an event or another post, not both");
    if (v.poll) add("eventId", "A post can share an event or have a poll, not both");
    if (v.attachmentIds.length) add("eventId", "A post that shares an event can’t have attachments");
  }
  if (v.type !== "celebration" && v.celebration) add("celebration", "Only celebration posts have milestone details");
  if (v.type !== "request" && v.request) add("request", "Only “Looking for” posts have request details");
  if (v.type !== "article" && v.article) add("article", "Only articles have a title");
  switch (v.type) {
    case "question":
      if (v.body.length < 10) add("body", "Write your question (at least 10 characters)");
      break;
    case "celebration":
      if (!v.celebration) add("celebration", "Choose what you are celebrating");
      break;
    case "request":
      if (!v.request) add("request", "Say what you are looking for");
      break;
    case "article":
      if (!v.article) add("article", "Give the article a title");
      if (v.body.length < ARTICLE_MIN_CHARS) add("body", `Articles need at least ${ARTICLE_MIN_CHARS} characters`);
      if (v.attachmentIds.length > 1) add("attachmentIds", "Articles take one cover image");
      break;
  }
  return issues;
}

/** POST /posts — up to 4 images or 1 document (CM-FED-01); type rules in compositionIssues. */
export const CreatePostInput = PostComposition.superRefine((v, ctx) => {
  for (const issue of compositionIssues(v)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export type CreatePostInput = z.infer<typeof CreatePostInput>;

/** PATCH /posts/{id} — author edit, marked "edited" (CM-FED-06). Type-specific details can be edited too. */
export const UpdatePostInput = z.object({
  body: z.string().trim().min(1).max(ARTICLE_MAX_CHARS),
  altTexts: z.record(z.string().uuid(), z.string().trim().max(ALT_TEXT_MAX_CHARS)).optional(),
  celebration: CelebrationDetails.optional(),
  request: RequestDetails.optional(),
  article: ArticleDetails.optional(),
});
export type UpdatePostInput = z.infer<typeof UpdatePostInput>;

/** PUT /posts/{id}/accepted-answer — question author marks the best answer. */
export const AcceptAnswerInput = z.object({ commentId: z.string().uuid() });
export type AcceptAnswerInput = z.infer<typeof AcceptAnswerInput>;

/** PUT /posts/{id}/closed — request author closes or reopens a "Looking for" post. */
export const CloseRequestInput = z.object({ closed: z.boolean() });
export type CloseRequestInput = z.infer<typeof CloseRequestInput>;

/** PUT /posts/{id}/help — "I can help" on a request, with an optional note to the author. */
export const HelpOfferInput = z.object({ note: z.string().trim().max(500).default("") });
export type HelpOfferInput = z.infer<typeof HelpOfferInput>;

/** GET /posts/{id}/help — request author only. */
export const HelpOfferView = z.object({ member: MemberRef, note: z.string(), createdAt: z.string() });
export type HelpOfferView = z.infer<typeof HelpOfferView>;

/* ---------- Drafts and scheduled posts ---------- */

/** Composer state saved as a draft: any field may be missing or incomplete. */
export const DraftPayload = PostComposition.extend({
  body: z.string().max(ARTICLE_MAX_CHARS).default(""),
  poll: z
    .object({
      question: z.string().max(200).default(""),
      options: z.array(z.string().max(80)).max(4).default([]),
      durationHours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(72),
    })
    .optional(),
  // Details as typed so far: lengths are capped, but nothing is required yet.
  celebration: z
    .object({ category: CelebrationCategory.optional(), headline: z.string().max(120).optional(), organisation: z.string().max(80).optional() })
    .optional(),
  request: z
    .object({
      category: RequestCategory.optional(),
      title: z.string().max(120).optional(),
      skills: z.array(z.string().max(40)).max(8).optional(),
      location: z.string().max(80).optional(),
      remote: z.boolean().optional(),
      closesOn: z.string().max(10).optional(),
    })
    .optional(),
  article: z.object({ title: z.string().max(150).optional(), subtitle: z.string().max(200).optional() }).optional(),
});
export type DraftPayload = z.infer<typeof DraftPayload>;

/** A scheduled post publishes between 5 minutes and 60 days from now. */
export const SCHEDULE_MIN_MINUTES = 5;
export const SCHEDULE_MAX_DAYS = 60;
export const MAX_DRAFTS = 50;

export const DraftStatus = z.enum(["draft", "scheduled", "failed"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

/** POST /me/drafts and PATCH /me/drafts/{id}. scheduledFor turns a draft into a scheduled post; null unschedules. */
export const SaveDraftInput = z.object({
  payload: DraftPayload,
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});
export type SaveDraftInput = z.infer<typeof SaveDraftInput>;

export const DraftView = z.object({
  id: z.string().uuid(),
  status: DraftStatus,
  payload: DraftPayload,
  scheduledFor: z.string().nullable(),
  /** Why a scheduled post could not be published (status "failed"). */
  lastError: z.string().nullable(),
  /** Short text for lists: article title, request title, or the start of the body. */
  preview: z.string(),
  attachments: z.array(z.object({ id: z.string().uuid(), url: z.string().nullable(), kind: z.enum(["image", "document", "video"]), name: z.string().nullable() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DraftView = z.infer<typeof DraftView>;

/** GET /me/drafts?status=draft|scheduled */
export const DraftsQuery = z.object({
  status: z.enum(["draft", "scheduled"]).default("draft"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DraftsQuery = z.infer<typeof DraftsQuery>;

/** GET /feed (CM-FED-07: cursor pagination, 20 per page). */
export const FeedQuery = z.object({
  tab: z.enum(["for_you", "following", "latest"]).default("for_you"),
  country: z.string().length(2).optional(),
  sector: z.string().optional(),
  chapter: z.string().optional(),
  /**
   * One member's posts (member id or handle), newest first, for profile "Recent posts".
   * Ignores `tab`; pinned announcements are not lifted to the top. Unknown members give an empty page.
   */
  author: z.string().trim().min(1).max(60).optional(),
  /** One page's posts (page id or slug), newest first, for the page's Posts tab. Ignores `tab`. */
  page: z.string().trim().min(1).max(80).optional(),
  /** Query-string boolean: "true"/"1" or "false"/"0" (z.coerce.boolean would read "false" as true). */
  announcements: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  /** Only one type of post, e.g. questions. */
  type: PostType.optional(),
  /** With type=question: questions without an accepted answer. Same boolean encoding as announcements. */
  unanswered: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

/** GET /feed/new — same filters as /feed, counts posts newer than `since` (for the "new posts" pill). */
export const FeedNewQuery = FeedQuery.omit({ cursor: true, limit: true, author: true, page: true }).extend({
  since: z.string().datetime({ offset: true }),
});
export type FeedNewQuery = z.infer<typeof FeedNewQuery>;

export const FeedNewResponse = z.object({
  count: z.number().int(),
  /** Up to 3 authors of the new posts, for the avatars on the pill. */
  authors: z.array(MemberRef),
});
export type FeedNewResponse = z.infer<typeof FeedNewResponse>;

/** POST /posts/{id}/poll/vote */
export const PollVoteInput = z.object({ optionId: z.string().uuid() });
export type PollVoteInput = z.infer<typeof PollVoteInput>;

/* ---------- Comments (one level of replies) ---------- */

export type CommentView = {
  id: string;
  postId: string;
  parentId: string | null;
  author: MemberRef | null;
  body: string;
  state: "visible" | "hidden" | "removed" | "deleted";
  createdAt: string;
  editedAt: string | null;
  isPostAuthor: boolean;
  /** Marked by the question's author as the best answer. */
  isAcceptedAnswer: boolean;
  counts: { reactions: number; replies: number };
  reactionBreakdown: z.infer<typeof ReactionCounts>;
  viewer: { reaction: ReactionKind | null; canEdit: boolean; canDelete: boolean; canReport: boolean };
  /** First replies for top-level comments; fetch more with GET /comments/{id}/replies. */
  replies: CommentView[];
};

export const CommentView: z.ZodType<CommentView> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    postId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    author: MemberRef.nullable(),
    body: z.string(),
    state: z.enum(["visible", "hidden", "removed", "deleted"]),
    createdAt: z.string(),
    editedAt: z.string().nullable(),
    isPostAuthor: z.boolean(),
    isAcceptedAnswer: z.boolean(),
    counts: z.object({ reactions: z.number().int(), replies: z.number().int() }),
    reactionBreakdown: ReactionCounts,
    viewer: z.object({
      reaction: ReactionKind.nullable(),
      canEdit: z.boolean(),
      canDelete: z.boolean(),
      canReport: z.boolean(),
    }),
    replies: z.array(CommentView),
  }),
);

/** GET /posts/{id}/comments?sort=relevant|newest&cursor= */
export const CommentsQuery = z.object({
  sort: z.enum(["relevant", "newest"]).default("relevant"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CommentsQuery = z.infer<typeof CommentsQuery>;

/** POST /posts/{id}/comments */
export const CreateCommentInput = z.object({
  body: z.string().trim().min(1, "Write a comment").max(COMMENT_MAX_CHARS),
  parentId: z.string().uuid().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

/** PATCH /comments/{id} */
export const UpdateCommentInput = z.object({ body: z.string().trim().min(1).max(COMMENT_MAX_CHARS) });
export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>;

/* ---------- Reactions and bookmarks ---------- */

/** PUT /reactions (set or change) and DELETE /reactions (remove; kind ignored). */
export const ReactionInput = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
  kind: ReactionKind.default("like"),
});
export type ReactionInput = z.infer<typeof ReactionInput>;

/** PUT /reactions and DELETE /reactions response: the viewer's reaction and the cached counts after the change. */
export const ReactionState = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
  reaction: ReactionKind.nullable(),
  reactions: z.number().int(),
  /** Per-kind counts for the post or comment. Kept nullable for older clients; always set. */
  breakdown: ReactionCounts.nullable(),
});
export type ReactionState = z.infer<typeof ReactionState>;

/**
 * PUT /bookmarks and DELETE /bookmarks. Posts, events (EventSummary.viewer.saved) and courses
 * (CourseSummary.saved). PUT checks the target is visible to the viewer (NOT_FOUND otherwise).
 */
export const BookmarkTargetType = z.enum(["post", "event", "course", "opportunity"]);
export type BookmarkTargetType = z.infer<typeof BookmarkTargetType>;
export const BookmarkInput = z.object({ targetType: BookmarkTargetType, targetId: z.string().uuid() });
export type BookmarkInput = z.infer<typeof BookmarkInput>;

/* ---------- Hashtags and trending ---------- */

export const HashtagSuggestion = z.object({ tag: z.string(), posts: z.number().int(), trending: z.boolean() });
export type HashtagSuggestion = z.infer<typeof HashtagSuggestion>;

/** GET /hashtags/suggest?q= — composer autocomplete (prefix match, up to 8). */
export const HashtagSuggestQuery = z.object({ q: z.string().trim().max(51).default("") });
export type HashtagSuggestQuery = z.infer<typeof HashtagSuggestQuery>;

/** GET /topics/{tag} */
export const TopicView = z.object({
  tag: z.string(),
  description: z.string().nullable(),
  posts: z.number().int(),
  followers: z.number().int(),
  following: z.boolean(),
  muted: z.boolean(),
  /** Percentage change over the member's usual level, last 24h. */
  velocityPct: z.number().int().nullable(),
  trending: z.object({ rank: z.number().int(), scopeLabel: z.string() }).nullable(),
  /** Post counts for the last 7 days, oldest first. */
  activity7d: z.array(z.number().int()).length(7),
  related: z.array(z.string()),
});
export type TopicView = z.infer<typeof TopicView>;

/** GET /topics/{tag}/posts?sort=top|latest|media */
export const TopicPostsQuery = z.object({
  sort: z.enum(["top", "latest", "media"]).default("top"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TopicPostsQuery = z.infer<typeof TopicPostsQuery>;

/** GET /topics?sort=popular|new|followed&q= — the explore page. */
export const TopicsQuery = z.object({
  sort: z.enum(["popular", "new", "followed"]).default("popular"),
  q: z.string().trim().max(51).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TopicsQuery = z.infer<typeof TopicsQuery>;

export const TopicSummary = z.object({
  tag: z.string(),
  description: z.string().nullable(),
  posts: z.number().int(),
  followers: z.number().int(),
  following: z.boolean(),
  /** Posts in the last 7 days. */
  posts7d: z.number().int(),
  createdAt: z.string(),
});
export type TopicSummary = z.infer<typeof TopicSummary>;

export const TrendingScope = z.enum(["global", "country", "chapter"]);
export type TrendingScope = z.infer<typeof TrendingScope>;

export const TrendingWindow = z.enum(["24h", "7d"]);
export type TrendingWindow = z.infer<typeof TrendingWindow>;

/** GET /trending?scope=&scopeId=&window= */
export const TrendingQuery = z.object({
  scope: TrendingScope.default("global"),
  scopeId: z.string().optional(),
  window: TrendingWindow.default("24h"),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type TrendingQuery = z.infer<typeof TrendingQuery>;

export const TrendingItem = z.object({
  rank: z.number().int(),
  tag: z.string(),
  /** e.g. "Trending in Africa", "Trending in Nigeria". */
  context: z.string(),
  posts: z.number().int(),
  authors: z.number().int(),
  velocityPct: z.number().int(),
  pinned: z.boolean(),
});
export type TrendingItem = z.infer<typeof TrendingItem>;

export const TrendingResponse = z.object({
  computedAt: z.string().nullable(),
  scope: TrendingScope,
  scopeId: z.string().nullable(),
  window: TrendingWindow,
  items: z.array(TrendingItem),
});
export type TrendingResponse = z.infer<typeof TrendingResponse>;

/* ---------- Uploads (CM-FED-02, spec 6.3) ---------- */

export const UploadPurpose = z.enum([
  "avatar",
  "profile_cover",
  "post_image",
  "post_document",
  "post_video",
  "event_cover",
  "story_image",
  "story_video",
  "chapter_image",
  "chapter_cover",
  "page_logo",
  "page_cover",
  "profile_video",
  "profile_resume",
  "message_image",
  "message_file",
  "voice_note",
]);
export type UploadPurpose = z.infer<typeof UploadPurpose>;

/** Videos phones and cameras record: MP4 (H.264/HEVC), QuickTime (iPhone .mov) and WebM. All are converted to MP4. */
export const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const isVideoPurpose = (p: UploadPurpose) => p === "post_video" || p === "story_video" || p === "profile_video";
/** What browsers' voice recorders produce (WebM/Opus in Chrome and Firefox, MP4/AAC in Safari). All are converted to AAC (.m4a). */
export const VOICE_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/x-m4a", "audio/wav", "video/webm", "video/mp4"] as const;
export const isAudioPurpose = (p: UploadPurpose) => p === "voice_note";
/** Documents members can send in messages. */
export const MESSAGE_FILE_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const UPLOAD_LIMITS = {
  avatar: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  /** Profile cover photo (shown as a wide 4:1 banner on the profile). */
  profile_cover: { maxBytes: 8 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  post_image: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  post_document: { maxBytes: 10 * 1024 * 1024, mimes: ["application/pdf"] },
  /** Length is capped separately (MediaSettings.postVideoMaxSeconds, set by admins). */
  post_video: { maxBytes: 1536 * 1024 * 1024, mimes: VIDEO_MIMES },
  /** Event cover image (shown 16:9 on cards and the event page). */
  event_cover: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  story_image: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  story_video: { maxBytes: 250 * 1024 * 1024, mimes: VIDEO_MIMES },
  /** Chapter display picture (square, shown in a circle or rounded tile). Admins only. */
  chapter_image: { maxBytes: 8 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  /** Chapter page cover banner (4:1). Admins only. */
  chapter_cover: { maxBytes: 10 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  /** Page logo (square) and page cover (wide 4:1 banner). Page admins and staff. */
  page_logo: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  page_cover: { maxBytes: 8 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  /** A member's intro video for their profile. Length is capped separately (MediaSettings.introVideoMaxSeconds). */
  profile_video: { maxBytes: 800 * 1024 * 1024, mimes: VIDEO_MIMES },
  /** A member's résumé or CV, shown on their profile to the people they choose. PDF only. */
  profile_resume: { maxBytes: 5 * 1024 * 1024, mimes: ["application/pdf"] },
  /** Photos sent in messages. */
  message_image: { maxBytes: 10 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  /** Documents sent in messages: PDF, Word, Excel, PowerPoint. */
  message_file: { maxBytes: 20 * 1024 * 1024, mimes: MESSAGE_FILE_MIMES },
  /** Voice notes, up to VOICE_NOTE_MAX_SECONDS. */
  voice_note: { maxBytes: 25 * 1024 * 1024, mimes: VOICE_MIMES },
} as const;

/**
 * Video length limits, set by Platform Admins (GET /uploads/limits for members,
 * GET/PUT /admin/settings/media for admins). Uploaded videos are converted to 720p MP4.
 */
export const MediaSettings = z.object({
  postVideoMaxSeconds: z.number().int().min(10, "At least 10 seconds").max(3600, "At most 60 minutes"),
  storyVideoMaxSeconds: z.number().int().min(5, "At least 5 seconds").max(180, "At most 3 minutes"),
  /** Intro videos on member profiles. */
  introVideoMaxSeconds: z.number().int().min(10, "At least 10 seconds").max(900, "At most 15 minutes"),
});
export type MediaSettings = z.infer<typeof MediaSettings>;

/** "1:05", "10:00", "1:02:03". */
export function formatDuration(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** POST /uploads → a short-lived URL to PUT the bytes to. */
export const CreateUploadInput = z.object({
  purpose: UploadPurpose,
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  /**
   * Videos only: the part of the file to keep, chosen in the trim window. The kept part must fit
   * the length limit; the file itself can be longer. Left out, the whole video is used.
   */
  trim: z
    .object({ startMs: z.number().int().min(0), endMs: z.number().int().positive() })
    .refine((t) => t.endMs - t.startMs >= 1000, "Keep at least one second")
    .optional(),
});
export type CreateUploadInput = z.infer<typeof CreateUploadInput>;

export const CreateUploadResponse = z.object({
  fileId: z.string().uuid(),
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

/** POST /uploads/{id}/complete → validation and scanning result. */
export const FileView = z.object({
  id: z.string().uuid(),
  purpose: UploadPurpose,
  status: z.enum(["pending", "clean", "rejected"]),
  rejectionReason: z.string().nullable(),
  url: z.string().nullable(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Videos: length after processing, and a still frame. */
  durationSeconds: z.number().nullable(),
  posterUrl: z.string().nullable(),
});
export type FileView = z.infer<typeof FileView>;
