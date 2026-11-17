import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { s256 } from '../../src/oauth/pkce.js';
import { MCP_ROUTES } from '../../src/oauth/mcp-routes.js';
import { sha256 } from '../../src/common/crypto.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

describe('Claude (MCP) access: OAuth server, bearer requests, limits and activity', () => {
  let t: TestApp;
  let admin: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(() => t.close());

  /* ------------------------------ helpers ------------------------------ */

  const register = (body: object) => t.http().post('/api/v1/oauth/register').send(body);

  async function registerClient(redirect = REDIRECT, name?: string) {
    const res = await register({ redirect_uris: [redirect], ...(name ? { client_name: name } : {}) }).expect(201);
    return res.body.client_id as string;
  }

  async function giveAccess(m: Member) {
    await admin.put(`/admin/members/${m.id}/mcp-access`, { enabled: true }).expect(200);
  }

  function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
    return {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state-123',
      ...extra,
    };
  }

  /** Approve on the consent page and return the code and its verifier. */
  async function getCode(m: Member, clientId: string) {
    const verifier = randomBytes(32).toString('base64url');
    const res = await m.post('/oauth/authorize', { ...authorizeQuery(clientId, s256(verifier)), approve: true }).expect(200);
    const url = new URL(res.body.redirectTo as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-123');
    const code = url.searchParams.get('code')!;
    expect(code).toMatch(/^cmac_/);
    return { code, verifier };
  }

  /** The token endpoint, form-encoded like real OAuth clients. */
  const tokenForm = (params: Record<string, string>) =>
    t.http().post('/api/v1/oauth/token').type('form').send(params);

  async function connect(m: Member, clientId?: string) {
    const client = clientId ?? (await registerClient());
    const { code, verifier } = await getCode(m, client);
    const res = await tokenForm({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: client,
      code_verifier: verifier,
    }).expect(200);
    return { clientId: client, access: res.body.access_token as string, refresh: res.body.refresh_token as string };
  }

  /** A request as Claude: bearer token and the CSRF header the MCP app sends, no cookies. */
  function bearer(token: string) {
    const auth = (r: ReturnType<ReturnType<TestApp['http']>['get']>) => r.set('Authorization', `Bearer ${token}`).set('X-CM-CSRF', '1');
    return {
      get: (url: string) => auth(t.http().get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(t.http().post(`/api/v1${url}`)).send(body),
      put: (url: string, body: object = {}) => auth(t.http().put(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object = {}) => auth(t.http().patch(`/api/v1${url}`)).send(body),
      delete: (url: string, body: object = {}) => auth(t.http().delete(`/api/v1${url}`)).send(body),
    };
  }

  /* ------------------------------ registration ------------------------------ */

  describe('dynamic client registration', () => {
    it('registers a public client for an allowed redirect URI', async () => {
      const res = await register({ client_name: 'Claude', redirect_uris: [REDIRECT] }).expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        client_name: 'Claude',
        redirect_uris: [REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
      expect(res.body.client_id).toMatch(/^cmc_/);
      expect(typeof res.body.client_id_issued_at).toBe('number');
      // Loopback redirects (Claude Code / Desktop) and the default name.
      const local = await register({ redirect_uris: ['http://localhost:33418/callback', 'http://127.0.0.1:6274/cb'] }).expect(201);
      expect(local.body.client_name).toBe('Claude');
      const long = await register({ client_name: `  ${'x'.repeat(200)}  `, redirect_uris: [REDIRECT] }).expect(201);
      expect(long.body.client_name).toHaveLength(80);
      // Bidi overrides and zero-width characters can't disguise the name on the consent page.
      const tricky = await register({ client_name: '\u202eClaude\u200b \u2066Desktop\n\t', redirect_uris: [REDIRECT] }).expect(201);
      expect(tricky.body.client_name).toBe('Claude Desktop');
      const blank = await register({ client_name: '\u200b\u202e \u2060', redirect_uris: [REDIRECT] }).expect(201);
      expect(blank.body.client_name).toBe('Claude');
    });

    it('rejects other redirect URIs and bad metadata with RFC errors', async () => {
      for (const uri of [
        'https://evil.example/cb',
        'http://claude.ai/api/mcp/auth_callback',
        'https://claude.ai.evil.com/api/mcp/auth_callback',
        'http://10.0.0.1/cb',
        // Pinned URIs: the right host on another path is not enough.
        'https://claude.ai/other/callback',
        'https://claude.ai/api/mcp/auth_callback/x',
        'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
      ]) {
        const res = await register({ redirect_uris: [uri] }).expect(400);
        expect(res.body.error).toBe('invalid_redirect_uri');
        expect(typeof res.body.error_description).toBe('string');
      }
      expect((await register({}).expect(400)).body.error).toBe('invalid_redirect_uri');
      expect((await register({ redirect_uris: Array(6).fill(REDIRECT) }).expect(400)).body.error).toBe('invalid_redirect_uri');
      expect((await register({ redirect_uris: [REDIRECT], client_name: 42 }).expect(400)).body.error).toBe('invalid_client_metadata');
    });
  });

  /* ------------------------------ consent ------------------------------ */

  describe('consent (authorize check and answer)', () => {
    it('reports the client and member, and allowed=false without Claude access', async () => {
      const m = await createMember(t, { name: 'Kofi Mensah' });
      const clientId = await registerClient(REDIRECT, 'Claude Desktop');
      const q = new URLSearchParams(authorizeQuery(clientId, s256(randomBytes(32).toString('base64url'))));
      const res = await m.get(`/oauth/authorize/check?${q}`).expect(200);
      expect(res.body).toMatchObject({ client: { name: 'Claude Desktop', redirectHost: 'claude.ai' }, allowed: false });
      expect(res.body.member).toMatchObject({ id: m.id, handle: m.handle });

      // Approving without access → 403; nothing issued.
      const verifier = randomBytes(32).toString('base64url');
      const denied = await m.post('/oauth/authorize', { ...authorizeQuery(clientId, s256(verifier)), approve: true }).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      expect(await t.db.select().from(s.oauthCodes).where(eq(s.oauthCodes.userId, m.id))).toHaveLength(0);

      await giveAccess(m);
      expect((await m.get(`/oauth/authorize/check?${q}`).expect(200)).body.allowed).toBe(true);
    });

    it('rejects an unknown client or a redirect URI that is not registered exactly (400), and visitors (401)', async () => {
      const m = await createMember(t);
      const clientId = await registerClient();
      const challenge = s256(randomBytes(32).toString('base64url'));
      const wrong = new URLSearchParams(authorizeQuery(clientId, challenge, { redirect_uri: `${REDIRECT}/x` }));
      expect((await m.get(`/oauth/authorize/check?${wrong}`).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      const unknown = new URLSearchParams(authorizeQuery('cmc_nope', challenge));
      await m.get(`/oauth/authorize/check?${unknown}`).expect(400);
      await t.http().get(`/api/v1/oauth/authorize/check?${new URLSearchParams(authorizeQuery(clientId, challenge))}`).expect(401);
      // Only S256 PKCE.
      const plain = new URLSearchParams(authorizeQuery(clientId, challenge, { code_challenge_method: 'plain' }));
      await m.get(`/oauth/authorize/check?${plain}`).expect(422);
    });

    it('Cancel sends the browser back with error=access_denied and the state', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const clientId = await registerClient();
      const res = await m
        .post('/oauth/authorize', { ...authorizeQuery(clientId, s256(randomBytes(32).toString('base64url'))), approve: false })
        .expect(200);
      const url = new URL(res.body.redirectTo as string);
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('state')).toBe('state-123');
      expect(url.searchParams.get('code')).toBeNull();
    });
  });

  /* ------------------------------ token endpoint ------------------------------ */

  describe('token endpoint', () => {
    it('exchanges a code with PKCE once; codes and tokens are stored hashed', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const clientId = await registerClient();
      const { code, verifier } = await getCode(m, clientId);
      const res = await tokenForm({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'charter' });
      expect(res.body.access_token).toMatch(/^cmat_/);
      expect(res.body.refresh_token).toMatch(/^cmrt_/);

      const [grant] = await t.db.select().from(s.oauthGrants).where(eq(s.oauthGrants.userId, m.id));
      expect(grant!.accessHash).toBe(sha256(res.body.access_token));
      expect(grant!.refreshHash).toBe(sha256(res.body.refresh_token));
      const [stored] = await t.db.select().from(s.oauthCodes).where(eq(s.oauthCodes.userId, m.id));
      expect(stored!.codeHash).toBe(sha256(code));
      expect(JSON.stringify(stored)).not.toContain(code);

      // Replaying the code fails and disconnects what it was exchanged for.
      await bearer(res.body.access_token).get('/me').expect(200);
      const replay = await tokenForm({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).expect(400);
      expect(replay.body).toMatchObject({ error: 'invalid_grant' });
      await bearer(res.body.access_token).get('/me').expect(401);
    });

    it('rejects a wrong verifier (and the code is then burnt), a wrong redirect URI or client, bad grants', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const clientId = await registerClient();

      const a = await getCode(m, clientId);
      const bad = await tokenForm({ grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: randomBytes(32).toString('base64url') }).expect(400);
      expect(bad.body).toEqual({ error: 'invalid_grant', error_description: expect.any(String) });
      await tokenForm({ grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier }).expect(400);

      const b = await getCode(m, clientId);
      expect((await tokenForm({ grant_type: 'authorization_code', code: b.code, redirect_uri: `${REDIRECT}?x=1`, client_id: clientId, code_verifier: b.verifier }).expect(400)).body.error).toBe('invalid_grant');

      const c = await getCode(m, clientId);
      const other = await registerClient();
      expect((await tokenForm({ grant_type: 'authorization_code', code: c.code, redirect_uri: REDIRECT, client_id: other, code_verifier: c.verifier }).expect(400)).body.error).toBe('invalid_grant');

      expect((await tokenForm({ grant_type: 'authorization_code', code: 'cmac_x', redirect_uri: REDIRECT, client_id: 'cmc_unknown', code_verifier: c.verifier }).expect(400)).body.error).toBe('invalid_client');
      expect((await tokenForm({ grant_type: 'password', username: 'x' }).expect(400)).body.error).toBe('unsupported_grant_type');
      expect((await tokenForm({ grant_type: 'authorization_code', client_id: clientId }).expect(400)).body.error).toBe('invalid_request');
      expect((await tokenForm({}).expect(400)).body.error).toBe('invalid_request');

      // Expired codes are refused.
      const d = await getCode(m, clientId);
      await t.db.update(s.oauthCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.oauthCodes.codeHash, sha256(d.code)));
      expect((await tokenForm({ grant_type: 'authorization_code', code: d.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: d.verifier }).expect(400)).body.error).toBe('invalid_grant');
    });

    it('accepts JSON as well as form bodies', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const clientId = await registerClient();
      const { code, verifier } = await getCode(m, clientId);
      const res = await t
        .http()
        .post('/api/v1/oauth/token')
        .send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })
        .expect(200);
      expect(res.body.access_token).toMatch(/^cmat_/);
    });

    it('refresh rotates both tokens; reusing the old refresh token revokes the connection', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const first = await connect(m);
      const r1 = await tokenForm({ grant_type: 'refresh_token', refresh_token: first.refresh, client_id: first.clientId }).expect(200);
      expect(r1.body.access_token).not.toBe(first.access);
      expect(r1.body.refresh_token).not.toBe(first.refresh);
      await bearer(first.access).get('/me').expect(401);
      await bearer(r1.body.access_token).get('/me').expect(200);
      // Still one connection row.
      expect(await t.db.select().from(s.oauthGrants).where(eq(s.oauthGrants.userId, m.id))).toHaveLength(1);

      // Another client can't use it.
      const other = await registerClient();
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: other }).expect(400)).body.error).toBe('invalid_grant');

      // Reuse of the replaced refresh token (after the retry window): the whole connection is revoked.
      await t.db.update(s.oauthGrants).set({ rotatedAt: new Date(Date.now() - 120_000) }).where(eq(s.oauthGrants.userId, m.id));
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: first.refresh, client_id: first.clientId }).expect(400)).body.error).toBe('invalid_grant');
      await bearer(r1.body.access_token).get('/me').expect(401);
      await tokenForm({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: first.clientId }).expect(400);
    });

    it('a refresh retried within 60 s (lost response) gets a fresh pair; after that it revokes', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const c = await connect(m);
      const refresh = (token: string) => tokenForm({ grant_type: 'refresh_token', refresh_token: token, client_id: c.clientId });
      const r1 = await refresh(c.refresh).expect(200);
      // The response was lost: the client retries with the same token.
      const retry = await refresh(c.refresh).expect(200);
      expect(retry.body.refresh_token).not.toBe(r1.body.refresh_token);
      await bearer(retry.body.access_token).get('/me').expect(200);
      await bearer(r1.body.access_token).get('/me').expect(401);
      // The connection survives and keeps refreshing normally.
      const r2 = await refresh(retry.body.refresh_token).expect(200);
      await bearer(r2.body.access_token).get('/me').expect(200);

      // A retry from another client within the window is a replay: revoked.
      const d = await connect(m);
      const d1 = await tokenForm({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: d.clientId }).expect(200);
      const other = await registerClient();
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: other }).expect(400)).body.error).toBe('invalid_grant');
      await bearer(d1.body.access_token).get('/me').expect(401);

      // Outside the window the replaced token revokes the connection.
      await t.db
        .update(s.oauthGrants)
        .set({ rotatedAt: new Date(Date.now() - 61_000) })
        .where(eq(s.oauthGrants.refreshHash, sha256(r2.body.refresh_token)));
      expect((await refresh(retry.body.refresh_token).expect(400)).body.error).toBe('invalid_grant');
      await bearer(r2.body.access_token).get('/me').expect(401);
      await refresh(r2.body.refresh_token).expect(400);
    });

    it('a password change, reset or suspension disconnects Claude; suspended accounts get no tokens', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const c = await connect(m);
      await m.post('/me/password', { currentPassword: PASSWORD, newPassword: 'Kente-Window-Rocket-31' }).expect(200);
      await bearer(c.access).get('/me').expect(401);
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId }).expect(400)).body.error).toBe('invalid_grant');
      // The member's own session stays.
      await m.get('/me').expect(200);

      // Suspended (by status or a running suspension): no refresh, and the access token stops working.
      const sus = await createMember(t);
      await giveAccess(sus);
      const sc = await connect(sus);
      await t.db.update(s.users).set({ suspendedUntil: new Date(Date.now() + 3600_000) }).where(eq(s.users.id, sus.id));
      await bearer(sc.access).get('/me').expect(401);
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: sc.refresh, client_id: sc.clientId }).expect(400)).body.error).toBe('invalid_grant');

      const sus2 = await createMember(t);
      await giveAccess(sus2);
      const clientId = await registerClient();
      const { code, verifier } = await getCode(sus2, clientId);
      await t.db.update(s.users).set({ status: 'suspended' }).where(eq(s.users.id, sus2.id));
      expect((await tokenForm({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).expect(400)).body.error).toBe('invalid_grant');

      // A moderator's suspension goes through revokeAll too.
      const { SessionService } = await import('../../src/core/session.service.js');
      const v = await createMember(t);
      await giveAccess(v);
      const vc = await connect(v);
      await t.app.get(SessionService).revokeAll(v.id);
      await bearer(vc.access).get('/me').expect(401);
    });

    it('revocation (RFC 7009) always answers 200 and disconnects', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const c = await connect(m);
      await t.http().post('/api/v1/oauth/revoke').type('form').send({ token: 'cmat_unknown' }).expect(200);
      // A client may not revoke another client's token.
      const other = await registerClient();
      await t.http().post('/api/v1/oauth/revoke').type('form').send({ token: c.access, client_id: other }).expect(200);
      await bearer(c.access).get('/me').expect(200);
      await t.http().post('/api/v1/oauth/revoke').type('form').send({ token: c.refresh, token_type_hint: 'refresh_token' }).expect(200);
      await bearer(c.access).get('/me').expect(401);
    });
  });

  /* ------------------------------ bearer requests ------------------------------ */

  describe('bearer requests', () => {
    it('Claude can read, post, comment and react as the member; cookies are ignored', async () => {
      const m = await createMember(t, { name: 'Ngozi Adeyemi' });
      await giveAccess(m);
      const { access } = await connect(m);
      const me = await bearer(access).get('/me').expect(200);
      expect(me.body.id ?? me.body.user?.id).toBe(m.id);

      const post = await bearer(access).post('/posts', { body: 'Written with Claude' }).expect(201);
      expect(post.body.author.id).toBe(m.id);
      const comment = await bearer(access).post(`/posts/${post.body.id}/comments`, { body: 'A follow-up thought' }).expect(201);
      await bearer(access).put('/reactions', { targetType: 'post', targetId: post.body.id, kind: 'insightful' }).expect(200);
      await bearer(access).get('/feed').expect(200);
      await bearer(access).get(`/posts/${post.body.id}/comments`).expect(200);
      await bearer(access).patch(`/comments/${comment.body.id}`, { body: 'An edited thought' }).expect(200);

      // No CSRF header needed for bearer requests.
      await t.http().get('/api/v1/notifications').set('Authorization', `Bearer ${access}`).expect(200);
      await t.http().post('/api/v1/notifications/read').set('Authorization', `Bearer ${access}`).send({}).expect((r) => expect(r.status).toBeLessThan(300));

      // Another member's cookie on the same request changes nothing: the token decides.
      const other = await createMember(t);
      const mixed = await other.get('/me').set('Authorization', `Bearer ${access}`).expect(200);
      expect(mixed.body.id ?? mixed.body.user?.id).toBe(m.id);
    });

    it('blocks routes outside the allowlist (403) and bad tokens (401 + WWW-Authenticate)', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const { access } = await connect(m);
      expect((await bearer(access).patch('/me/profile', { name: 'Changed' }).expect(403)).body.error.code).toBe('FORBIDDEN');
      await bearer(access).get('/messages/config').expect(403);
      await bearer(access).get('/me/connected-apps').expect(403);
      await bearer(access).post('/auth/logout').expect(403);
      await bearer(access).post('/oauth/authorize', { approve: true }).expect(403);
      await bearer(access).get('/admin/members').expect(403);
      await bearer(access).put('/me/privacy', {}).expect(403);

      const bad = await bearer('cmat_not-a-real-token').get('/me').expect(401);
      expect(bad.headers['www-authenticate']).toContain('Bearer error="invalid_token"');
      const badWrite = await bearer('cmat_not-a-real-token').post('/posts', { body: 'x' }).expect(401);
      expect(badWrite.headers['www-authenticate']).toContain('invalid_token');
      // Expired access token.
      await t.db.update(s.oauthGrants).set({ accessExpiresAt: new Date(Date.now() - 1000) }).where(eq(s.oauthGrants.accessHash, sha256(access)));
      expect((await bearer(access).get('/me').expect(401)).headers['www-authenticate']).toContain('invalid_token');
    });

    it('staff tokens carry member permissions only (no admin, moderation or announcements)', async () => {
      const staff = await createMember(t, { name: 'Team Admin', roles: ['platform_admin'] });
      await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
      const author = await createMember(t);
      const post = await author.post('/posts', { body: 'Not yours to delete' }).expect(201);
      // A staff member's own session can moderate; the same person through Claude can't.
      const { access } = await connect(staff);
      expect((await bearer(access).delete(`/posts/${post.body.id}`).expect(403)).body.error.code).toBe('FORBIDDEN');
      await bearer(access).post('/posts', { body: 'Big news', kind: 'announcement' }).expect(403);
      await bearer(access).post('/posts', { body: 'A normal post' }).expect(201);
    });

    it('every allowlisted route exists', () => {
      const keys = new Set<string>();
      const METHOD = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      for (const mod of t.app.get(ModulesContainer).values()) {
        for (const wrapper of mod.controllers.values()) {
          const ctrl = wrapper.metatype as unknown as { prototype: Record<string, unknown> } | null;
          if (!ctrl) continue;
          const base = String(Reflect.getMetadata('path', ctrl) ?? '').split('/').filter(Boolean);
          for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
            const fn = ctrl.prototype[name];
            if (typeof fn !== 'function') continue;
            const method = Reflect.getMetadata('method', fn) as number | undefined;
            const path = Reflect.getMetadata('path', fn) as string | undefined;
            if (method === undefined || path === undefined) continue;
            keys.add(`${METHOD[method]} ${[...base, ...path.split('/').filter(Boolean)].join('/')}`);
          }
        }
      }
      expect(keys.size).toBeGreaterThan(200);
      expect(keys.has('PATCH me/profile')).toBe(true);
      expect([...MCP_ROUTES].filter((r) => !keys.has(r))).toEqual([]);
    });
  });

  /* ------------------------------ limits and activity ------------------------------ */

  describe('limits and activity', () => {
    it('limits posts to 5 an hour per member, even in parallel, and logs each action', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const { access } = await connect(m);
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => bearer(access).post('/posts', { body: `Post ${i}` })));
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 201, 201, 201, 201, 429, 429, 429, 429, 429]);
      const ids = results.filter((r) => r.status === 201).map((r) => r.body.id as string);
      const over = await bearer(access).post('/posts', { body: 'One too many' }).expect(429);
      expect(over.body.error.code).toBe('RATE_LIMITED');
      expect(over.body.error.message).toBe('Claude can publish or schedule at most 5 posts an hour for you; try again later.');
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      // The member's own session isn't limited by Claude's actions.
      await m.post('/posts', { body: 'Posted myself' }).expect(201);

      const logged = await t.db.select().from(s.mcpActions).where(and(eq(s.mcpActions.userId, m.id), eq(s.mcpActions.action, 'post.create')));
      expect(logged).toHaveLength(5);
      expect(new Set(logged.map((l) => l.targetId))).toEqual(new Set(ids));
      expect(logged[0]).toMatchObject({ targetType: 'post', clientName: 'Claude' });
    });

    it('scheduling and publishing drafts share the post allowance; failed requests give the slot back', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const { access } = await connect(m);
      const later = new Date(Date.now() + 2 * 3600_000).toISOString();
      // Plain drafts are their own allowance and don't count as posts.
      const draft = await bearer(access).post('/me/drafts', { payload: { body: 'Just notes' } }).expect(201);
      // A failing request (validation) doesn't spend anything.
      await bearer(access).post('/posts', { body: '' }).expect(422);
      await bearer(access).post('/posts', { body: 'Now' }).expect(201);
      await bearer(access).post('/posts', { body: 'Now again' }).expect(201);
      await bearer(access).post('/me/drafts', { payload: { body: 'Later' }, scheduledFor: later }).expect(201);
      await bearer(access).patch(`/me/drafts/${draft.body.id}`, { payload: { body: 'Later too' }, scheduledFor: later }).expect(200);
      const second = await bearer(access).post('/me/drafts', { payload: { body: 'Another draft' } }).expect(201);
      await bearer(access).post(`/me/drafts/${second.body.id}/publish`).expect(200);
      const over = await bearer(access).post('/me/drafts', { payload: { body: 'One too many' }, scheduledFor: later }).expect(429);
      expect(over.body.error.message).toBe('Claude can publish or schedule at most 5 posts an hour for you; try again later.');
      await bearer(access).post('/posts', { body: 'Also too many' }).expect(429);
      // Saving without a time is still allowed.
      await bearer(access).post('/me/drafts', { payload: { body: 'Unscheduled' } }).expect(201);

      const logged = await t.db.select().from(s.mcpActions).where(eq(s.mcpActions.userId, m.id));
      const counts = logged.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.action]: (acc[l.action] ?? 0) + 1 }), {});
      expect(counts).toEqual({ 'draft.save': 3, 'post.create': 2, 'post.schedule': 2, 'draft.publish': 1 });
      expect(logged.every((l) => l.targetId)).toBe(true);
    });

    it('lists activity and connections for the member, with links', async () => {
      const m = await createMember(t);
      const friend = await createMember(t, { name: 'Zainab Bello' });
      await giveAccess(m);
      const { access } = await connect(m);
      const post = await bearer(access).post('/posts', { body: 'Hello from Claude' }).expect(201);
      await bearer(access).post('/connections', { memberId: friend.id }).expect(201);
      await bearer(access).post('/follows', { targetType: 'hashtag', targetId: 'Leadership' }).expect((r) => expect(r.status).toBeLessThan(300));

      const apps = await m.get('/me/connected-apps').expect(200);
      expect(apps.body.mcpAccess).toBe(true);
      expect(apps.body.apps).toHaveLength(1);
      expect(apps.body.apps[0]).toMatchObject({ clientName: 'Claude', actionsLast7Days: 3 });
      expect(apps.body.apps[0].lastUsedAt).not.toBeNull();

      const page1 = await m.get('/me/connected-apps/activity?limit=2').expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0]).toMatchObject({ action: 'follow', targetType: 'hashtag', href: null });
      expect(page1.body.items[1]).toMatchObject({ action: 'connection.request', targetType: 'member', targetId: friend.id, href: `/${friend.handle}` });
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await m.get(`/me/connected-apps/activity?limit=2&cursor=${page1.body.nextCursor}`).expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0]).toMatchObject({ action: 'post.create', href: `/posts/${post.body.id}` });
      expect(page2.body.nextCursor).toBeNull();

      // Without access: no list.
      const plain = await createMember(t);
      expect((await plain.get('/me/connected-apps').expect(200)).body).toEqual({ mcpAccess: false, apps: [] });
      expect((await plain.get('/me/connected-apps/activity').expect(200)).body.items).toEqual([]);
    });

    it('the member can disconnect a connection', async () => {
      const m = await createMember(t);
      await giveAccess(m);
      const c = await connect(m);
      const [app] = (await m.get('/me/connected-apps').expect(200)).body.apps;
      // Someone else can't.
      const other = await createMember(t);
      await other.delete(`/me/connected-apps/${app.id}`).expect(404);
      await m.delete(`/me/connected-apps/${app.id}`).expect(204);
      await bearer(c.access).get('/me').expect(401);
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId }).expect(400)).body.error).toBe('invalid_grant');
      expect((await m.get('/me/connected-apps').expect(200)).body.apps).toEqual([]);
      await m.delete(`/me/connected-apps/${app.id}`).expect(404);
    });
  });

  /* ------------------------------ admin ------------------------------ */

  describe('admin', () => {
    it('turns Claude access on and off; off disconnects; filter, counts, audit and activity', async () => {
      const m = await createMember(t, { name: 'Halima Yusuf' });
      const on = await admin.put(`/admin/members/${m.id}/mcp-access`, { enabled: true }).expect(200);
      expect(on.body).toMatchObject({ id: m.id, mcpAccess: true, mcpConnections: 0 });
      const c = await connect(m);
      await bearer(c.access).post('/posts', { body: 'Through Claude' }).expect(201);
      expect((await admin.get(`/admin/members/${m.id}`).expect(200)).body.mcpConnections).toBe(1);

      const listed = await admin.get('/admin/members?filter=claude&limit=50').expect(200);
      expect(listed.body.items.map((r: { id: string }) => r.id)).toContain(m.id);
      const activity = await admin.get(`/admin/members/${m.id}/mcp-activity`).expect(200);
      expect(activity.body.items[0]).toMatchObject({ action: 'post.create', clientName: 'Claude' });

      const off = await admin.put(`/admin/members/${m.id}/mcp-access`, { enabled: false }).expect(200);
      expect(off.body).toMatchObject({ mcpAccess: false, mcpConnections: 0 });
      await bearer(c.access).get('/me').expect(401);
      expect((await tokenForm({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId }).expect(400)).body.error).toBe('invalid_grant');
      const after = await admin.get('/admin/members?filter=claude&limit=50').expect(200);
      expect(after.body.items.map((r: { id: string }) => r.id)).not.toContain(m.id);

      const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, m.id));
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['member.mcp_access_granted', 'member.mcp_access_revoked']));

      // Members without members.manage can't.
      const mod = await createMember(t, { roles: ['moderator'], admin: true });
      await mod.put(`/admin/members/${m.id}/mcp-access`, { enabled: true }).expect(403);
      // The member can't connect again until it's back on.
      const clientId = await registerClient();
      await m.post('/oauth/authorize', { ...authorizeQuery(clientId, s256(randomBytes(32).toString('base64url'))), approve: true }).expect(403);
    });

    it('staff have access without a grant; turning it off only removes the grant row', async () => {
      const staff = await createMember(t, { name: 'Team Member', roles: ['moderator'] });
      await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
      expect((await admin.get(`/admin/members/${staff.id}`).expect(200)).body.mcpAccess).toBe(true);
      await admin.put(`/admin/members/${staff.id}/mcp-access`, { enabled: true }).expect(200);
      const c = await connect(staff);
      await admin.put(`/admin/members/${staff.id}/mcp-access`, { enabled: false }).expect(200);
      expect(await t.db.select().from(s.mcpAccessGrants).where(eq(s.mcpAccessGrants.userId, staff.id))).toHaveLength(0);
      await bearer(c.access).get('/me').expect(200);
    });
  });

  /* ------------------------------ cookie sessions unchanged ------------------------------ */

  it('cookie sessions behave as before (CSRF still enforced, profile editable)', async () => {
    const m = await createMember(t);
    await t.http().post('/api/v1/posts').set('Cookie', `cm_session=x`).send({ body: 'x' }).expect(403);
    const res = await m.agent.post('/api/v1/posts').send({ body: 'No CSRF header' }).expect(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
    await m.post('/posts', { body: 'With the header' }).expect(201);
    // A non-Charter bearer token is not ours: the cookie session still applies.
    await m.get('/me').set('Authorization', 'Bearer something-else').expect(200);
    expect(await t.db.select().from(s.mcpActions).where(eq(s.mcpActions.userId, m.id))).toHaveLength(0);
  });
});
