import { and, eq } from 'drizzle-orm';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { insertComment, insertHashtag, insertPost } from './fixtures.js';

describe('Reporting (POST /reports, GET /me/reports)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('rejects unverified members with 403 EMAIL_NOT_VERIFIED', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const unverified = await createMember(t, { verified: false });
    const res = await unverified
      .post('/reports', { targetType: 'post', targetId: post.id, reason: 'spam' })
      .expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('requires a signed-in member', async () => {
    const res = await t
      .http()
      .post('/api/v1/reports')
      .set('X-CM-CSRF', '1')
      .send({ targetType: 'post', targetId: 'x', reason: 'spam' });
    expect(res.status).toBe(401);
  });

  it('creates a report with next steps, owner, audit and analytics', async () => {
    const author = await createMember(t, { name: 'Jo Doe' });
    const reporter = await createMember(t);
    const post = await insertPost(t, author.id, 'Guaranteed 10x returns, DM me to join');
    const res = await reporter
      .post('/reports', {
        targetType: 'post',
        targetId: post.id,
        reason: 'scam',
        detail: 'Promises guaranteed returns',
      })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'open' });
    expect(res.body.nextSteps).toMatch(/moderator will review/i);
    expect(res.body.nextSteps).not.toMatch(/Jo Doe/);

    const [row] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, res.body.id));
    expect(row).toMatchObject({
      targetUserId: author.id,
      priority: 'high',
      reasonCode: 'scam',
      reporterId: reporter.id,
    });
    expect(
      await count(t.db, s.auditLog, and(eq(s.auditLog.action, 'report.created'), eq(s.auditLog.actorId, reporter.id))),
    ).toBe(1);
    await new Promise((r) => setTimeout(r, 50)); // analytics is fire-and-forget
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'report_created'))).toBeGreaterThan(0);
  });

  it('returns the existing open report instead of creating a duplicate', async () => {
    const author = await createMember(t);
    const reporter = await createMember(t);
    const post = await insertPost(t, author.id);
    const first = await reporter
      .post('/reports', { targetType: 'post', targetId: post.id, reason: 'spam' })
      .expect(201);
    const second = await reporter
      .post('/reports', { targetType: 'post', targetId: post.id, reason: 'hate' })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await count(t.db, s.contentReports, eq(s.contentReports.targetId, post.id))).toBe(1);
  });

  it('does not let members report their own content or themselves', async () => {
    const me = await createMember(t);
    const post = await insertPost(t, me.id);
    const own = await me.post('/reports', { targetType: 'post', targetId: post.id, reason: 'spam' }).expect(422);
    expect(own.body.error.fields.targetId).toMatch(/own content/);
    const comment = await insertComment(t, post.id, me.id);
    await me.post('/reports', { targetType: 'comment', targetId: comment.id, reason: 'spam' }).expect(422);
    await me.post('/reports', { targetType: 'member', targetId: me.handle, reason: 'impersonation' }).expect(422);
  });

  it('only accepts targets that exist and are visible', async () => {
    const author = await createMember(t);
    const reporter = await createMember(t);
    const deleted = await insertPost(t, author.id);
    await t.db.update(s.posts).set({ deletedAt: new Date() }).where(eq(s.posts.id, deleted.id));
    const hidden = await insertPost(t, author.id);
    await t.db.update(s.posts).set({ moderationState: 'hidden' }).where(eq(s.posts.id, hidden.id));
    await reporter.post('/reports', { targetType: 'post', targetId: deleted.id, reason: 'spam' }).expect(404);
    await reporter.post('/reports', { targetType: 'post', targetId: hidden.id, reason: 'spam' }).expect(404);
    await reporter.post('/reports', { targetType: 'post', targetId: 'not-a-uuid', reason: 'spam' }).expect(404);
    await reporter.post('/reports', { targetType: 'hashtag', targetId: 'NoSuchTopic', reason: 'spam' }).expect(404);
    await reporter.post('/reports', { targetType: 'post', targetId: deleted.id, reason: 'nonsense' }).expect(422);
  });

  it('reports members by handle and topics by tag', async () => {
    const other = await createMember(t, { name: 'Fake Official' });
    const reporter = await createMember(t);
    const m = await reporter
      .post('/reports', { targetType: 'member', targetId: `@${other.handle}`, reason: 'impersonation' })
      .expect(201);
    const [mr] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, m.body.id));
    expect(mr).toMatchObject({ targetId: other.id, targetUserId: other.id, priority: 'medium' });

    await insertHashtag(t, 'CryptoGiveaway');
    const h = await reporter
      .post('/reports', { targetType: 'hashtag', targetId: '#CryptoGiveaway', reason: 'trend_manipulation' })
      .expect(201);
    const [hr] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, h.body.id));
    expect(hr).toMatchObject({ targetId: 'cryptogiveaway', targetUserId: null, priority: 'medium' });
  });

  it('applies priority rules and bumps a piled-on target to high', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const priorities: Record<string, string> = {};
    for (const reason of ['scam', 'spam', 'copyright', 'other'] as const) {
      const r = await createMember(t);
      const res = await r.post('/reports', { targetType: 'post', targetId: post.id, reason }).expect(201);
      const [row] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, res.body.id));
      priorities[reason] = row!.priority;
    }
    expect(priorities).toEqual({ scam: 'high', spam: 'medium', copyright: 'low', other: 'low' });

    // The target already has 4 open reports: the 5th is high and every open report is bumped.
    const fifth = await createMember(t);
    await fifth.post('/reports', { targetType: 'post', targetId: post.id, reason: 'copyright' }).expect(201);
    const rows = await t.db.select().from(s.contentReports).where(eq(s.contentReports.targetId, post.id));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.priority === 'high')).toBe(true);
  });

  it('lists my reports in general terms', async () => {
    const author = await createMember(t);
    const reporter = await createMember(t);
    const a = await insertPost(t, author.id);
    const b = await insertPost(t, author.id);
    const ra = await reporter.post('/reports', { targetType: 'post', targetId: a.id, reason: 'spam' }).expect(201);
    await reporter.post('/reports', { targetType: 'post', targetId: b.id, reason: 'spam' }).expect(201);
    await t.db
      .update(s.contentReports)
      .set({ status: 'actioned', resolvedAt: new Date() })
      .where(eq(s.contentReports.id, ra.body.id));

    const page1 = await reporter.get('/me/reports?limit=1').expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await reporter.get(`/me/reports?limit=1&cursor=${page1.body.nextCursor}`).expect(200);
    const all = [...page1.body.items, ...page2.body.items];
    const actioned = all.find((r: any) => r.id === ra.body.id);
    expect(actioned).toMatchObject({ status: 'action_taken' });
    expect(actioned.summary).toMatch(/took action/);
    expect(all.find((r: any) => r.id !== ra.body.id)).toMatchObject({ status: 'received', resolvedAt: null });
    expect(JSON.stringify(all)).not.toContain(author.id);
  });

  it('limits reports to 20 per member per day', async () => {
    const author = await createMember(t);
    const reporter = await createMember(t);
    for (let i = 0; i < 20; i++) {
      const p = await insertPost(t, author.id, `post ${i}`);
      await reporter.post('/reports', { targetType: 'post', targetId: p.id, reason: 'spam' }).expect(201);
    }
    const p = await insertPost(t, author.id, 'one too many');
    const res = await reporter.post('/reports', { targetType: 'post', targetId: p.id, reason: 'spam' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
