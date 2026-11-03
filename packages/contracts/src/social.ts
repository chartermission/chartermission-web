import { z } from "zod";
import { ChapterRef, MemberRef } from "./common.js";

/*
 * Feed, posts, comments, reactions, bookmarks, polls, hashtags, trending and uploads
 * (spec 4.5 FED, Figma feed / post detail / create-post / topic screens).
 */

export const POST_MAX_CHARS = 3000;
export const COMMENT_MAX_CHARS = 1500;

export const ReactionKind = z.enum(["like", "insightful", "support"]);
export type ReactionKind = z.infer<typeof ReactionKind>;

export const PostKind = z.enum(["standard", "announcement"]);
export type PostKind = z.infer<typeof PostKind>;

export const ModerationState = z.enum(["visible", "hidden", "removed"]);
export type ModerationState = z.infer<typeof ModerationState>;

export const AttachmentView = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "document"]),
  url: z.string(),
  name: z.string().nullable(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
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

export const LinkPreview = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const ReactionCounts = z.object({ like: z.number().int(), insightful: z.number().int(), support: z.number().int() });

export type PostView = {
  id: string;
  author: MemberRef;
  body: string;
  kind: PostKind;
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
  status: "published" | "pending_media";
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
  };
  /** Present only for the author or moderators when the post is not visible to others. */
  moderationState?: ModerationState;
};

export const PostView: z.ZodType<PostView> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    author: MemberRef,
    body: z.string(),
    kind: PostKind,
    pinned: z.boolean(),
    chapter: ChapterRef.nullable(),
    hashtags: z.array(z.string()),
    mentions: z.array(MemberRef),
    attachments: z.array(AttachmentView),
    poll: PollView.nullable(),
    linkPreview: LinkPreview.nullable(),
    repostOf: PostView.nullable(),
    isRepost: z.boolean(),
    status: z.enum(["published", "pending_media"]),
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
    }),
    moderationState: ModerationState.optional(),
  }),
);

/** POST /posts — up to 4 images or 1 document (CM-FED-01). */
export const CreatePostInput = z
  .object({
    body: z.string().trim().max(POST_MAX_CHARS, `Posts can be up to ${POST_MAX_CHARS} characters`),
    attachmentIds: z.array(z.string().uuid()).max(4).default([]),
    poll: z
      .object({
        question: z.string().trim().min(1).max(200),
        options: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
        durationHours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(72),
      })
      .optional(),
    linkUrl: z.string().url().max(500).optional(),
    repostOfId: z.string().uuid().optional(),
    chapterId: z.string().uuid().optional(),
    visibility: z.enum(["members", "public"]).default("members"),
    /** Only for accounts with post.announce. */
    kind: PostKind.default("standard"),
  })
  .refine((v) => v.body.length > 0 || v.repostOfId || v.attachmentIds.length > 0, {
    message: "Write something or attach a file",
    path: ["body"],
  });
export type CreatePostInput = z.infer<typeof CreatePostInput>;

/** PATCH /posts/{id} — author edit, marked "edited" (CM-FED-06). */
export const UpdatePostInput = z.object({ body: z.string().trim().min(1).max(POST_MAX_CHARS) });
export type UpdatePostInput = z.infer<typeof UpdatePostInput>;

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
  /** Query-string boolean: "true"/"1" or "false"/"0" (z.coerce.boolean would read "false" as true). */
  announcements: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

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

/** PUT /bookmarks and DELETE /bookmarks. Phase 1 covers posts; other types arrive with their modules. */
export const BookmarkInput = z.object({ targetType: z.enum(["post"]), targetId: z.string().uuid() });
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

export const UploadPurpose = z.enum(["avatar", "post_image", "post_document"]);
export type UploadPurpose = z.infer<typeof UploadPurpose>;

export const UPLOAD_LIMITS = {
  avatar: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  post_image: { maxBytes: 5 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  post_document: { maxBytes: 10 * 1024 * 1024, mimes: ["application/pdf"] },
} as const;

/** POST /uploads → a short-lived URL to PUT the bytes to. */
export const CreateUploadInput = z.object({
  purpose: UploadPurpose,
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().max(100),
  sizeBytes: z.number().int().positive(),
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
});
export type FileView = z.infer<typeof FileView>;
