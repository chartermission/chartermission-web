import { and, asc, eq, isNull } from 'drizzle-orm';
import { count, createTestApp, s, type TestApp } from '../helpers.js';
import { startRun, RunInProgressError } from '../../src/learning/learning-sync.js';
import { courseRecord, fixture, learning } from './learning-helpers.js';

describe('Learning: catalogue sync', () => {
  let t: TestApp;
  let l: ReturnType<typeof learning>;

  beforeAll(async () => {
    t = await createTestApp();
    l = learning(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('creates every fixture course, topic link and path, and records the run', async () => {
    const run = await l.sync();
    expect(run).toMatchObject({ kind: 'sync', trigger: 'schedule', status: 'succeeded', createdCount: 21, updatedCount: 0, removedCount: 0, error: null });
    expect(await count(t.db, s.courses)).toBe(18);
    expect(await count(t.db, s.learningPaths)).toBe(3);

    const carbon = await l.course('carbon-finance-fundamentals');
    expect(carbon).toMatchObject({
      externalId: '1004',
      title: 'Carbon Finance Fundamentals',
      level: 'intermediate',
      durationMinutes: 300,
      lessons: 14,
      language: 'en',
      free: false,
      startUrl: 'https://chartercenter.org/courses/carbon-finance-fundamentals',
      hidden: false,
      featured: false,
      linkStatus: 'unknown',
      removedAt: null,
    });
    const topics = await t.db
      .select({ slug: s.courseTopics.slug })
      .from(s.courseTopicLinks)
      .innerJoin(s.courseTopics, eq(s.courseTopics.id, s.courseTopicLinks.topicId))
      .where(eq(s.courseTopicLinks.courseId, carbon.id));
    expect(topics.map((x) => x.slug).sort()).toEqual(['climate', 'finance']);
    // Topics given as slugs ("tech") and names ("Tech & data") land on the same seeded topic.
    expect(await count(t.db, s.courseTopics)).toBe(8);

    const [path] = await t.db.select().from(s.learningPaths).where(eq(s.learningPaths.slug, 'from-idea-to-first-export'));
    const order = await t.db
      .select({ slug: s.courses.slug })
      .from(s.learningPathCourses)
      .innerJoin(s.courses, eq(s.courses.id, s.learningPathCourses.courseId))
      .where(eq(s.learningPathCourses.pathId, path!.id))
      .orderBy(asc(s.learningPathCourses.position));
    expect(order.map((o) => o.slug)).toEqual([
      'export-readiness-for-african-smes',
      'afcfta-rules-of-origin-explained',
      'exporter-en-afrique-de-l-ouest',
      'pitching-to-diaspora-investors',
      'mobile-money-and-payments-apis',
    ]);
    expect(path!.position).toBe(0);
  });

  it('a second identical sync changes nothing', async () => {
    const run = await l.sync();
    expect(run).toMatchObject({ status: 'succeeded', createdCount: 0, updatedCount: 0, removedCount: 0 });
  });

  it('updates changed courses, marks missing ones removed, preserves curation, and restores reappearing ones', async () => {
    const export_ = await l.course('export-readiness-for-african-smes');
    const sql_ = await l.course('data-for-development-intro-to-sql');
    // Local curation and link state that the sync must never touch.
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, export_.id));
    await t.db.update(s.courses).set({ featured: true, featuredAt: new Date(), linkStatus: 'broken', linkFailures: 2 }).where(eq(s.courses.id, sql_.id));

    const data = fixture();
    const rec = data.courses.find((c: any) => c.id === 1001) as any;
    rec.title = 'Export Readiness for African SMEs (2027 edition)';
    rec.duration_minutes = 260;
    rec.topics = ['Business & trade', 'Policy'];
    const sqlRec = data.courses.find((c: any) => c.id === 1002) as any;
    sqlRec.description = 'Updated description';
    // 1003 disappears; 1008 is archived on Charter Center; a brand-new course with a new topic arrives.
    data.courses = data.courses.filter((c: any) => c.id !== 1003);
    (data.courses.find((c: any) => c.id === 1008) as any).status = 'archived';
    data.courses.push(courseRecord(2001, { topics: ['Creative industries'], slug: 'film-financing-basics', title: 'Film Financing Basics' }));
    l.setCatalogue(data);

    const run = await l.sync();
    // Updated: the two edited courses plus the climate path, which lost course 1003.
    expect(run).toMatchObject({ status: 'succeeded', createdCount: 1, updatedCount: 3, removedCount: 2 });

    const after = await l.course('export-readiness-for-african-smes');
    expect(after).toMatchObject({ title: 'Export Readiness for African SMEs (2027 edition)', durationMinutes: 260, hidden: true, removedAt: null });
    const afterSql = await l.course('data-for-development-intro-to-sql');
    expect(afterSql).toMatchObject({ description: 'Updated description', featured: true, linkStatus: 'broken', linkFailures: 2 });
    expect((await l.course('leading-distributed-teams')).removedAt).not.toBeNull();
    expect((await l.course('grant-writing-that-wins')).removedAt).not.toBeNull();
    const [topic] = await t.db.select().from(s.courseTopics).where(eq(s.courseTopics.slug, 'creative-industries'));
    expect(topic?.name).toBe('Creative industries');

    // The course comes back: un-removed, and back in its path.
    data.courses.push(fixture().courses.find((c: any) => c.id === 1003)!);
    l.setCatalogue(data);
    const back = await l.sync();
    expect(back).toMatchObject({ status: 'succeeded', createdCount: 0, updatedCount: 2, removedCount: 0 });
    expect((await l.course('leading-distributed-teams')).removedAt).toBeNull();
  });

  it('suffixes a slug that clashes with another course and keeps it stable', async () => {
    const data = fixture();
    data.courses.push(courseRecord(3001, { slug: 'carbon-finance-fundamentals', title: 'Carbon Finance Fundamentals (French)' }));
    l.setCatalogue(data);
    await l.sync();
    const [dup] = await t.db.select().from(s.courses).where(eq(s.courses.externalId, '3001'));
    expect(dup!.slug).toBe('carbon-finance-fundamentals-2');
    await l.sync();
    const [again] = await t.db.select().from(s.courses).where(eq(s.courses.externalId, '3001'));
    expect(again!.slug).toBe('carbon-finance-fundamentals-2');
  });

  it('skips records it cannot map and notes them on the run', async () => {
    const data = fixture();
    data.courses.push(courseRecord(4001, { url: 'http://insecure.example.org/course' }));
    l.setCatalogue(data);
    const run = await l.sync();
    expect(run!.status).toBe('succeeded');
    expect(run!.error).toMatch(/Skipped 1 record.*4001.*https/);
    expect(await count(t.db, s.courses, eq(s.courses.externalId, '4001'))).toBe(0);
  });

  it('refuses to empty the catalogue when the source returns no courses', async () => {
    l.setCatalogue({ courses: [], paths: [] });
    const run = await l.sync();
    expect(run).toMatchObject({ status: 'failed' });
    expect(run!.error).toMatch(/no published courses/);
    expect(await count(t.db, s.courses, and(isNull(s.courses.removedAt), eq(s.courses.externalId, '1004')))).toBe(1);
  });

  it('records a failed run when Charter Center sends an unexpected payload', async () => {
    l.setCatalogue({ courses: [{ nope: true }], paths: [] });
    const run = await l.sync();
    expect(run!.status).toBe('failed');
    expect(run!.error).toMatch(/Unexpected \/courses response/);
    l.setCatalogue(fixture());
  });

  it('allows only one running sync at a time', async () => {
    const results = await Promise.allSettled([startRun(t.db, 'sync', 'admin'), startRun(t.db, 'sync', 'admin'), startRun(t.db, 'sync', 'schedule')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(RunInProgressError);
    // A scheduled job while one is running is skipped, not failed.
    expect(await l.sync()).toBeNull();
    // A link check is a different kind and may run alongside.
    const lc = await startRun(t.db, 'link_check', 'admin');
    expect(lc.status).toBe('running');
    await t.db.update(s.learningSyncRuns).set({ status: 'failed', finishedAt: new Date() }).where(eq(s.learningSyncRuns.status, 'running'));
  });

  it('marks a run stuck for over an hour as failed before starting a new one', async () => {
    const [stale] = await t.db
      .insert(s.learningSyncRuns)
      .values({ kind: 'sync', trigger: 'schedule', status: 'running', startedAt: new Date(Date.now() - 2 * 3600_000) })
      .returning();
    const run = await l.sync();
    expect(run!.status).toBe('succeeded');
    const [after] = await t.db.select().from(s.learningSyncRuns).where(eq(s.learningSyncRuns.id, stale!.id));
    expect(after!.status).toBe('failed');
  });
});
