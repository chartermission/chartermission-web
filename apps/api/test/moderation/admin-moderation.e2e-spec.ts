import { and, eq, isNull } from 'drizzle-orm';
import { client, count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { insertComment, insertHashtag, insertPost, notificationsFor, REASON, signInAgain, textOf } from './fixtures.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Admin moderation (queue, detail, actions)', () => {
  let t: TestApp;
  let mod: Member;
  beforeAll(async () => {
    t = await createTestApp();
    mod = await createMember(t, { name: 'Aisha Mod', roles: ['moderator'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  async function report(targetType: string, targetId: string, reason = 'scam', detail?: string) {
    const r = await createMember(t);
    const res = await r.post('/reports', { targetType, targetId, reason, detail }).expect(201);
    return { reporter: r, reportId: res.body.id as string };
  }

  describe('access control', () => {
    it('rejects members, member-audience moderators and admin sessions without MFA', async () => {
      const member = await createMember(t);
      expect((await member.get('/admin/queue/stats')).status).toBe(403);

      const memberAudienceMod = await createMember(t, { roles: ['moderator'] });
      const r1 = await memberAudienceMod.get('/admin/reports').expect(403);
      expect(r1.body.error.code).toBe('FORBIDDEN');

      const noMfa = await createMember(t, { roles: ['moderator'], admin: true });
      const unverifiedSession = await signInAgain(t, noMfa.id, 'admin', false);
      const r2 = await unverifiedSession.get('/admin/reports').expect(403);
      expect(r2.body.error.code).toBe('MFA_REQUIRED');

      // A member's own session cookie sent with the admin header is not an admin session.
      const plain = client(t, 'admin');
      expect((await plain.get('/admin/reports')).status).toBe(401);

      const post = await insertPost(t, member.id);
      await memberAudienceMod
        .post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'hide', reason: REASON })
        .expect(403);
      await mod.get('/admin/queue/stats').expect(200);
    });
  });

  it('groups reports by target, ordered by priority then age', async () => {
    const author = await createMember(t, { name: 'Grouped Author' });
    const lowPost = await insertPost(t, author.id, 'Low priority copyright post');
    const scamPost = await insertPost(t, author.id, `Guaranteed returns ${'x'.repeat(200)}`);
    const low = await report('post', lowPost.id, 'copyright');
    const first = await report('post', scamPost.id, 'scam', 'Promises guaranteed returns');
    await report('post', scamPost.id, 'scam', 'Promises guaranteed returns');
    await report('post', scamPost.id, 'spam');

    const res = await mod.get('/admin/reports?limit=50').expect(200);
    const rows = res.body.items.filter((r: any) => [lowPost.id, scamPost.id].includes(r.target.id));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: first.reportId,
      target: { type: 'post', id: scamPost.id },
      reportCount: 3,
      priority: 'high',
      reason: 'scam',
      status: 'open',
      assignedTo: null,
    });
    expect(rows[0].target.preview.length).toBeLessThanOrEqual(120);
    expect(rows[1]).toMatchObject({ id: low.reportId, reportCount: 1, priority: 'low' });

    const highOnly = await mod.get('/admin/reports?priority=high&limit=50').expect(200);
    expect(highOnly.body.items.some((r: any) => r.target.id === lowPost.id)).toBe(false);

    // Reason filter matches any open report for that reason, not only the group's most common one.
    const spamOnly = await mod.get('/admin/reports?reason=spam&limit=100').expect(200);
    const spamRow = spamOnly.body.items.find((r: any) => r.target.id === scamPost.id);
    expect(spamRow).toMatchObject({ reason: 'spam', reportCount: 3 });
    expect(spamOnly.body.items.some((r: any) => r.target.id === lowPost.id)).toBe(false);
    const copyright = await mod.get('/admin/reports?reason=copyright&limit=100').expect(200);
    expect(copyright.body.items.map((r: any) => r.target.id)).toContain(lowPost.id);
    expect(copyright.body.items.map((r: any) => r.target.id)).not.toContain(scamPost.id);
    await mod.get('/admin/reports?reason=not-a-reason').expect(422);

    // Keyset pagination walks every group exactly once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: any = await mod.get(`/admin/reports?limit=1${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...page.body.items.map((r: any) => r.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expect.arrayContaining([first.reportId, low.reportId]));

    const stats = await mod.get('/admin/queue/stats').expect(200);
    expect(stats.body.openReports).toBeGreaterThanOrEqual(2);
    expect(stats.body.highPriority).toBeGreaterThanOrEqual(1);
  });

  it('assigns a case to me and releases it', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const { reportId } = await report('post', post.id, 'spam');
    await report('post', post.id, 'spam');
    const res = await mod.post(`/admin/reports/${reportId}/assign`, { assignee: 'me' }).expect(200);
    expect(res.body).toMatchObject({ status: 'in_review', assignedTo: { id: mod.id }, reportCount: 2 });
    const mine = await mod.get('/admin/reports?assignee=me').expect(200);
    expect(mine.body.items.map((r: any) => r.id)).toContain(reportId);
    const released = await mod.post(`/admin/reports/${reportId}/assign`, { assignee: 'none' }).expect(200);
    expect(released.body).toMatchObject({ status: 'open', assignedTo: null });
  });

  it('report detail shows content, reasons, author history and previous actions', async () => {
    const author = await createMember(t, { name: 'History Author' });
    const earlier = await insertPost(t, author.id, 'An earlier post that was warned about');
    const warn = await mod
      .post('/admin/moderation-actions', {
        targetType: 'post',
        targetId: earlier.id,
        action: 'warn',
        reason: 'Borderline spam, first warning',
        policyRef: 'guidelines.spam',
      })
      .expect(201);
    const post = await insertPost(t, author.id, 'Send me $20 and your CV for review');
    await t.db
      .insert(s.files)
      .values({
        id: '00000000-0000-4000-8000-000000000001',
        ownerId: author.id,
        purpose: 'post_image',
        storageKey: 'k',
        declaredMime: 'image/png',
        mime: 'image/png',
        sizeBytes: 10,
        scanStatus: 'clean',
      });
    await t.db
      .insert(s.postAttachments)
      .values({ postId: post.id, fileId: '00000000-0000-4000-8000-000000000001', kind: 'image' });
    const { reportId } = await report('post', post.id, 'scam', 'Charging for fake job placement');
    await report('post', post.id, 'scam', 'Charging for fake job placement');
    await report('post', post.id, 'spam');

    const res = await mod.get(`/admin/reports/${reportId}`).expect(200);
    const d = res.body;
    expect(d.content).toMatchObject({
      body: 'Send me $20 and your CV for review',
      attachmentCount: 1,
      moderationState: 'visible',
      href: `/posts/${post.id}`,
    });
    expect(d.author).toMatchObject({ id: author.id, name: 'History Author' });
    expect(d.reasons).toEqual([
      { reason: 'scam', detail: 'Charging for fake job placement', count: 2 },
      { reason: 'spam', detail: null, count: 1 },
    ]);
    expect(d.authorHistory).toMatchObject({
      emailVerified: true,
      hasAvatar: false,
      status: 'active',
      previousReports: 0,
    });
    expect(d.authorHistory.recentActions).toEqual([{ action: 'warn', createdAt: warn.body.createdAt }]);
    expect(d.previousActions).toHaveLength(1);
    expect(d.previousActions[0]).toMatchObject({
      id: warn.body.id,
      action: 'warn',
      reason: 'Borderline spam, first warning',
      moderator: { id: mod.id },
      appealStatus: null,
      // The warning was about the author's other post; the view says which.
      targetType: 'post',
      targetId: earlier.id,
      targetPreview: 'An earlier post that was warned about',
    });

    await mod.get('/admin/reports/not-a-uuid').expect(404);
    await mod.get('/admin/reports/00000000-0000-4000-8000-00000000ffff').expect(404);
  });

  it('requires a reason for every action (CM-ADM-05)', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const { reportId } = await report('post', post.id);
    const res = await mod.post(`/admin/reports/${reportId}/actions`, { action: 'hide' }).expect(422);
    expect(res.body.error.fields.reason).toBeDefined();
    await mod.post(`/admin/reports/${reportId}/actions`, { action: 'hide', reason: '   ' }).expect(422);
    await mod.post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'warn' }).expect(422);
  });

  it('hide sets moderation_state, resolves every report on the target and notifies author and reporters', async () => {
    const author = await createMember(t, { name: 'Hidden Author' });
    const post = await insertPost(t, author.id, 'Guaranteed 10x returns in 30 days');
    const a = await report('post', post.id, 'scam');
    const b = await report('post', post.id, 'spam');
    const c = await report('post', post.id, 'scam');

    const res = await mod
      .post(`/admin/reports/${b.reportId}/actions`, { action: 'hide', reason: REASON, policyRef: 'guidelines.scams' })
      .expect(201);
    expect(res.body).toMatchObject({
      action: 'hide',
      reason: REASON,
      policyRef: 'guidelines.scams',
      moderator: { id: mod.id },
      revokedAt: null,
    });

    const [p] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
    expect(p!.moderationState).toBe('hidden');
    const [action] = await t.db.select().from(s.moderationActions).where(eq(s.moderationActions.id, res.body.id));
    expect(action).toMatchObject({
      reportId: b.reportId,
      targetUserId: author.id,
      moderatorId: mod.id,
      targetType: 'post',
      targetId: post.id,
    });
    const reports = await t.db.select().from(s.contentReports).where(eq(s.contentReports.targetId, post.id));
    expect(reports.map((r) => r.status)).toEqual(['actioned', 'actioned', 'actioned']);
    expect(reports.every((r) => r.resolvedAt)).toBe(true);

    const audit = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'moderation.hide'), eq(s.auditLog.targetId, post.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ moderationState: 'visible' });
    expect(audit[0]!.after).toMatchObject({ moderationState: 'hidden', reason: REASON, policyRef: 'guidelines.scams' });

    const [authorNote] = await notificationsFor(t, author.id, 'moderation_action');
    expect(authorNote!.data.href).toBe(`/appeals/${res.body.id}`);
    expect(textOf(authorNote!)).toMatch(/We hid your post/);
    expect(textOf(authorNote!)).toMatch(/Scams and fraud/);
    expect(textOf(authorNote!)).toMatch(/appeal/);
    const email = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, author.id));
    expect(email.some((e) => e.template === 'notification.moderation_action')).toBe(true);

    for (const r of [a, b, c]) {
      const notes = await notificationsFor(t, r.reporter.id, 'report_outcome');
      expect(notes).toHaveLength(1);
      expect(textOf(notes[0]!)).toMatch(/We reviewed your report and took action/);
      expect(JSON.stringify(notes[0])).not.toContain('Hidden Author');
    }

    // The case left the open queue and appears in the hidden list with its action.
    const open = await mod.get('/admin/reports?limit=100').expect(200);
    expect(open.body.items.some((r: any) => r.target.id === post.id)).toBe(false);
    const hidden = await mod.get('/admin/hidden').expect(200);
    const row = hidden.body.items.find((r: any) => r.target.id === post.id);
    expect(row).toMatchObject({
      moderationState: 'hidden',
      author: { id: author.id },
      href: `/posts/${post.id}`,
      action: { id: res.body.id },
    });

    // Acting again on a resolved report is a conflict; the author still sees their own action.
    await mod.post(`/admin/reports/${a.reportId}/actions`, { action: 'remove', reason: REASON }).expect(409);
    const mine = await author.get('/me/moderation-actions').expect(200);
    expect(mine.body[0]).toMatchObject({
      id: res.body.id,
      action: 'hide',
      canAppeal: true,
      appeal: null,
      target: { type: 'post', id: post.id },
    });
  });

  it('dismiss closes reports and tells reporters it did not break the guidelines', async () => {
    const author = await createMember(t);
    const comment = await insertComment(
      t,
      (await insertPost(t, author.id)).id,
      author.id,
      'I disagree with this analysis',
    );
    const r = await report('comment', comment.id, 'harassment');
    await mod
      .post(`/admin/reports/${r.reportId}/actions`, { action: 'dismiss', reason: 'Disagreement, not harassment' })
      .expect(201);
    const [row] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, r.reportId));
    expect(row).toMatchObject({ status: 'dismissed' });
    const [note] = await notificationsFor(t, r.reporter.id, 'report_outcome');
    expect(textOf(note!)).toMatch(/didn’t break our Community Guidelines/);
    expect(await notificationsFor(t, author.id, 'moderation_action')).toHaveLength(0);
  });

  it('escalate keeps reports in review with high priority', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const r = await report('post', post.id, 'copyright');
    await mod
      .post(`/admin/reports/${r.reportId}/actions`, { action: 'escalate', reason: 'Needs legal review' })
      .expect(201);
    const [row] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, r.reportId));
    expect(row).toMatchObject({ status: 'in_review', priority: 'high', resolvedAt: null });
  });

  it('rejects hiding a member and acting on privileged accounts', async () => {
    const target = await createMember(t);
    const res = await mod
      .post('/admin/moderation-actions', { targetType: 'member', targetId: target.id, action: 'hide', reason: REASON })
      .expect(422);
    expect(res.body.error.fields.action).toBeDefined();

    const otherMod = await createMember(t, { roles: ['moderator'] });
    const admin = await createMember(t, { roles: ['platform_admin'] });
    const staff = await createMember(t);
    await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
    for (const who of [otherMod, admin, staff]) {
      const post = await insertPost(t, who.id);
      await mod
        .post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'hide', reason: REASON })
        .expect(403);
      await mod
        .post('/admin/moderation-actions', {
          targetType: 'member',
          targetId: who.handle,
          action: 'suspend',
          reason: REASON,
        })
        .expect(403);
    }
    const ownPost = await insertPost(t, mod.id);
    await mod
      .post('/admin/moderation-actions', { targetType: 'post', targetId: ownPost.id, action: 'hide', reason: REASON })
      .expect(403);

    // A Platform Admin can act on a moderator's content.
    const pa = await createMember(t, { roles: ['platform_admin'], admin: true });
    const modPost = await insertPost(t, otherMod.id);
    await pa
      .post('/admin/moderation-actions', { targetType: 'post', targetId: modPost.id, action: 'hide', reason: REASON })
      .expect(201);
  });

  it('restrict sets the matching column; restore makes content visible and revokes the hide', async () => {
    const author = await createMember(t);
    const before = Date.now();
    await mod
      .post('/admin/moderation-actions', {
        targetType: 'member',
        targetId: author.id,
        action: 'restrict_posting',
        reason: REASON,
      })
      .expect(201);
    await mod
      .post('/admin/moderation-actions', {
        targetType: 'member',
        targetId: author.id,
        action: 'restrict_connecting',
        reason: REASON,
        durationHours: 24,
      })
      .expect(201);
    const [u] = await t.db.select().from(s.users).where(eq(s.users.id, author.id));
    expect(u!.restrictedPostingUntil!.getTime() - before).toBeGreaterThan(167 * 3600_000);
    expect(u!.restrictedConnectingUntil!.getTime() - before).toBeLessThan(25 * 3600_000);

    const post = await insertPost(t, author.id);
    const hide = await mod
      .post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'remove', reason: REASON })
      .expect(201);
    await mod
      .post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'hide', reason: REASON })
      .expect(409);
    await mod
      .post('/admin/moderation-actions', {
        targetType: 'post',
        targetId: post.id,
        action: 'restore',
        reason: 'Reviewed again, it is fine',
      })
      .expect(201);
    const [p] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
    expect(p!.moderationState).toBe('visible');
    const [a] = await t.db.select().from(s.moderationActions).where(eq(s.moderationActions.id, hide.body.id));
    expect(a!.revokedAt).not.toBeNull();
    expect(a!.revokedBy).toBe(mod.id);
  });

  it('suspend revokes sessions; the next request is 403 ACCOUNT_SUSPENDED but my moderation actions still load', async () => {
    const author = await createMember(t);
    const post = await insertPost(t, author.id);
    const other = await insertPost(t, (await createMember(t)).id);
    const r = await report('post', post.id, 'harassment');
    await author.get('/me/moderation-actions').expect(200);

    const res = await mod
      .post(`/admin/reports/${r.reportId}/actions`, { action: 'suspend', reason: REASON, durationHours: 168 })
      .expect(201);
    const [u] = await t.db.select().from(s.users).where(eq(s.users.id, author.id));
    expect(u!.status).toBe('suspended');
    expect(u!.suspendedUntil).not.toBeNull();
    expect(await count(t.db, s.sessions, and(eq(s.sessions.userId, author.id), isNull(s.sessions.revokedAt)))).toBe(0);

    // The old cookie is dead.
    expect((await author.get('/me/moderation-actions')).status).toBe(401);
    // Signing in again works, but member actions are blocked.
    const again = await signInAgain(t, author.id);
    const blocked = await again
      .post('/reports', { targetType: 'post', targetId: other.id, reason: 'spam' })
      .expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const mine = await again.get('/me/moderation-actions').expect(200);
    expect(mine.body[0]).toMatchObject({ id: res.body.id, action: 'suspend', canAppeal: true });
    expect(mine.body[0].summary).toMatch(/suspended until/);
    const [note] = await notificationsFor(t, author.id, 'moderation_action');
    expect(note).toBeDefined();
  });

  it('hiding a topic creates a suppress override; restoring revokes it', async () => {
    const h = await insertHashtag(t, 'GiveawayNow');
    const r = await report('hashtag', 'GiveawayNow', 'trend_manipulation');
    await mod
      .post(`/admin/reports/${r.reportId}/actions`, {
        action: 'hide',
        reason: 'Coordinated giveaway spam',
        durationHours: 168,
      })
      .expect(201);
    const [o] = await t.db.select().from(s.trendingOverrides).where(eq(s.trendingOverrides.hashtagId, h.id));
    expect(o).toMatchObject({ action: 'suppress', scopeType: 'global', revokedAt: null, actorId: mod.id });
    expect(o!.expiresAt).not.toBeNull();
    await mod
      .post('/admin/moderation-actions', {
        targetType: 'hashtag',
        targetId: 'giveawaynow',
        action: 'suspend',
        reason: REASON,
      })
      .expect(422);
    await mod
      .post('/admin/moderation-actions', {
        targetType: 'hashtag',
        targetId: 'giveawaynow',
        action: 'restore',
        reason: 'Campaign ended',
      })
      .expect(201);
    const [after] = await t.db.select().from(s.trendingOverrides).where(eq(s.trendingOverrides.id, o!.id));
    expect(after!.revokedAt).not.toBeNull();
  });
});
