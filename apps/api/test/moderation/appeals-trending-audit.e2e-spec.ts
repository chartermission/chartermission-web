import { and, eq, sql } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { expireRestrictions, ExpiryService } from '../../src/moderation/expiry.js';
import { AuditService } from '../../src/infra/audit.service.js';
import { QueueService } from '../../src/infra/queue.service.js';
import { SETTING_DEFAULTS, SettingsService } from '../../src/infra/settings.service.js';
import { insertHashtag, insertPost, notificationsFor, REASON, signInAgain, textOf } from './fixtures.js';

type Member = Awaited<ReturnType<typeof createMember>>;
const STATEMENT = 'This was a genuine announcement of our cooperative programme, not a scam.';

describe('Appeals, trending controls, audit log and expiry', () => {
  let t: TestApp;
  let modA: Member;
  let modB: Member;
  beforeAll(async () => {
    t = await createTestApp();
    // Settings are cached per process and may have been read before the database reset.
    await t.app.get(SettingsService).set('trending_rules', SETTING_DEFAULTS.trending_rules, null);
    modA = await createMember(t, { name: 'Moderator A', roles: ['moderator'], admin: true });
    modB = await createMember(t, { name: 'Moderator B', roles: ['moderator'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  describe('appeals (CM-ADM-06)', () => {
    it('one appeal per action, decided by a different moderator; overturning restores content', async () => {
      const author = await createMember(t);
      const post = await insertPost(t, author.id, 'Our cooperative input subsidy programme opens today');
      const reporter = await createMember(t);
      const rep = await reporter
        .post('/reports', { targetType: 'post', targetId: post.id, reason: 'scam' })
        .expect(201);
      const action = await modA
        .post(`/admin/reports/${rep.body.id}/actions`, { action: 'hide', reason: REASON })
        .expect(201);

      // Only the affected member can appeal; others get 404.
      const stranger = await createMember(t);
      await stranger.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(404);
      await author.post('/appeals', { actionId: action.body.id, statement: 'too short' }).expect(422);

      const appeal = await author.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(201);
      expect(appeal.body).toMatchObject({ actionId: action.body.id, status: 'open' });
      const again = await author.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(409);
      expect(again.body.error.code).toBe('CONFLICT');
      const [reportRow] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, rep.body.id));
      expect(reportRow!.status).toBe('appealed');

      const mine = await author.get('/me/moderation-actions').expect(200);
      expect(mine.body[0]).toMatchObject({
        canAppeal: false,
        appeal: { id: appeal.body.id, status: 'open', decidedAt: null },
      });

      // The moderator who acted cannot decide.
      const listA = await modA.get('/admin/appeals').expect(200);
      expect(listA.body.items.find((a: any) => a.id === appeal.body.id)).toMatchObject({ canDecide: false });
      const own = await modA
        .post(`/admin/appeals/${appeal.body.id}/decide`, { decision: 'overturned', reason: 'I changed my mind' })
        .expect(403);
      expect(own.body.error.code).toBe('FORBIDDEN');

      const listB = await modB.get('/admin/appeals').expect(200);
      const row = listB.body.items.find((a: any) => a.id === appeal.body.id);
      expect(row).toMatchObject({
        canDecide: true,
        statement: STATEMENT,
        appellant: { id: author.id },
        action: { id: action.body.id, action: 'hide', moderator: { id: modA.id }, appealStatus: 'open' },
        target: { type: 'post', id: post.id },
      });

      await modB.post(`/admin/appeals/${appeal.body.id}/decide`, { decision: 'overturned' }).expect(422);
      const decided = await modB
        .post(`/admin/appeals/${appeal.body.id}/decide`, {
          decision: 'overturned',
          reason: 'Verified programme, link is legitimate',
        })
        .expect(200);
      expect(decided.body).toMatchObject({ status: 'overturned', canDecide: false });

      const [p] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
      expect(p!.moderationState).toBe('visible');
      const [a] = await t.db.select().from(s.moderationActions).where(eq(s.moderationActions.id, action.body.id));
      expect(a!.revokedAt).not.toBeNull();
      expect(a!.revokedBy).toBe(modB.id);
      const [r2] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, rep.body.id));
      expect(r2!.status).toBe('overturned');
      const [note] = await notificationsFor(t, author.id, 'appeal_outcome');
      expect(textOf(note!)).toMatch(/reversed our decision/);
      const audit = await t.db
        .select()
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, 'appeal.decided'), eq(s.auditLog.targetId, appeal.body.id)));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorId).toBe(modB.id);

      await modB
        .post(`/admin/appeals/${appeal.body.id}/decide`, { decision: 'upheld', reason: 'Second decision' })
        .expect(409);
      // The action is revoked: no further appeal is possible.
      const later = await author.get('/me/moderation-actions').expect(200);
      expect(later.body[0].canAppeal).toBe(false);
    });

    it('upholding keeps the action in place', async () => {
      const author = await createMember(t);
      const post = await insertPost(t, author.id);
      const action = await modA
        .post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'remove', reason: REASON })
        .expect(201);
      const appeal = await author.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(201);
      await modB
        .post(`/admin/appeals/${appeal.body.id}/decide`, { decision: 'upheld', reason: 'Clear scam, decision stands' })
        .expect(200);
      const [p] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
      expect(p!.moderationState).toBe('removed');
      const [note] = await notificationsFor(t, author.id, 'appeal_outcome');
      expect(textOf(note!)).toMatch(/decision stands/);
    });

    it('a suspended member can appeal, and overturning lifts the suspension', async () => {
      const author = await createMember(t);
      const action = await modA
        .post('/admin/moderation-actions', {
          targetType: 'member',
          targetId: author.handle,
          action: 'suspend',
          reason: REASON,
        })
        .expect(201);
      const [u] = await t.db.select().from(s.users).where(eq(s.users.id, author.id));
      expect(u).toMatchObject({ status: 'suspended', suspendedUntil: null });

      const session = await signInAgain(t, author.id);
      const appeal = await session.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(201);
      await modB
        .post(`/admin/appeals/${appeal.body.id}/decide`, {
          decision: 'overturned',
          reason: 'Context shows it was self-defence',
        })
        .expect(200);
      const [after] = await t.db.select().from(s.users).where(eq(s.users.id, author.id));
      expect(after).toMatchObject({ status: 'active', suspendedUntil: null });

      const other = await insertPost(t, modA.id);
      await session.post('/reports', { targetType: 'post', targetId: other.id, reason: 'spam' }).expect(201);
    });

    it('appeals close after 30 days', async () => {
      const author = await createMember(t);
      const action = await modA
        .post('/admin/moderation-actions', {
          targetType: 'member',
          targetId: author.id,
          action: 'warn',
          reason: REASON,
        })
        .expect(201);
      await t.db
        .update(s.moderationActions)
        .set({ createdAt: new Date(Date.now() - 31 * 24 * 3600_000) })
        .where(eq(s.moderationActions.id, action.body.id));
      const mine = await author.get('/me/moderation-actions').expect(200);
      expect(mine.body[0]).toMatchObject({ canAppeal: false });
      await author.post('/appeals', { actionId: action.body.id, statement: STATEMENT }).expect(422);
    });
  });

  describe('trending controls', () => {
    it('creates, replaces and revokes overrides, audited and shown in GET /admin/trending', async () => {
      await insertHashtag(t, 'AfCFTA');
      const crypto = await insertHashtag(t, 'CryptoGiveaway');
      await insertHashtag(t, 'CharterFellows');
      // Dated ahead so the trending computation (which runs inline on every override change) keeps it as the latest.
      await t.db.insert(s.trendingSnapshots).values({
        scopeType: 'global',
        window: '24h',
        computedAt: new Date(Date.now() + 3600_000),
        entries: [
          { tag: 'afcfta', display: 'AfCFTA', posts: 2481, authors: 1106, velocityPct: 312, status: 'trending' },
          {
            tag: 'cryptogiveaway',
            display: 'CryptoGiveaway',
            posts: 3920,
            authors: 31,
            velocityPct: 2140,
            status: 'trending',
          },
          {
            tag: 'smalltopic',
            display: 'SmallTopic',
            posts: 4,
            authors: 2,
            velocityPct: 10,
            status: 'below_threshold',
          },
        ],
      });

      await modA
        .post('/admin/trending/overrides', { tag: 'NoSuchTag', action: 'pin', reason: 'Applications close soon' })
        .expect(404);
      await modA.post('/admin/trending/overrides', { tag: 'AfCFTA', action: 'pin' }).expect(422);

      const sup = await modA
        .post('/admin/trending/overrides', {
          tag: 'CryptoGiveaway',
          action: 'suppress',
          reason: 'Coordinated giveaway spam from new accounts',
        })
        .expect(201);
      expect(sup.body).toMatchObject({
        tag: 'CryptoGiveaway',
        action: 'suppress',
        scope: 'global',
        scopeId: null,
        actor: { id: modA.id },
      });
      const pin = await modA
        .post('/admin/trending/overrides', {
          tag: 'CharterFellows',
          action: 'pin',
          reason: 'Applications close soon',
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        })
        .expect(201);

      const view = await modA.get('/admin/trending?scope=global&window=24h').expect(200);
      expect(view.body.rules).toMatchObject({ minDistinctAuthors: 25 });
      expect(view.body.computedAt).toBeTruthy();
      const byTag = Object.fromEntries(view.body.rows.map((r: any) => [r.tag, r]));
      expect(byTag.AfCFTA).toMatchObject({ rank: 1, status: 'trending', override: null });
      expect(byTag.CryptoGiveaway).toMatchObject({
        rank: null,
        status: 'suppressed',
        override: {
          id: sup.body.id,
          action: 'suppress',
          reason: 'Coordinated giveaway spam from new accounts',
          actor: { id: modA.id },
        },
      });
      expect(byTag.SmallTopic).toMatchObject({ rank: null, status: 'below_threshold' });
      expect(byTag.CharterFellows).toMatchObject({ rank: null, status: 'pinned', override: { id: pin.body.id } });

      // One active override per tag and scope: a new one replaces the old.
      const replaced = await modB
        .post('/admin/trending/overrides', {
          tag: 'cryptogiveaway',
          action: 'suppress',
          reason: 'Extending: campaign still running',
        })
        .expect(201);
      const active = await t.db
        .select()
        .from(s.trendingOverrides)
        .where(and(eq(s.trendingOverrides.hashtagId, crypto.id), sql`${s.trendingOverrides.revokedAt} is null`));
      expect(active.map((o) => o.id)).toEqual([replaced.body.id]);

      await modA.delete(`/admin/trending/overrides/${replaced.body.id}`, {}).expect(422);
      await modA
        .delete(`/admin/trending/overrides/${replaced.body.id}`, { reason: 'Campaign has stopped' })
        .expect(200);
      await modA
        .delete(`/admin/trending/overrides/${replaced.body.id}`, { reason: 'Campaign has stopped' })
        .expect(409);
      const after = await modA.get('/admin/trending').expect(200);
      expect(after.body.rows.find((r: any) => r.tag === 'CryptoGiveaway')).toMatchObject({
        status: 'trending',
        rank: 2,
        override: null,
      });

      const audit = await t.db
        .select()
        .from(s.auditLog)
        .where(sql`${s.auditLog.action} like 'trending.%'`);
      const actions = audit.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['trending.suppress', 'trending.pin', 'trending.unsuppress']));
      const unsup = audit.find((a) => a.action === 'trending.unsuppress')!;
      expect(unsup.after).toMatchObject({ reason: 'Campaign has stopped' });
      expect(unsup.actorId).toBe(modA.id);
    });

    it('updates trending rules (trending.manage) and audits them', async () => {
      const rules = { minDistinctAuthors: 30, maxPostsPerAuthorPerHour: 2, baselineDays: 14, recomputeMinutes: 5 };
      const res = await modA.put('/admin/trending/rules', rules).expect(200);
      expect(res.body).toEqual(rules);
      const view = await modA.get('/admin/trending').expect(200);
      expect(view.body.rules).toEqual(rules);
      const [a] = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'trending.rules.updated'));
      expect(a!.before).toMatchObject({ minDistinctAuthors: 25 });
      expect(a!.after).toMatchObject({ minDistinctAuthors: 30 });
      await modA.put('/admin/trending/rules', { ...rules, minDistinctAuthors: 0 }).expect(422);
    });
  });

  it('expiry job lifts expired restrictions and suspensions and expires overrides', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3600_000);
    const restricted = await createMember(t);
    const suspended = await createMember(t);
    const stillSuspended = await createMember(t);
    await t.db
      .update(s.users)
      .set({ restrictedPostingUntil: past, restrictedConnectingUntil: future })
      .where(eq(s.users.id, restricted.id));
    await t.db.update(s.users).set({ status: 'suspended', suspendedUntil: past }).where(eq(s.users.id, suspended.id));
    await t.db
      .update(s.users)
      .set({ status: 'suspended', suspendedUntil: null })
      .where(eq(s.users.id, stillSuspended.id));
    const h = await insertHashtag(t, 'ExpiringTopic');
    const [o] = await t.db
      .insert(s.trendingOverrides)
      .values({ hashtagId: h.id, action: 'pin', reason: 'Short pin', actorId: modA.id, expiresAt: past })
      .returning();

    const result = await expireRestrictions({
      db: t.db,
      audit: t.app.get(AuditService),
      queue: t.app.get(QueueService),
    });
    expect(result).toMatchObject({ postingLifted: 1, connectingLifted: 0, suspensionsLifted: 1, overridesExpired: 1 });

    const [r] = await t.db.select().from(s.users).where(eq(s.users.id, restricted.id));
    expect(r!.restrictedPostingUntil).toBeNull();
    expect(r!.restrictedConnectingUntil).not.toBeNull();
    const [su] = await t.db.select().from(s.users).where(eq(s.users.id, suspended.id));
    expect(su).toMatchObject({ status: 'active', suspendedUntil: null });
    const [still] = await t.db.select().from(s.users).where(eq(s.users.id, stillSuspended.id));
    expect(still!.status).toBe('suspended');
    const [ov] = await t.db.select().from(s.trendingOverrides).where(eq(s.trendingOverrides.id, o!.id));
    expect(ov!.revokedAt).not.toBeNull();

    const sys = await t.db
      .select()
      .from(s.auditLog)
      .where(sql`${s.auditLog.actorId} is null and ${s.auditLog.action} like 'moderation.%expired'`);
    expect(sys.map((a) => a.targetId)).toEqual(expect.arrayContaining([restricted.id, suspended.id]));

    // The suspended member is back: the next sign-in can act again.
    const back = await signInAgain(t, suspended.id);
    const p = await insertPost(t, modA.id);
    await back.post('/reports', { targetType: 'post', targetId: p.id, reason: 'spam' }).expect(201);

    // Idempotent: nothing left to expire. The service wrapper runs the same job.
    expect(await t.app.get(ExpiryService).run()).toMatchObject({
      postingLifted: 0,
      suspensionsLifted: 0,
      overridesExpired: 0,
    });
  });

  describe('audit log (CM-ADM-09)', () => {
    it('lists entries with actor and summary, filtered by actor, action prefix and target type', async () => {
      const all = await modA.get('/admin/audit?limit=100').expect(200);
      expect(all.body.items.length).toBeGreaterThan(5);
      const entry = all.body.items.find((e: any) => e.action === 'trending.pin');
      expect(entry).toMatchObject({
        actor: { id: modA.id },
        targetType: 'hashtag',
        targetId: 'charterfellows',
        summary: 'Pinned #charterfellows in trending',
      });
      expect(entry).not.toHaveProperty('before');

      const byPrefix = await modA.get('/admin/audit?action=trending.').expect(200);
      expect(byPrefix.body.items.every((e: any) => e.action.startsWith('trending.'))).toBe(true);
      const byActor = await modA.get(`/admin/audit?actor=@${modB.handle}`).expect(200);
      expect(byActor.body.items.length).toBeGreaterThan(0);
      expect(byActor.body.items.every((e: any) => e.actor?.id === modB.id)).toBe(true);
      const byType = await modA.get('/admin/audit?targetType=member').expect(200);
      expect(byType.body.items.every((e: any) => e.targetType === 'member')).toBe(true);
      const system = await modA.get('/admin/audit?actor=system').expect(200);
      expect(system.body.items.every((e: any) => e.actor === null)).toBe(true);
      expect((await modA.get('/admin/audit?actor=nobody-here')).body.items).toEqual([]);

      const p1 = await modA.get('/admin/audit?limit=2').expect(200);
      const p2 = await modA.get(`/admin/audit?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
      expect(Number(p2.body.items[0].id)).toBeLessThan(Number(p1.body.items[1].id));
    });

    it('is append-only: UPDATE and DELETE on audit_log throw', async () => {
      await expect(t.db.execute(sql`update audit_log set action = 'tampered'`)).rejects.toThrow();
      await expect(t.db.execute(sql`delete from audit_log`)).rejects.toThrow();
    });

    it('CSV export is for Platform Admins only and never includes before/after', async () => {
      const denied = await modA.get('/admin/audit/export.csv').expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      const pa = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
      const res = await pa.get('/admin/audit/export.csv?action=moderation.').expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-log-/);
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toBe('id,created_at,actor_id,actor_handle,action,target_type,target_id,summary');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.slice(1).every((l) => l.includes(',moderation.'))).toBe(true);
      expect(res.text).not.toContain(REASON);
      const [exp] = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'audit.exported'));
      expect(exp!.actorId).toBe(pa.id);
    });
  });
});
