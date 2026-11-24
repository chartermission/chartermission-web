import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BulkResult, GroupDetail, GroupMemberView, GroupSummary, Page } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits } from '../auth/support.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { MCP_ROUTES } from '../../src/oauth/mcp-routes.js';
import { s256 } from '../../src/oauth/pkce.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/*
 * Groups for members: who may create them, joining, asking and invitations, roles and member lists,
 * archiving, notifications and what Claude may reach.
 */
describe('Groups: creation, membership and roles', () => {
  let t: TestApp;
  let admin: Member;
  let owner: Member;
  let ada: Member;
  let bola: Member;
  let chi: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    owner = await createMember(t, { name: 'Owen Owner' });
    ada = await createMember(t, { name: 'Ada Member' });
    bola = await createMember(t, { name: 'Bola Member' });
    chi = await createMember(t, { name: 'Chi Member' });
    // The owner here starts many groups.
    await t.app.get(SettingsService).set('groups', { whoCanCreate: 'everyone', maxOwnedPerMember: 20 }, null);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  const settings = (value: { whoCanCreate: 'everyone' | 'verified' | 'staff'; maxOwnedPerMember: number }) =>
    t.app.get(SettingsService).set('groups', value, null);

  let n = 0;
  async function makeGroup(m: Member, extra: Record<string, unknown> = {}) {
    n += 1;
    const res = await m.post('/groups', { name: `Test Group ${n}`, visibility: 'public', ...extra });
    if (res.status !== 201) throw new Error(`group create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as GroupDetail;
  }

  const memberCount = async (id: string) => (await t.db.select({ n: s.groups.memberCount }).from(s.groups).where(eq(s.groups.id, id)))[0]!.n;

  describe('creating groups', () => {
    it('makes the creator the owner, slugs from the name, and lists the group', async () => {
      const g = await makeGroup(owner, { name: 'Fintech Builders', tagline: 'Payments people', hashtags: ['#Fintech', 'fintech', 'Payments'] });
      expect(g).toMatchObject({ slug: 'fintech-builders', visibility: 'public', ownerType: 'member', memberCount: 1, hashtags: ['Fintech', 'Payments'] });
      expect(g.membership).toEqual({ status: 'active', role: 'owner', viaOwner: false });
      expect(g.abilities).toMatchObject({ seeContent: true, post: true, manage: true, own: true, leave: false });
      expect(g.admins.map((a) => [a.member.id, a.role])).toEqual([[owner.id, 'owner']]);
      const again = await makeGroup(ada, { name: 'Fintech Builders' });
      expect(again.slug).toBe('fintech-builders-2');
      await ada.post('/groups', { name: 'Third', slug: 'fintech-builders', visibility: 'public' }).expect(422);
      const list = (await bola.get('/groups?q=fintech').expect(200)).body as Page<GroupSummary>;
      expect(list.items.map((i) => i.slug).sort()).toEqual(['fintech-builders', 'fintech-builders-2']);
    });

    it('follows the platform setting: everyone, verified members only, or staff only; and caps owned groups', async () => {
      const m = await createMember(t, { name: 'Setting Tester' });
      await settings({ whoCanCreate: 'verified', maxOwnedPerMember: 2 });
      expect((await m.post('/groups', { name: 'Not yet', visibility: 'public' }).expect(403)).body.error.message).toContain('verified');
      await t.db.update(s.users).set({ verifiedAt: new Date() }).where(eq(s.users.id, m.id));
      await makeGroup(m);
      await makeGroup(m);
      expect((await m.post('/groups', { name: 'One too many', visibility: 'public' }).expect(409)).body.error.message).toContain('up to 2 groups');
      await settings({ whoCanCreate: 'staff', maxOwnedPerMember: 10 });
      await ada.post('/groups', { name: 'Staff only now', visibility: 'public' }).expect(403);
      await settings({ whoCanCreate: 'everyone', maxOwnedPerMember: 20 });
      await t.db.update(s.users).set({ restrictedPostingUntil: new Date(Date.now() + 3600_000) }).where(eq(s.users.id, chi.id));
      await chi.post('/groups', { name: 'Restricted', visibility: 'public' }).expect(403);
      await t.db.update(s.users).set({ restrictedPostingUntil: null }).where(eq(s.users.id, chi.id));
    });

    it('page groups need a live page the creator manages; chapter groups need the chapter team', async () => {
      const [page] = await t.db.insert(s.pages).values({ slug: 'agrihub', name: 'AgriHub', category: 'company', status: 'active', createdBy: owner.id }).returning();
      await t.db.insert(s.pageAdmins).values({ pageId: page!.id, userId: owner.id, role: 'owner' });
      await ada.post('/groups', { name: 'Not my page', visibility: 'public', ownerType: 'page', pageId: page!.id }).expect(403);
      const pg = await makeGroup(owner, { name: 'AgriHub Growers', ownerType: 'page', pageId: page!.id });
      expect(pg.page?.slug).toBe('agrihub');
      await t.db.update(s.pages).set({ status: 'suspended' }).where(eq(s.pages.id, page!.id));
      await owner.post('/groups', { name: 'Dead page group', visibility: 'public', ownerType: 'page', pageId: page!.id }).expect(403);
      await t.db.update(s.pages).set({ status: 'active' }).where(eq(s.pages.id, page!.id));
      // Another admin of the page runs its group without a membership.
      await t.db.insert(s.pageAdmins).values({ pageId: page!.id, userId: bola.id, role: 'admin' });
      const asPageAdmin = (await bola.get(`/groups/${pg.slug}`).expect(200)).body as GroupDetail;
      expect(asPageAdmin.membership).toMatchObject({ status: 'none', role: 'admin', viaOwner: true });
      expect(asPageAdmin.abilities).toMatchObject({ manage: true, own: true, moderate: true });

      const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'nigeria'));
      await ada.post('/groups', { name: 'Chapter group', visibility: 'private', ownerType: 'chapter', chapterId: chapter!.id }).expect(403);
      const [lead] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'chapter_lead'));
      await t.db.insert(s.userRoles).values({ userId: ada.id, roleId: lead!.id, scopeType: 'chapter', scopeId: chapter!.id });
      const cg = await makeGroup(ada, { name: 'Nigeria Organisers', visibility: 'private', ownerType: 'chapter', chapterId: chapter!.id });
      expect(cg.chapter?.slug).toBe('nigeria');
      await ada.post('/groups', { name: 'Mixed', visibility: 'public', ownerType: 'member', chapterId: chapter!.id }).expect(422);
    });

    it('accepts only the creator’s own clean group pictures', async () => {
      const file = async (ownerId: string, purpose: string, scanStatus = 'clean') =>
        (
          await t.db
            .insert(s.files)
            .values({ ownerId, purpose, storageKey: `k/${randomBytes(4).toString('hex')}`, declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus })
            .returning()
        )[0]!.id;
      await owner.post('/groups', { name: 'Pictures', visibility: 'public', logoFileId: await file(ada.id, 'group_logo') }).expect(422);
      await owner.post('/groups', { name: 'Pictures', visibility: 'public', logoFileId: await file(owner.id, 'page_logo') }).expect(422);
      await owner.post('/groups', { name: 'Pictures', visibility: 'public', coverFileId: await file(owner.id, 'group_cover', 'pending') }).expect(422);
      const g = await makeGroup(owner, { logoFileId: await file(owner.id, 'group_logo') });
      expect(g.logoUrl).toContain('/media/');
    });
  });

  describe('joining, asking and invitations', () => {
    it('public groups: join at once, leave; the owner can’t leave; already in is 409', async () => {
      const g = await makeGroup(owner);
      const joined = (await ada.post(`/groups/${g.slug}/join`).expect(200)).body as GroupDetail;
      expect(joined.membership).toMatchObject({ status: 'active', role: 'member' });
      expect(joined.memberCount).toBe(2);
      await ada.post(`/groups/${g.slug}/join`).expect(409);
      await owner.post(`/groups/${g.slug}/leave`).expect(409);
      const left = (await ada.post(`/groups/${g.slug}/leave`).expect(200)).body as GroupDetail;
      expect(left.membership.status).toBe('none');
      expect(await memberCount(g.id)).toBe(1);
    });

    it('private groups: ask with the answer, moderators see it and approve or decline; the requester is told', async () => {
      const g = await makeGroup(owner, { visibility: 'private', joinQuestion: 'What do you build?' });
      await ada.post(`/groups/${g.slug}/join`, {}).expect(422);
      const asked = (await ada.post(`/groups/${g.slug}/join`, { answer: 'Payments rails' }).expect(200)).body as GroupDetail;
      expect(asked.membership.status).toBe('pending');
      expect(asked.abilities.join).toBe('none');
      expect(asked.memberCount).toBe(1);
      await bola.post(`/groups/${g.slug}/join`, { answer: 'Lending' }).expect(200);

      // The owner hears about it: one notification for the group, both people named.
      const notes = await notificationsFor(t, owner.id, 'group_join_request');
      expect(notes).toHaveLength(1);
      expect(notes[0]!.actorCount).toBe(2);
      expect(notes[0]!.category).toBe('groups');

      // Requests are for moderators only.
      await chi.get(`/groups/${g.slug}/members?status=pending`).expect(403);
      const pending = (await owner.get(`/groups/${g.slug}/members?status=pending`).expect(200)).body as Page<GroupMemberView>;
      const answers = Object.fromEntries(pending.items.map((m) => [m.member.id, m.requestAnswer]));
      expect(answers).toEqual({ [ada.id]: 'Payments rails', [bola.id]: 'Lending' });
      const detail = (await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(detail.pending).toEqual({ requests: 2, posts: 0 });
      expect(((await chi.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).pending).toBeNull();

      const approved = await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'approve' }).expect(200);
      expect(approved.body.member).toMatchObject({ status: 'active', role: 'member' });
      await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'decline' }).expect(200);
      expect(await memberCount(g.id)).toBe(2);
      expect(await notificationsFor(t, ada.id, 'group_request_approved')).toHaveLength(1);
      expect(await notificationsFor(t, bola.id, 'group_request_approved')).toHaveLength(0);
      await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'approve' }).expect(404);
    });

    it('invitations: who may invite, per-id results, accept with join, cancel by the inviter', async () => {
      const g = await makeGroup(owner, { visibility: 'private' });
      await ada.post(`/groups/${g.slug}/invitations`, { memberIds: [bola.id] }).expect(403);
      const blocker = await createMember(t, { name: 'Blocker' });
      await t.db.insert(s.blocks).values({ blockerId: blocker.id, blockedId: owner.id });
      const gone = await createMember(t, { name: 'Gone', status: 'deactivated' });
      const res = (await owner.post(`/groups/${g.slug}/invitations`, { memberIds: [ada.id, bola.id, blocker.id, gone.id, owner.id] }).expect(200)).body as BulkResult;
      expect(res.done.sort()).toEqual([ada.id, bola.id].sort());
      expect(res.failed.map((f) => f.id).sort()).toEqual([blocker.id, gone.id, owner.id].sort());
      const again = (await owner.post(`/groups/${g.slug}/invitations`, { memberIds: [ada.id] }).expect(200)).body as BulkResult;
      expect(again.failed[0]!.error).toBe('Already invited');
      expect(await notificationsFor(t, ada.id, 'group_invitation')).toHaveLength(1);

      const invitedView = (await ada.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(invitedView.abilities.join).toBe('accept');
      expect((await ada.get('/groups?scope=invited').expect(200)).body.items.map((i: GroupSummary) => i.id)).toContain(g.id);
      const accepted = (await ada.post(`/groups/${g.slug}/join`).expect(200)).body as GroupDetail;
      expect(accepted.membership.status).toBe('active');

      await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'cancel_invite' }).expect(200);
      expect(((await bola.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).membership.status).toBe('none');
      expect(await memberCount(g.id)).toBe(2);

      // In a public group any member invites.
      const pub = await makeGroup(owner);
      await ada.post(`/groups/${pub.slug}/join`).expect(200);
      expect(((await ada.post(`/groups/${pub.slug}/invitations`, { memberIds: [chi.id] }).expect(200)).body as BulkResult).done).toEqual([chi.id]);
      await ada.post(`/groups/${pub.slug}/members/${chi.id}`, { action: 'cancel_invite' }).expect(200);
    });

    it('bans keep people out; unban lets them back', async () => {
      const g = await makeGroup(owner);
      await ada.post(`/groups/${g.slug}/join`).expect(200);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'ban' }).expect(200);
      expect(await memberCount(g.id)).toBe(1);
      await ada.post(`/groups/${g.slug}/join`).expect(403);
      expect(((await ada.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).abilities.join).toBe('none');
      // Banning someone who never joined works too.
      await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'ban' }).expect(200);
      const banned = (await owner.get(`/groups/${g.slug}/members?status=banned`).expect(200)).body as Page<GroupMemberView>;
      expect(banned.items.map((m) => m.member.id).sort()).toEqual([ada.id, bola.id].sort());
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'unban' }).expect(200);
      await ada.post(`/groups/${g.slug}/join`).expect(200);
    });
  });

  describe('roles', () => {
    it('admins manage members below them; only the owner makes admins and hands the group over', async () => {
      const g = await makeGroup(owner);
      for (const m of [ada, bola, chi]) await m.post(`/groups/${g.slug}/join`).expect(200);
      // Members can't change anything.
      await bola.post(`/groups/${g.slug}/members/${chi.id}`, { action: 'remove' }).expect(403);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      expect(await notificationsFor(t, ada.id, 'group_role_changed')).toHaveLength(1);
      // An admin makes moderators, but not admins, and can't touch the owner or another admin.
      await ada.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'set_role', role: 'moderator' }).expect(200);
      await ada.post(`/groups/${g.slug}/members/${chi.id}`, { action: 'set_role', role: 'admin' }).expect(403);
      await ada.post(`/groups/${g.slug}/members/${owner.id}`, { action: 'remove' }).expect(403);
      await ada.post(`/groups/${g.slug}/members/${owner.id}`, { action: 'ban' }).expect(403);
      await ada.post(`/groups/${g.slug}/members/${owner.id}`, { action: 'transfer_ownership' }).expect(403);
      // Moderators answer requests but can't remove people.
      await bola.post(`/groups/${g.slug}/members/${chi.id}`, { action: 'remove' }).expect(403);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      const second = await createMember(t, { name: 'Second Admin' });
      await second.post(`/groups/${g.slug}/join`).expect(200);
      await owner.post(`/groups/${g.slug}/members/${second.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      await ada.post(`/groups/${g.slug}/members/${second.id}`, { action: 'remove' }).expect(403);
      await ada.post(`/groups/${g.slug}/members/${chi.id}`, { action: 'remove' }).expect(200);

      // The members list: owner, admins and moderators first.
      const list = (await bola.get(`/groups/${g.slug}/members`).expect(200)).body as Page<GroupMemberView>;
      expect(list.items.map((m) => m.role)).toEqual(['owner', 'admin', 'admin', 'moderator']);

      // Hand over: the old owner becomes an admin and may leave.
      await owner.post(`/groups/${g.slug}/members/${chi.id}`, { action: 'transfer_ownership' }).expect(422);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'transfer_ownership' }).expect(200);
      const after = (await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(after.membership.role).toBe('admin');
      expect(after.admins[0]).toMatchObject({ member: { id: ada.id }, role: 'owner' });
      await owner.post(`/groups/${g.slug}/leave`).expect(200);
      expect(await memberCount(g.id)).toBe(3);
    });

    it('bulk: approve several requests with per-id results', async () => {
      const g = await makeGroup(owner, { visibility: 'private' });
      await ada.post(`/groups/${g.slug}/join`).expect(200);
      await bola.post(`/groups/${g.slug}/join`).expect(200);
      const res = (await owner.post(`/groups/${g.slug}/members/bulk`, { ids: [ada.id, bola.id, chi.id], action: 'approve' }).expect(200)).body as BulkResult;
      expect(res.done.sort()).toEqual([ada.id, bola.id].sort());
      expect(res.failed).toEqual([{ id: chi.id, error: 'That request was not found' }]);
      expect(await memberCount(g.id)).toBe(3);
    });
  });

  describe('privacy, changes and lists', () => {
    it('private groups are listed with their summary, but members are for members only', async () => {
      const g = await makeGroup(owner, { visibility: 'private', about: 'Secret plans', rules: 'Be kind' });
      await ada.post(`/groups/${g.slug}/join`).expect(200);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'approve' }).expect(200);
      const outsider = (await bola.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(outsider).toMatchObject({ about: 'Secret plans', rules: 'Be kind', memberCount: 2, postsThisWeek: null, connections: null });
      expect(outsider.abilities).toMatchObject({ seeContent: false, post: false, join: 'ask' });
      expect(outsider.admins.map((a) => a.member.id)).toEqual([owner.id]);
      await bola.get(`/groups/${g.slug}/members`).expect(403);
      await bola.get(`/feed?group=${g.slug}`).expect(403);
      expect((await ada.get(`/groups/${g.slug}/members`).expect(200)).body.items).toHaveLength(2);
      // Visitors: public groups only.
      await t.http().get(`/api/v1/groups/${g.slug}`).expect(401);
      await t.http().get(`/api/v1/feed?group=${g.slug}`).expect(401);
      const pub = await makeGroup(owner);
      const visitor = (await t.http().get(`/api/v1/groups/${pub.slug}`).expect(200)).body as GroupDetail;
      expect(visitor.abilities).toMatchObject({ seeContent: true, join: 'none' });
      await t.http().get(`/api/v1/feed?group=${pub.slug}`).expect(200);
      await t.http().get('/api/v1/feed').expect(401);
    });

    it('scopes: mine, managed, requested and suggested; suspended and deleted groups are not listed', async () => {
      const viewer = await createMember(t, { name: 'Scope Viewer', countryCode: 'KE' });
      const mine = await makeGroup(owner, { name: 'Scope Mine' });
      await viewer.post(`/groups/${mine.slug}/join`).expect(200);
      const run = await makeGroup(viewer, { name: 'Scope Run' });
      const asked = await makeGroup(owner, { name: 'Scope Asked', visibility: 'private' });
      await viewer.post(`/groups/${asked.slug}/join`).expect(200);
      const kenya = await makeGroup(owner, { name: 'Scope Kenya', countryCode: 'KE' });
      const featured = await makeGroup(owner, { name: 'Scope Featured' });
      await t.db.update(s.groups).set({ featuredAt: new Date() }).where(eq(s.groups.id, featured.id));
      const suspended = await makeGroup(viewer, { name: 'Scope Suspended' });
      await t.db.update(s.groups).set({ status: 'suspended', statusNote: 'Spam' }).where(eq(s.groups.id, suspended.id));

      const ids = async (q: string) => ((await viewer.get(`/groups?${q}`).expect(200)).body as Page<GroupSummary>).items.map((i) => i.id);
      expect((await ids('scope=mine')).sort()).toEqual([mine.id, run.id].sort());
      expect((await ids('scope=managed')).sort()).toEqual([run.id, suspended.id].sort());
      expect(await ids('scope=requested')).toEqual([asked.id]);
      const suggested = await ids('scope=suggested&limit=50');
      expect(suggested[0]).toBe(featured.id);
      expect(suggested.indexOf(kenya.id)).toBeLessThan(suggested.indexOf(asked.id) === -1 ? Infinity : suggested.indexOf(asked.id));
      expect(suggested).not.toContain(mine.id);
      expect(suggested).not.toContain(asked.id);
      expect(await ids('q=Scope&limit=50')).not.toContain(suspended.id);
      // Suspended: 404 for others, open for its admins with the reason.
      await owner.get(`/groups/${suspended.slug}`).expect(404);
      expect(((await viewer.get(`/groups/${suspended.slug}`).expect(200)).body as GroupDetail).statusNote).toBe('Spam');

      // Cursor paging by name.
      const first = (await viewer.get('/groups?q=Scope&sort=name&limit=2').expect(200)).body as Page<GroupSummary>;
      const next = (await viewer.get(`/groups?q=Scope&sort=name&limit=2&cursor=${first.nextCursor}`).expect(200)).body as Page<GroupSummary>;
      expect([...first.items, ...next.items].map((i) => i.name)).toEqual(['Scope Asked', 'Scope Featured', 'Scope Kenya', 'Scope Mine']);
      await viewer.get('/groups?cursor=bad').expect(400);

      await owner.delete(`/groups/${mine.slug}`).expect(200);
      expect(await ids('scope=mine')).toEqual([run.id]);
      await viewer.get(`/groups/${mine.slug}`).expect(404);
    });

    it('PATCH: admins edit, only the owner archives; archived groups are read-only', async () => {
      const g = await makeGroup(owner);
      await ada.post(`/groups/${g.slug}/join`).expect(200);
      await ada.patch(`/groups/${g.slug}`, { tagline: 'Nope' }).expect(403);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      expect((await ada.patch(`/groups/${g.slug}`, { tagline: 'Updated' }).expect(200)).body.tagline).toBe('Updated');
      await ada.patch(`/groups/${g.slug}`, { archived: true }).expect(403);
      await ada.delete(`/groups/${g.slug}`).expect(403);
      const archived = (await owner.patch(`/groups/${g.slug}`, { archived: true }).expect(200)).body as GroupDetail;
      expect(archived.status).toBe('archived');
      expect(archived.abilities).toMatchObject({ post: false, invite: false, seeContent: true });
      await bola.post(`/groups/${g.slug}/join`).expect(409);
      await owner.post('/posts', { body: 'Still here?', groupId: g.id }).expect(403);
      await ada.patch(`/groups/${g.slug}`, { tagline: 'While archived' }).expect(409);
      expect((await owner.patch(`/groups/${g.slug}`, { archived: false }).expect(200)).body.status).toBe('active');
      await bola.post(`/groups/${g.slug}/join`).expect(200);
    });
  });

  describe('Claude (MCP)', () => {
    it('may list the member’s groups and open one, but not change memberships', async () => {
      expect(MCP_ROUTES.has('GET groups')).toBe(true);
      expect(MCP_ROUTES.has('GET groups/:slug')).toBe(true);
      expect([...MCP_ROUTES].filter((r) => r.includes('groups') && !r.startsWith('GET '))).toEqual([]);

      const m = await createMember(t, { name: 'Claude User' });
      await admin.put(`/admin/members/${m.id}/mcp-access`, { enabled: true }).expect(200);
      const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
      const reg = await t.http().post('/api/v1/oauth/register').send({ redirect_uris: [REDIRECT] }).expect(201);
      const verifier = randomBytes(32).toString('base64url');
      const auth = await m
        .post('/oauth/authorize', {
          response_type: 'code',
          client_id: reg.body.client_id,
          redirect_uri: REDIRECT,
          code_challenge: s256(verifier),
          code_challenge_method: 'S256',
          state: 'x',
          approve: true,
        })
        .expect(200);
      const code = new URL(auth.body.redirectTo as string).searchParams.get('code')!;
      const token = await t
        .http()
        .post('/api/v1/oauth/token')
        .type('form')
        .send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.body.client_id, code_verifier: verifier })
        .expect(200);
      const bearer = (r: ReturnType<ReturnType<TestApp['http']>['get']>) => r.set('Authorization', `Bearer ${token.body.access_token}`).set('X-CM-CSRF', '1');

      const g = await makeGroup(owner, { name: 'Claude Readers' });
      await m.post(`/groups/${g.slug}/join`).expect(200);
      const mine = await bearer(t.http().get('/api/v1/groups?scope=mine')).expect(200);
      expect(mine.body.items.map((i: GroupSummary) => i.slug)).toEqual(['claude-readers']);
      expect((await bearer(t.http().get(`/api/v1/groups/${g.slug}`)).expect(200)).body.abilities.post).toBe(true);
      await bearer(t.http().post(`/api/v1/groups/${g.slug}/leave`)).expect(403);
      await bearer(t.http().post('/api/v1/posts')).send({ body: 'From Claude, in my group', groupId: g.id }).expect(201);
      const [row] = await t.db.select().from(s.posts).where(and(eq(s.posts.groupId, g.id), eq(s.posts.authorId, m.id)));
      expect(row?.source).toBe('claude');
    });
  });
});
