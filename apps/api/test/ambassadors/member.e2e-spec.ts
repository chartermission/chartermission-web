import { and, eq } from 'drizzle-orm';
import { AMBASSADOR_AGREEMENT_VERSION, type AdminLeadDetail, type AdminLeadsPage, type MyAmbassadorView } from '@chartermission/contracts';
import { count, createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/** The Ambassador programme from the member side: applying, nominating, onboarding and the agreement. */
describe('Ambassadors: members', () => {
  let t: TestApp;
  let admin: Member;

  const application = (over: Record<string, unknown> = {}) => ({
    countryCode: 'KE',
    city: 'Nairobi',
    hoursPerWeek: 6,
    linkedinUrl: 'https://linkedin.com/in/example',
    motivation: 'I run a 400-member founders meetup in Nairobi and want to connect it to builders across the continent and the diaspora.',
    ...over,
  });

  async function leadFor(email: string): Promise<AdminLeadDetail> {
    const page = (await admin.get(`/admin/ambassadors/leads?stage=all&q=${encodeURIComponent(email)}`).expect(200)).body as AdminLeadsPage;
    const hit = page.items.find((l) => l.email === email.toLowerCase());
    if (!hit) throw new Error(`No lead for ${email}`);
    return (await admin.get(`/admin/ambassadors/leads/${hit.id}`).expect(200)).body as AdminLeadDetail;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  it('starts with no application', async () => {
    const m = await createMember(t, { name: 'New Member' });
    const me = (await m.get('/ambassadors/me').expect(200)).body as MyAmbassadorView;
    expect(me).toMatchObject({ status: 'none', canApply: true, onboarding: null, agreement: null });
    await t.http().get('/api/v1/ambassadors/me').expect(401);
  });

  it('takes an application from a verified member and screens it', async () => {
    const unverified = await createMember(t, { name: 'Unverified', verified: false });
    await unverified.post('/ambassadors/applications', application()).expect(403);

    const m = await createMember(t, { name: 'Wanjiru Kamau', countryCode: 'KE' });
    await m.post('/ambassadors/applications', application({ motivation: 'Too short' })).expect(422);
    const view = (await m.post('/ambassadors/applications', application()).expect(201)).body as MyAmbassadorView;
    expect(view).toMatchObject({ status: 'in_review', country: { code: 'KE' }, canApply: false });
    expect(view.appliedAt).not.toBeNull();

    const again = await m.post('/ambassadors/applications', application()).expect(409);
    expect(again.body.error.message).toMatch(/already with the community team/);

    const lead = await leadFor(m.email);
    expect(lead).toMatchObject({ source: 'application', stage: 'new', member: { id: m.id }, hoursPerWeek: 6, owner: null });
    expect(lead.scores.availability).toBe(5);
    expect(lead.scoreTotal).toBe(5);
    expect(lead.activity[0]).toMatchObject({ kind: 'applied' });
    expect(lead.activity[0]!.body).toMatch(/6 h\/week/);
  });

  it('lets declined applicants apply again only after six months; withdrawn ones straight away', async () => {
    const m = await createMember(t, { name: 'Tendai Moyo' });
    await m.post('/ambassadors/applications', application({ countryCode: 'ZW' })).expect(201);
    const lead = await leadFor(m.email);

    await admin.post(`/admin/ambassadors/leads/${lead.id}/stage`, { stage: 'declined' }).expect(200);
    const closed = (await m.get('/ambassadors/me').expect(200)).body as MyAmbassadorView;
    expect(closed).toMatchObject({ status: 'closed', canApply: false });
    expect(new Date(closed.reapplyFrom!).getTime()).toBeGreaterThan(Date.now() + 170 * 86_400_000);
    await m.post('/ambassadors/applications', application({ countryCode: 'ZW' })).expect(409);

    await admin.post(`/admin/ambassadors/leads/${lead.id}/stage`, { stage: 'withdrawn' }).expect(200);
    expect(((await m.get('/ambassadors/me').expect(200)).body as MyAmbassadorView).canApply).toBe(true);
    const reopened = (await m.post('/ambassadors/applications', application({ countryCode: 'ZW', hoursPerWeek: 3 })).expect(201)).body as MyAmbassadorView;
    expect(reopened.status).toBe('in_review');
    const after = await leadFor(m.email);
    expect(after).toMatchObject({ id: lead.id, stage: 'new', scoreTotal: 3 });
    expect(after.activity[0]!.body).toMatch(/Applied again/);
  });

  it('records nominations, emails new nominees once and never reveals existing leads', async () => {
    const nominator = await createMember(t, { name: 'Kwame Asante' });
    const nominee = `efua.${Date.now()}@example.test`;
    const body = { fullName: 'Efua Boateng', email: nominee, countryCode: 'GH', reason: 'She has hosted the Accra product meetup for three years.' };

    await nominator.post('/ambassadors/nominations', { ...body, email: nominator.email }).expect(422);
    await nominator.post('/ambassadors/nominations', body).expect(202);
    const lead = await leadFor(nominee);
    expect(lead).toMatchObject({ source: 'nomination', stage: 'new', referredBy: 'Kwame Asante', hasAccount: false });
    expect(lead.notes).toMatch(/She has hosted/);
    expect(await lastEmail(t.db, nominee)).toMatchObject({ template: 'ambassador.nominated' });

    const second = await createMember(t, { name: 'Abena Owusu' });
    await second.post('/ambassadors/nominations', { ...body, reason: 'Best community builder I know in Ghana, by far.' }).expect(202);
    expect(await count(t.db, s.emailOutbox, eq(s.emailOutbox.toAddress, nominee))).toBe(1);
    const again = await leadFor(nominee);
    expect(again.activity[0]).toMatchObject({ kind: 'note' });
    expect(again.activity[0]!.body).toMatch(/Also nominated by Abena Owusu/);
  });

  it('shows the onboarding checklist and takes the signed agreement', async () => {
    const m = await createMember(t, { name: 'Amina Diallo', countryCode: 'SN' });
    await m.post('/ambassadors/applications', application({ countryCode: 'SN' })).expect(201);
    const lead = await leadFor(m.email);
    await m.post('/ambassadors/me/agreement', { fullName: 'Amina Diallo', accept: true, version: AMBASSADOR_AGREEMENT_VERSION }).expect(409);

    for (const stage of ['screening', 'review', 'interview', 'references', 'decision', 'onboarding']) {
      await admin.post(`/admin/ambassadors/leads/${lead.id}/stage`, { stage }).expect(200);
    }
    const me = (await m.get('/ambassadors/me').expect(200)).body as MyAmbassadorView;
    expect(me.status).toBe('onboarding');
    expect(me.onboarding!.steps.map((st) => st.key)).toEqual(['agreement', 'account', 'profile', 'training', 'orientation', 'first_event']);
    expect(me.onboarding!.steps.find((st) => st.key === 'account')).toMatchObject({ status: 'done', selfServe: true });
    expect(me.onboarding!.steps.find((st) => st.key === 'agreement')).toMatchObject({ status: 'pending', selfServe: true });

    await m.post('/ambassadors/me/agreement', { fullName: 'Amina Diallo', accept: false, version: AMBASSADOR_AGREEMENT_VERSION }).expect(422);
    await m.post('/ambassadors/me/agreement', { fullName: 'Amina Diallo', accept: true, version: 'old' }).expect(409);
    const signed = (await m.post('/ambassadors/me/agreement', { fullName: 'Amina Diallo', accept: true, version: AMBASSADOR_AGREEMENT_VERSION }).expect(200)).body as MyAmbassadorView;
    expect(signed.agreement).toMatchObject({ signedName: 'Amina Diallo', version: AMBASSADOR_AGREEMENT_VERSION });
    expect(signed.onboarding!.steps.find((st) => st.key === 'agreement')!.status).toBe('done');

    const [row] = await t.db.select().from(s.ambassadorLeads).where(eq(s.ambassadorLeads.id, lead.id));
    expect(row!.agreementSignedName).toBe('Amina Diallo');
    const detail = (await admin.get(`/admin/ambassadors/leads/${lead.id}`).expect(200)).body as AdminLeadDetail;
    expect(detail.checklist!.steps.find((st) => st.key === 'agreement')).toMatchObject({ status: 'done', completedBy: { id: m.id } });
    const audit = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'ambassador.agreement.sign'), eq(s.auditLog.targetId, lead.id)));
    expect(audit).toHaveLength(1);
  });
});
