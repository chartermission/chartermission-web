import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnalyticsDay,
  ChapterDetail,
  ChapterSummary,
  CreatorAnalytics,
  GroupDetail,
  GroupSummary,
  ManagedPage,
  NotificationView,
  Page,
  PostAnalytics,
  PostView,
  TopicView,
  TrendingResponse,
  UnreadCount,
} from '@chartermission/contracts';
import { chapterSummary, clip, group, json, LIST_BODY_MAX, notification, post } from '../format.js';
import { cursor, IDEMPOTENT_WRITE, pathSegment, READ, stripPrefix, uuid, uuidString, type ToolContext } from './shared.js';

const days = z
  .union([z.literal(7), z.literal(28), z.literal(90)])
  .optional()
  .describe('Period in days: 7, 28 (default) or 90.');

/** One row per day as [day, impressions, viewers, engagements]: a quarter of the size of the objects. */
const dailyRows = (rows: AnalyticsDay[]) => rows.map((d) => [d.day, d.impressions, d.viewers, d.engagements]);

export function registerExploreTools(server: McpServer, ctx: ToolContext) {
  const { api, links } = ctx;

  /* ---------------------------- Notifications and analytics ---------------------------- */

  server.registerTool(
    'list_notifications',
    {
      title: 'List notifications',
      description: "The member's notifications, newest first (reactions, comments, mentions, connection requests, follows…), with the unread count.",
      inputSchema: {
        filter: z
          .enum(['all', 'unread', 'my_posts', 'mentions', 'messages', 'network'])
          .optional()
          .describe('all (default), unread, my_posts (activity and milestones on their posts), mentions, messages or network (follows, connections, profile views).'),
        cursor,
      },
      annotations: { title: 'List notifications', ...READ },
    },
    async (a) => {
      const [page, unread] = await Promise.all([
        api.get<Page<NotificationView>>('notifications', { filter: a.filter ?? 'all', cursor: a.cursor, limit: 20 }),
        api.get<UnreadCount>('notifications/unread-count'),
      ]);
      return json({ unread: unread.unread, notifications: page.items.map((n) => notification(n, links)), nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'mark_notifications_read',
    {
      title: 'Mark notifications read',
      description: 'Mark notifications as read: the ones listed in ids, or all of them when ids is left out.',
      inputSchema: {
        ids: z.array(uuidString()).min(1).max(100).optional().describe('Notification ids; leave out to mark everything read.'),
      },
      annotations: { title: 'Mark notifications read', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const result = await api.post<UnreadCount>('notifications/read', a.ids?.length ? { ids: a.ids } : { all: true });
      return json({ unread: result.unread });
    },
  );

  server.registerTool(
    'post_analytics',
    {
      title: 'Post analytics',
      description:
        "Numbers for one of the member's own posts (or a post of a page they manage): impressions, reach, reactions, comments, reposts, saves, engagement rate, audience and countries. daily rows are [day, impressions, viewers, engagements].",
      inputSchema: { post_id: uuid('post'), days },
      annotations: { title: 'Post analytics', ...READ },
    },
    async (a) => {
      const r = await api.get<PostAnalytics>(`posts/${a.post_id}/analytics`, { days: a.days ?? 28 });
      return json({
        post: { id: r.post.id, url: links.post(r.post.id), type: r.post.type, title: r.post.title, excerpt: clip(r.post.excerpt, 200).text, createdAt: r.post.createdAt },
        totals: r.totals,
        reactions: r.reactions,
        audience: r.audience,
        trackedSince: r.trackedSince,
        daily: dailyRows(r.daily),
      });
    },
  );

  server.registerTool(
    'my_analytics',
    {
      title: 'My analytics',
      description:
        "How the member's posts (or one of their pages' posts) performed over a period: posts, impressions, engagements, engagement rate, followers and new followers, compared with the period before, and the top posts. daily rows are [day, impressions, viewers, engagements].",
      inputSchema: {
        days,
        page: z.string().max(80).optional().describe('A page the member manages (slug or id) instead of their own posts.'),
      },
      annotations: { title: 'My analytics', ...READ },
    },
    async (a) => {
      const r = await api.get<CreatorAnalytics>('me/analytics', { days: a.days ?? 28, page: a.page });
      return json({
        days: r.days,
        page: r.page ? { name: r.page.name, slug: r.page.slug } : undefined,
        totals: r.totals,
        previousPeriod: r.previous,
        topPosts: r.topPosts.map((p) => ({ ...p, excerpt: clip(p.excerpt, 160).text, url: links.post(p.id) })),
        daily: dailyRows(r.daily),
      });
    },
  );

  /* ---------------------------- Chapters, topics, pages ---------------------------- */

  server.registerTool(
    'list_chapters',
    {
      title: 'List chapters',
      description: 'Charter Mission\'s country chapters (slug, country, region, followers, whether the member has joined). Use a slug with get_chapter, create_post (chapter) or follow.',
      inputSchema: {
        search: z.string().max(60).optional().describe('Only chapters whose name, country or region contains this text.'),
      },
      annotations: { title: 'List chapters', ...READ },
    },
    async (a) => {
      const all = await api.get<ChapterSummary[]>('chapters');
      const q = a.search?.trim().toLowerCase();
      const items = q ? all.filter((c) => [c.name, c.countryName, c.region, c.slug].some((v) => v.toLowerCase().includes(q))) : all;
      return json({ chapters: items.map((c) => chapterSummary(c, links)) });
    },
  );

  server.registerTool(
    'get_chapter',
    {
      title: 'Get chapter',
      description: 'One chapter: about, hashtag, team, counts, pinned posts, whether the member has joined and whether posts there need the team\'s approval.',
      inputSchema: { slug: z.string().min(1).max(120).describe('The chapter slug (from list_chapters) or id.') },
      annotations: { title: 'Get chapter', ...READ },
    },
    async (a) => {
      const c = await api.get<ChapterDetail>(`chapters/${pathSegment(a.slug.toLowerCase(), 'slug')}`);
      return json({
        ...chapterSummary(c, links),
        about: c.about ? clip(c.about, 800).text : undefined,
        hashtag: c.hashtag,
        counts: c.counts,
        postsNeedApproval: c.postApproval === 'review' || undefined,
        ...(c.viewer.banned ? { banned: true } : {}),
        team: c.team.map((t) => ({ name: t.member.name, handle: t.member.handle, role: t.label })),
        pinned: c.pinned.map((p) => post(p, links, 300)),
      });
    },
  );

  server.registerTool(
    'topic_posts',
    {
      title: 'Topic posts',
      description: 'Posts with a hashtag (topic), plus the topic\'s follower count and whether the member follows it.',
      inputSchema: {
        tag: z.string().min(1).max(51).describe('The hashtag, with or without #.'),
        sort: z.enum(['top', 'latest', 'media']).optional().describe('top (default), latest or media.'),
        limit: z.number().int().min(1).max(20).optional().describe('Posts per page, 1–20 (default 10).'),
        cursor,
      },
      annotations: { title: 'Topic posts', ...READ },
    },
    async (a) => {
      const tag = pathSegment(stripPrefix(a.tag, '#'), 'tag');
      const [topic, page] = await Promise.all([
        api.get<TopicView>(`topics/${tag}`),
        api.get<Page<PostView>>(`topics/${tag}/posts`, { sort: a.sort ?? 'top', limit: a.limit ?? 10, cursor: a.cursor }),
      ]);
      return json({
        topic: { tag: topic.tag, url: links.topic(topic.tag), description: topic.description, posts: topic.posts, followers: topic.followers, following: topic.following },
        posts: page.items.map((p) => post(p, links, LIST_BODY_MAX)),
        nextCursor: page.nextCursor,
      });
    },
  );

  server.registerTool(
    'trending',
    {
      title: 'Trending topics',
      description: 'Trending hashtags on Charter Mission across Africa, or in one country or chapter.',
      inputSchema: {
        window: z.enum(['24h', '7d']).optional().describe('24h (default) or 7d.'),
        country: z.string().length(2).optional().describe('Trending in this country (ISO code) instead of across Africa.'),
        chapter: z.string().max(120).optional().describe('Trending in this chapter (slug or id).'),
        limit: z.number().int().min(1).max(20).optional().describe('How many, 1–20 (default 10).'),
      },
      annotations: { title: 'Trending topics', ...READ },
    },
    async (a) => {
      const scope = a.chapter ? 'chapter' : a.country ? 'country' : 'global';
      const r = await api.get<TrendingResponse>('trending', {
        scope,
        scopeId: a.chapter ?? a.country,
        window: a.window ?? '24h',
        limit: a.limit ?? 10,
      });
      return json({
        window: r.window,
        computedAt: r.computedAt,
        items: r.items.map((t) => ({ rank: t.rank, tag: t.tag, context: t.context, posts: t.posts, authors: t.authors, velocityPct: t.velocityPct, url: links.topic(t.tag) })),
      });
    },
  );

  server.registerTool(
    'my_pages',
    {
      title: 'My pages',
      description: 'Pages (organisation accounts) the member owns or helps manage. Use a slug with create_post (page) to publish as the page, or with my_analytics.',
      inputSchema: {},
      annotations: { title: 'My pages', ...READ },
    },
    async () => {
      const pages = await api.get<ManagedPage[]>('me/pages');
      return json({
        pages: pages.map((p) => ({ id: p.id, slug: p.slug, name: p.name, role: p.role, status: p.status, followers: p.followers, url: links.page(p.slug) })),
      });
    },
  );

  /* ---------------------------- Groups ---------------------------- */

  server.registerTool(
    'list_my_groups',
    {
      title: 'My groups',
      description:
        'Groups the member is in (or runs through a page or chapter), with their role. Use a slug with get_group to see whether they can post there, and with create_post or schedule_post (group) to post in it.',
      inputSchema: { cursor },
      annotations: { title: 'My groups', ...READ },
    },
    async (a) => {
      const page = await api.get<Page<GroupSummary>>('groups', { scope: 'mine', limit: 50, cursor: a.cursor });
      return json({ groups: page.items.map((g) => group(g, links)), nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'get_group',
    {
      title: 'Get group',
      description:
        "One group by slug: what it is about, whether it is public or private, the member's role and whether they can post there (some groups approve posts first, some let only admins post).",
      inputSchema: { slug: z.string().min(1).max(120).describe('The group\'s slug (from list_my_groups) or id.') },
      annotations: { title: 'Get group', ...READ },
    },
    async (a) => {
      const g = await api.get<GroupDetail>(`groups/${pathSegment(a.slug.trim().toLowerCase(), 'slug')}`);
      return json(group(g, links));
    },
  );
}
