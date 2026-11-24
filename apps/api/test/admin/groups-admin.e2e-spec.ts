import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminGroupDetail, AdminGroupMember, AdminGroupRow, AdminGroupsPage, AdminMemberOverview, AdminPageRow, AdminReportDetail, BulkResult, Page } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

/*
 * Groups in the admin console. The member-facing groups API is built in parallel, so groups, their
 * members and posts are written straight to the database here.
 */

type Member = Awaited<ReturnType<typeof createMember>>;

const MISSING = '00000000-0000-4000-8000-000000000099';
const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));

async function auditRows(t: TestApp, action: string, targetId: string) {
  return t.db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.action, action), eq(s.auditLog.targetId, targetId)));
}

async function notificationsFor(t: TestApp, userId: string, type: string) {
  return t.db
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type)));
}

async function insertGroup(
  t: TestApp,
  values: Partial<typeof s.groups.$inferInsert> & { name: string; slug: string },
  people: { user: Member; role?: 'owner' | 'admin' | 'moderator' | 'member'; status?: 'active' | 'pending' | 'invited' | 'banned'; answer?: string }[] = [],
) {
  const [group] = await t.db
    .insert(s.groups)
    .values({ memberCount: people.filter((p) => (p.status ?? 'active') === 'active').length, ...values })
    .returning();
  if (people.length) {
    await t.db.insert(s.groupMembers).values(
      people.map((p) => ({
        groupId: group!.id,
        userId: p.user.id,
        role: p.role ?? 'member',
        status: p.status ?? 'active',
        requestAnswer: p.answer ?? null,
        joinedAt: (p.status ?? 'active') === 'active' ? new Date() : null,
      })),
    );
  }
  return group!;
}

describe('Admin console: groups', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let amara: Member;
  let leila: Member;
  let kofi: Member;
  let zara: Member;
  let chapterId: string;
  let page: AdminPageRow;
  const g: Record<string, typeof s.groups.$inferSelect> = {};
  let privatePostId: string;
  let publicPostId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    amara = await createMember(t, { name: 'Amara Okafor', email: 'amara@example.test' });
    leila = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });
    kofi = await createMember(t, { name: 'Kofi Mensah', countryCode: 'GH' });
    zara = await createMember(t, { name: '=Abebe Formula' });
    const [chapter] = await t.db.select().from(s.chapters).limit(1);
    chapterId = chapter!.id;
    page = (await admin.post('/admin/pages', { name: 'Baobab Ventures', category: 'company', owner: leila.email }).expect(201)).body as AdminPageRow;

    // Agri Founders: public, member-run, 3 members, featured, oldest.
    g.agri = await insertGroup(
      t,
      { name: 'Agri Founders', slug: 'agri-founders', visibility: 'public', createdBy: amara.id, createdAt: day(1), lastPostAt: day(20), featuredAt: day(2) },
      [{ user: amara, role: 'owner' }, { user: leila, role: 'admin' }, { user: kofi }, { user: zara, status: 'pending', answer: '=SUM(1,2)' }],
    );
    // Lagos Builders: private, member-run, 2 members.
    g.lagos = await insertGroup(
      t,
      { name: 'Lagos Builders', slug: 'lagos-builders', visibility: 'private', createdBy: kofi.id, createdAt: day(5), lastPostAt: day(22) },
      [{ user: kofi, role: 'owner' }, { user: amara, role: 'moderator' }],
    );
    // Baobab Investors Circle: public, page-run, 1 member.
    g.page = await insertGroup(
      t,
      { name: 'Baobab Investors Circle', slug: 'baobab-investors', visibility: 'public', ownerType: 'page', pageId: page.id, createdBy: leila.id, createdAt: day(8) },
      [{ user: leila, role: 'admin' }],
    );
    // Chapter group: private, chapter-run, no members, archived.
    g.chapter = await insertGroup(t, {
      name: 'Chapter Mentors',
      slug: 'chapter-mentors',
      visibility: 'private',
      ownerType: 'chapter',
      chapterId,
      createdBy: admin.id,
      createdAt: day(10),
      status: 'archived',
    });

    const [priv] = await t.db.insert(s.posts).values({ authorId: kofi.id, body: 'Members only: site visit on Friday', groupId: g.lagos.id, visibility: 'group' }).returning();
    const [pub] = await t.db.insert(s.posts).values({ authorId: kofi.id, body: 'Harvest prices this week', groupId: g.agri.id, visibility: 'members' }).returning();
    privatePostId = priv!.id;
    publicPostId = pub!.id;
  });
  afterAll(() => t.close());

  describe('permissions', () => {
    it('moderators can look but not act; members get 403', async () => {
      await amara.get('/admin/groups').expect(403);
      await amara.get(`/admin/groups/${g.agri.id}`).expect(403);
      await mod.get('/admin/groups').expect(200);
      await mod.get(`/admin/groups/${g.lagos.id}`).expect(200);
      await mod.get(`/admin/groups/${g.lagos.id}/members`).expect(200);
      await mod.post(`/admin/groups/${g.agri.id}`, { action: 'feature' }).expect(403);
      await mod.post('/admin/groups/bulk', { ids: [g.agri.id], action: 'feature' }).expect(403);
      await mod.get(`/admin/groups/${g.agri.id}/members/export.csv`).expect(403);
      await mod.get('/admin/settings/groups').expect(403);
      await mod.put('/admin/settings/groups', { whoCanCreate: 'staff', maxOwnedPerMember: 3 }).expect(403);
      await amara.post(`/admin/groups/${g.agri.id}`, { action: 'feature' }).expect(403);
    });

    it('404s for unknown groups and 422s for bad input', async () => {
      await admin.get(`/admin/groups/${MISSING}`).expect(404);
      await admin.get('/admin/groups/nope').expect(404);
      await admin.post(`/admin/groups/${MISSING}`, { action: 'feature' }).expect(404);
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'suspend' }).expect(422);
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'launch' }).expect(422);
      await admin.get('/admin/groups?sort=random').expect(422);
      await admin.get('/admin/groups?cursor=bm9wZQ').expect(400);
    });
  });

  const names = (page: AdminGroupsPage) => page.items.map((r) => r.name);

  describe('list', () => {

    it('lists groups newest first with counts, owners and activity', async () => {
      const res = (await admin.get('/admin/groups').expect(200)).body as AdminGroupsPage;
      expect(names(res)).toEqual(['Chapter Mentors', 'Baobab Investors Circle', 'Lagos Builders', 'Agri Founders']);
      expect(res.counts).toEqual({ all: 4, active: 3, suspended: 0, archived: 1, deleted: 0, private: 2, public: 2 });
      const agri = res.items.find((r) => r.id === g.agri.id)!;
      expect(agri).toMatchObject({
        slug: 'agri-founders',
        visibility: 'public',
        ownerType: 'member',
        status: 'active',
        featured: true,
        memberCount: 3,
        pendingRequests: 1,
        postsLast30Days: 1,
        openReports: 0,
        page: null,
        chapter: null,
      });
      expect(agri.owner?.id).toBe(amara.id);
      const pageGroup = res.items.find((r) => r.id === g.page.id)!;
      expect(pageGroup.page?.slug).toBe(page.slug);
      expect(pageGroup.owner).toBeNull();
      expect(res.items.find((r) => r.id === g.chapter.id)!.chapter?.id).toBe(chapterId);
    });

    it('filters by status tab, visibility, who runs it, chapter and featured', async () => {
      expect(names((await admin.get('/admin/groups?status=archived').expect(200)).body)).toEqual(['Chapter Mentors']);
      expect(names((await admin.get('/admin/groups?visibility=private').expect(200)).body)).toEqual(['Chapter Mentors', 'Lagos Builders']);
      const priv = (await admin.get('/admin/groups?visibility=private').expect(200)).body as AdminGroupsPage;
      expect(priv.counts).toMatchObject({ all: 2, active: 1, archived: 1, private: 2, public: 2 });
      expect(names((await admin.get('/admin/groups?ownerType=page').expect(200)).body)).toEqual(['Baobab Investors Circle']);
      expect(names((await admin.get(`/admin/groups?chapter=${chapterId}`).expect(200)).body)).toEqual(['Chapter Mentors']);
      expect(names((await admin.get('/admin/groups?featured=yes').expect(200)).body)).toEqual(['Agri Founders']);
      expect(names((await admin.get('/admin/groups?featured=no&sort=name').expect(200)).body)).toEqual(['Baobab Investors Circle', 'Chapter Mentors', 'Lagos Builders']);
    });

    it('searches by name, slug, owner name and owner email', async () => {
      expect(names((await admin.get('/admin/groups?q=builders').expect(200)).body)).toEqual(['Lagos Builders']);
      expect(names((await admin.get('/admin/groups?q=baobab-inv').expect(200)).body)).toEqual(['Baobab Investors Circle']);
      expect(names((await admin.get('/admin/groups?q=Kofi').expect(200)).body)).toEqual(['Lagos Builders']);
      expect(names((await admin.get('/admin/groups?q=amara@example').expect(200)).body)).toEqual(['Agri Founders']);
      expect(names((await admin.get('/admin/groups?q=100%25_').expect(200)).body)).toEqual([]);
    });

    it('sorts by members, name and activity, and pages with cursors', async () => {
      expect(names((await admin.get('/admin/groups?sort=members').expect(200)).body)).toEqual(['Agri Founders', 'Lagos Builders', 'Baobab Investors Circle', 'Chapter Mentors']);
      expect(names((await admin.get('/admin/groups?sort=name').expect(200)).body)).toEqual(['Agri Founders', 'Baobab Investors Circle', 'Chapter Mentors', 'Lagos Builders']);
      // Groups without posts come last (in no particular order between themselves).
      expect(names((await admin.get('/admin/groups?sort=activity').expect(200)).body).slice(0, 2)).toEqual(['Lagos Builders', 'Agri Founders']);
      for (const sort of ['newest', 'members', 'name', 'activity', 'reports']) {
        const all = names((await admin.get(`/admin/groups?sort=${sort}`).expect(200)).body);
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const res: AdminGroupsPage = (await admin.get(`/admin/groups?sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).expect(200)).body;
          seen.push(...names(res));
          cursor = res.nextCursor;
        } while (cursor);
        expect(seen).toEqual(all);
      }
    });

    it('finds reported groups and sorts by open reports', async () => {
      // A report on Lagos Builders' post, two on Baobab Investors Circle itself.
      await t.db.insert(s.contentReports).values([
        { reporterId: amara.id, targetType: 'post', targetId: privatePostId, targetUserId: kofi.id, reasonCode: 'spam' },
        { reporterId: amara.id, targetType: 'group', targetId: g.page.id, reasonCode: 'scam' },
        { reporterId: kofi.id, targetType: 'group', targetId: g.page.id, reasonCode: 'spam' },
      ]);
      const reported = (await admin.get('/admin/groups?reported=yes&sort=reports').expect(200)).body as AdminGroupsPage;
      expect(names(reported)).toEqual(['Baobab Investors Circle', 'Lagos Builders']);
      expect(reported.items.map((r) => r.openReports)).toEqual([2, 1]);
      expect(reported.counts.all).toBe(2);
      // Clean up so later tests start from no reports.
      await t.db.delete(s.contentReports);
    });
  });

  describe('detail and members', () => {
    it('shows settings, admins and recent posts, private ones marked', async () => {
      const detail = (await mod.get(`/admin/groups/${g.lagos.id}`).expect(200)).body as AdminGroupDetail;
      expect(detail.name).toBe('Lagos Builders');
      expect(detail.admins.map((a) => [a.member.id, a.role])).toEqual([
        [kofi.id, 'owner'],
        [amara.id, 'moderator'],
      ]);
      expect(detail.recentPosts).toHaveLength(1);
      expect(detail.recentPosts[0]).toMatchObject({ id: privatePostId, private: true, preview: 'Members only: site visit on Friday', deleted: false });
      const agri = (await admin.get(`/admin/groups/${g.agri.id}`).expect(200)).body as AdminGroupDetail;
      expect(agri.recentPosts[0]).toMatchObject({ id: publicPostId, private: false });
      expect(agri.history).toEqual([]);
    });

    it('lists members with filters, search and paging', async () => {
      const all = (await mod.get(`/admin/groups/${g.agri.id}/members`).expect(200)).body as Page<AdminGroupMember>;
      expect(all.items.map((m) => [m.member.name, m.role, m.status])).toEqual([
        ['Amara Okafor', 'owner', 'active'],
        ['Leila Benali', 'admin', 'active'],
        ['=Abebe Formula', 'member', 'pending'],
        ['Kofi Mensah', 'member', 'active'],
      ]);
      expect(all.items[0]!.email).toBe('amara@example.test');
      const pending = (await admin.get(`/admin/groups/${g.agri.id}/members?status=pending`).expect(200)).body as Page<AdminGroupMember>;
      expect(pending.items.map((m) => [m.member.id, m.requestAnswer])).toEqual([[zara.id, '=SUM(1,2)']]);
      expect((await admin.get(`/admin/groups/${g.agri.id}/members?role=admin`).expect(200)).body.items).toHaveLength(1);
      expect((await admin.get(`/admin/groups/${g.agri.id}/members?q=kofi`).expect(200)).body.items.map((m: AdminGroupMember) => m.member.id)).toEqual([kofi.id]);
      const first = (await admin.get(`/admin/groups/${g.agri.id}/members?limit=3`).expect(200)).body as Page<AdminGroupMember>;
      const rest = (await admin.get(`/admin/groups/${g.agri.id}/members?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`).expect(200)).body as Page<AdminGroupMember>;
      expect([...first.items, ...rest.items].map((m) => m.member.id)).toEqual(all.items.map((m) => m.member.id));
      expect(rest.nextCursor).toBeNull();
    });

    it('exports members as CSV with formula-safe cells, audited', async () => {
      const res = await admin.get(`/admin/groups/${g.agri.id}/members/export.csv`).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('group-agri-founders-members');
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe('name,handle,email,role,status,joined_at,since,invited_by,request_answer');
      expect(lines).toHaveLength(5);
      const zaraLine = lines.find((l) => l.includes(zara.email))!;
      expect(zaraLine.startsWith("'=Abebe Formula,")).toBe(true);
      expect(zaraLine).toContain(`"'=SUM(1,2)"`);
      expect(await auditRows(t, 'group.members_exported', g.agri.id)).toHaveLength(1);
      const filtered = await admin.get(`/admin/groups/${g.agri.id}/members/export.csv?status=pending`).expect(200);
      expect(filtered.text.trim().split('\r\n')).toHaveLength(2);
    });
  });

  describe('actions', () => {
    it('features and unfeatures active groups', async () => {
      const row = (await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'feature' }).expect(200)).body as AdminGroupRow;
      expect(row.featured).toBe(true);
      await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'feature' }).expect(409);
      await admin.post(`/admin/groups/${g.chapter.id}`, { action: 'feature' }).expect(409);
      expect((await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'unfeature' }).expect(200)).body.featured).toBe(false);
      await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'unfeature' }).expect(409);
      expect(await auditRows(t, 'group.featured', g.lagos.id)).toHaveLength(1);
      expect(await auditRows(t, 'group.unfeatured', g.lagos.id)).toHaveLength(1);
    });

    it('suspends a group: hidden from members, its admins told with the note, audited; then restores it', async () => {
      const res = (await admin.post(`/admin/groups/${g.agri.id}`, { action: 'suspend', note: 'Selling fake fertiliser' }).expect(200)).body as AdminGroupRow;
      expect(res).toMatchObject({ status: 'suspended', statusNote: 'Selling fake fertiliser', featured: false });
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'suspend', note: 'Again please' }).expect(409);
      expect(await auditRows(t, 'group.suspended', g.agri.id)).toHaveLength(1);

      // Owner and admin hear about it (with the note); plain members don't.
      const [toOwner] = await notificationsFor(t, amara.id, 'group_status');
      expect(toOwner).toBeDefined();
      expect(JSON.stringify(toOwner!.data)).toContain('Selling fake fertiliser');
      expect(await notificationsFor(t, leila.id, 'group_status')).toHaveLength(1);
      expect(await notificationsFor(t, kofi.id, 'group_status')).toHaveLength(0);

      // Its post is gone for members (even its author), but staff still read it here.
      await kofi.get(`/posts/${publicPostId}`).expect(404);
      await leila.get(`/posts/${publicPostId}`).expect(404);
      const detail = (await mod.get(`/admin/groups/${g.agri.id}`).expect(200)).body as AdminGroupDetail;
      expect(detail.recentPosts.map((p) => p.id)).toEqual([publicPostId]);
      expect(detail.history.map((h) => h.action)).toContain('group.suspended');
      expect(detail.history.find((h) => h.action === 'group.suspended')!.summary).toMatch(/^Suspended group/);

      const counts = ((await admin.get('/admin/groups').expect(200)).body as AdminGroupsPage).counts;
      expect(counts).toMatchObject({ active: 2, suspended: 1 });

      const restored = (await admin.post(`/admin/groups/${g.agri.id}`, { action: 'restore' }).expect(200)).body as AdminGroupRow;
      expect(restored).toMatchObject({ status: 'active', statusNote: null });
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'restore' }).expect(409);
      expect(await auditRows(t, 'group.restored', g.agri.id)).toHaveLength(1);
      expect(await notificationsFor(t, amara.id, 'group_status')).toHaveLength(2);
    });

    it('page groups: the page’s admins are told', async () => {
      await admin.post(`/admin/groups/${g.page.id}`, { action: 'suspend', note: 'Investment scam reports' }).expect(200);
      // Leila owns the page and is a group admin: one notification, not two (two came from Agri Founders).
      expect(await notificationsFor(t, leila.id, 'group_status')).toHaveLength(3);
      await admin.post(`/admin/groups/${g.page.id}`, { action: 'restore' }).expect(200);
    });

    it('changes the owner of a member-run group; the old owner stays as an admin', async () => {
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'set_owner', memberId: MISSING }).expect(422);
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'set_owner', memberId: zara.id }).expect(422); // pending
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'set_owner', memberId: amara.id }).expect(409); // already owner
      await admin.post(`/admin/groups/${g.page.id}`, { action: 'set_owner', memberId: leila.id }).expect(422); // page group
      const row = (await admin.post(`/admin/groups/${g.agri.id}`, { action: 'set_owner', memberId: kofi.id }).expect(200)).body as AdminGroupRow;
      expect(row.owner?.id).toBe(kofi.id);
      const roles = await t.db.select({ userId: s.groupMembers.userId, role: s.groupMembers.role }).from(s.groupMembers).where(eq(s.groupMembers.groupId, g.agri.id));
      expect(Object.fromEntries(roles.map((r) => [r.userId, r.role]))).toMatchObject({ [kofi.id]: 'owner', [amara.id]: 'admin', [leila.id]: 'admin' });
      const [entry] = await auditRows(t, 'group.owner_changed', g.agri.id);
      expect(entry!.after).toEqual({ ownerId: kofi.id });
      expect(entry!.before).toMatchObject({ ownerIds: [amara.id] });
      expect(await notificationsFor(t, kofi.id, 'group_role_changed')).toHaveLength(1);
      expect(await notificationsFor(t, amara.id, 'group_role_changed')).toHaveLength(1);
    });

    it('deletes a group (soft): its posts vanish, admins told; it can be restored', async () => {
      const row = (await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'delete', note: 'Spam ring' }).expect(200)).body as AdminGroupRow;
      expect(row.status).toBe('deleted');
      expect((await t.db.select().from(s.groups).where(eq(s.groups.id, g.lagos.id)))[0]!.deletedAt).not.toBeNull();
      await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'delete' }).expect(409);
      await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'feature' }).expect(409);
      expect(await auditRows(t, 'group.deleted', g.lagos.id)).toHaveLength(1);
      expect(await notificationsFor(t, kofi.id, 'group_status')).toHaveLength(1);
      await kofi.get(`/posts/${privatePostId}`).expect(404);

      const list = (await admin.get('/admin/groups?status=deleted').expect(200)).body as AdminGroupsPage;
      expect(names(list)).toEqual(['Lagos Builders']);
      expect(list.counts).toMatchObject({ all: 3, deleted: 1 });
      expect(names((await admin.get('/admin/groups').expect(200)).body)).not.toContain('Lagos Builders');

      const back = (await admin.post(`/admin/groups/${g.lagos.id}`, { action: 'restore' }).expect(200)).body as AdminGroupRow;
      expect(back.status).toBe('active');
      expect(await auditRows(t, 'group.restored', g.lagos.id)).toHaveLength(1);
    });

    it('bulk: each group on its own, failures reported', async () => {
      await admin.post('/admin/groups/bulk', { ids: [g.agri.id], action: 'suspend' }).expect(422);
      // Agri Founders lost its feature when it was suspended.
      const res = (await admin.post('/admin/groups/bulk', { ids: [g.agri.id, g.chapter.id, MISSING, 'nope'], action: 'feature' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([g.agri.id]);
      expect(res.failed).toEqual([
        { id: g.chapter.id, error: 'Only active groups can be featured' },
        { id: MISSING, error: 'That group was not found' },
        { id: 'nope', error: 'That group was not found' },
      ]);
      const suspended = (await admin.post('/admin/groups/bulk', { ids: [g.agri.id, g.lagos.id, g.chapter.id], action: 'suspend', note: 'Coordinated spam' }).expect(200)).body as BulkResult;
      expect(suspended).toEqual({ done: [g.agri.id, g.lagos.id, g.chapter.id], failed: [] });
      const again = (await admin.post('/admin/groups/bulk', { ids: [g.agri.id, g.page.id], action: 'restore' }).expect(200)).body as BulkResult;
      expect(again).toEqual({ done: [g.agri.id], failed: [{ id: g.page.id, error: 'Only suspended or deleted groups can be restored' }] });
      await admin.post('/admin/groups/bulk', { ids: [g.lagos.id], action: 'restore' }).expect(200);
      // Archived groups come back active after a suspension.
      await admin.post('/admin/groups/bulk', { ids: [g.chapter.id], action: 'restore' }).expect(200);
      expect(await auditRows(t, 'group.suspended', g.chapter.id)).toHaveLength(1);
    });
  });

  describe('settings', () => {
    it('reads and saves who can create groups (settings.manage), audited', async () => {
      expect((await admin.get('/admin/settings/groups').expect(200)).body).toEqual({ whoCanCreate: 'everyone', maxOwnedPerMember: 10 });
      await admin.put('/admin/settings/groups', { whoCanCreate: 'admins', maxOwnedPerMember: 3 }).expect(422);
      await admin.put('/admin/settings/groups', { whoCanCreate: 'verified', maxOwnedPerMember: 0 }).expect(422);
      expect((await admin.put('/admin/settings/groups', { whoCanCreate: 'verified', maxOwnedPerMember: 3 }).expect(200)).body).toEqual({ whoCanCreate: 'verified', maxOwnedPerMember: 3 });
      expect((await admin.get('/admin/settings/groups').expect(200)).body).toEqual({ whoCanCreate: 'verified', maxOwnedPerMember: 3 });
      expect(await auditRows(t, 'settings.groups_updated', 'groups')).toHaveLength(1);
    });
  });

  describe('reports', () => {
    it('members report a group; it shows in the queue with a card; suspending closes the report', async () => {
      // The owner can't report their own group; unknown groups are 404.
      await kofi.post('/reports', { targetType: 'group', targetId: g.agri.id, reason: 'spam' }).expect(422);
      await amara.post('/reports', { targetType: 'group', targetId: MISSING, reason: 'spam' }).expect(404);
      const created = (await zara.post('/reports', { targetType: 'group', targetId: g.agri.id, reason: 'scam', detail: 'Asks for upfront fees' }).expect(201)).body;
      expect(created.nextSteps).toContain('leave it');

      const queue = (await mod.get('/admin/reports?targetType=group').expect(200)).body;
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0].target).toMatchObject({ type: 'group', id: g.agri.id, preview: 'Agri Founders' });
      const detail = (await mod.get(`/admin/reports/${created.id}`).expect(200)).body as AdminReportDetail;
      expect(detail.group).toMatchObject({ id: g.agri.id, slug: 'agri-founders', visibility: 'public', status: 'active', memberCount: 3 });
      expect(detail.content.href).toBe('/groups/agri-founders');
      expect(detail.author?.id).toBe(kofi.id);

      expect((await admin.get('/admin/groups?reported=yes').expect(200)).body.items.map((r: AdminGroupRow) => r.id)).toEqual([g.agri.id]);
      expect(((await admin.get(`/admin/groups/${g.agri.id}`).expect(200)).body as AdminGroupDetail).reports).toMatchObject([
        { id: created.id, target: { type: 'group', id: g.agri.id }, reason: 'scam', detail: 'Asks for upfront fees' },
      ]);

      // Hiding or suspending through the generic moderation action is refused: groups are suspended from Groups.
      await mod.post(`/admin/reports/${created.id}/actions`, { action: 'hide', reason: 'Scam group' }).expect(422);
      await mod.post(`/admin/reports/${created.id}/actions`, { action: 'suspend', reason: 'Scam group' }).expect(422);

      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'suspend', note: 'Advance-fee scam' }).expect(200);
      const [report] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, created.id));
      expect(report!.status).toBe('actioned');
      expect(await notificationsFor(t, zara.id, 'report_outcome')).toHaveLength(1);
      expect((await admin.get('/admin/groups?reported=yes').expect(200)).body.items).toEqual([]);
      const [entry] = await auditRows(t, 'group.suspended', g.agri.id).then((rows) => rows.slice(-1));
      expect(entry!.after).toMatchObject({ reportIds: [created.id] });

      // A suspended group can't be reported.
      await leila.post('/reports', { targetType: 'group', targetId: g.agri.id, reason: 'spam' }).expect(404);
      await admin.post(`/admin/groups/${g.agri.id}`, { action: 'restore' }).expect(200);
    });

    it('a group report can be dismissed', async () => {
      const created = (await amara.post('/reports', { targetType: 'group', targetId: g.lagos.id, reason: 'other' }).expect(201)).body;
      await mod.post(`/admin/reports/${created.id}/actions`, { action: 'dismiss', reason: 'Nothing against the rules' }).expect(201);
      const [report] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, created.id));
      expect(report!.status).toBe('dismissed');
    });
  });

  describe('member overview', () => {
    it('lists the groups a member owns or runs', async () => {
      const overview = (await admin.get(`/admin/members/${amara.id}/overview`).expect(200)).body as AdminMemberOverview;
      expect(overview.groups?.total).toBe(1);
      expect(overview.groups?.items.map((i) => [i.name, i.role])).toEqual([['Agri Founders', 'admin']]);
      const kofiOverview = (await admin.get(`/admin/members/${kofi.id}/overview`).expect(200)).body as AdminMemberOverview;
      expect(kofiOverview.groups?.items.map((i) => [i.name, i.role])).toEqual([
        ['Lagos Builders', 'owner'],
        ['Agri Founders', 'owner'],
      ]);
    });
  });
});
