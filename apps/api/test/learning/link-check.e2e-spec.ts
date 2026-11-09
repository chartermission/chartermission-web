import { and, eq } from 'drizzle-orm';
import type { CourseDetail, CourseSummary, Page } from '@chartermission/contracts';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { HttpLinkChecker, type RequestFn } from '../../src/learning/link-checker.js';
import { learning, openLearning } from './learning-helpers.js';

const BROKEN_SLUG = 'cooperative-agribusiness-farm-to-market';

describe('Learning: link checks', () => {
  let t: TestApp;
  let l: ReturnType<typeof learning>;

  beforeAll(async () => {
    t = await createTestApp();
    await openLearning(t);
    l = learning(t);
    await l.sync();
  });
  afterAll(async () => {
    await t.close();
  });

  it('breaks a link after two failed checks, hides startUrl and alerts curators once', async () => {
    const admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'] });
    const superAdmin = await createMember(t, { name: 'Super Admin', roles: ['super_admin'] });
    const moderator = await createMember(t, { name: 'Moderator', roles: ['moderator'] });
    const member = await createMember(t, { name: 'Member' });
    const revoked = await createMember(t, { name: 'Former Admin', roles: ['platform_admin'] });
    await t.db.update(s.userRoles).set({ revokedAt: new Date() }).where(eq(s.userRoles.userId, revoked.id));
    const alerts = (userId: string) =>
      count(t.db, s.notifications, and(eq(s.notifications.userId, userId), eq(s.notifications.type, 'course_link_broken')));

    const first = await l.linkCheck();
    expect(first).toMatchObject({ kind: 'link_check', status: 'succeeded', checkedCount: 18, brokenCount: 0, updatedCount: 17 });
    let course = await l.course(BROKEN_SLUG);
    // One failure is not enough: status stays unknown and Start learning stays available.
    expect(course).toMatchObject({ linkStatus: 'unknown', linkFailures: 1, linkHttpStatus: 404 });
    expect(course.linkCheckedAt).not.toBeNull();
    expect((await l.course('carbon-finance-fundamentals')).linkStatus).toBe('ok');
    expect(await alerts(admin.id)).toBe(0);

    const second = await l.linkCheck();
    expect(second).toMatchObject({ status: 'succeeded', checkedCount: 18, brokenCount: 1 });
    course = await l.course(BROKEN_SLUG);
    expect(course).toMatchObject({ linkStatus: 'broken', linkFailures: 2 });
    expect(await alerts(admin.id)).toBe(1);
    expect(await alerts(superAdmin.id)).toBe(1);
    expect(await alerts(moderator.id)).toBe(0);
    expect(await alerts(member.id)).toBe(0);
    expect(await alerts(revoked.id)).toBe(0);
    const [n] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, admin.id), eq(s.notifications.type, 'course_link_broken')));
    expect(n!.data).toMatchObject({ icon: 'alert', href: `/learning/courses/${BROKEN_SLUG}` });
    expect(JSON.stringify(n!.data)).toContain('Cooperative Agribusiness');

    // Still broken next week: no repeat alert, even outside the de-duplication window.
    await t.db.update(s.notifications).set({ updatedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(s.notifications.type, 'course_link_broken'));
    await l.linkCheck();
    expect(await alerts(admin.id)).toBe(1);

    // Members still see the course, without a start URL.
    const detail = (await member.get(`/courses/${BROKEN_SLUG}`).expect(200)).body as CourseDetail;
    expect(detail).toMatchObject({ linkStatus: 'broken', startUrl: null });
    const page = (await member.get('/courses?topic=agriculture').expect(200)).body as Page<CourseSummary>;
    expect(page.items.find((c) => c.slug === BROKEN_SLUG)).toMatchObject({ startUrl: null });
    expect(page.items.find((c) => c.slug !== BROKEN_SLUG)!.startUrl).toMatch(/^https:\/\/chartercenter\.org\/courses\//);
  });

  it('a later success sets the link ok again', async () => {
    l.checker.setBroken([]);
    await l.linkCheck();
    const course = await l.course(BROKEN_SLUG);
    expect(course).toMatchObject({ linkStatus: 'ok', linkFailures: 0, linkHttpStatus: 200 });
    l.checker.setBroken([course.startUrl]);
  });

  it('skips hidden and removed courses', async () => {
    const hidden = await l.course('grant-writing-that-wins');
    await t.db.update(s.courses).set({ hidden: true, linkCheckedAt: null }).where(eq(s.courses.id, hidden.id));
    const run = await l.linkCheck();
    expect(run!.checkedCount).toBe(17);
    expect((await l.course('grant-writing-that-wins')).linkCheckedAt).toBeNull();
    await t.db.update(s.courses).set({ hidden: false }).where(eq(s.courses.id, hidden.id));
  });

  describe('HttpLinkChecker', () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const stub = (answers: Record<string, { HEAD?: number; GET?: number; location?: string }>) => {
      const calls: string[] = [];
      const request: RequestFn = async (url, method) => {
        calls.push(`${method} ${url.toString()}`);
        const a = answers[url.toString()];
        if (!a) throw new Error('connect ECONNREFUSED');
        return { status: a[method] ?? a.GET ?? a.HEAD ?? 500, location: a.location };
      };
      return { calls, checker: new HttpLinkChecker(request, publicLookup) };
    };

    it('uses HEAD and follows redirects', async () => {
      const { calls, checker } = stub({
        'https://chartercenter.org/courses/a': { HEAD: 301, location: '/learn/a' },
        'https://chartercenter.org/learn/a': { HEAD: 200 },
      });
      expect(await checker.check('https://chartercenter.org/courses/a')).toEqual({ ok: true, status: 200 });
      expect(calls).toEqual(['HEAD https://chartercenter.org/courses/a', 'HEAD https://chartercenter.org/learn/a']);
    });

    it('falls back to GET when HEAD is refused', async () => {
      const { calls, checker } = stub({ 'https://chartercenter.org/courses/b': { HEAD: 405, GET: 200 } });
      expect(await checker.check('https://chartercenter.org/courses/b')).toEqual({ ok: true, status: 200 });
      expect(calls).toHaveLength(2);
    });

    it('reports 404s, network errors, unsafe URLs and redirect loops as failures', async () => {
      const { checker } = stub({
        'https://chartercenter.org/gone': { HEAD: 404 },
        'https://chartercenter.org/loop': { HEAD: 302, location: '/loop' },
      });
      expect(await checker.check('https://chartercenter.org/gone')).toEqual({ ok: false, status: 404 });
      expect(await checker.check('https://chartercenter.org/down')).toMatchObject({ ok: false, status: null, error: expect.stringMatching(/ECONNREFUSED/) });
      expect(await checker.check('https://chartercenter.org/loop')).toMatchObject({ ok: false, error: 'Too many redirects' });
      expect(await checker.check('http://chartercenter.org/x')).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
      const privateDns = new HttpLinkChecker(async () => ({ status: 200 }), async () => [{ address: '10.0.0.5', family: 4 }]);
      expect(await privateDns.check('https://intranet.example.org/')).toMatchObject({ ok: false });
    });
  });
});
