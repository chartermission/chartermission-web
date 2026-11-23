import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEARNING_FEATURED_LIMIT, type AdminHiddenRow, type AdminLeadDetail, type BulkResult, type TeamMember } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const MISSING = '00000000-0000-4000-8000-000000000099';
const REASON = 'Reviewed again: within the community rules';

async function auditRows(t: TestApp, action: string, targetId: string) {
  return t.db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.action, action), eq(s.auditLog.targetId, targetId)));
}

describe('Admin batch actions: courses, hidden content and ambassador leads', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let member: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Aisha Mod', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Amara Okafor' });
  });
  afterAll(() => t.close());

  describe('courses', () => {
    let n = 0;
    async function course(values: Partial<typeof s.courses.$inferInsert> = {}) {
      n += 1;
      const [row] = await t.db
        .insert(s.courses)
        .values({ externalId: `ext-${n}`, slug: `course-${n}`, title: `Course ${n}`, provider: 'Charter Center', startUrl: `https://chartercenter.example/c/${n}`, ...values })
        .returning();
      return row!.id;
    }

    it('needs course.curate in an admin session', async () => {
      const id = await course();
      await member.post('/admin/courses/bulk', { ids: [id], action: 'feature' }).expect(403);
      await mod.post('/admin/courses/bulk', { ids: [id], action: 'feature' }).expect(403);
      await admin.post('/admin/courses/bulk', { ids: [id], action: 'archive' }).expect(422);
    });

    it(`features up to ${LEARNING_FEATURED_LIMIT} visible courses and refuses the extras one by one`, async () => {
      for (let i = 0; i < LEARNING_FEATURED_LIMIT - 1; i++) await course({ featured: true, featuredAt: new Date() });
      const removedFeatured = await course({ featured: true, removedAt: new Date() });
      const [a, b, hidden, already] = [await course(), await course(), await course({ hidden: true }), await course({ featured: true, hidden: true })];

      const res = (await admin.post('/admin/courses/bulk', { ids: [a, b, hidden, already, MISSING], action: 'feature' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([a, hidden]);
      expect(res.failed).toEqual([
        { id: b, error: `The Learning page shows up to ${LEARNING_FEATURED_LIMIT} featured courses. Unfeature one first.` },
        { id: already, error: 'Already featured' },
        { id: MISSING, error: 'Course was not found' },
      ]);
      const rows = await t.db.select().from(s.courses).where(inArray(s.courses.id, [a, b, hidden]));
      expect(rows.find((r) => r.id === a)).toMatchObject({ featured: true });
      expect(rows.find((r) => r.id === a)!.featuredAt).not.toBeNull();
      expect(rows.find((r) => r.id === b)).toMatchObject({ featured: false });
      expect(await auditRows(t, 'course.curated', a)).toHaveLength(1);
      expect(await auditRows(t, 'course.curated', b)).toHaveLength(0);

      // Unfeature one, then the refused course fits.
      const off = (await admin.post('/admin/courses/bulk', { ids: [a, removedFeatured], action: 'unfeature' }).expect(200)).body as BulkResult;
      expect(off).toEqual({ done: [a, removedFeatured], failed: [] });
      expect((await admin.post('/admin/courses/bulk', { ids: [b], action: 'feature' }).expect(200)).body).toEqual({ done: [b], failed: [] });
    });

    it('hides and shows several courses', async () => {
      const [x, y] = [await course(), await course({ hidden: true })];
      const hide = (await admin.post('/admin/courses/bulk', { ids: [x, y], action: 'hide' }).expect(200)).body as BulkResult;
      expect(hide).toEqual({ done: [x], failed: [{ id: y, error: 'Already hidden' }] });
      const show = (await admin.post('/admin/courses/bulk', { ids: [x, y], action: 'show' }).expect(200)).body as BulkResult;
      expect(show).toEqual({ done: [x, y], failed: [] });
      const rows = await t.db.select().from(s.courses).where(inArray(s.courses.id, [x, y]));
      expect(rows.every((r) => !r.hidden)).toBe(true);
      const audits = await auditRows(t, 'course.curated', x);
      expect(audits).toHaveLength(2);
      expect(audits.map((r) => r.after)).toEqual(expect.arrayContaining([expect.objectContaining({ hidden: true }), expect.objectContaining({ hidden: false })]));
    });
  });

  describe('hidden content', () => {
    let author: Member;
    let hiddenPost: string;
    let removedComment: string;
    let autoPost: string;
    let oldAutoPost: string;
    let visiblePost: string;

    beforeAll(async () => {
      author = await createMember(t, { name: 'Kwame Mensah' });
      const insertPost = async (body: string, values: Partial<typeof s.posts.$inferInsert> = {}) =>
        (await t.db.insert(s.posts).values({ authorId: author.id, body, ...values }).returning())[0]!.id;
      hiddenPost = await insertPost('Send money to this account for a guaranteed grant');
      visiblePost = await insertPost('A post about trade corridors');
      autoPost = await insertPost('Spam link farm detected automatically', { moderationState: 'hidden' });
      oldAutoPost = await insertPost('Old automatic hide', { moderationState: 'hidden', updatedAt: new Date(Date.now() - 40 * 86_400_000) });
      const [comment] = await t.db.insert(s.comments).values({ postId: visiblePost, authorId: author.id, body: 'Rude reply to the post' }).returning();
      removedComment = comment!.id;
      await mod.post('/admin/moderation-actions', { targetType: 'post', targetId: hiddenPost, action: 'hide', reason: 'Breaks the scams policy', policyRef: 'guidelines.scams' }).expect(201);
      await mod.post('/admin/moderation-actions', { targetType: 'comment', targetId: removedComment, action: 'remove', reason: 'Harassment of another member' }).expect(201);
    });

    it('filters by who hid it, when, and the words in it', async () => {
      const ids = async (query: string) => ((await mod.get(`/admin/hidden${query}`).expect(200)).body.items as AdminHiddenRow[]).map((r) => r.target.id);
      expect((await ids('')).sort()).toEqual([hiddenPost, removedComment, autoPost, oldAutoPost].sort());
      expect((await ids('?by=moderator')).sort()).toEqual([hiddenPost, removedComment].sort());
      expect((await ids('?by=automatic')).sort()).toEqual([autoPost, oldAutoPost].sort());
      expect(await ids('?by=automatic&since=30d')).toEqual([autoPost]);
      expect((await ids('?since=7d')).sort()).toEqual([hiddenPost, removedComment, autoPost].sort());
      expect(await ids('?q=money')).toEqual([hiddenPost]);
      expect(await ids('?q=rude&targetType=comment')).toEqual([removedComment]);
      await mod.get('/admin/hidden?since=90d').expect(422);
    });

    it('needs moderation.act; a reason is required', async () => {
      await member.post('/admin/hidden/bulk', { ids: [hiddenPost], action: 'restore', reason: REASON }).expect(403);
      const manager = await createMember(t, { name: 'Manager', roles: ['ambassador_manager'], admin: true });
      await manager.post('/admin/hidden/bulk', { ids: [hiddenPost], action: 'restore', reason: REASON }).expect(403);
      await mod.post('/admin/hidden/bulk', { ids: [hiddenPost], action: 'restore' }).expect(422);
      await mod.post('/admin/hidden/bulk', { ids: [hiddenPost], action: 'restore', reason: 'ok' }).expect(422);
    });

    it('restores posts and comments like the single restore: visible again, hide revoked, author told, audited', async () => {
      const before = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, author.id), eq(s.notifications.type, 'moderation_action')));
      const res = (await mod.post('/admin/hidden/bulk', { ids: [hiddenPost, removedComment, autoPost, visiblePost, MISSING], action: 'restore', reason: REASON }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([hiddenPost, removedComment, autoPost]);
      expect(res.failed).toEqual([
        { id: visiblePost, error: 'This post is not hidden' },
        { id: MISSING, error: 'That post or comment was not found' },
      ]);
      const [post] = await t.db.select().from(s.posts).where(eq(s.posts.id, hiddenPost));
      expect(post!.moderationState).toBe('visible');
      const [comment] = await t.db.select().from(s.comments).where(eq(s.comments.id, removedComment));
      expect(comment!.moderationState).toBe('visible');

      const actions = await t.db.select().from(s.moderationActions).where(eq(s.moderationActions.targetId, hiddenPost));
      expect(actions.find((a) => a.action === 'hide')!.revokedAt).not.toBeNull();
      expect(actions.find((a) => a.action === 'restore')).toMatchObject({ reason: REASON, moderatorId: mod.id, policyRef: 'guidelines.scams' });
      expect(await auditRows(t, 'moderation.restore', hiddenPost)).toHaveLength(1);
      expect(await auditRows(t, 'moderation.restore', removedComment)).toHaveLength(1);
      const after = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, author.id), eq(s.notifications.type, 'moderation_action')));
      expect(after.length).toBeGreaterThan(before.length);

      const left = ((await mod.get('/admin/hidden').expect(200)).body.items as AdminHiddenRow[]).map((r) => r.target.id);
      expect(left).toEqual([oldAutoPost]);
    });
  });

  describe('ambassador leads', () => {
    let nia: Member;
    let ng1: AdminLeadDetail;
    let ng2: AdminLeadDetail;
    let gh: AdminLeadDetail;

    async function scopedManager(name: string, countries: string[]) {
      const m = await createMember(t, { name, admin: true });
      const [role] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'ambassador_manager'));
      await t.db.insert(s.userRoles).values(countries.map((c) => ({ userId: m.id, roleId: role!.id, scopeType: 'country', scopeId: c })));
      return m;
    }
    const lead = (fullName: string, countryCode: string) => ({
      fullName,
      email: `${fullName.toLowerCase().replace(/\W+/g, '.')}@example.test`,
      countryCode,
      city: 'Capital',
      source: 'nomination',
    });

    beforeAll(async () => {
      nia = await scopedManager('Nia Manager', ['NG']);
      ng1 = (await admin.post('/admin/ambassadors/leads', lead('Chinedu Obi', 'NG')).expect(201)).body;
      ng2 = (await admin.post('/admin/ambassadors/leads', lead('Ngozi Eze', 'NG')).expect(201)).body;
      gh = (await admin.post('/admin/ambassadors/leads', lead('Kofi Mensah', 'GH')).expect(201)).body;
    });

    it('lists who covers which countries for the owner picker', async () => {
      const team = (await admin.get('/admin/ambassadors/team').expect(200)).body as TeamMember[];
      expect(team.find((m) => m.id === nia.id)).toMatchObject({ allCountries: false, countryCodes: ['NG'] });
      expect(team.find((m) => m.id === admin.id)).toMatchObject({ allCountries: true, countryCodes: [] });
    });

    it('needs ambassador.manage; the owner must be on the team', async () => {
      await member.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id], action: 'assign', ownerId: nia.id }).expect(403);
      await mod.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id], action: 'assign', ownerId: nia.id }).expect(403);
      const res = await admin.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id], action: 'assign', ownerId: member.id }).expect(422);
      expect(res.body.error.fields).toMatchObject({ ownerId: 'Choose someone on the ambassador team' });
      await admin.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id], action: 'stage', ownerId: nia.id }).expect(422);
    });

    it('assigns leads to an owner who covers their country; the others fail with the reason', async () => {
      const res = (await admin.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id, ng2.id, gh.id], action: 'assign', ownerId: nia.id }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([ng1.id, ng2.id]);
      expect(res.failed).toEqual([{ id: gh.id, error: 'Nia Manager doesn’t cover Ghana' }]);
      const rows = await t.db.select().from(s.ambassadorLeads).where(inArray(s.ambassadorLeads.id, [ng1.id, ng2.id, gh.id]));
      expect(rows.find((r) => r.id === ng1.id)!.ownerId).toBe(nia.id);
      expect(rows.find((r) => r.id === gh.id)!.ownerId).toBe(admin.id);
      const activity = await t.db.select().from(s.ambassadorLeadActivities).where(eq(s.ambassadorLeadActivities.leadId, ng1.id));
      expect(activity.some((a) => a.body === 'Updated owner')).toBe(true);
      const [audit] = await auditRows(t, 'ambassador.lead.update', ng1.id);
      expect(audit!.after).toMatchObject({ fields: ['owner'] });
      expect(await auditRows(t, 'ambassador.lead.update', gh.id)).toHaveLength(0);
    });

    it('a manager only reaches the leads in their countries', async () => {
      const res = (await nia.post('/admin/ambassadors/leads/bulk', { ids: [ng1.id, gh.id], action: 'assign', ownerId: admin.id }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([ng1.id]);
      expect(res.failed).toEqual([{ id: gh.id, error: 'That lead was not found' }]);
    });
  });
});
