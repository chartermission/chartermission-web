import { and, eq } from 'drizzle-orm';
import type { CourseDetail, CourseSummary, LearningHub, LearningPath, Page } from '@chartermission/contracts';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { learning } from './learning-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Learning: member catalogue', () => {
  let t: TestApp;
  let l: ReturnType<typeof learning>;
  let amara: Member;

  const slugs = (p: Page<CourseSummary>) => p.items.map((c) => c.slug);
  async function list(m: Member, qs = ''): Promise<Page<CourseSummary>> {
    const res = await m.get(`/courses${qs}`).expect(200);
    return res.body as Page<CourseSummary>;
  }
  /** Every page, following cursors. */
  async function all(m: Member, qs = '', limit = 5): Promise<CourseSummary[]> {
    const out: CourseSummary[] = [];
    let cursor: string | null = null;
    do {
      const sep = qs ? '&' : '?';
      const page = await list(m, `${qs}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  beforeAll(async () => {
    t = await createTestApp();
    l = learning(t);
    await l.sync();
    amara = await createMember(t, { name: 'Amara Okafor' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('requires sign-in for every member endpoint', async () => {
    const http = t.http();
    await http.get('/api/v1/learning').expect(401);
    await http.get('/api/v1/courses').expect(401);
    await http.get('/api/v1/courses/carbon-finance-fundamentals').expect(401);
    await http.get('/api/v1/learning/paths/from-idea-to-first-export').expect(401);
  });

  it('GET /learning returns featured, paths, topic/language/level counts and the last sync time', async () => {
    const a = await l.course('export-readiness-for-african-smes');
    const b = await l.course('carbon-finance-fundamentals');
    await t.db.update(s.courses).set({ featured: true, featuredAt: new Date(Date.now() - 60_000) }).where(eq(s.courses.id, a.id));
    await t.db.update(s.courses).set({ featured: true, featuredAt: new Date() }).where(eq(s.courses.id, b.id));
    const hub = (await amara.get('/learning').expect(200)).body as LearningHub;
    expect(hub.featured.map((c) => c.slug)).toEqual(['carbon-finance-fundamentals', 'export-readiness-for-african-smes']);
    expect(hub.paths.map((p) => p.slug)).toEqual(['from-idea-to-first-export', 'data-and-digital-for-development', 'climate-smart-enterprise']);
    expect(hub.paths[0]).toMatchObject({ courseCount: 5, totalMinutes: 240 + 90 + 150 + 120 + 240, level: 'beginner' });
    expect(hub.total).toBe(18);
    expect(hub.topics.map((x) => x.topic.slug)).toEqual(['business', 'tech', 'leadership', 'climate', 'finance', 'policy', 'health', 'agriculture']);
    expect(hub.topics.find((x) => x.topic.slug === 'health')!.courses).toBe(2);
    expect(hub.languages[0]).toEqual({ code: 'en', name: 'English', courses: 12 });
    expect(hub.languages.map((x) => x.code).sort()).toEqual(['ar', 'en', 'fr', 'pt', 'sw']);
    expect(hub.languages.find((x) => x.code === 'sw')!.name).toBe('Swahili');
    expect(hub.levels.map((x) => x.level)).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(hub.levels.reduce((n, x) => n + x.courses, 0)).toBe(18);
    expect(hub.syncedAt).not.toBeNull();
  });

  it('serialises a summary with labels and the exact start URL', async () => {
    const page = await list(amara, '?q=Carbon%20Finance');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      title: 'Carbon Finance Fundamentals',
      provider: 'Charter Center',
      level: 'intermediate',
      durationMinutes: 300,
      durationLabel: '5 hours · 14 lessons',
      lessons: 14,
      language: 'en',
      languageName: 'English',
      free: false,
      featured: true,
      linkStatus: 'unknown',
      saved: false,
      startUrl: 'https://chartercenter.org/courses/carbon-finance-fundamentals',
    });
    expect(page.items[0]!.topics.map((x) => x.slug)).toEqual(['climate', 'finance']);
    const short = (await list(amara, '?q=Community%20Health')).items[0]!;
    expect(short.durationLabel).toBe('30 min · 2 lessons');
    const noDuration = (await list(amara, '?q=Uongozi')).items[0]!;
    expect(noDuration).toMatchObject({ durationMinutes: null, durationLabel: '3 lessons' });
  });

  it('filters by search text across title, provider and description', async () => {
    expect(slugs(await list(amara, '?q=accra%20school&sort=title'))).toEqual(['community-health-data-essentials', 'health-systems-financing-in-africa']);
    expect(slugs(await list(amara, '?q=warehouse%20receipts'))).toEqual(['cooperative-agribusiness-farm-to-market']);
    expect((await list(amara, '?q=%25')).items).toHaveLength(0);
  });

  it('filters by topic, level, language, duration and free', async () => {
    const health = await all(amara, '?topic=health');
    expect(health.map((c) => c.slug).sort()).toEqual(['community-health-data-essentials', 'health-systems-financing-in-africa']);
    expect((await all(amara, '?topic=agriculture')).map((c) => c.slug).sort()).toEqual(['cooperative-agribusiness-farm-to-market', 'kilimo-kinachostahimili-tabianchi']);
    expect((await all(amara, '?topic=nonexistent'))).toHaveLength(0);

    const advanced = await all(amara, '?level=advanced');
    expect(advanced.map((c) => c.slug).sort()).toEqual(['health-systems-financing-in-africa', 'product-management-in-emerging-markets']);

    const fr = await all(amara, '?language=fr');
    expect(fr.map((c) => c.slug).sort()).toEqual(['exporter-en-afrique-de-l-ouest', 'politiques-publiques-numeriques']);
    expect(fr.every((c) => c.languageName === 'French')).toBe(true);
    expect((await all(amara, '?language=sw')).length).toBe(2);
    await amara.get('/courses?language=not_a_code!').expect(422);

    const under = await all(amara, '?duration=under_1h');
    expect(under.every((c) => c.durationMinutes !== null && c.durationMinutes < 60)).toBe(true);
    expect(under.map((c) => c.slug)).toEqual(['community-health-data-essentials']);
    const mid = await all(amara, '?duration=1_5h');
    expect(mid.every((c) => c.durationMinutes! >= 60 && c.durationMinutes! <= 300)).toBe(true);
    expect(mid.map((c) => c.slug)).toContain('kilimo-kinachostahimili-tabianchi'); // exactly 60 min
    expect(mid.map((c) => c.slug)).toContain('carbon-finance-fundamentals'); // exactly 300 min
    const over = await all(amara, '?duration=over_5h');
    expect(over.map((c) => c.slug).sort()).toEqual(['data-for-development-intro-to-sql', 'health-systems-financing-in-africa', 'product-management-in-emerging-markets']);
    expect(under.length + mid.length + over.length).toBe(17); // one course has no duration

    const free = await all(amara, '?free=true');
    expect(free.every((c) => c.free)).toBe(true);
    const paid = await all(amara, '?free=false');
    expect(paid.map((c) => c.slug).sort()).toEqual([
      'carbon-finance-fundamentals',
      'health-systems-financing-in-africa',
      'politiques-publiques-numeriques',
      'product-management-in-emerging-markets',
    ]);
    expect(free.length + paid.length).toBe(18);

    const combined = await all(amara, '?topic=business&level=beginner&language=en&free=true&duration=1_5h');
    expect(combined.map((c) => c.slug).sort()).toEqual(['export-readiness-for-african-smes', 'pitching-to-diaspora-investors']);
  });

  it('matches regional language tags with the base language', async () => {
    const pt = await l.course('introducao-ao-financiamento-de-startups');
    await t.db.update(s.courses).set({ language: 'pt-BR' }).where(eq(s.courses.id, pt.id));
    const items = await all(amara, '?language=pt');
    expect(items.map((c) => c.slug)).toEqual(['introducao-ao-financiamento-de-startups']);
    expect(items[0]!.languageName).toBe('Brazilian Portuguese');
    await t.db.update(s.courses).set({ language: 'pt' }).where(eq(s.courses.id, pt.id));
  });

  it('sorts and paginates every sort order without gaps or repeats', async () => {
    const featured = await all(amara, '?sort=featured', 4);
    expect(featured).toHaveLength(18);
    expect(new Set(featured.map((c) => c.id)).size).toBe(18);
    expect(featured.slice(0, 2).every((c) => c.featured)).toBe(true);

    const titles = (await all(amara, '?sort=title', 5)).map((c) => c.title.toLowerCase());
    expect(titles).toHaveLength(18);
    expect(titles[0]).toBe('afcfta rules of origin explained');
    const pageTitles = (await list(amara, '?sort=title&limit=50')).items.map((c) => c.title.toLowerCase());
    expect(titles).toEqual(pageTitles);

    const shortest = await all(amara, '?sort=shortest', 3);
    expect(shortest).toHaveLength(18);
    expect(shortest[0]!.durationMinutes).toBe(30);
    expect(shortest[16]!.durationMinutes).toBe(720);
    expect(shortest[17]!.durationMinutes).toBeNull();

    const newest = await all(amara, '?sort=newest', 7);
    expect(newest).toHaveLength(18);
    expect(newest[0]!.slug).toBe('afcfta-rules-of-origin-explained'); // updated 2026-10-30
    await amara.get('/courses?cursor=garbage').expect(400);
  });

  it('GET /courses/:slug returns the detail with paths; hidden and removed courses are 404', async () => {
    const detail = (await amara.get('/courses/mobile-money-and-payments-apis').expect(200)).body as CourseDetail;
    expect(detail).toMatchObject({
      eligibility: 'Some programming experience recommended',
      accessConditions: 'Free Charter Center account required',
      sourceUpdatedAt: '2026-10-09T11:00:00.000Z',
    });
    expect(detail.outcomes).toHaveLength(4);
    expect(detail.description).toMatch(/mobile money/);
    expect(detail.paths.map((p) => p.slug)).toEqual(['from-idea-to-first-export', 'data-and-digital-for-development']);

    const hidden = await l.course('grant-writing-that-wins');
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, hidden.id));
    await amara.get('/courses/grant-writing-that-wins').expect(404);
    expect(slugs(await list(amara, '?q=grant'))).toEqual([]);

    const removed = await l.course('leading-distributed-teams');
    await t.db.update(s.courses).set({ removedAt: new Date() }).where(eq(s.courses.id, removed.id));
    await amara.get('/courses/leading-distributed-teams').expect(404);
    await amara.get('/courses/no-such-course').expect(404);

    const hub = (await amara.get('/learning').expect(200)).body as LearningHub;
    expect(hub.total).toBe(16);
    expect(hub.paths.find((p) => p.slug === 'climate-smart-enterprise')!.courseCount).toBe(3);

    await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, hidden.id));
    await t.db.update(s.courses).set({ removedAt: null }).where(eq(s.courses.id, removed.id));
  });

  it('GET /learning/paths/:slug lists visible courses in path order; empty or removed paths are 404', async () => {
    const path = (await amara.get('/learning/paths/data-and-digital-for-development').expect(200)).body as LearningPath;
    expect(path.courses.map((c) => c.slug)).toEqual([
      'community-health-data-essentials',
      'data-for-development-intro-to-sql',
      'mobile-money-and-payments-apis',
      'product-management-in-emerging-markets',
    ]);
    expect(path).toMatchObject({ courseCount: 4, totalMinutes: 30 + 360 + 240 + 420, sourceUrl: 'https://chartercenter.org/paths/data-and-digital-for-development' });

    const ids = path.courses.map((c) => c.id);
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, ids[0]!));
    const fewer = (await amara.get('/learning/paths/data-and-digital-for-development').expect(200)).body as LearningPath;
    expect(fewer.courses).toHaveLength(3);
    for (const id of ids) await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, id));
    await amara.get('/learning/paths/data-and-digital-for-development').expect(404);
    const hub = (await amara.get('/learning').expect(200)).body as LearningHub;
    expect(hub.paths.map((p) => p.slug)).not.toContain('data-and-digital-for-development');
    for (const id of ids) await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, id));

    const [p] = await t.db.select().from(s.learningPaths).where(eq(s.learningPaths.slug, 'climate-smart-enterprise'));
    await t.db.update(s.learningPaths).set({ removedAt: new Date() }).where(eq(s.learningPaths.id, p!.id));
    await amara.get('/learning/paths/climate-smart-enterprise').expect(404);
    await t.db.update(s.learningPaths).set({ removedAt: null }).where(eq(s.learningPaths.id, p!.id));
    await amara.get('/learning/paths/nope').expect(404);
  });

  it('saves courses with the bookmark endpoints and lists them with saved=true', async () => {
    const a = await l.course('carbon-finance-fundamentals');
    const b = await l.course('export-readiness-for-african-smes');
    const c = await l.course('grant-writing-that-wins');
    await amara.put('/bookmarks', { targetType: 'course', targetId: a.id }).expect(200);
    await amara.put('/bookmarks', { targetType: 'course', targetId: a.id }).expect(200); // idempotent
    await amara.put('/bookmarks', { targetType: 'course', targetId: b.id }).expect(200);
    await amara.put('/bookmarks', { targetType: 'course', targetId: c.id }).expect(200);
    // Bookmark order: c newest.
    await t.db.update(s.bookmarks).set({ createdAt: new Date(Date.now() - 3000) }).where(and(eq(s.bookmarks.userId, amara.id), eq(s.bookmarks.targetId, a.id)));
    await t.db.update(s.bookmarks).set({ createdAt: new Date(Date.now() - 2000) }).where(and(eq(s.bookmarks.userId, amara.id), eq(s.bookmarks.targetId, b.id)));

    const saved = await all(amara, '?saved=true', 2);
    expect(saved.map((x) => x.slug)).toEqual(['grant-writing-that-wins', 'export-readiness-for-african-smes', 'carbon-finance-fundamentals']);
    expect(saved.every((x) => x.saved)).toBe(true);
    // An explicit sort wins over bookmark order.
    expect((await all(amara, '?saved=true&sort=title')).map((x) => x.slug)).toEqual([
      'carbon-finance-fundamentals',
      'export-readiness-for-african-smes',
      'grant-writing-that-wins',
    ]);
    expect((await all(amara, '?saved=true&free=false')).map((x) => x.slug)).toEqual(['carbon-finance-fundamentals']);
    expect(((await amara.get('/courses/carbon-finance-fundamentals').expect(200)).body as CourseDetail).saved).toBe(true);

    // Someone else's view is unaffected; /me/bookmarks stays posts-only.
    const kwame = await createMember(t, { name: 'Kwame Mensah' });
    expect(await all(kwame, '?saved=true')).toHaveLength(0);
    expect(((await kwame.get('/courses/carbon-finance-fundamentals').expect(200)).body as CourseDetail).saved).toBe(false);
    expect((await amara.get('/me/bookmarks').expect(200)).body.items).toHaveLength(0);

    // Hidden saved courses drop out; unsaving works.
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, c.id));
    expect((await all(amara, '?saved=true')).map((x) => x.slug)).not.toContain('grant-writing-that-wins');
    await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, c.id));
    await amara.delete('/bookmarks', { targetType: 'course', targetId: b.id }).expect(200);
    expect(await all(amara, '?saved=true')).toHaveLength(2);
  });

  it('refuses to bookmark courses and events that are not visible', async () => {
    const hidden = await l.course('grant-writing-that-wins');
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, hidden.id));
    await amara.put('/bookmarks', { targetType: 'course', targetId: hidden.id }).expect(404);
    await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, hidden.id));
    await amara.put('/bookmarks', { targetType: 'course', targetId: '00000000-0000-4000-8000-000000000000' }).expect(404);

    const host = await createMember(t, { name: 'Event Host' });
    const base = {
      title: 'Trade Week',
      summary: 'A week of trade sessions',
      format: 'online',
      hostType: 'member',
      hostMemberId: host.id,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      timezone: 'Africa/Lagos',
      createdBy: host.id,
    };
    const [published] = await t.db.insert(s.events).values({ ...base, slug: 'trade-week', status: 'published' }).returning();
    const [draft] = await t.db.insert(s.events).values({ ...base, slug: 'trade-week-draft', status: 'draft' }).returning();
    const [archived] = await t.db.insert(s.events).values({ ...base, slug: 'trade-week-2025', status: 'archived' }).returning();
    await amara.put('/bookmarks', { targetType: 'event', targetId: published!.id }).expect(200);
    await amara.put('/bookmarks', { targetType: 'event', targetId: archived!.id }).expect(200);
    await amara.put('/bookmarks', { targetType: 'event', targetId: draft!.id }).expect(404);
    expect(await count(t.db, s.bookmarks, and(eq(s.bookmarks.userId, amara.id), eq(s.bookmarks.targetType, 'event')))).toBe(2);
    await amara.delete('/bookmarks', { targetType: 'event', targetId: published!.id }).expect(200);
    expect(await count(t.db, s.bookmarks, and(eq(s.bookmarks.userId, amara.id), eq(s.bookmarks.targetType, 'event')))).toBe(1);
    // Post bookmarks still check the post.
    await amara.put('/bookmarks', { targetType: 'post', targetId: published!.id }).expect(404);
  });

  it('POST /courses/:id/click records charter_center_click with the course id only', async () => {
    const course = await l.course('pitching-to-diaspora-investors');
    await amara.post(`/courses/${course.id}/click`).expect(204);
    let rows: (typeof s.analyticsEvents.$inferSelect)[] = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      rows = await t.db.select().from(s.analyticsEvents).where(eq(s.analyticsEvents.name, 'charter_center_click'));
      if (!rows.length) await new Promise((r) => setTimeout(r, 20));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectId: course.id, countryCode: 'NG' });
    expect(rows[0]!.memberPseudoId).not.toBe(amara.id);
    expect(rows[0]!.memberPseudoId).toBeTruthy();

    await amara.post('/courses/00000000-0000-4000-8000-000000000000/click').expect(404);
    await amara.post('/courses/not-a-uuid/click').expect(404);
    await t.http().post(`/api/v1/courses/${course.id}/click`).set('Origin', 'http://localhost:3000').set('X-CM-CSRF', '1').expect(401);
    const hidden = await l.course('grant-writing-that-wins');
    await t.db.update(s.courses).set({ hidden: true }).where(eq(s.courses.id, hidden.id));
    await amara.post(`/courses/${hidden.id}/click`).expect(404);
    await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, hidden.id));
  });

  it('rate-limits clicks per member', async () => {
    const { CLICK_LIMIT } = await import('../../src/learning/courses.service.js');
    const m = await createMember(t, { name: 'Clicky' });
    const course = await l.course('pitching-to-diaspora-investors');
    for (let i = 0; i < CLICK_LIMIT; i++) await m.post(`/courses/${course.id}/click`).expect(204);
    const res = await m.post(`/courses/${course.id}/click`).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Others are unaffected.
    await amara.post(`/courses/${course.id}/click`).expect(204);
  });
});
