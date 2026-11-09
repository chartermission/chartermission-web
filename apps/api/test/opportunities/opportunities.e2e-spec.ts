import { and, eq } from 'drizzle-orm';
import type { ApplicationsPage, OpportunityDetail, OpportunitySummary } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { eventually } from '../events/event-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function listing(overrides: Record<string, unknown> = {}) {
  return {
    type: 'employment',
    title: 'Product Designer, Payments',
    organisation: 'PayBridge',
    summary: 'Design checkout flows used across West Africa.',
    description: 'You will own the end-to-end design of our merchant checkout, working with engineers in Lagos and Accra.',
    remoteMode: 'hybrid',
    countryCode: 'NG',
    city: 'Lagos',
    deadline: inDays(20),
    compensation: '$40k–55k',
    ...overrides,
  };
}

describe('Opportunities: posting, browsing, applying and reviewing', () => {
  let t: TestApp;
  let poster: Member;
  let applicant: Member;
  beforeAll(async () => {
    t = await createTestApp();
    poster = await createMember(t, { name: 'Kwame Poster' });
    applicant = await createMember(t, { name: 'Leila Applicant', countryCode: 'KE' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('verified members post listings that go live straight away; bad input is rejected', async () => {
    const res = await poster.post('/opportunities', listing()).expect(201);
    const o = res.body as OpportunityDetail;
    expect(o).toMatchObject({ status: 'open', moderationState: 'visible', viewer: { isOwner: true, canManage: true, canApply: false } });
    expect(o.slug).toMatch(/^product-designer-payments-[0-9a-f]{6}$/);

    const bad = await poster.post('/opportunities', listing({ remoteMode: 'in_person', countryCode: null, deadline: '2020-01-01' })).expect(422);
    expect(bad.body.error.fields).toMatchObject({ countryCode: expect.any(String) });
    const past = await poster.post('/opportunities', listing({ deadline: '2020-01-01' })).expect(422);
    expect(past.body.error.fields).toMatchObject({ deadline: expect.any(String) });

    const unverified = await createMember(t, { verified: false });
    expect((await unverified.post('/opportunities', listing()).expect(403)).body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('browses with search and filters, and hides expired and closed listings', async () => {
    const grant = (await poster.post('/opportunities', listing({ type: 'grant', title: 'Climate Seed Grant', organisation: 'Green Fund', remoteMode: 'remote', countryCode: null, city: null }))
      .expect(201)).body as OpportunityDetail;
    const closed = (await poster.post('/opportunities', listing({ title: 'Closed Internship Role', type: 'internship' })).expect(201)).body as OpportunityDetail;
    await poster.post(`/opportunities/${closed.id}/close`, {}).expect(200);
    await t.db.update(s.opportunities).set({ deadline: inDays(-1) }).where(eq(s.opportunities.title, 'Product Designer, Payments'));

    const all = (await applicant.get('/opportunities').expect(200)).body.items as OpportunitySummary[];
    expect(all.map((o) => o.id)).toContain(grant.id);
    expect(all.map((o) => o.id)).not.toContain(closed.id);
    expect(all.some((o) => o.title === 'Product Designer, Payments')).toBe(false);

    const grants = (await applicant.get('/opportunities?type=grant,fellowship&remote=true').expect(200)).body.items as OpportunitySummary[];
    expect(grants.map((o) => o.id)).toEqual([grant.id]);
    expect((await applicant.get('/opportunities?q=seed').expect(200)).body.items).toHaveLength(1);
    expect((await applicant.get('/opportunities?country=GH').expect(200)).body.items).toHaveLength(0);

    // The poster still sees everything in "Posted".
    const posted = (await poster.get('/me/opportunities?tab=posted').expect(200)).body.items as OpportunitySummary[];
    expect(posted.find((o) => o.id === closed.id)?.status).toBe('closed');
  });

  it('applicants apply with a note, the poster reviews them, and both sides are notified', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Community Fellowship', type: 'fellowship' })).expect(201)).body as OpportunityDetail;
    await poster.post(`/opportunities/${o.id}/applications`, { note: 'I would like to apply to my own listing please.' }).expect(409);
    await applicant.post(`/opportunities/${o.id}/applications`, { note: 'Too short' }).expect(422);

    const applied = (await applicant.post(`/opportunities/${o.id}/applications`, { note: 'I run a 400-member founders community in Nairobi.' }).expect(201))
      .body as OpportunityDetail;
    expect(applied.viewer).toMatchObject({ canApply: false, application: { status: 'submitted' }, applicationStatus: 'submitted' });
    expect(applied.applicationCount).toBe(1);
    await applicant.post(`/opportunities/${o.id}/applications`, { note: 'Applying a second time to the same thing.' }).expect(409);

    const notified = await eventually(
      () => t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, poster.id), eq(s.notifications.type, 'opportunity_application_received'))),
      (rows) => rows.length > 0,
    );
    expect(notified[0]!.data.href).toBe(`/opportunities/${o.slug}/applicants`);

    await applicant.get(`/opportunities/${o.id}/applications`).expect(403);
    const page = (await poster.get(`/opportunities/${o.id}/applications`).expect(200)).body as ApplicationsPage;
    expect(page.counts.submitted).toBe(1);
    expect(page.items[0]).toMatchObject({ applicant: { id: applicant.id }, note: expect.stringContaining('Nairobi'), status: 'submitted' });

    await poster.patch(`/opportunities/${o.id}/applications/${page.items[0]!.id}`, { status: 'accepted', message: 'Welcome aboard! I will email you.' }).expect(200);
    const updated = await eventually(
      () => t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, applicant.id), eq(s.notifications.type, 'opportunity_application_updated'))),
      (rows) => rows.length > 0,
    );
    expect(JSON.stringify(updated[0]!.data.segments)).toContain('Welcome aboard');
    // A decided application can't be withdrawn.
    await applicant.delete(`/opportunities/${o.id}/applications/mine`).expect(409);

    const mine = (await applicant.get('/me/opportunities?tab=applied').expect(200)).body.items as OpportunitySummary[];
    expect(mine.find((x) => x.id === o.id)?.viewer.applicationStatus).toBe('accepted');
  });

  it('applicants can withdraw and re-apply; closed listings take no applications', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Volunteer Mentors Wanted', type: 'volunteering' })).expect(201)).body as OpportunityDetail;
    await applicant.post(`/opportunities/${o.id}/applications`, { note: 'Happy to mentor two founders a month.' }).expect(201);
    const withdrawn = (await applicant.delete(`/opportunities/${o.id}/applications/mine`).expect(200)).body as OpportunityDetail;
    expect(withdrawn.viewer).toMatchObject({ canApply: true, application: { status: 'withdrawn' } });
    expect(withdrawn.applicationCount).toBe(0);
    await applicant.post(`/opportunities/${o.id}/applications`, { note: 'Back again: I can mentor three founders.' }).expect(201);

    await poster.post(`/opportunities/${o.id}/close`, {}).expect(200);
    const other = await createMember(t);
    const res = await other.post(`/opportunities/${o.id}/applications`, { note: 'Is there still space for one more mentor?' }).expect(409);
    expect(res.body.error.message).toMatch(/closed/);
  });

  it('members save listings, report them, and moderators remove them', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Too Good To Be True', type: 'grant', remoteMode: 'remote', countryCode: null })).expect(201))
      .body as OpportunityDetail;
    await applicant.put('/bookmarks', { targetType: 'opportunity', targetId: o.id }).expect(200);
    const saved = (await applicant.get('/me/opportunities?tab=saved').expect(200)).body.items as OpportunitySummary[];
    expect(saved.map((x) => x.id)).toContain(o.id);

    await applicant.post('/reports', { targetType: 'opportunity', targetId: o.id, reason: 'scam' }).expect(201);
    const mod = await createMember(t, { roles: ['moderator'], admin: true });
    await mod.post('/admin/moderation-actions', { targetType: 'opportunity', targetId: o.id, action: 'remove', reason: 'Asks applicants to pay a fee' }).expect(201);

    await applicant.get(`/opportunities/${o.id}`).expect(404);
    expect(((await applicant.get('/opportunities').expect(200)).body.items as OpportunitySummary[]).map((x) => x.id)).not.toContain(o.id);
    expect((await poster.get(`/opportunities/${o.id}`).expect(200)).body.moderationState).toBe('removed');
  });

  it('only the poster edits, closes and deletes', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Editable Listing' })).expect(201)).body as OpportunityDetail;
    await applicant.patch(`/opportunities/${o.id}`, listing({ title: 'Hijacked' })).expect(403);
    const edited = (await poster.patch(`/opportunities/${o.id}`, listing({ title: 'Edited Listing', compensation: null })).expect(200)).body as OpportunityDetail;
    expect(edited).toMatchObject({ title: 'Edited Listing', compensation: null, slug: o.slug });
    await applicant.delete(`/opportunities/${o.id}`).expect(403);
    await poster.delete(`/opportunities/${o.id}`).expect(204);
    await poster.get(`/opportunities/${o.id}`).expect(404);
  });
});
