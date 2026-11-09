import { eq } from 'drizzle-orm';
import type { AdminLearningMember, LearningAccess, LearningAccessRules, OwnProfile } from '@chartermission/contracts';
import { LEARNING_ACCESS_DEFAULTS } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { learning } from './learning-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Learning: e-learning access rules', () => {
  let t: TestApp;
  let admin: Member;

  beforeAll(async () => {
    t = await createTestApp();
    await learning(t).sync();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  async function access(m: Member): Promise<LearningAccess> {
    return (await m.get('/learning/access').expect(200)).body as LearningAccess;
  }
  async function cleanFile(ownerId: string, purpose: 'avatar' | 'profile_cover') {
    const [f] = await t.db
      .insert(s.files)
      .values({ ownerId, purpose, storageKey: `k-${purpose}-${ownerId}`, declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    return f!.id;
  }
  async function fillProfile(m: Member) {
    const pick = async (table: typeof s.skills) => (await t.db.select({ id: table.id }).from(table).limit(1))[0]!.id;
    await m
      .patch('/me/profile', {
        headline: 'Trade policy analyst',
        countryCode: 'KE',
        city: 'Nairobi',
        bio: 'I work on regional trade.',
        organisation: 'AfCFTA Hub',
        skillIds: [await pick(s.skills)],
        sectorIds: [await pick(s.sectors)],
        interestIds: [await pick(s.interests)],
        languageIds: [await pick(s.languages)],
        experience: [{ title: 'Analyst', organisation: 'AfCFTA Hub', startDate: '2022-01' }],
      })
      .expect(200);
  }
  async function connect(m: Member, n: number) {
    for (let i = 0; i < n; i++) {
      const other = await createMember(t, { name: `Peer ${i}` });
      await t.db.insert(s.connections).values({ requesterId: other.id, addresseeId: m.id, status: 'accepted', respondedAt: new Date() });
    }
  }

  it('is on by default with the six rules, and locks every member Learning endpoint', async () => {
    const m = await createMember(t, { name: 'New Member' });
    const a = await access(m);
    expect(a).toMatchObject({ unlocked: false, reason: 'locked' });
    expect(a.requirements.map((r) => r.key)).toEqual(['profile_info', 'photo', 'cover_photo', 'chapter', 'posts', 'connections']);
    expect(a.requirements.find((r) => r.key === 'connections')).toMatchObject({ done: false, current: 0, target: 50 });
    expect(a.requirements.find((r) => r.key === 'profile_info')!.missing).toEqual(expect.arrayContaining(['Headline', 'About']));

    for (const url of ['/learning', '/courses', '/courses/carbon-finance-fundamentals', '/learning/paths/from-idea-to-first-export']) {
      expect((await m.get(url).expect(403)).body.error.code).toBe('LEARNING_LOCKED');
    }
    const [course] = await t.db.select({ id: s.courses.id }).from(s.courses).limit(1);
    await m.post(`/courses/${course!.id}/click`).expect(403);
  });

  it('unlocks once every rule is met: profile, photo, cover photo, chapter, first post, connections', async () => {
    await admin.put('/admin/settings/learning-access', { ...LEARNING_ACCESS_DEFAULTS, minConnections: 3 }).expect(200);
    const m = await createMember(t, { name: 'Busy Member' });

    await fillProfile(m);
    await m.patch('/me/profile', { avatarFileId: await cleanFile(m.id, 'avatar') }).expect(200);
    // A cover photo must be the member's own profile_cover upload.
    await m.patch('/me/profile', { coverFileId: await cleanFile(m.id, 'avatar') }).expect(422);
    const own = (await m.patch('/me/profile', { coverFileId: await cleanFile(m.id, 'profile_cover') }).expect(200)).body as OwnProfile;
    expect(own.coverUrl).toContain('/media/');
    expect((await m.get(`/members/${m.handle}`).expect(200)).body.coverUrl).toBe(own.coverUrl);

    const [chapter] = await t.db.select({ id: s.chapters.id }).from(s.chapters).limit(1);
    await t.db.insert(s.follows).values({ followerId: m.id, targetType: 'chapter', targetId: chapter!.id });
    await connect(m, 2);

    let a = await access(m);
    expect(a.unlocked).toBe(false);
    expect(a.requirements.filter((r) => !r.done).map((r) => r.key)).toEqual(['posts', 'connections']);
    expect(a.requirements.find((r) => r.key === 'connections')).toMatchObject({ current: 2, target: 3 });

    // Reposts don't count as a first post.
    await t.db.insert(s.posts).values({ authorId: m.id, body: '', repostOfId: (await t.db.insert(s.posts).values({ authorId: admin.id, body: 'x' }).returning())[0]!.id });
    expect((await access(m)).requirements.find((r) => r.key === 'posts')!.done).toBe(false);
    await t.db.insert(s.posts).values({ authorId: m.id, body: 'Hello Charter Mission' });
    await connect(m, 1);

    a = await access(m);
    expect(a).toMatchObject({ unlocked: true, reason: 'met' });
    await m.get('/learning').expect(200);
    await m.get('/courses').expect(200);
  });

  it('admins change the rules; rules switched off or set to 0 drop out, and the gate can be turned off', async () => {
    const m = await createMember(t, { name: 'Only Photo Missing' });
    const rules: LearningAccessRules = {
      enabled: true,
      requireProfileInfo: false,
      requirePhoto: true,
      requireCoverPhoto: false,
      requireChapter: false,
      minPosts: 0,
      minConnections: 0,
    };
    await admin.put('/admin/settings/learning-access', rules).expect(200);
    expect((await admin.get('/admin/settings/learning-access').expect(200)).body).toEqual(rules);
    expect((await access(m)).requirements.map((r) => r.key)).toEqual(['photo']);

    await admin.put('/admin/settings/learning-access', { ...rules, minConnections: -1 }).expect(422);
    await admin.put('/admin/settings/learning-access', { ...rules, enabled: false }).expect(200);
    expect(await access(m)).toEqual({ unlocked: true, reason: 'open', requirements: [] });
    await m.get('/learning').expect(200);

    const [log] = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'settings.learning_access.updated'));
    expect(log).toBeTruthy();
    // Members can't read or change the rules.
    await m.get('/admin/settings/learning-access').expect(403);
    await admin.put('/admin/settings/learning-access', LEARNING_ACCESS_DEFAULTS).expect(200);
  });

  it('admins unlock a member regardless of the rules, and can put them back under the rules', async () => {
    const m = await createMember(t, { name: 'Zainab Override', email: 'zainab.override@example.test' });
    expect((await access(m)).unlocked).toBe(false);

    const found = (await admin.get('/admin/learning/access/members?q=zainab').expect(200)).body as AdminLearningMember[];
    expect(found.map((x) => x.id)).toEqual([m.id]);
    expect(found[0]).toMatchObject({ email: 'zainab.override@example.test', override: null, access: { unlocked: false } });
    expect(((await admin.get('/admin/learning/access/members?q=zainab.override@').expect(200)).body as AdminLearningMember[]).length).toBe(1);

    const granted = (await admin.put(`/admin/learning/access/overrides/${m.id}`, { note: 'Partner organisation staff' }).expect(200))
      .body as AdminLearningMember;
    expect(granted.override).toMatchObject({ note: 'Partner organisation staff', grantedBy: 'Ada Admin' });
    expect(await access(m)).toMatchObject({ unlocked: true, reason: 'override' });
    await m.get('/learning').expect(200);

    const list = (await admin.get('/admin/learning/access/members').expect(200)).body as AdminLearningMember[];
    expect(list.map((x) => x.id)).toContain(m.id);

    const back = (await admin.delete(`/admin/learning/access/overrides/${m.id}`).expect(200)).body as AdminLearningMember;
    expect(back.override).toBeNull();
    expect((await access(m)).unlocked).toBe(false);
    await m.get('/learning').expect(403);

    const actions = (await t.db.select({ a: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.targetId, m.id))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(['learning.access.unlocked', 'learning.access.override_removed']));
    await admin.put(`/admin/learning/access/overrides/00000000-0000-4000-8000-000000000000`, {}).expect(404);
  });

  it('staff accounts are never locked out', async () => {
    const staff = await createMember(t, { name: 'Staff Person', mfa: true });
    await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
    expect(await access(staff)).toMatchObject({ unlocked: true, reason: 'staff' });
  });
});
