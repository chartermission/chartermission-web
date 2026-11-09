import { and, eq, isNull } from 'drizzle-orm';
import type { AdminLeadDetail, AdminLeadsPage, AmbassadorTrainingView, ManagerView } from '@chartermission/contracts';
import { createMember, createTestApp, lastEmail, s, tokenFrom, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/** Ambassador programme in the admin console: scoped managers, the pipeline, onboarding, certification. */
describe('Ambassadors: admin', () => {
  let t: TestApp;
  let admin: Member;
  let manager: Member;

  /** An Ambassador Manager limited to the given countries (a member with admin MFA and scoped role rows). */
  async function scopedManager(name: string, countries: string[]) {
    const m = await createMember(t, { name, admin: true });
    const [role] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'ambassador_manager'));
    await t.db.insert(s.userRoles).values(countries.map((c) => ({ userId: m.id, roleId: role!.id, scopeType: 'country', scopeId: c })));
    return m;
  }

  const lead = (over: Record<string, unknown> = {}) => ({
    fullName: 'Chinedu Obi',
    email: `chinedu.${Math.random().toString(36).slice(2)}@example.test`,
    countryCode: 'NG',
    city: 'Lagos',
    source: 'nomination',
    hoursPerWeek: 6,
    motivation: 'Grow the Lagos founders community.',
    ...over,
  });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    manager = await scopedManager('Nia Manager', ['NG']);
  });
  afterAll(async () => {
    await t.close();
  });

  it('needs an admin session with ambassador.manage; managers can’t manage managers', async () => {
    const member = await createMember(t, { name: 'Member' });
    const moderator = await createMember(t, { name: 'Mod', roles: ['moderator'], admin: true });
    for (const who of [member, moderator]) {
      await who.get('/admin/ambassadors/leads').expect(403);
      await who.post('/admin/ambassadors/leads', lead()).expect(403);
    }
    await manager.get('/admin/ambassadors/leads').expect(200);
    await manager.get('/admin/ambassadors/managers').expect(403);
    await manager.put('/admin/ambassadors/training', { courseIds: [] }).expect(403);
    await t.http().get('/api/v1/admin/ambassadors/leads').set('X-CM-Audience', 'admin').expect(401);
  });

  it('keeps managers inside their countries', async () => {
    const mine = (await manager.post('/admin/ambassadors/leads', lead()).expect(201)).body as AdminLeadDetail;
    expect(mine).toMatchObject({ stage: 'new', country: { code: 'NG' }, owner: { id: manager.id }, checklist: null });
    expect(mine.activity[0]).toMatchObject({ kind: 'created' });

    await manager.post('/admin/ambassadors/leads', lead({ countryCode: 'GH' })).expect(403);
    const ghana = (await admin.post('/admin/ambassadors/leads', lead({ countryCode: 'GH', fullName: 'Kofi Mensah' })).expect(201)).body as AdminLeadDetail;
    await manager.get(`/admin/ambassadors/leads/${ghana.id}`).expect(404);
    await manager.patch(`/admin/ambassadors/leads/${mine.id}`, { countryCode: 'GH' }).expect(403);

    const list = (await manager.get('/admin/ambassadors/leads?stage=all').expect(200)).body as AdminLeadsPage;
    expect(list.items.map((l) => l.id)).toContain(mine.id);
    expect(list.items.map((l) => l.id)).not.toContain(ghana.id);
    expect(list.countries.map((c) => c.code)).toEqual(['NG']);

    const dup = await manager.post('/admin/ambassadors/leads', lead({ email: mine.email.toUpperCase() })).expect(409);
    expect(dup.body.error.message).toMatch(/already exists/);
  });

  it('scores, moves through the pipeline, onboards and certifies', async () => {
    const person = await createMember(t, { name: 'Amaka Eze', countryCode: 'NG' });
    const created = (await manager.post('/admin/ambassadors/leads', lead({ fullName: 'Amaka Eze', email: person.email })).expect(201)).body as AdminLeadDetail;
    const base = `/admin/ambassadors/leads/${created.id}`;
    expect(created.member).toMatchObject({ id: person.id });

    const scored = (await manager.patch(base, { scores: { standing: 12, reach: 13, leadership: 18, motivation: 12, availability: 5, values: 9 } }).expect(200)).body as AdminLeadDetail;
    expect(scored.scoreTotal).toBe(69);
    await manager.patch(base, { scores: { interview: 21 } }).expect(400);

    // Required training: one Charter Center course.
    const [course] = await t.db
      .insert(s.courses)
      .values({ externalId: '232', slug: 'leed-green-associate', title: 'LEED Green Associate', provider: 'Charter Center', startUrl: 'https://charter-center.com/courses/232' })
      .returning();
    const training = (await admin.put('/admin/ambassadors/training', { courseIds: [course!.id] }).expect(200)).body as AmbassadorTrainingView;
    expect(training.courses).toEqual([expect.objectContaining({ id: course!.id, available: true })]);

    for (const stage of ['screening', 'review', 'interview', 'references', 'decision']) {
      await manager.post(`${base}/stage`, { stage }).expect(200);
    }
    const onboarding = (await manager.post(`${base}/stage`, { stage: 'onboarding', note: 'Panel approved' }).expect(200)).body as AdminLeadDetail;
    expect(onboarding.stage).toBe('onboarding');
    expect(onboarding.checklist!.steps.find((st) => st.key === 'account')!.status).toBe('done');
    expect(onboarding.checklist!.training).toEqual([expect.objectContaining({ courseId: course!.id, completedAt: null })]);
    expect(onboarding.checklist!.invitedAt).not.toBeNull();
    const invite = await lastEmail(t.db, person.email);
    expect(invite).toMatchObject({ template: 'ambassador.onboarding_invite' });
    expect(invite!.textBody).toContain('LEED Green Associate');

    // Not ready: steps still open.
    await manager.post(`${base}/certify`, {}).expect(409);

    const afterCourse = (await manager.put(`${base}/training/${course!.id}`, { completed: true }).expect(200)).body as AdminLeadDetail;
    expect(afterCourse.checklist!.steps.find((st) => st.key === 'training')!.status).toBe('done');
    for (const step of ['agreement', 'profile', 'orientation']) {
      await manager.patch(`${base}/onboarding/${step}`, { status: 'done' }).expect(200);
    }
    const ready = (await manager.patch(`${base}/onboarding/first_event`, { status: 'waived', note: 'Event already scheduled by HQ' }).expect(200)).body as AdminLeadDetail;
    expect(ready.checklist!.readyToCertify).toBe(true);

    const certified = (await manager.post(`${base}/certify`, { founding: true }).expect(200)).body as AdminLeadDetail;
    expect(certified).toMatchObject({ stage: 'ambassador', founding: true });
    expect(certified.certifiedAt).not.toBeNull();

    const [role] = await t.db
      .select({ scopeType: s.userRoles.scopeType, scopeId: s.userRoles.scopeId })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(and(eq(s.userRoles.userId, person.id), eq(s.roles.key, 'ambassador'), isNull(s.userRoles.revokedAt)));
    expect(role!.scopeType).toBe('chapter');
    const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.id, role!.scopeId!));
    expect(chapter!.countryCode).toBe('NG');
    expect(await lastEmail(t.db, person.email)).toMatchObject({ template: 'ambassador.certified' });

    await manager.post(`${base}/stage`, { stage: 'review' }).expect(409);
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ambassador.certify'));
    expect(audit).toHaveLength(1);
  });

  it('creates manager sub-accounts with a set-password email and scoped countries', async () => {
    const created = (await admin.post('/admin/ambassadors/managers', { name: 'Kemi Ade', email: 'kemi.manager@example.test', countryCodes: ['NG', 'GH'] }).expect(201)).body as ManagerView;
    expect(created).toMatchObject({ name: 'Kemi Ade', status: 'invited', allCountries: false, mfaEnabled: false });
    expect(created.countries.map((c) => c.code).sort()).toEqual(['GH', 'NG']);
    const [user] = await t.db.select().from(s.users).where(eq(s.users.email, 'kemi.manager@example.test'));
    expect(user).toMatchObject({ isStaff: true, status: 'active' });
    const email = await lastEmail(t.db, 'kemi.manager@example.test');
    expect(email).toMatchObject({ template: 'ambassador.manager_invite' });
    expect(tokenFrom(email!.textBody)).toBeTruthy();

    await admin.post('/admin/ambassadors/managers', { name: 'Kemi Ade', email: 'kemi.manager@example.test' }).expect(409);

    const updated = (await admin.patch(`/admin/ambassadors/managers/${created.userId}`, { countryCodes: [] }).expect(200)).body as ManagerView;
    expect(updated).toMatchObject({ allCountries: true, countries: [] });
    const back = (await admin.patch(`/admin/ambassadors/managers/${created.userId}`, { countryCodes: ['KE'] }).expect(200)).body as ManagerView;
    expect(back.countries.map((c) => c.code)).toEqual(['KE']);

    // An existing member becomes a manager without a new account.
    const existing = await createMember(t, { name: 'Tunde Bello' });
    const promoted = (await admin.post('/admin/ambassadors/managers', { name: 'ignored', email: existing.email, countryCodes: ['NG'] }).expect(201)).body as ManagerView;
    expect(promoted).toMatchObject({ userId: existing.id, name: 'Tunde Bello' });
    expect(await lastEmail(t.db, existing.email)).toMatchObject({ template: 'ambassador.manager_added' });

    await admin.delete(`/admin/ambassadors/managers/${created.userId}`).expect(204);
    const list = (await admin.get('/admin/ambassadors/managers').expect(200)).body as ManagerView[];
    expect(list.map((m) => m.userId)).not.toContain(created.userId);
    await admin.delete(`/admin/ambassadors/managers/${admin.id}`).expect(404);
  });
});
