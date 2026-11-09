import { and, desc, eq } from 'drizzle-orm';
import type { AdminCourseView, Page, SyncRunView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { learning, openLearning } from './learning-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Learning: admin', () => {
  let t: TestApp;
  let l: ReturnType<typeof learning>;
  let admin: Member;

  beforeAll(async () => {
    t = await createTestApp();
    await openLearning(t);
    l = learning(t);
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  it('needs an admin session with course.curate', async () => {
    const member = await createMember(t, { name: 'Member' });
    const moderator = await createMember(t, { name: 'Mod', roles: ['moderator'], admin: true });
    const memberSessionAdmin = await createMember(t, { name: 'Admin on member site', roles: ['platform_admin'] });
    for (const who of [member, moderator, memberSessionAdmin]) {
      await who.get('/admin/courses').expect(403);
      await who.get('/admin/learning/sync-runs').expect(403);
      await who.post('/admin/learning/sync').expect(403);
      await who.post('/admin/learning/link-check').expect(403);
      await who.patch('/admin/courses/00000000-0000-4000-8000-000000000000', { hidden: true }).expect(403);
    }
    await t.http().get('/api/v1/admin/courses').set('X-CM-Audience', 'admin').expect(401);
  });

  it('POST /admin/learning/sync starts a run (202) and the catalogue appears', async () => {
    const res = await admin.post('/admin/learning/sync').expect(202);
    const run = res.body as SyncRunView;
    expect(run).toMatchObject({ kind: 'sync', trigger: 'admin', status: 'running', triggeredBy: 'Ada Admin', finishedAt: null });
    // Queues run inline in tests, so the run has finished by now.
    const runs = (await admin.get('/admin/learning/sync-runs').expect(200)).body as Page<SyncRunView>;
    expect(runs.items[0]).toMatchObject({ id: run.id, status: 'succeeded', created: 21, updated: 0, removed: 0, error: null });
    expect(runs.items[0]!.finishedAt).not.toBeNull();
  });

  it('answers CONFLICT while a run of the same kind is running', async () => {
    const [running] = await t.db.insert(s.learningSyncRuns).values({ kind: 'sync', trigger: 'schedule', status: 'running' }).returning();
    const res = await admin.post('/admin/learning/sync').expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The other kind is independent.
    const lc = (await admin.post('/admin/learning/link-check').expect(202)).body as SyncRunView;
    expect(lc).toMatchObject({ kind: 'link_check', status: 'running' });
    await t.db.insert(s.learningSyncRuns).values({ kind: 'link_check', trigger: 'schedule', status: 'running' });
    await admin.post('/admin/learning/link-check').expect(409);
    await t.db.update(s.learningSyncRuns).set({ status: 'failed', finishedAt: new Date() }).where(eq(s.learningSyncRuns.status, 'running'));
    expect(running).toBeTruthy();
  });

  it('lists sync and link-check history newest first with cursors', async () => {
    await admin.post('/admin/learning/link-check').expect(202);
    const first = (await admin.get('/admin/learning/sync-runs?limit=2').expect(200)).body as Page<SyncRunView>;
    expect(first.items).toHaveLength(2);
    // Second check in this file: the fixture's broken link has now failed twice.
    expect(first.items[0]).toMatchObject({ kind: 'link_check', trigger: 'admin', checked: 18, broken: 1, status: 'succeeded' });
    expect(first.nextCursor).not.toBeNull();
    const rest = (await admin.get(`/admin/learning/sync-runs?limit=50&cursor=${first.nextCursor}`).expect(200)).body as Page<SyncRunView>;
    const ids = [...first.items, ...rest.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it('GET /admin/courses includes hidden, removed and broken courses with filters', async () => {
    const all = (await admin.get('/admin/courses?limit=100').expect(200)).body as Page<AdminCourseView>;
    expect(all.items).toHaveLength(18);
    expect(all.items[0]).toMatchObject({ hidden: false, removedAt: null, externalId: expect.any(String), clicks30d: 0, saved: false });
    expect(all.items.map((c) => c.title.toLowerCase())[0]).toBe('afcfta rules of origin explained');

    const broken = await l.course('cooperative-agribusiness-farm-to-market');
    await t.db.update(s.courses).set({ linkStatus: 'broken', linkFailures: 2, linkHttpStatus: 404 }).where(eq(s.courses.id, broken.id));
    const removed = await l.course('leading-distributed-teams');
    await t.db.update(s.courses).set({ removedAt: new Date() }).where(eq(s.courses.id, removed.id));

    const brokenList = (await admin.get('/admin/courses?status=broken').expect(200)).body as Page<AdminCourseView>;
    expect(brokenList.items).toHaveLength(1);
    // Admins still get the URL (sourceUrl) while members get startUrl null.
    expect(brokenList.items[0]).toMatchObject({ linkStatus: 'broken', startUrl: null, httpStatus: 404, sourceUrl: broken.startUrl });
    const removedList = (await admin.get('/admin/courses?status=removed').expect(200)).body as Page<AdminCourseView>;
    expect(removedList.items.map((c) => c.id)).toEqual([removed.id]);
    expect(removedList.items[0]!.removedAt).not.toBeNull();
    const visible = (await admin.get('/admin/courses?status=visible&limit=100').expect(200)).body as Page<AdminCourseView>;
    expect(visible.items).toHaveLength(17);
    const search = (await admin.get('/admin/courses?q=1004').expect(200)).body as Page<AdminCourseView>;
    expect(search.items.map((c) => c.slug)).toEqual(['carbon-finance-fundamentals']);

    // Cursor pagination covers everything once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await admin.get(`/admin/courses?limit=7${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body as Page<AdminCourseView>;
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(18);
  });

  it('PATCH /admin/courses/:id hides and features (audited) and the sync keeps it', async () => {
    const course = await l.course('carbon-finance-fundamentals');
    const view = (await admin.patch(`/admin/courses/${course.id}`, { featured: true }).expect(200)).body as AdminCourseView;
    expect(view).toMatchObject({ featured: true, hidden: false });
    const hidden = (await admin.patch(`/admin/courses/${course.id}`, { hidden: true }).expect(200)).body as AdminCourseView;
    expect(hidden).toMatchObject({ featured: true, hidden: true });
    expect(((await admin.get('/admin/courses?status=hidden').expect(200)).body as Page<AdminCourseView>).items.map((c) => c.id)).toEqual([course.id]);
    expect(((await admin.get('/admin/courses?status=featured').expect(200)).body as Page<AdminCourseView>).items.map((c) => c.id)).toEqual([course.id]);

    const audit = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'course.curated'), eq(s.auditLog.targetId, course.id)))
      .orderBy(desc(s.auditLog.createdAt));
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorId: admin.id, targetType: 'course', before: expect.objectContaining({ hidden: false }), after: { hidden: true, featured: true } });

    // No-op changes are not audited; empty bodies and content fields are rejected.
    await admin.patch(`/admin/courses/${course.id}`, { hidden: true }).expect(200);
    const after = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'course.curated'), eq(s.auditLog.targetId, course.id)));
    expect(after).toHaveLength(2);
    await admin.patch(`/admin/courses/${course.id}`, {}).expect(422);
    await admin.patch(`/admin/courses/${course.id}`, { title: 'Edited' }).expect(422);
    await admin.patch('/admin/courses/00000000-0000-4000-8000-000000000000', { hidden: true }).expect(404);

    await admin.post('/admin/learning/sync').expect(202);
    expect(await l.course('carbon-finance-fundamentals')).toMatchObject({ hidden: true, featured: true });

    // Member view: hidden courses are gone.
    const member = await createMember(t, { name: 'Member Two' });
    await member.get('/courses/carbon-finance-fundamentals').expect(404);
    await admin.patch(`/admin/courses/${course.id}`, { hidden: false }).expect(200);
    await member.get('/courses/carbon-finance-fundamentals').expect(200);
  });

  it('counts charter_center_click events from the last 30 days', async () => {
    const course = await l.course('export-readiness-for-african-smes');
    await t.db.insert(s.analyticsEvents).values([
      { name: 'charter_center_click', subjectId: course.id },
      { name: 'charter_center_click', subjectId: course.id },
      { name: 'charter_center_click', subjectId: course.id, createdAt: new Date(Date.now() - 40 * 86_400_000) },
      { name: 'event_published', subjectId: course.id },
    ]);
    const page = (await admin.get('/admin/courses?q=Export%20Readiness').expect(200)).body as Page<AdminCourseView>;
    expect(page.items[0]!.clicks30d).toBe(2);
  });
});
