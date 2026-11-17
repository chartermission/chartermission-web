import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ConnectionView,
  ConnectionsPage,
  DirectoryPage,
  MemberProfile,
  Ok,
  SessionUser,
  SuggestedMember,
} from '@chartermission/contracts';
import { clip, connection, json, memberRef, relationship } from '../format.js';
import { cursor, IDEMPOTENT_WRITE, isUuid, limitNote, pathSegment, READ, stripPrefix, uuid, WRITE, type ToolContext } from './shared.js';

const followTarget = {
  target_type: z.enum(['member', 'hashtag', 'chapter', 'page']).describe('What to follow: a member, a hashtag (topic), a chapter or a page.'),
  target: z
    .string()
    .min(1)
    .max(80)
    .describe('member: handle (with or without @) or id; hashtag: the tag (with or without #); chapter: slug or id; page: slug or id.'),
};

/** The API resolves handles, slugs and ids itself (FollowsService.resolve); only the typed prefixes go. */
function followInput(a: { target_type: 'member' | 'hashtag' | 'chapter' | 'page'; target: string }) {
  const targetId =
    a.target_type === 'member' ? stripPrefix(a.target, '@') : a.target_type === 'hashtag' ? stripPrefix(a.target, '#') : a.target.trim();
  return { targetType: a.target_type, targetId };
}

export function registerPeopleTools(server: McpServer, ctx: ToolContext) {
  const { api, links } = ctx;

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The Charter Mission member Claude is acting for: name, handle, profile link and any posting or connecting restrictions. Call this first if unsure whose account this is.',
      inputSchema: {},
      annotations: { title: 'Who am I', ...READ },
    },
    async () => {
      const me = await api.get<SessionUser>('me');
      return json({
        id: me.id,
        handle: me.handle,
        name: me.name,
        headline: me.headline,
        url: links.member(me.handle),
        country: me.countryCode,
        ...(me.emailVerified ? {} : { emailVerified: false, note: 'The member must verify their email before posting, commenting or connecting.' }),
        ...(me.status !== 'active' ? { status: me.status } : {}),
        postingRestrictedUntil: me.restrictions.postingUntil,
        connectingRestrictedUntil: me.restrictions.connectingUntil,
      });
    },
  );

  server.registerTool(
    'search_members',
    {
      title: 'Search members',
      description: 'Search the member directory by name, headline, organisation or skill, optionally within a country or chapter. Shows each member\'s relationship to the signed-in member.',
      inputSchema: {
        query: z.string().max(100).optional().describe('Words to search for.'),
        country: z.string().length(2).optional().describe('ISO country code, e.g. NG, KE, AE.'),
        chapter: z.string().max(120).optional().describe('Only members of this chapter (slug).'),
        limit: z.number().int().min(1).max(24).optional().describe('Results per page, 1–24 (default 10).'),
        cursor,
      },
      annotations: { title: 'Search members', ...READ },
    },
    async (a) => {
      const page = await api.get<DirectoryPage>('members', {
        q: a.query,
        country: a.country?.toUpperCase(),
        chapter: a.chapter,
        limit: a.limit ?? 10,
        cursor: a.cursor,
      });
      return json({
        members: page.items.map((m) => ({
          ...memberRef(m),
          location: m.location,
          mutualConnections: m.mutualConnections || undefined,
          relationship: relationship(m.relationship),
          url: links.member(m.handle),
        })),
        nextCursor: page.nextCursor,
      });
    },
  );

  server.registerTool(
    'get_member',
    {
      title: 'Get member',
      description: "A member's profile (what the signed-in member is allowed to see): headline, bio, organisation, skills, chapters, counts and how they are related.",
      inputSchema: { handle: z.string().min(1).max(60).describe('Their handle (with or without @) or member id.') },
      annotations: { title: 'Get member', ...READ },
    },
    async (a) => {
      const m = await api.get<MemberProfile>(`members/${pathSegment(stripPrefix(a.handle, '@'), 'handle')}`);
      return json({
        ...memberRef(m),
        url: links.member(m.handle),
        relationship: relationship(m.relationship),
        connectionRequestId: m.relationship.connection.startsWith('pending') ? m.relationship.connectionId : undefined,
        country: m.country?.name,
        city: m.city,
        organisation: m.organisation,
        bio: m.bio ? clip(m.bio, 800).text : undefined,
        website: m.website,
        skills: m.skills?.map((s) => s.name),
        sectors: m.sectors?.map((s) => s.name),
        experience: m.experience?.slice(0, 3).map((e) => `${e.title}, ${e.organisation}${e.endDate ? '' : ' (current)'}`),
        chapters: m.chapters.map((c) => c.slug),
        badges: m.badges.length ? m.badges.map((b) => b.name) : undefined,
        counts: m.counts,
        joinedAt: m.joinedAt,
      });
    },
  );

  server.registerTool(
    'member_suggestions',
    {
      title: 'Member suggestions',
      description: 'People Charter Mission suggests the member connect with (shared sector, skills, chapter or country), with the reason for each.',
      inputSchema: {},
      annotations: { title: 'Member suggestions', ...READ },
    },
    async () => {
      const items = await api.get<SuggestedMember[]>('members/suggestions');
      return json({
        suggestions: items.map((m) => ({ ...memberRef(m), reason: m.reason, ...(m.canConnect === false ? { followOnly: true } : {}), url: links.member(m.handle) })),
      });
    },
  );

  server.registerTool(
    'send_connection_request',
    {
      title: 'Send connection request',
      description:
        'Send a connection request from the member to another member, with an optional personal note. Only for people the member actually wants to connect with: confirm the person (and the note) with the member first unless they asked for exactly this. Official accounts are follow-only.' +
        limitNote('connection.request'),
      inputSchema: {
        member: z.string().min(1).max(60).describe('Their handle (with or without @) or member id.'),
        note: z.string().max(300).optional().describe('A short personal note (up to 300 characters), in the member\'s voice.'),
      },
      annotations: { title: 'Send connection request', ...WRITE },
    },
    async (a) => {
      const ref = stripPrefix(a.member, '@');
      const memberId = isUuid(ref) ? ref : (await api.get<MemberProfile>(`members/${pathSegment(ref, 'handle')}`)).id;
      const c = await api.post<ConnectionView>('connections', { memberId, ...(a.note?.trim() ? { note: a.note.trim() } : {}) });
      return json({ sent: connection(c, links) });
    },
  );

  server.registerTool(
    'list_connection_requests',
    {
      title: 'List connection requests',
      description: 'Connection requests the member received (incoming) or sent (outgoing) and that are still pending, or their existing connections (connected).',
      inputSchema: {
        direction: z.enum(['incoming', 'outgoing', 'connected']).describe('incoming, outgoing, or connected for existing connections.'),
        cursor,
      },
      annotations: { title: 'List connection requests', ...READ },
    },
    async (a) => {
      const page = await api.get<ConnectionsPage>('me/connections', { filter: a.direction, cursor: a.cursor, limit: 20 });
      return json({ items: page.items.map((c) => connection(c, links)), total: page.total, nextCursor: page.nextCursor });
    },
  );

  server.registerTool(
    'accept_connection_request',
    {
      title: 'Accept connection request',
      description: 'Accept a connection request the member received (requestId from list_connection_requests with direction incoming). Confirm with the member unless they asked to accept this one.',
      inputSchema: { request_id: uuid('connection request') },
      annotations: { title: 'Accept connection request', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const c = await api.post<ConnectionView>(`connections/${a.request_id}/accept`);
      return json({ accepted: connection(c, links) });
    },
  );

  server.registerTool(
    'follow',
    {
      title: 'Follow',
      description:
        'Follow a member, hashtag (topic), chapter (joins it) or page as the member, so their posts appear in the member\'s Following feed.' +
        limitNote('follow'),
      inputSchema: followTarget,
      annotations: { title: 'Follow', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const input = followInput(a);
      await api.post<Ok>('follows', input);
      return json({ following: true, ...input });
    },
  );

  server.registerTool(
    'unfollow',
    {
      title: 'Unfollow',
      description: 'Stop following a member, hashtag, chapter (leaves it) or page.',
      inputSchema: followTarget,
      annotations: { title: 'Unfollow', ...IDEMPOTENT_WRITE },
    },
    async (a) => {
      const input = followInput(a);
      await api.delete<Ok>('follows', input);
      return json({ following: false, ...input });
    },
  );
}
