import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type Request } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth.js';
import { toApiError } from '../src/api-client.js';
import { pathSegment } from '../src/tools/shared.js';
import type { Config } from '../src/env.js';

/*
 * The MCP server against a fake API (a local express app speaking the real API's shapes).
 * Covers discovery metadata, the 401 challenge, the /authorize hand-off, the token proxy,
 * tools/list, a write tool reaching the API with the member's bearer, and error mapping.
 */

const GOOD = 'cmat_good';
const CHAPTER_ID = '6f1c2a5e-8b1d-4c3e-9a2b-1d2e3f4a5b6c';
const POST_ID = '0b9d8c7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';
const GROUP_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

function groupSummary() {
  return {
    id: GROUP_ID,
    slug: 'solar-builders',
    name: 'Solar Builders',
    visibility: 'private',
    logoUrl: null,
    tagline: 'People building mini-grids',
    coverUrl: null,
    ownerType: 'member',
    page: null,
    chapter: null,
    country: null,
    memberCount: 12,
    postsThisWeek: 3,
    connections: [],
    status: 'active',
    featured: false,
    membership: { status: 'active', role: 'member', viaOwner: false },
    createdAt: '2026-11-01T10:00:00.000Z',
  };
}

type Seen = { method: string; path: string; auth?: string; csrf?: string; contentType?: string; body: unknown; forwardedFor?: string };

let seen: Seen[] = [];
let meCalls = 0;
/** Lets a test make the next POST /posts fail with this status and API error envelope. */
let postFailure: { status: number; body: unknown; retryAfter?: string } | null = null;

const member = {
  id: '11111111-2222-4333-8444-555555555555',
  handle: 'amina',
  name: 'Amina Okafor',
  headline: 'Founder, GreenGrid',
  avatarUrl: null,
  tone: 'primary',
  verified: false,
  staff: false,
  official: false,
};

function postView(body: string) {
  return {
    id: POST_ID,
    author: member,
    page: null,
    aboutPage: null,
    body,
    kind: 'standard',
    type: 'standard',
    question: null,
    celebration: null,
    request: null,
    article: null,
    pinned: false,
    chapter: { id: CHAPTER_ID, slug: 'nigeria', name: 'Nigeria Chapter', countryCode: 'NG' },
    hashtags: ['energy'],
    mentions: [],
    attachments: [],
    poll: null,
    linkPreview: null,
    repostOf: null,
    isRepost: false,
    event: null,
    isEventShare: false,
    initiative: null,
    status: 'published',
    createdAt: '2026-11-17T10:00:00.000Z',
    editedAt: null,
    counts: { reactions: 0, comments: 0, reposts: 0 },
    reactionBreakdown: { like: 0, insightful: 0, support: 0 },
    viewer: { reaction: null, bookmarked: false, reposted: false, canEdit: true, canDelete: true, canReport: false, canViewAnalytics: true },
  };
}

function fakeApi() {
  const api = express();
  const v1 = express.Router();
  const record = (req: Request) =>
    seen.push({
      method: req.method,
      path: req.path,
      auth: req.get('authorization'),
      csrf: req.get('x-cm-csrf'),
      contentType: req.get('content-type'),
      body: req.body,
      forwardedFor: req.get('x-forwarded-for'),
    });

  v1.post('/oauth/token', express.text({ type: () => true }), (req, res) => {
    record(req);
    res.set('Cache-Control', 'no-store').json({ access_token: 'cmat_new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'cmrt_new', scope: 'charter' });
  });
  v1.post('/oauth/register', express.json(), (req, res) => {
    record(req);
    res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Redirect URIs must be on claude.ai or claude.com' });
  });

  v1.use(express.json());
  v1.use((req, res, next) => {
    record(req);
    if (req.get('authorization') !== `Bearer ${GOOD}`) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
      return;
    }
    next();
  });
  v1.get('/me', (_req, res) => {
    meCalls++;
    res.json({ ...member, email: 'amina@example.com', emailVerified: true, status: 'active', countryCode: 'NG', restrictions: { postingUntil: null, connectingUntil: null } });
  });
  v1.get('/members/:handle', (req, res) => {
    res.json({ ...member, relationship: { self: false, connection: 'none', connectionId: null, following: false, followsYou: false, blocked: false, muted: false } });
  });
  v1.get('/topics/:tag', (req, res) => {
    res.json({ tag: req.params.tag, description: null, posts: 0, followers: 0, following: false });
  });
  v1.get('/topics/:tag/posts', (_req, res) => {
    res.json({ items: [], nextCursor: null });
  });
  v1.get('/chapters/:slug', (req, res) => {
    if (req.params.slug !== 'nigeria') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chapter not found' } });
      return;
    }
    res.json({ id: CHAPTER_ID, slug: 'nigeria' });
  });
  v1.get('/groups', (req, res) => {
    // list_my_groups asks only for the member's own groups.
    if (req.query.scope !== 'mine') {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Expected scope=mine' } });
      return;
    }
    res.json({ items: [groupSummary()], nextCursor: null });
  });
  v1.get('/groups/:slug', (req, res) => {
    if (req.params.slug !== 'solar-builders') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Group was not found' } });
      return;
    }
    res.json({
      ...groupSummary(),
      about: 'We share what works.',
      rules: null,
      joinQuestion: null,
      postPermission: 'members',
      postApproval: true,
      hashtags: [],
      postCount: 40,
      admins: [],
      createdBy: null,
      statusNote: null,
      pending: null,
      abilities: { seeContent: true, post: true, join: 'none', leave: true, invite: false, moderate: false, manage: false, own: false },
    });
  });
  v1.post('/posts', (req, res) => {
    if (postFailure) {
      if (postFailure.retryAfter) res.set('Retry-After', postFailure.retryAfter);
      res.status(postFailure.status).json(postFailure.body);
      return;
    }
    res.status(201).json(postView((req.body as { body: string }).body));
  });
  api.use('/api/v1', v1);
  return api;
}

let apiServer: Server;
let mcpServer: Server;
let mcpUrl: string;
let config: Config;

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const portOf = (s: Server) => (s.address() as AddressInfo).port;

beforeAll(async () => {
  apiServer = await listen(fakeApi());
  config = {
    PORT: 0,
    PUBLIC_URL: 'https://mcp.example.test',
    API_INTERNAL_URL: `http://127.0.0.1:${portOf(apiServer)}/api/v1`,
    WEB_URL: 'https://web.example.test',
  };
  mcpServer = await listen(createApp(config));
  mcpUrl = `http://127.0.0.1:${portOf(mcpServer)}`;
});

afterAll(async () => {
  await new Promise((r) => mcpServer.close(r));
  await new Promise((r) => apiServer.close(r));
});

beforeEach(() => {
  seen = [];
  postFailure = null;
});

async function connect(token = GOOD) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

const text = (result: unknown) => ((result as { content: { type: string; text: string }[] }).content[0]!.text);

describe('discovery metadata', () => {
  it('describes the protected resource at both paths', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await fetch(mcpUrl + path);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.json()).toEqual({
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://mcp.example.test'],
        scopes_supported: ['charter'],
        bearer_methods_supported: ['header'],
        resource_name: 'Charter Mission',
      });
    }
  });

  it('describes the authorization server', async () => {
    const res = await fetch(`${mcpUrl}/.well-known/oauth-authorization-server`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      issuer: 'https://mcp.example.test',
      authorization_endpoint: 'https://mcp.example.test/authorize',
      token_endpoint: 'https://mcp.example.test/token',
      registration_endpoint: 'https://mcp.example.test/register',
      revocation_endpoint: 'https://mcp.example.test/revoke',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['charter'],
    });
    const oidc = await fetch(`${mcpUrl}/.well-known/openid-configuration`);
    expect(await oidc.json()).toEqual(body);
  });

  it('answers CORS preflight and health', async () => {
    const pre = await fetch(`${mcpUrl}/mcp`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('Mcp-Protocol-Version');
    expect(pre.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
    const health = await fetch(`${mcpUrl}/health`);
    expect(await health.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /mcp authentication', () => {
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
  const post = (headers: Record<string, string>) =>
    fetch(`${mcpUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init) });

  it('asks for a token with the resource metadata link', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"');
  });

  it('rejects a token the API does not accept, and never caches the failure', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await post({ authorization: 'Bearer cmat_bad' });
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate')!;
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"');
    }
    expect(seen.filter((s) => s.path === '/me')).toHaveLength(2);
  });

  it('caches an accepted token', async () => {
    const before = meCalls;
    await post({ authorization: 'Bearer cmat_good' });
    await post({ authorization: 'Bearer cmat_good' });
    expect(meCalls - before).toBeLessThanOrEqual(1);
  });

  it('refuses GET and DELETE', async () => {
    expect((await fetch(`${mcpUrl}/mcp`)).status).toBe(405);
    expect((await fetch(`${mcpUrl}/mcp`, { method: 'DELETE' })).status).toBe(405);
  });
});

describe('OAuth hand-off', () => {
  it('sends /authorize to the consent page with the query unchanged', async () => {
    const query = 'response_type=code&client_id=cmc_abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=x&code_challenge_method=S256&state=s%20t';
    const res = await fetch(`${mcpUrl}/authorize?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://web.example.test/connect?${query}`);
  });

  it('rejects an /authorize request without the required fields', async () => {
    const res = await fetch(`${mcpUrl}/authorize?client_id=x`, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('forwards /token to the API with the raw form body and relays the answer', async () => {
    const form = 'grant_type=authorization_code&code=cmac_1&code_verifier=v&client_id=cmc_abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb';
    const res = await fetch(`${mcpUrl}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as { access_token: string }).access_token).toBe('cmat_new');
    const call = seen.find((s) => s.path === '/oauth/token')!;
    expect(call.body).toBe(form);
    expect(call.contentType).toBe('application/x-www-form-urlencoded');
    expect(call.csrf).toBe('1');
    expect(call.forwardedFor).toBeTruthy();
  });

  it('relays OAuth errors from /register as they are', async () => {
    const res = await fetch(`${mcpUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_redirect_uri', error_description: 'Redirect URIs must be on claude.ai or claude.com' });
  });

  it('answers 502 when the API cannot be reached', async () => {
    const down = createApp({ ...config, API_INTERNAL_URL: 'http://127.0.0.1:1/api/v1' });
    const s = await listen(down);
    try {
      const res = await fetch(`http://127.0.0.1:${portOf(s)}/revoke`, { method: 'POST', body: 'token=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe('temporarily_unavailable');
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe('tools', () => {
  it('lists every tool with a description, schema and annotations', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'accept_connection_request', 'comment', 'create_post', 'delete_comment', 'delete_post', 'edit_comment', 'edit_post',
        'follow', 'get_chapter', 'get_group', 'get_member', 'get_post', 'list_chapters', 'list_comments', 'list_connection_requests',
        'list_drafts', 'list_my_groups', 'list_notifications', 'mark_notifications_read', 'member_suggestions', 'my_analytics', 'my_pages',
        'post_analytics', 'publish_draft', 'react', 'read_feed', 'remove_reaction', 'save_draft', 'schedule_post',
        'search_members', 'send_connection_request', 'topic_posts', 'trending', 'unfollow', 'whoami',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.read_feed!.annotations?.readOnlyHint).toBe(true);
    expect(byName.delete_post!.annotations?.destructiveHint).toBe(true);
    const shared = 'at most 5 posts (publishing, scheduling and publishing drafts together) an hour and 20 a day';
    for (const name of ['create_post', 'schedule_post', 'publish_draft']) expect(byName[name]!.description, name).toContain(shared);
    expect(byName.save_draft!.description).toContain('at most 10 draft saves an hour');
    expect(byName.create_post!.inputSchema.required).toEqual(['body']);
    expect(client.getInstructions()).toContain('get their confirmation');
    await client.close();
  });

  it('create_post resolves the chapter slug and calls the API with the bearer', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'create_post',
      arguments: { body: 'Solar mini-grids are scaling in Kano. #energy', chapter: 'nigeria', visibility: 'members' },
    });
    expect(result.isError).toBeFalsy();
    const create = seen.find((s) => s.method === 'POST' && s.path === '/posts')!;
    expect(create.auth).toBe(`Bearer ${GOOD}`);
    expect(create.csrf).toBe('1');
    expect(create.body).toEqual({
      type: 'standard',
      body: 'Solar mini-grids are scaling in Kano. #energy',
      visibility: 'members',
      chapterId: CHAPTER_ID,
    });
    const out = JSON.parse(text(result)) as { published: Record<string, unknown> };
    expect(out.published).toMatchObject({ id: POST_ID, url: `https://web.example.test/posts/${POST_ID}`, author: { handle: 'amina' }, chapter: 'nigeria' });
    expect(out.published).not.toHaveProperty('reactionBreakdown');
    await client.close();
  });

  it('lists the member\'s groups, opens one, and posts in it by slug', async () => {
    const client = await connect();
    const listed = await client.callTool({ name: 'list_my_groups', arguments: {} });
    expect(listed.isError).toBeFalsy();
    const list = seen.find((s) => s.method === 'GET' && s.path === '/groups')!;
    expect(list).toBeTruthy();
    expect(JSON.parse(text(listed))).toMatchObject({ groups: [{ slug: 'solar-builders', visibility: 'private', yourRole: 'member', url: 'https://web.example.test/groups/solar-builders' }] });

    const opened = await client.callTool({ name: 'get_group', arguments: { slug: 'solar-builders' } });
    expect(JSON.parse(text(opened))).toMatchObject({ name: 'Solar Builders', canPost: true, postsNeedApproval: true, yourRole: 'member' });

    const result = await client.callTool({ name: 'create_post', arguments: { body: 'Our Kano site is live.', group: 'solar-builders' } });
    expect(result.isError).toBeFalsy();
    const create = seen.find((s) => s.method === 'POST' && s.path === '/posts')!;
    expect(create.body).toMatchObject({ body: 'Our Kano site is live.', groupId: GROUP_ID });

    const missing = await client.callTool({ name: 'create_post', arguments: { body: 'Hi', group: 'atlantis' } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('Group was not found');
    await client.close();
  });

  it('reports an hourly limit (429) clearly', async () => {
    postFailure = {
      status: 429,
      retryAfter: '1200',
      body: { error: { code: 'RATE_LIMITED', message: 'Claude can create at most 5 posts an hour for you; try again later', retryAfter: 1200 } },
    };
    const client = await connect();
    const result = await client.callTool({ name: 'create_post', arguments: { body: 'Hello' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Claude can create at most 5 posts an hour for you');
    expect(text(result)).toContain('20 minutes');
    await client.close();
  });

  it('turns a 401 from the API during a tool call into a 401 challenge and forgets the token', async () => {
    const call = () =>
      fetch(`${mcpUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${GOOD}`, 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_post', arguments: { body: 'Hello' } } }),
      });
    // Warm the cache, then fail mid-call.
    expect((await call()).status).toBe(200);
    postFailure = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } } };
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"');
    // The cached "valid" entry is gone: the next request asks the API again.
    postFailure = null;
    const before = meCalls;
    expect((await call()).status).toBe(200);
    expect(meCalls).toBe(before + 1);
  });

  it('words a 401 as an expired sign-in to retry', () => {
    const error = toApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
    expect(error.message).toContain('sign-in expired');
    expect(error.message).toContain('Retry the same request');
    expect(error.message).not.toContain('Settings');
  });

  it('passes validation messages and field errors through', async () => {
    postFailure = { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'Check the highlighted fields', fields: { body: 'Write your question (at least 10 characters)' } } } };
    const client = await connect();
    const result = await client.callTool({ name: 'create_post', arguments: { body: 'Why?', type: 'question' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('body: Write your question (at least 10 characters).');
    await client.close();
  });

  it('reports an unknown chapter as not found without posting', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'create_post', arguments: { body: 'Hello', chapter: 'atlantis' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Not found: Chapter not found');
    expect(seen.some((s) => s.method === 'POST' && s.path === '/posts')).toBe(false);
    await client.close();
  });
});

describe('path segments', () => {
  it('refuses traversal, separators, control characters and empty values', () => {
    for (const bad of ['', ' ', '.', '..', '...', 'a/b', '../admin', 'a\\b', 'x\u0000', 'tab\there', '%2e%2e', 'a?b', 'a#b']) {
      expect(() => pathSegment(bad, 'slug'), JSON.stringify(bad)).toThrow(/not a valid slug/);
    }
    expect(() => pathSegment('..', 'tag')).toThrow(/not a valid hashtag/);
    expect(() => pathSegment('a.b', 'tag')).toThrow();
  });

  it('accepts real handles, slugs, unicode tags and ids', () => {
    expect(pathSegment('nigeria', 'slug')).toBe('nigeria');
    expect(pathSegment('amina.okafor_2', 'handle')).toBe('amina.okafor_2');
    expect(pathSegment('green-grid', 'slug')).toBe('green-grid');
    expect(pathSegment('énergie_verte', 'tag')).toBe(encodeURIComponent('énergie_verte'));
    expect(pathSegment('الطاقة', 'tag')).toBe(encodeURIComponent('الطاقة'));
    expect(pathSegment(POST_ID, 'handle')).toBe(POST_ID);
  });

  it('never lets a tool argument walk the API path', async () => {
    const client = await connect();
    const cases = [
      { name: 'topic_posts', arguments: { tag: '..' } },
      { name: 'topic_posts', arguments: { tag: '#../../admin' } },
      { name: 'get_member', arguments: { handle: '..' } },
      { name: 'get_member', arguments: { handle: '@../admin/members' } },
      { name: 'get_chapter', arguments: { slug: '../notifications' } },
      { name: 'send_connection_request', arguments: { member: 'a/b' } },
      { name: 'create_post', arguments: { body: 'Hi', chapter: '..' } },
      { name: 'create_post', arguments: { body: 'Hi', page: '../me' } },
      { name: 'create_post', arguments: { body: 'Hi', group: '../me' } },
      { name: 'get_group', arguments: { slug: '../admin' } },
    ];
    for (const c of cases) {
      const result = await client.callTool(c);
      expect(result.isError, JSON.stringify(c)).toBe(true);
      expect(text(result)).toMatch(/is not a valid/);
    }
    // Only the token check (/me) reached the API.
    expect(seen.filter((s) => s.path !== '/me')).toEqual([]);
    const ok = await client.callTool({ name: 'topic_posts', arguments: { tag: '#énergie' } });
    expect(ok.isError).toBeFalsy();
    expect(seen.some((s) => s.path === `/topics/${encodeURIComponent('énergie')}/posts`)).toBe(true);
    await client.close();
  });
});

describe('token cache', () => {
  it('trusts an accepted token for 30 seconds, and forgets it on request', async () => {
    let now = 1_000_000;
    const verifier = new TokenVerifier(config.API_INTERNAL_URL, () => now);
    const before = meCalls;
    expect((await verifier.verify(GOOD)).ok).toBe(true);
    now += 29_000;
    expect((await verifier.verify(GOOD)).ok).toBe(true);
    expect(meCalls).toBe(before + 1);
    now += 2_000;
    expect((await verifier.verify(GOOD)).ok).toBe(true);
    expect(meCalls).toBe(before + 2);
    verifier.forget(GOOD);
    expect((await verifier.verify(GOOD)).ok).toBe(true);
    expect(meCalls).toBe(before + 3);
  });
});
