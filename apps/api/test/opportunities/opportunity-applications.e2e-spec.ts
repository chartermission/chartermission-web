import { and, eq } from 'drizzle-orm';
import { OpportunityInput, type ApplicationCv, type ApplicationsPage, type OpportunityDetail } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { SessionService } from '../../src/core/session.service.js';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const NOTE = 'I have led payments design at two fintechs in Lagos and Nairobi.';

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
    shareToFeed: false,
    ...overrides,
  };
}

/** A PDF through the real upload API (create → PUT bytes → complete), clean once checked. */
async function uploadPdf(t: TestApp, m: Member, purpose: 'application_cv' | 'post_document' | 'profile_resume', fileName = 'Leila Benali CV.pdf') {
  const res = await m.post('/uploads', { purpose, fileName, mime: 'application/pdf', sizeBytes: PDF.length });
  expect(res.status).toBe(201);
  const url = new URL(res.body.uploadUrl as string);
  await t.http().put(`${url.pathname}${url.search}`).set('Content-Type', 'application/pdf').send(PDF).expect(200);
  expect((await m.post(`/uploads/${res.body.fileId}/complete`).expect(200)).body.status).toBe('clean');
  return res.body.fileId as string;
}

const segmentsText = (data: Record<string, unknown>) => (data.segments as { text: string }[]).map((x) => x.text).join('');

const received = (t: TestApp, userId: string) =>
  t.db
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, 'opportunity_application_received')));

describe('Opportunities: the application form (phone, link, CV) and who sees it', () => {
  let t: TestApp;
  let poster: Member;
  let applicant: Member;
  let stranger: Member;
  let listingRow: OpportunityDetail;
  let cvId: string;

  beforeAll(async () => {
    t = await createTestApp();
    poster = await createMember(t, { name: 'Kwame Poster' });
    applicant = await createMember(t, { name: 'Leila Applicant', countryCode: 'KE' });
    stranger = await createMember(t, { name: 'Sam Stranger' });
    listingRow = (await poster.post('/opportunities', listing()).expect(201)).body as OpportunityDetail;
    expect(listingRow.source).toBe('member');
  });
  afterAll(async () => {
    await t.close();
  });

  it('rejects a bad phone number, link or CV with field errors', async () => {
    const at = `/opportunities/${listingRow.id}/applications`;
    const phone = await applicant.post(at, { note: NOTE, phone: 'call me maybe' }).expect(422);
    expect(phone.body.error.fields).toMatchObject({ phone: expect.stringContaining('phone number') });
    const link = await applicant.post(at, { note: NOTE, link: 'linkedin.com/in/leila' }).expect(422);
    expect(link.body.error.fields).toMatchObject({ link: expect.stringContaining('https://') });
    await applicant.post(at, { note: NOTE, link: 'ftp://files.example.com/cv' }).expect(422);

    // Someone else's CV, a PDF uploaded for something else, or an id that isn't a file.
    const theirs = await uploadPdf(t, stranger, 'application_cv');
    const wrongPurpose = await uploadPdf(t, applicant, 'post_document');
    for (const cvFileId of [theirs, wrongPurpose, '00000000-0000-4000-8000-000000000000']) {
      const res = await applicant.post(at, { note: NOTE, cvFileId }).expect(422);
      expect(res.body.error.fields).toMatchObject({ cvFileId: 'Upload your CV as a PDF first' });
    }
    await applicant.post(at, { note: NOTE, cvFileId: 'not-a-uuid' }).expect(422);
    // Nothing was sent.
    expect((await applicant.get(`/opportunities/${listingRow.slug}`).expect(200)).body.viewer.application).toBeNull();
    expect(await received(t, poster.id)).toHaveLength(0);
  });

  it('applies with a note, phone, link and CV; the poster sees them all, with the applicant’s email', async () => {
    cvId = await uploadPdf(t, applicant, 'application_cv');
    const applied = (
      await applicant
        .post(`/opportunities/${listingRow.id}/applications`, { note: NOTE, phone: ' +254 712 345 678 ', link: 'https://leila.example.com/work', cvFileId: cvId })
        .expect(201)
    ).body as OpportunityDetail;
    expect(applied.viewer.application).toMatchObject({
      status: 'submitted',
      note: NOTE,
      phone: '+254 712 345 678',
      link: 'https://leila.example.com/work',
      cv: { id: cvId, name: 'Leila Benali CV.pdf', sizeBytes: PDF.length },
    });
    const [file] = await t.db.select().from(s.files).where(eq(s.files.id, cvId));
    expect(file!.attachedAt).not.toBeNull();

    const page = (await poster.get(`/opportunities/${listingRow.id}/applications`).expect(200)).body as ApplicationsPage;
    expect(page.items[0]).toMatchObject({
      applicant: { id: applicant.id },
      email: applicant.email,
      phone: '+254 712 345 678',
      link: 'https://leila.example.com/work',
      cv: { id: cvId, name: 'Leila Benali CV.pdf' },
    });

    // A member-posted listing still tells its poster.
    expect(await received(t, poster.id)).toHaveLength(1);
  });

  it('opens the CV only for the applicant, the poster and staff who review applications', async () => {
    await applicant.get(`/media/${cvId}`).expect(200);
    const res = await poster.get(`/media/${cvId}`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Leila Benali CV.pdf"/);
    await stranger.get(`/media/${cvId}`).expect(404);
    // Posting some other listing doesn't open CVs sent to this one.
    await stranger.post('/opportunities', listing({ title: 'Another Listing' })).expect(201);
    await stranger.get(`/media/${cvId}`).expect(404);
    const staff = await createMember(t, { name: 'Ops Staff', roles: ['platform_admin'], admin: true });
    await staff.get(`/media/${cvId}`).expect(200);
    const moderator = await createMember(t, { name: 'Mod Erator', roles: ['moderator'], admin: true });
    await moderator.get(`/media/${cvId}`).expect(404);
    await t.http().get(`/api/v1/media/${cvId}`).expect(401);
  });

  it('re-applying after withdrawing replaces what was sent', async () => {
    await applicant.delete(`/opportunities/${listingRow.id}/applications/mine`).expect(200);
    const again = (
      await applicant.post(`/opportunities/${listingRow.id}/applications`, { note: `${NOTE} Still keen.`, phone: '', link: null }).expect(201)
    ).body as OpportunityDetail;
    expect(again.viewer.application).toMatchObject({ status: 'submitted', note: `${NOTE} Still keen.`, phone: null, link: null, cv: null });
  });

  it('“Use the résumé on my profile” copies it as an application CV the poster can open', async () => {
    const member = await createMember(t, { name: 'Ama Resume' });
    await member.post('/me/application-cv/from-resume', {}).expect(404);
    const resume = await uploadPdf(t, member, 'profile_resume', 'Ama Resume.pdf');
    await member.patch('/me/profile', { resumeFileId: resume }).expect(200);

    const copy = (await member.post('/me/application-cv/from-resume', {}).expect(201)).body as ApplicationCv;
    expect(copy).toMatchObject({ name: 'Ama Resume.pdf', sizeBytes: PDF.length });
    expect(copy.id).not.toBe(resume);
    const [row] = await t.db.select().from(s.files).where(eq(s.files.id, copy.id));
    expect(row).toMatchObject({ ownerId: member.id, purpose: 'application_cv', scanStatus: 'clean' });

    await poster.get(`/media/${copy.id}`).expect(404);
    await member.post(`/opportunities/${listingRow.id}/applications`, { note: NOTE, cvFileId: copy.id }).expect(201);
    expect(((await poster.get(`/media/${copy.id}`).expect(200)).body as Buffer).toString('latin1')).toContain('%PDF-1.4');
  });

  describe('listings imported by staff and posted as a page', () => {
    let staff: Member;
    let pageId: string;
    let imported: OpportunityDetail;

    beforeAll(async () => {
      const admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
      const owner = await createMember(t, { name: 'Page Owner' });
      pageId = (
        (await admin
          .post('/admin/pages', { name: 'Charter Mission', slug: 'charter-mission-official', category: 'organisation', owner: owner.email, official: true, verified: true })
          .expect(201)).body as { id: string }
      ).id;
      staff = await createMember(t, { name: 'Ops Importer', roles: ['platform_admin'] });
      const staffUser = (await t.app.get(SessionService).userById(staff.id))!;
      const row = await t.app
        .get(OpportunitiesService)
        .createListing(staffUser, OpportunityInput.parse(listing({ title: 'Climate Policy Fellowship', type: 'fellowship', applyUrl: null })), { source: 'import', pageId });
      imported = (await applicant.get(`/opportunities/${row.slug}`).expect(200)).body as OpportunityDetail;
    });

    it('takes applications in Charter Mission without notifying the staff member who imported it', async () => {
      expect(imported).toMatchObject({ source: 'import', applyUrl: null, page: { id: pageId, name: 'Charter Mission' }, viewer: { canApply: true } });
      await applicant.post(`/opportunities/${imported.id}/applications`, { note: NOTE, phone: '+254 712 345 678' }).expect(201);
      expect(await received(t, staff.id)).toHaveLength(0);
      expect(await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, staff.email))).toHaveLength(0);
    });

    it('decisions on a page listing come from the page, not the staff member', async () => {
      const page = (await staff.get(`/opportunities/${imported.id}/applications`).expect(200)).body as ApplicationsPage;
      const app = page.items.find((a) => a.applicant.id === applicant.id)!;
      await staff.patch(`/opportunities/${imported.id}/applications/${app.id}`, { status: 'shortlisted' }).expect(200);
      const [n] = await t.db
        .select()
        .from(s.notifications)
        .where(and(eq(s.notifications.userId, applicant.id), eq(s.notifications.type, 'opportunity_application_updated'), eq(s.notifications.objectId, imported.id)));
      expect(n).toBeDefined();
      const text = segmentsText(n!.data);
      expect(text).toBe('Charter Mission shortlisted you for Climate Policy Fellowship');
      expect(text).not.toContain('Ops Importer');
      expect(n!.actorIds).toEqual([]);
    });

    it('a member listing’s decision still names the member who posted it', async () => {
      const page = (await poster.get(`/opportunities/${listingRow.id}/applications`).expect(200)).body as ApplicationsPage;
      const app = page.items.find((a) => a.applicant.id === applicant.id)!;
      await poster.patch(`/opportunities/${listingRow.id}/applications/${app.id}`, { status: 'declined' }).expect(200);
      const [n] = await t.db
        .select()
        .from(s.notifications)
        .where(and(eq(s.notifications.userId, applicant.id), eq(s.notifications.type, 'opportunity_application_updated'), eq(s.notifications.objectId, listingRow.id)));
      expect(segmentsText(n!.data)).toBe('Kwame Poster reviewed your application for Product Designer, Payments');
      expect(n!.actorIds).toEqual([poster.id]);
    });
  });
});
