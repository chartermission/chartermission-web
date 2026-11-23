import { and, eq, inArray } from 'drizzle-orm';
import type { BulkResult } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { insertComment, insertPost, notificationsFor, textOf } from '../moderation/fixtures.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Admin moderation queue: batch assign, unassign and dismiss', () => {
  let t: TestApp;
  let mod: Member;
  let author: Member;

  beforeAll(async () => {
    t = await createTestApp();
    mod = await createMember(t, { name: 'Batch Mod', roles: ['moderator'], admin: true });
    author = await createMember(t, { name: 'Post Author' });
  });
  afterAll(() => t.close());

  async function reported(reason = 'spam') {
    const post = await insertPost(t, author.id, `A post to report ${Math.random()}`);
    const reporter = await createMember(t);
    const res = await reporter.post('/reports', { targetType: 'post', targetId: post.id, reason }).expect(201);
    return { post, reporter, reportId: res.body.id as string };
  }
  const report = async (id: string) => (await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, id)))[0]!;

  it('refuses members and staff without moderation.act', async () => {
    const r = await reported();
    const member = await createMember(t);
    await member.post('/admin/queue/bulk', { ids: [r.reportId], action: 'assign' }).expect(403);
    const viewer = await createMember(t, { roles: ['platform_admin'], admin: true });
    // Platform admins include moderation.act; a member-audience moderator session does not reach the console.
    await viewer.post('/admin/queue/bulk', { ids: [r.reportId], action: 'unassign' }).expect(200);
    const memberAudienceMod = await createMember(t, { roles: ['moderator'] });
    await memberAudienceMod.post('/admin/queue/bulk', { ids: [r.reportId], action: 'assign' }).expect(403);
  });

  it('assigns several cases to the moderator and releases them, audited per case', async () => {
    const [a, b] = [await reported(), await reported()];
    const res = (await mod.post('/admin/queue/bulk', { ids: [a.reportId, b.reportId], action: 'assign' }).expect(200)).body as BulkResult;
    expect(res).toEqual({ done: [a.reportId, b.reportId], failed: [] });
    expect(await report(a.reportId)).toMatchObject({ assignedTo: mod.id, status: 'in_review' });
    expect(await report(b.reportId)).toMatchObject({ assignedTo: mod.id, status: 'in_review' });
    const assigned = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'report.assigned'), inArray(s.auditLog.targetId, [a.post.id, b.post.id])));
    expect(assigned).toHaveLength(2);

    await mod.post('/admin/queue/bulk', { ids: [a.reportId, b.reportId], action: 'unassign' }).expect(200);
    expect(await report(a.reportId)).toMatchObject({ assignedTo: null, status: 'open' });
    const released = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'report.unassigned'), inArray(s.auditLog.targetId, [a.post.id, b.post.id])));
    expect(released).toHaveLength(2);
  });

  it('dismisses several cases with one reason; reporters hear back and each case is audited', async () => {
    const [a, b] = [await reported('harassment'), await reported('spam')];
    // A second report on the same post is dismissed with its case.
    const second = await createMember(t);
    const extra = (await second.post('/reports', { targetType: 'post', targetId: a.post.id, reason: 'spam' }).expect(201)).body.id as string;
    // A case already resolved fails on its own without stopping the rest.
    const done = await reported();
    await mod.post(`/admin/reports/${done.reportId}/actions`, { action: 'dismiss', reason: 'Handled on its own already' }).expect(201);

    const reason = 'Disagreement, not a breach of the guidelines';
    const res = (await mod.post('/admin/queue/bulk', { ids: [a.reportId, done.reportId, b.reportId, crypto.randomUUID()], action: 'dismiss', reason }).expect(200))
      .body as BulkResult;
    expect(res.done).toEqual([a.reportId, b.reportId]);
    expect(res.failed).toEqual([
      { id: done.reportId, error: 'This report has already been resolved' },
      { id: expect.any(String), error: 'That report was not found' },
    ]);
    for (const id of [a.reportId, extra, b.reportId]) expect(await report(id)).toMatchObject({ status: 'dismissed' });

    const actions = await t.db.select().from(s.moderationActions).where(inArray(s.moderationActions.targetId, [a.post.id, b.post.id]));
    expect(actions.map((x) => [x.action, x.reason])).toEqual([
      ['dismiss', reason],
      ['dismiss', reason],
    ]);
    const audit = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'moderation.dismiss'), inArray(s.auditLog.targetId, [a.post.id, b.post.id])));
    expect(audit).toHaveLength(2);

    for (const reporterId of [a.reporter.id, second.id, b.reporter.id]) {
      const [note] = await notificationsFor(t, reporterId, 'report_outcome');
      expect(textOf(note!)).toMatch(/didn’t break our Community Guidelines/);
    }
    expect(await notificationsFor(t, author.id, 'moderation_action')).toHaveLength(0);
  });

  it('needs a reason to dismiss and a valid action', async () => {
    const r = await reported();
    await mod.post('/admin/queue/bulk', { ids: [r.reportId], action: 'dismiss' }).expect(422);
    await mod.post('/admin/queue/bulk', { ids: [r.reportId], action: 'dismiss', reason: 'no' }).expect(422);
    await mod.post('/admin/queue/bulk', { ids: [r.reportId], action: 'remove', reason: 'Not allowed in bulk' }).expect(422);
    expect(await report(r.reportId)).toMatchObject({ status: 'open' });
  });

  it('dismisses comment cases too', async () => {
    const post = await insertPost(t, author.id);
    const comment = await insertComment(t, post.id, author.id, 'A reported comment');
    const reporter = await createMember(t);
    const id = (await reporter.post('/reports', { targetType: 'comment', targetId: comment.id, reason: 'spam' }).expect(201)).body.id as string;
    const res = (await mod.post('/admin/queue/bulk', { ids: [id], action: 'dismiss', reason: 'Not spam, an honest question' }).expect(200)).body as BulkResult;
    expect(res.done).toEqual([id]);
  });
});
