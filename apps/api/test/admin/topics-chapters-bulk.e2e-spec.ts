import { and, eq, inArray } from 'drizzle-orm';
import type { AdminChapterRow, BulkResult, CsvImportResult } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Admin topics and chapters: batch changes and CSV import', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let member: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Plain Member' });
  });
  afterAll(() => t.close());

  const topic = async (tag: string, values: Partial<typeof s.hashtags.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(s.hashtags)
      .values({ tag: tag.toLowerCase(), display: tag, ...values })
      .returning();
    return row!;
  };
  const audits = (action: string, ids: string[]) =>
    t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, action), inArray(s.auditLog.targetId, ids)));

  describe('topics', () => {
    it('refuses members and admin sessions without trending.manage', async () => {
      await member.post('/admin/topics/bulk', { ids: [crypto.randomUUID()], action: 'feature' }).expect(403);
      await member.post('/admin/topics/import', { rows: [{ row: 2, tag: 'x' }], dryRun: true }).expect(403);
    });

    it('features, deactivates and activates several topics, one audit entry each', async () => {
      const a = await topic('BulkAlpha');
      const b = await topic('BulkBeta');
      const res = (await mod.post('/admin/topics/bulk', { ids: [a.id, b.id], action: 'feature' }).expect(200)).body as BulkResult;
      expect(res).toEqual({ done: [a.id, b.id], failed: [] });
      const rows = await t.db.select().from(s.hashtags).where(inArray(s.hashtags.id, [a.id, b.id]));
      expect(rows.every((r) => r.featured)).toBe(true);
      expect(await audits('topic.updated', [a.id, b.id])).toHaveLength(2);

      await mod.post('/admin/topics/bulk', { ids: [a.id, b.id], action: 'deactivate' }).expect(200);
      expect((await t.db.select().from(s.hashtags).where(eq(s.hashtags.id, a.id)))[0]!.status).toBe('disabled');
      expect(await audits('topic.deactivated', [a.id, b.id])).toHaveLength(2);
      await mod.post('/admin/topics/bulk', { ids: [a.id], action: 'activate' }).expect(200);
      expect((await t.db.select().from(s.hashtags).where(eq(s.hashtags.id, a.id)))[0]!.status).toBe('active');
      await mod.post('/admin/topics/bulk', { ids: [a.id, b.id], action: 'unfeature' }).expect(200);
      expect((await t.db.select().from(s.hashtags).where(eq(s.hashtags.id, b.id)))[0]!.featured).toBe(false);
    });

    it('deletes unused topics and reports the ones posts use or that are gone', async () => {
      const unused = await topic('BulkUnused');
      const used = await topic('BulkUsed', { postCount: 3 });
      const missing = crypto.randomUUID();
      const res = (await mod.post('/admin/topics/bulk', { ids: [unused.id, used.id, missing, 'nope'], action: 'delete' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([unused.id]);
      expect(res.failed).toEqual([
        { id: used.id, error: 'Posts use this topic. Deactivate it instead.' },
        { id: missing, error: 'That topic was not found' },
        { id: 'nope', error: 'That topic was not found' },
      ]);
      expect(await t.db.select().from(s.hashtags).where(eq(s.hashtags.id, unused.id))).toHaveLength(0);
      expect(await t.db.select().from(s.hashtags).where(eq(s.hashtags.id, used.id))).toHaveLength(1);
      expect(await audits('topic.removed', [unused.id])).toHaveLength(1);
    });

    it('validates the request', async () => {
      await mod.post('/admin/topics/bulk', { ids: [], action: 'feature' }).expect(422);
      await mod.post('/admin/topics/bulk', { ids: ['a'], action: 'explode' }).expect(422);
      await mod.post('/admin/topics/bulk', { ids: Array.from({ length: 501 }, (_, i) => `id-${i}`), action: 'feature' }).expect(422);
    });

    it('imports topics from CSV rows: a dry run writes nothing, then the import adds and updates', async () => {
      await topic('ImportExisting', { description: 'Old words', featured: false });
      await topic('ImportSame', { description: 'Same', featured: true });
      const rows = [
        { row: 2, tag: '#ImportNew', description: 'A brand new topic', featured: 'yes', status: '' },
        { row: 3, tag: 'importexisting', description: 'New words', featured: '', status: 'inactive' },
        { row: 4, tag: 'ImportSame', description: 'Same', featured: 'yes', status: 'active' },
        { row: 5, tag: 'not a tag!', description: '', featured: '', status: '' },
        { row: 6, tag: 'ImportNew', description: '', featured: '', status: '' },
        { row: 7, tag: 'ImportOther', description: '', featured: 'maybe', status: '' },
        { row: 8, tag: 'ImportPlain', description: '', featured: '', status: '' },
      ];
      const preview = (await mod.post('/admin/topics/import', { rows, dryRun: true }).expect(200)).body as CsvImportResult;
      expect(preview).toMatchObject({ created: 2, updated: 1, unchanged: 1, dryRun: true });
      expect(preview.problems.map((p) => p.row)).toEqual([5, 6, 7]);
      expect(preview.problems[1]!.message).toContain('row 2');
      expect(await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'importnew'))).toHaveLength(0);

      const done = (await mod.post('/admin/topics/import', { rows, dryRun: false }).expect(200)).body as CsvImportResult;
      expect(done).toMatchObject({ created: 2, updated: 1, unchanged: 1, dryRun: false });
      const [created] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'importnew'));
      expect(created).toMatchObject({ display: 'ImportNew', description: 'A brand new topic', featured: true, status: 'active' });
      const [plain] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'importplain'));
      expect(plain).toMatchObject({ featured: false, status: 'active' });
      const [updated] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'importexisting'));
      // Capitalisation from the file, new description and status; featured left as it was.
      expect(updated).toMatchObject({ display: 'importexisting', description: 'New words', status: 'disabled', featured: false });
      expect(await audits('topic.added', [created!.id, plain!.id])).toHaveLength(2);
      expect(await audits('topic.deactivated', [updated!.id])).toHaveLength(1);

      // Importing the same file again changes nothing.
      const again = (await mod.post('/admin/topics/import', { rows, dryRun: true }).expect(200)).body as CsvImportResult;
      expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
      await mod.post('/admin/topics/import', { rows: [], dryRun: true }).expect(422);
    });
  });

  describe('chapters', () => {
    const chapter = async (slug: string) => (await t.db.select().from(s.chapters).where(eq(s.chapters.slug, slug)))[0]!;

    it('refuses moderators and members', async () => {
      const ghana = await chapter('ghana');
      await mod.post('/admin/chapters/bulk', { ids: [ghana.id], action: 'deactivate' }).expect(403);
      await member.post('/admin/chapters/bulk', { ids: [ghana.id], action: 'deactivate' }).expect(403);
    });

    it('deactivates, activates and sets the posting rule of several chapters, one audit entry each', async () => {
      const [ghana, kenya] = [await chapter('ghana'), await chapter('kenya')];
      const ids = [ghana.id, kenya.id];
      expect((await admin.post('/admin/chapters/bulk', { ids, action: 'deactivate' }).expect(200)).body).toEqual({ done: ids, failed: [] });
      expect((await chapter('ghana')).status).toBe('dormant');
      expect(await audits('chapter.deactivated', ids)).toHaveLength(2);
      await admin.post('/admin/chapters/bulk', { ids, action: 'activate' }).expect(200);
      expect((await chapter('kenya')).status).toBe('active');
      expect(await audits('chapter.activated', ids)).toHaveLength(2);

      await admin.post('/admin/chapters/bulk', { ids, action: 'posts_review' }).expect(200);
      expect((await chapter('ghana')).postApproval).toBe('review');
      await admin.post('/admin/chapters/bulk', { ids, action: 'posts_direct' }).expect(200);
      expect((await chapter('kenya')).postApproval).toBe('direct');
      await admin.post('/admin/chapters/bulk', { ids, action: 'posts_platform' }).expect(200);
      expect((await chapter('ghana')).postApproval).toBeNull();
      expect(await audits('chapter.updated', ids)).toHaveLength(6);
    });

    it('removes only chapters nobody has used, and says why for the rest', async () => {
      const [lesotho, nigeria] = [await chapter('lesotho'), await chapter('nigeria')];
      await t.db.insert(s.follows).values({ followerId: member.id, targetType: 'chapter', targetId: nigeria.id });
      const res = (await admin.post('/admin/chapters/bulk', { ids: [lesotho.id, nigeria.id], action: 'delete' }).expect(200)).body as BulkResult;
      expect(res.done).toEqual([lesotho.id]);
      expect(res.failed).toEqual([{ id: nigeria.id, error: 'This chapter already has members, posts, events or team roles. Deactivate it instead.' }]);
      expect(await t.db.select().from(s.chapters).where(eq(s.chapters.id, lesotho.id))).toHaveLength(0);
      expect(await audits('chapter.removed', [lesotho.id])).toHaveLength(1);
    });

    it('counts members as the chapter page does, and filters by region', async () => {
      const nigeria = await chapter('nigeria');
      const closed = await createMember(t, { name: 'Closed Account' });
      await t.db.insert(s.follows).values({ followerId: closed.id, targetType: 'chapter', targetId: nigeria.id });
      await t.db.update(s.users).set({ status: 'deactivated' }).where(eq(s.users.id, closed.id));

      const rows = (await admin.get('/admin/chapters?q=Nigeria').expect(200)).body as AdminChapterRow[];
      const row = rows.find((r) => r.slug === 'nigeria')!;
      const page = await member.get('/chapters/nigeria').expect(200);
      expect(row.followers).toBe(1);
      expect(page.body.counts.followers).toBe(row.followers);

      const west = (await admin.get('/admin/chapters?region=West%20Africa').expect(200)).body as AdminChapterRow[];
      expect(west.length).toBeGreaterThan(5);
      expect(west.every((r) => r.region === 'West Africa')).toBe(true);
      expect(west.some((r) => r.slug === 'nigeria')).toBe(true);
    });
  });
});
