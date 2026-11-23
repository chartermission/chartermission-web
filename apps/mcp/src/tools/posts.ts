import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ARTICLE_MAX_CHARS,
  ARTICLE_MIN_CHARS,
  COMMENT_MAX_CHARS,
  POST_MAX_CHARS,
  SCHEDULE_MAX_DAYS,
  SCHEDULE_MIN_MINUTES,
  type ChapterDetail,
  type CommentView,
  type DraftView,
  type Ok,
  type Page,
  type PageDetail,
  type PostView,
  type ReactionState,
} from '@chartermission/contracts';
import { comment, draft, json, LIST_BODY_MAX, post } from '../format.js';
import { cursor, DELETE, IDEMPOTENT_WRITE, isUuid, limitNote, OVERWRITE, pathSegment, READ, uuid, uuidString, WRITE, type ToolContext } from './shared.js';

/* ---------------------------- Composition (posts, drafts, scheduled posts) ---------------------------- */

const BODY_HELP = `The post text, written in the member's voice. Up to ${POST_MAX_CHARS} characters (articles up to ${ARTICLE_MAX_CHARS}, at least ${ARTICLE_MIN_CHARS}). #hashtags and @handles in the text are linked automatically.`;
const requiredBody = z.string().min(1).max(ARTICLE_MAX_CHARS).describe(BODY_HELP);

const compositionShape = {
  body: requiredBody,
  type: z
    .enum(['standard', 'question', 'article'])
    .optional()
    .describe('standard (default); question: asks the community, comments become answers (at least 10 characters); article: long-form, needs article_title.'),
  visibility: z
    .enum(['public', 'members'])
    .optional()
    .describe('public (default): anyone, including signed-out visitors; members: signed-in members only.'),
  chapter: z
    .string()
    .max(120)
    .optional()
    .describe('Post in a chapter: its slug (from list_chapters) or id. Some chapters review posts before they appear.'),
  page: z.string().max(120).optional().describe('Publish as a page the member manages: its slug or id (from my_pages).'),
  link_url: z.string().url().max(500).optional().describe('A link to show as a preview card under the post.'),
  article_title: z.string().min(5).max(150).optional().describe('Articles only: the title (5–150 characters).'),
  article_subtitle: z.string().max(200).optional().describe('Articles only: an optional subtitle.'),
  poll: z
    .object({
      question: z.string().min(1).max(200),
      options: z.array(z.string().min(1).max(80)).min(2).max(4),
      duration_hours: z.union([z.literal(24), z.literal(72), z.literal(168)]).optional().describe('24, 72 (default) or 168.'),
    })
    .optional()
    .describe('Standard posts only: a poll with 2–4 options.'),
};

type CompositionArgs = {
  body?: string;
  type?: 'standard' | 'question' | 'article';
  visibility?: 'public' | 'members';
  chapter?: string;
  page?: string;
  link_url?: string;
  article_title?: string;
  article_subtitle?: string;
  poll?: { question: string; options: string[]; duration_hours?: 24 | 72 | 168 };
};

/** The API wants ids; members and Claude know chapters and pages by slug. */
async function chapterId(ctx: ToolContext, value: string): Promise<string> {
  const v = value.trim();
  if (isUuid(v)) return v;
  const chapter = await ctx.api.get<ChapterDetail>(`chapters/${pathSegment(v.toLowerCase(), 'slug')}`);
  return chapter.id;
}

async function pageId(ctx: ToolContext, value: string): Promise<string> {
  const v = value.trim();
  if (isUuid(v)) return v;
  const page = await ctx.api.get<PageDetail>(`pages/${pathSegment(v, 'slug')}`);
  return page.id;
}

/** Tool arguments → PostComposition (POST /posts) or DraftPayload (drafts). */
async function composition(ctx: ToolContext, a: CompositionArgs) {
  const article = a.article_title || a.article_subtitle ? { title: a.article_title ?? '', subtitle: a.article_subtitle } : undefined;
  return {
    type: a.type ?? (article ? 'article' : 'standard'),
    body: a.body ?? '',
    visibility: a.visibility ?? 'public',
    ...(a.chapter ? { chapterId: await chapterId(ctx, a.chapter) } : {}),
    ...(a.page ? { pageId: await pageId(ctx, a.page) } : {}),
    ...(a.link_url ? { linkUrl: a.link_url } : {}),
    ...(article ? { article } : {}),
    ...(a.poll ? { poll: { question: a.poll.question, options: a.poll.options, durationHours: a.poll.duration_hours ?? 72 } } : {}),
  };
}

function publishedNote(p: PostView): string | undefined {
  if (p.status === 'awaiting_approval' || p.contentReview?.state === 'pending') {
    return 'Saved, but waiting for the Charter Mission team\'s approval: others will see it once they approve it. Tell the member.';
  }
  if (p.chapterReview?.state === 'pending' || p.status === 'in_review') return 'Published, but waiting for review before others can see it.';
  if (p.status === 'pending_media') return 'Published; attachments are still processing.';
  return undefined;
}

/** What to tell the member about a scheduled post the Charter Mission team reviews first, or paused. */
function scheduledNote(d: DraftView): string | undefined {
  if (d.status === 'held') return 'Paused by the Charter Mission team: it won\'t be published until they release it. Tell the member.';
  if (d.review?.state === 'pending') {
    return 'Scheduled, but waiting for the Charter Mission team\'s approval: it will only be published once they approve it. Tell the member.';
  }
  return undefined;
}

const CONFIRM =
  ' Before calling, show the member the exact text (and type, chapter, page, visibility) and get their go-ahead, unless they already asked for exactly this content to be published.';

export function registerPostTools(server: McpServer, ctx: ToolContext) {
  const { api, links } = ctx;

  server.registerTool(
    'read_feed',
    {
      title: 'Read feed',
      description:
        "Read the member's Charter Mission feed, newest pages first. Use it to see what people are posting, find posts to react or reply to, or summarise activity. Bodies are shortened; use get_post for a full post.",
      inputSchema: {
        tab: z.enum(['for_you', 'following', 'latest']).optional().describe('for_you (default, ranked), following (people, pages, chapters and topics they follow) or latest (everything, newest first).'),
        chapter: z.string().max(120).optional().describe('Only posts in this chapter (slug or id).'),
        type: z.enum(['standard', 'question', 'celebration', 'request', 'article']).optional().describe('Only one kind of post.'),
        limit: z.number().int().min(1).max(20).optional().describe('Posts per page, 1–20 (default 10).'),
        cursor,
      },
      annotations: { title: 'Read feed', ...READ },
    },
    async (a) => {
      const page = await api.get<Page<PostView>>('feed', { tab: a.tab ?? 'for_you', chapter: a.chapter, type: a.type, limit: a.limit ?? 10, cursor: a.cursor });
      return json({ posts: page.items.map((p) => post(p, links, LIST_BODY_MAX)), nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'get_post',
    {
      title: 'Get post',
      description: 'Read one post by id: text, author, counts and the member\'s own reaction. Set full_body for the whole text of a long post or article (needed before editing one).',
      inputSchema: {
        post_id: uuid('post'),
        full_body: z.boolean().optional().describe('Return the whole body instead of the first 1500 characters.'),
      },
      annotations: { title: 'Get post', ...READ },
    },
    async (a) => {
      const p = await api.get<PostView>(`posts/${a.post_id}`);
      return json(post(p, links, a.full_body ? Number.MAX_SAFE_INTEGER : undefined));
    },
  );

  server.registerTool(
    'list_comments',
    {
      title: 'List comments',
      description: 'Read the comments on a post (each with its first replies), or all replies to one comment when parent_comment_id is set.',
      inputSchema: {
        post_id: uuid('post'),
        sort: z.enum(['relevant', 'newest']).optional().describe('relevant (default) or newest.'),
        parent_comment_id: uuidString().optional().describe('List the replies to this comment instead of the top-level comments.'),
        cursor,
      },
      annotations: { title: 'List comments', ...READ },
    },
    async (a) => {
      const page = a.parent_comment_id
        ? await api.get<Page<CommentView>>(`comments/${a.parent_comment_id}/replies`, { cursor: a.cursor, limit: 20 })
        : await api.get<Page<CommentView>>(`posts/${a.post_id}/comments`, { sort: a.sort ?? 'relevant', cursor: a.cursor, limit: 20 });
      return json({ comments: page.items.map(comment), nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'create_post',
    {
      title: 'Publish post',
      description:
        "Publish a post on Charter Mission as the member (or as a page they manage). Write in the member's own voice; no generic or spammy content." +
        CONFIRM +
        limitNote('post.create'),
      inputSchema: compositionShape,
      annotations: { title: 'Publish post', ...WRITE },
    },
    async (a) => {
      const p = await api.post<PostView>('posts', await composition(ctx, a));
      return json({ published: post(p, links), note: publishedNote(p) });
    },
  );

  server.registerTool(
    'schedule_post',
    {
      title: 'Schedule post',
      description:
        `Schedule a post to publish automatically at publish_at (${SCHEDULE_MIN_MINUTES} minutes to ${SCHEDULE_MAX_DAYS} days ahead). Same fields as create_post. It is kept as a scheduled draft until then (list_drafts with status scheduled).` +
        CONFIRM +
        limitNote('post.schedule'),
      inputSchema: {
        ...compositionShape,
        publish_at: z
          .string()
          .datetime({ offset: true })
          .describe('When to publish, ISO 8601 with a time zone offset, e.g. 2026-12-01T09:00:00+04:00. Ask the member for their time zone if unsure.'),
      },
      annotations: { title: 'Schedule post', ...WRITE },
    },
    async (a) => {
      const { publish_at, ...rest } = a;
      const d = await api.post<DraftView>('me/drafts', { payload: await composition(ctx, rest), scheduledFor: publish_at });
      return json({ scheduled: draft(d), note: scheduledNote(d) });
    },
  );

  server.registerTool(
    'save_draft',
    {
      title: 'Save draft',
      description:
        'Save a post as a draft the member can finish and publish later in the app (or with publish_draft). Pass draft_id to replace an existing draft\'s content. Drafts are private to the member.' +
        limitNote('draft.save'),
      inputSchema: {
        ...compositionShape,
        body: z.string().max(ARTICLE_MAX_CHARS).optional().describe(`${BODY_HELP} May be left empty in a draft.`),
        draft_id: uuidString().optional().describe('Update this draft instead of creating a new one (its content is replaced).'),
      },
      annotations: { title: 'Save draft', ...WRITE },
    },
    async (a) => {
      const { draft_id, ...rest } = a;
      const payload = await composition(ctx, rest);
      const d = draft_id ? await api.patch<DraftView>(`me/drafts/${draft_id}`, { payload }) : await api.post<DraftView>('me/drafts', { payload });
      return json({ saved: draft(d), note: scheduledNote(d) });
    },
  );

  server.registerTool(
    'list_drafts',
    {
      title: 'List drafts',
      description: "List the member's drafts, or their scheduled posts.",
      inputSchema: {
        status: z.enum(['draft', 'scheduled']).optional().describe('draft (default) or scheduled.'),
        cursor,
      },
      annotations: { title: 'List drafts', ...READ },
    },
    async (a) => {
      const page = await api.get<Page<DraftView>>('me/drafts', { status: a.status ?? 'draft', cursor: a.cursor, limit: 20 });
      return json({ drafts: page.items.map(draft), nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'publish_draft',
    {
      title: 'Publish draft',
      description:
        'Publish one of the member\'s drafts (or a scheduled post) now. Show the member the draft\'s content and get their go-ahead first, unless they asked to publish exactly this draft.' +
        limitNote('draft.publish'),
      inputSchema: { draft_id: uuid('draft') },
      annotations: { title: 'Publish draft', ...WRITE },
    },
    async (a) => {
      const p = await api.post<PostView>(`me/drafts/${a.draft_id}/publish`);
      return json({ published: post(p, links), note: publishedNote(p) });
    },
  );

  server.registerTool(
    'edit_post',
    {
      title: 'Edit post',
      description:
        "Replace the text of one of the member's own posts (it shows as edited). The new body replaces the old one entirely, so read the full post first (get_post with full_body) and keep what should stay. Confirm the new text with the member unless they dictated it.",
      inputSchema: {
        post_id: uuid('post'),
        body: z.string().min(1).max(ARTICLE_MAX_CHARS).describe('The complete new text.'),
      },
      annotations: { title: 'Edit post', ...OVERWRITE },
    },
    async (a) => {
      const p = await api.patch<PostView>(`posts/${a.post_id}`, { body: a.body });
      return json({ updated: post(p, links) });
    },
  );

  server.registerTool(
    'delete_post',
    {
      title: 'Delete post',
      description: "Delete one of the member's own posts. This cannot be undone: name the post (its start and date) and get the member's explicit confirmation first.",
      inputSchema: { post_id: uuid('post') },
      annotations: { title: 'Delete post', ...DELETE },
    },
    async (a) => {
      await api.delete<Ok>(`posts/${a.post_id}`);
      return json({ deleted: true, postId: a.post_id });
    },
  );

  /* ---------------------------- Reactions and comments ---------------------------- */

  const reactionTarget = {
    target_type: z.enum(['post', 'comment']).describe('What to react to.'),
    target_id: uuidString().describe('The post or comment id.'),
  };

  server.registerTool(
    'react',
    {
      title: 'React',
      description:
        "React to a post or comment as the member (replaces their previous reaction on it). Only react where the member would genuinely mean it; never mass-react." +
        limitNote('reaction.set'),
      inputSchema: {
        ...reactionTarget,
        kind: z.enum(['like', 'insightful', 'support']).optional().describe('like (default), insightful or support.'),
      },
      annotations: { title: 'React', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const state = await api.put<ReactionState>('reactions', { targetType: a.target_type, targetId: a.target_id, kind: a.kind ?? 'like' });
      return json({ targetType: state.targetType, targetId: state.targetId, yourReaction: state.reaction, reactions: state.reactions });
    },
  );

  server.registerTool(
    'remove_reaction',
    {
      title: 'Remove reaction',
      description: "Remove the member's reaction from a post or comment.",
      inputSchema: reactionTarget,
      annotations: { title: 'Remove reaction', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const state = await api.delete<ReactionState>('reactions', { targetType: a.target_type, targetId: a.target_id });
      return json({ targetType: state.targetType, targetId: state.targetId, yourReaction: state.reaction, reactions: state.reactions });
    },
  );

  server.registerTool(
    'comment',
    {
      title: 'Comment',
      description:
        `Comment on a post as the member, or reply to a comment (reply_to_comment_id). Up to ${COMMENT_MAX_CHARS} characters, specific to the post, in the member's voice; never generic praise ("Great post!"). Show the member the comment first unless they gave you the exact words.` +
        limitNote('comment.create'),
      inputSchema: {
        post_id: uuid('post'),
        body: z.string().min(1).max(COMMENT_MAX_CHARS).describe('The comment text.'),
        reply_to_comment_id: uuidString().optional().describe('Reply to this comment (replies are one level deep; replying to a reply joins the same thread).'),
      },
      annotations: { title: 'Comment', ...WRITE },
    },
    async (a) => {
      const c = await api.post<CommentView>(`posts/${a.post_id}/comments`, { body: a.body, ...(a.reply_to_comment_id ? { parentId: a.reply_to_comment_id } : {}) });
      return json({ commented: comment(c), url: links.post(a.post_id) });
    },
  );

  server.registerTool(
    'edit_comment',
    {
      title: 'Edit comment',
      description: "Replace the text of one of the member's own comments. Confirm the new text with the member unless they dictated it.",
      inputSchema: {
        comment_id: uuid('comment'),
        body: z.string().min(1).max(COMMENT_MAX_CHARS).describe('The complete new text.'),
      },
      annotations: { title: 'Edit comment', ...OVERWRITE },
    },
    async (a) => {
      const c = await api.patch<CommentView>(`comments/${a.comment_id}`, { body: a.body });
      return json({ updated: comment(c) });
    },
  );

  server.registerTool(
    'delete_comment',
    {
      title: 'Delete comment',
      description: "Delete one of the member's own comments (or a comment on their own post). Cannot be undone: quote it and get the member's explicit confirmation first.",
      inputSchema: { comment_id: uuid('comment') },
      annotations: { title: 'Delete comment', ...DELETE },
    },
    async (a) => {
      await api.delete<Ok>(`comments/${a.comment_id}`);
      return json({ deleted: true, commentId: a.comment_id });
    },
  );
}
