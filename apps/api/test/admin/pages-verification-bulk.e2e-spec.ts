import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminPageRow, AdminVerificationRow, BulkResult } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const MISSING = '00000000-0000-4000-8000-000000000099';

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

describe('Admin batch actions: pages and verification requests', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let member: Member;
  let leila: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Amara Okafor', countryCode: 'NG' });
    leila = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });
  });
  afterAll(() => t.close());

  describe('pages', () => {
    const created: Record<string, AdminPageRow> = {};

    beforeAll(async () => {
      for (const [name, category, verified] of [
        ['Atlas Media', 'media', false],
        ['Baobab Ventures', 'company', true],
        ['Cedar Collective', 'community', false],
      ] as const) {
        const res = await admin.post('/admin/pages', { name, category, owner: leila.email, verified }).expect(201);
        created[name] = res.body as AdminPageRow;
      }
      // Followers: Cedar 2, Baobab 1, Atlas 0.
      await t.db.insert(s.follows).values([
        { followerId: member.id, targetType: 'page', targetId: created['Cedar Collective']!.id },
        { followerId: admin.id, targetType: 'page', targetId: created['Cedar Collective']!.id },
        { followerId: member.id, targetType: 'page', targetId: created['Baobab Ventures']!.id },
      ]);
    });

    it('needs pages.manage in an admin session', async () => {
      const body = { ids: [created['Atlas Media']!.id], action: 'verify' };
      await member.post('/admin/pages/bulk', body).expect(403);
      await mod.post('/admin/pages/bulk', body).expect(403);
      await admin.post('/admin/pages/bulk', { ids: [], action: 'verify' }).expect(422);
      await admin.post('/admin/pages/bulk', { ids: [created['Atlas Media']!.id], action: 'suspend' }).expect(422);
    });

    it('filters by kind and tick, and sorts by name or followers', async () => {
      const names = (rows: AdminPageRow[]) => rows.map((p) => p.name);
      const byName = (await admin.get('/admin/pages?sort=name').expect(200)).body.items as AdminPageRow[];
      expect(names(byName)).toEqual(['Atlas Media', 'Baobab Ventures', 'Cedar Collective']);
      const byFollowers = (await admin.get('/admin/pages?sort=followers').expect(200)).body.items as AdminPageRow[];
      expect(names(byFollowers)).toEqual(['Cedar Collective', 'Baobab Ventures', 'Atlas Media']);
      expect(names((await admin.get('/admin/pages?category=company').expect(200)).body.items)).toEqual(['Baobab Ventures']);
      expect(names((await admin.get('/admin/pages?verified=yes').expect(200)).body.items)).toEqual(['Baobab Ventures']);
      expect(names((await admin.get('/admin/pages?verified=no&sort=name').expect(200)).body.items)).toEqual(['Atlas Media', 'Cedar Collective']);

      // Paging keeps the order.
      const first = (await admin.get('/admin/pages?sort=followers&limit=2').expect(200)).body;
      expect(names(first.items)).toEqual(['Cedar Collective', 'Baobab Ventures']);
      const rest = (await admin.get(`/admin/pages?sort=followers&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`).expect(200)).body;
      expect(names(rest.items)).toEqual(['Atlas Media']);
      const firstByName = (await admin.get('/admin/pages?sort=name&limit=1').expect(200)).body;
      const nextByName = (await admin.get(`/admin/pages?sort=name&limit=1&cursor=${encodeURIComponent(firstByName.nextCursor)}`).expect(200)).body;
      expect(names(nextByName.items)).toEqual(['Baobab Ventures']);
    });

    it('verifies several pages, and reports the ones that could not be', async () => {
      const atlas = created['Atlas Media']!.id;
      const baobab = created['Baobab Ventures']!.id;
      const res = (await admin.post('/admin/pages/bulk', { ids: [atlas, baobab, MISSING, 'nope'], action: 'verify' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([atlas]);
      expect(res.failed).toEqual([
        { id: baobab, error: 'Already verified' },
        { id: MISSING, error: 'That page was not found' },
        { id: 'nope', error: 'That page was not found' },
      ]);
      const [row] = await t.db.select().from(s.pages).where(eq(s.pages.id, atlas));
      expect(row!.verifiedAt).not.toBeNull();
      expect(await auditRows(t, 'page.updated', atlas)).toHaveLength(1);

      const removed = (await admin.post('/admin/pages/bulk', { ids: [atlas, created['Cedar Collective']!.id], action: 'unverify' }).expect(200)).body as BulkResult;
      expect(removed.done).toEqual([atlas]);
      expect(removed.failed).toEqual([{ id: created['Cedar Collective']!.id, error: 'Not verified' }]);
      expect((await t.db.select().from(s.pages).where(eq(s.pages.id, atlas)))[0]!.verifiedAt).toBeNull();
    });

    it('suspends and restores like the single action: admins told, note kept, audited', async () => {
      const atlas = created['Atlas Media']!.id;
      const cedar = created['Cedar Collective']!.id;
      const res = (await admin.post('/admin/pages/bulk', { ids: [atlas, cedar], action: 'suspend', note: 'Impersonation reports' }).expect(200)).body as BulkResult;
      expect(res).toEqual({ done: [atlas, cedar], failed: [] });
      const rows = await t.db.select().from(s.pages).where(eq(s.pages.status, 'suspended'));
      expect(rows.map((r) => r.id).sort()).toEqual([atlas, cedar].sort());
      expect(rows.every((r) => r.reviewNote === 'Impersonation reports')).toBe(true);
      expect(await notificationsFor(t, leila.id, 'page_rejected')).toHaveLength(2);
      expect(await auditRows(t, 'page.suspend', atlas)).toHaveLength(1);

      const again = (await admin.post('/admin/pages/bulk', { ids: [atlas], action: 'suspend', note: 'Again' }).expect(200)).body as BulkResult;
      expect(again).toEqual({ done: [], failed: [{ id: atlas, error: 'Only live pages can be suspended' }] });

      const restored = (await admin.post('/admin/pages/bulk', { ids: [atlas, created['Baobab Ventures']!.id], action: 'restore' }).expect(200)).body as BulkResult;
      expect(restored.done).toEqual([atlas]);
      expect(restored.failed).toEqual([{ id: created['Baobab Ventures']!.id, error: 'Only suspended pages can be restored' }]);
      expect((await t.db.select().from(s.pages).where(eq(s.pages.id, atlas)))[0]!.status).toBe('active');
      expect(await auditRows(t, 'page.restore', atlas)).toHaveLength(1);
    });

    it('deletes pages with their followers', async () => {
      const cedar = created['Cedar Collective']!.id;
      const res = (await admin.post('/admin/pages/bulk', { ids: [cedar, MISSING], action: 'delete' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([cedar]);
      expect(res.failed).toEqual([{ id: MISSING, error: 'That page was not found' }]);
      expect(await t.db.select().from(s.pages).where(eq(s.pages.id, cedar))).toHaveLength(0);
      expect(await t.db.select().from(s.follows).where(eq(s.follows.targetId, cedar))).toHaveLength(0);
      expect(await auditRows(t, 'page.deleted', cedar)).toHaveLength(1);
    });
  });

  describe('verification requests', () => {
    const APPLICATION = {
      category: 'individual',
      legalName: 'Legal Name',
      statement: 'I run a business and members ask whether this account is really mine, so I would like the tick.',
      links: ['https://example.test/me'],
    };
    let kofi: Member;
    let zara: Member;
    let ids: { kofi: string; zara: string; page: string; pageId: string };

    beforeAll(async () => {
      kofi = await createMember(t, { name: 'Kofi Boateng', countryCode: 'GH' });
      zara = await createMember(t, { name: 'Zara Mwangi', countryCode: 'KE' });
      const page = (await admin.post('/admin/pages', { name: 'Nairobi Makers', category: 'community', owner: zara.email }).expect(201)).body as AdminPageRow;
      const day = 86_400_000;
      const insert = async (values: Partial<typeof s.verificationRequests.$inferInsert> & { userId: string; createdAt: Date }) =>
        (await t.db
          .insert(s.verificationRequests)
          .values({ subjectType: 'member', ...APPLICATION, ...values })
          .returning())[0]!.id;
      ids = {
        kofi: await insert({ userId: kofi.id, legalName: 'Kofi Boateng', createdAt: new Date(Date.now() - 3 * day) }),
        zara: await insert({ userId: zara.id, legalName: 'Zara Mwangi', createdAt: new Date(Date.now() - 2 * day) }),
        page: await insert({ userId: zara.id, pageId: page.id, subjectType: 'page', category: 'organisation', legalName: 'Nairobi Makers Ltd', createdAt: new Date(Date.now() - day) }),
        pageId: page.id,
      };
    });

    it('searches, filters by type and sorts', async () => {
      const list = async (query: string) => ((await admin.get(`/admin/verification${query}`).expect(200)).body.items as AdminVerificationRow[]).map((r) => r.id);
      expect(await list('')).toEqual([ids.kofi, ids.zara, ids.page]);
      expect(await list('?sort=newest')).toEqual([ids.page, ids.zara, ids.kofi]);
      expect(await list('?type=page')).toEqual([ids.page]);
      expect(await list('?type=member')).toEqual([ids.kofi, ids.zara]);
      expect(await list(`?q=${encodeURIComponent(kofi.email)}`)).toEqual([ids.kofi]);
      expect(await list('?q=zara')).toEqual([ids.zara, ids.page]);
      expect(await list('?q=makers')).toEqual([ids.page]);
    });

    it('needs members.manage in an admin session; declining needs a note', async () => {
      await member.post('/admin/verification/bulk', { ids: [ids.kofi], action: 'approve' }).expect(403);
      await mod.post('/admin/verification/bulk', { ids: [ids.kofi], action: 'approve' }).expect(403);
      await admin.post('/admin/verification/bulk', { ids: [ids.kofi], action: 'decline' }).expect(422);
    });

    it('approves several requests like the single decision: tick set, applicants told, audited', async () => {
      const res = (await admin.post('/admin/verification/bulk', { ids: [ids.kofi, ids.page, MISSING], action: 'approve' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([ids.kofi, ids.page]);
      expect(res.failed).toEqual([{ id: MISSING, error: 'That request was not found' }]);
      expect((await t.db.select().from(s.users).where(eq(s.users.id, kofi.id)))[0]!.verifiedAt).not.toBeNull();
      expect((await t.db.select().from(s.pages).where(eq(s.pages.id, ids.pageId)))[0]!.verifiedAt).not.toBeNull();
      expect(await notificationsFor(t, kofi.id, 'verification_approved')).toHaveLength(1);
      expect(await notificationsFor(t, zara.id, 'verification_approved')).toHaveLength(1);
      expect(await auditRows(t, 'verification.approved', kofi.id)).toHaveLength(1);
      expect(await auditRows(t, 'verification.approved', ids.pageId)).toHaveLength(1);
    });

    it('declines with one note for all; requests already decided fail', async () => {
      const note = 'The links don’t show your name';
      const res = (await admin.post('/admin/verification/bulk', { ids: [ids.kofi, ids.zara], action: 'decline', note }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([ids.zara]);
      expect(res.failed).toEqual([{ id: ids.kofi, error: 'This request was already decided. Reload to see the outcome.' }]);
      const [row] = await t.db.select().from(s.verificationRequests).where(eq(s.verificationRequests.id, ids.zara));
      expect(row).toMatchObject({ status: 'declined', decisionNote: note, decidedBy: admin.id });
      const [declined] = await notificationsFor(t, zara.id, 'verification_declined');
      expect(JSON.stringify(declined!.data)).toContain(note);
      const [audit] = await auditRows(t, 'verification.declined', zara.id);
      expect(audit!.after).toMatchObject({ requestId: ids.zara, note });
    });
  });
});
