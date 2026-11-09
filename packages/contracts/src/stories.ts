import { z } from "zod";
import { MemberRef } from "./common.js";
import { ModerationState } from "./social.js";

/*
 * Stories and highlights (feed strip, story viewer, profile highlights).
 *
 *  GET    /stories/tray                    StoryTray: the viewer's own stories and those of the people they are
 *                                          connected to or follow (and Ambassadors of chapters they follow).
 *  POST   /stories                         CreateStoryInput → StoryView. The file (story_image or story_video)
 *                                          must have finished processing.
 *  GET    /stories/archive                 StoryView[]: the viewer's stories from the last 30 days (for highlights).
 *  GET    /stories/:id                     StoryView (live stories for their audience; highlighted ones for members).
 *  POST   /stories/:id/view                204. Counted once per viewer.
 *  GET    /stories/:id/viewers             StoryViewer[] (author only).
 *  DELETE /stories/:id                     204 (author). Also removes it from highlights.
 *  GET    /highlights?member=<handle|id>   HighlightView[] for a profile.
 *  POST   /highlights                      CreateHighlightInput → HighlightView.
 *  PATCH  /highlights/:id                  UpdateHighlightInput → HighlightView (rename, reorder or replace stories).
 *  POST   /highlights/:id/stories          AddToHighlightInput → HighlightView.
 *  DELETE /highlights/:id/stories/:storyId → HighlightView.
 *  DELETE /highlights/:id                  204.
 *
 * Stories disappear from the strip after 24 hours. The author keeps them in their archive for 30 days;
 * stories saved to a highlight stay until they are removed from every highlight.
 */

export const STORY_TTL_HOURS = 24;
export const STORY_ARCHIVE_DAYS = 30;
/** How long a photo story shows before moving on. */
export const STORY_IMAGE_SECONDS = 6;
export const STORY_CAPTION_MAX_CHARS = 200;
export const HIGHLIGHT_TITLE_MAX_CHARS = 30;
export const HIGHLIGHTS_MAX = 20;
export const HIGHLIGHT_STORIES_MAX = 50;
/** Stories a member can post in 24 hours. */
export const STORIES_PER_DAY = 30;

export const CreateStoryInput = z.object({
  fileId: z.string().uuid(),
  caption: z
    .string()
    .trim()
    .max(STORY_CAPTION_MAX_CHARS, `Captions can be up to ${STORY_CAPTION_MAX_CHARS} characters`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateStoryInput = z.input<typeof CreateStoryInput>;

export const StoryMedia = z.object({
  kind: z.enum(["image", "video"]),
  url: z.string(),
  /** Videos: a still frame shown while loading. Images: null. */
  posterUrl: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
});
export type StoryMedia = z.infer<typeof StoryMedia>;

export const StoryView = z.object({
  id: z.string().uuid(),
  author: MemberRef,
  media: StoryMedia,
  caption: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** Past 24 hours: only reachable through a highlight or the author's archive. */
  expired: z.boolean(),
  viewer: z.object({
    seen: z.boolean(),
    own: z.boolean(),
    canDelete: z.boolean(),
    canReport: z.boolean(),
  }),
  /** Author only: how many people viewed it, and the highlights it is in. */
  viewCount: z.number().int().nullable(),
  highlightIds: z.array(z.string().uuid()).nullable(),
  /** Present for the author or moderators when the story is hidden or removed. */
  moderationState: ModerationState.optional(),
});
export type StoryView = z.infer<typeof StoryView>;

export const StoryTrayItem = z.object({
  author: MemberRef,
  stories: z.array(StoryView),
  hasUnseen: z.boolean(),
  latestAt: z.string(),
});
export type StoryTrayItem = z.infer<typeof StoryTrayItem>;

export const StoryTray = z.object({
  /** The viewer's live stories (null when they have none). */
  mine: StoryTrayItem.nullable(),
  /** Unseen first, then most recent. */
  items: z.array(StoryTrayItem),
});
export type StoryTray = z.infer<typeof StoryTray>;

export const StoryViewer = z.object({ member: MemberRef, viewedAt: z.string() });
export type StoryViewer = z.infer<typeof StoryViewer>;

const HighlightTitle = z
  .string()
  .trim()
  .min(1, "Give the highlight a name")
  .max(HIGHLIGHT_TITLE_MAX_CHARS, `Names can be up to ${HIGHLIGHT_TITLE_MAX_CHARS} characters`);

export const CreateHighlightInput = z.object({
  title: HighlightTitle,
  storyIds: z.array(z.string().uuid()).min(1, "Choose at least one story").max(HIGHLIGHT_STORIES_MAX),
});
export type CreateHighlightInput = z.input<typeof CreateHighlightInput>;

export const UpdateHighlightInput = z.object({
  title: HighlightTitle.optional(),
  /** Replaces the stories and their order. */
  storyIds: z.array(z.string().uuid()).min(1, "A highlight needs at least one story").max(HIGHLIGHT_STORIES_MAX).optional(),
});
export type UpdateHighlightInput = z.input<typeof UpdateHighlightInput>;

export const AddToHighlightInput = z.object({ storyId: z.string().uuid() });
export type AddToHighlightInput = z.input<typeof AddToHighlightInput>;

export const HighlightsQuery = z.object({ member: z.string().trim().min(1).max(80) });
export type HighlightsQuery = z.input<typeof HighlightsQuery>;

export const HighlightView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  /** First story's image or video still. */
  coverUrl: z.string().nullable(),
  stories: z.array(StoryView),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type HighlightView = z.infer<typeof HighlightView>;
