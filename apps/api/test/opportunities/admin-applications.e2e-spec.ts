import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminApplicationsPage,
  AdminApplicationView,
  AdminNewApplicationsCount,
  AdminOpportunityRow,
  AdminPageRow,
  OpportunityDetail,
  OpportunityImportResult,
} from '@chartermission/contracts';
import { env } from '../../src/config/env.js';
import { MediaService } from '../../src/media/media.service.js';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { eventually } from '../events/event-helpers.js';

/*
 * Admin console → Opportunities → an imported listing's applications. Listings imported without an
 * apply link take applications in Charter Mission; staff review them in the console (not the staff
 * member who imported them on the member site): list with counts, shortlist / accept / decline (the
 * applicant is notified as by a poster's decision, from Charter Mission), and a CSV export.
 */

type Member = Awaited<ReturnType<typeof createMember>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const csvRow = (overrides: Record<string, string> = {}) => ({
  type: 'fellowship',
  title: 'Pan-African Policy Fellowship',
  organisation: 'Baobab Institute',
  summary: 'A year-long fellowship for early-career policy researchers.',
  description: 'The Baobab Institute fellowship supports early-career researchers working on trade and policy across the continent, with a stipend and mentoring.',
  remote_mode: 'remote',
  deadline: inDays(20),
  apply_link: '',
  ...overrides,
});

/** Parses our CSV (RFC 4180: quoted fields may hold commas, quotes and line breaks). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') continue;
    else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

describe('Admin console: applications to imported listings', () => {
  let t: TestApp;
  let admin: Member;
  let otherAdmin: Member;
  let mod: Member;
  let poster: Member;
  let ada: Member;
  let bayo: Member;
  let chi: Member;
  let official: AdminPageRow;
  let listing: { id: string; slug: string };
  let external: { id: string };
  let memberListing: OpportunityDetail;
  let cvFileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Importing Admin', roles: ['platform_admin'], admin: true });
    otherAdmin = await createMember(t, { name: 'Reviewing Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator Only', roles: ['moderator'], admin: true });
    poster = await createMember(t, { name: 'Member Poster' });
    ada = await createMember(t, { name: 'Ada Éloïse Mensah', countryCode: 'GH' });
    bayo = await createMember(t, { name: 'Bayo Adeyemi', countryCode: 'NG' });
    chi = await createMember(t, { name: 'Chi Okafor', countryCode: 'KE' });
    await t.db.update(s.memberProfiles).set({ headline: 'Policy analyst, trade & regional integration', city: 'Accra' }).where(eq(s.memberProfiles.userId, ada.id));

    official = (await admin.post('/admin/pages', { name: 'Charter Mission', category: 'organisation', official: true }).expect(201)).body as AdminPageRow;
    const imported = (
      await admin
        .post('/admin/opportunities/import', {
          pageId: official.id,
          shareToFeed: false,
          rows: [
            { row: 2, values: csvRow() },
            { row: 3, values: csvRow({ title: 'External Apply Analyst', apply_link: 'https://baobab.example/apply' }) },
          ],
        })
        .expect(200)
    ).body as OpportunityImportResult;
    listing = imported.created[0]!;
    external = imported.created[1]!;
    memberListing = (
      await poster
        .post('/opportunities', {
          type: 'employment',
          title: 'Community Manager',
          organisation: 'Member Co',
          summary: 'Run our member community day to day.',
          description: 'We are hiring a community manager to run events, onboarding and our member newsletter across West Africa.',
          remoteMode: 'remote',
        })
        .expect(201)
    ).body as OpportunityDetail;

    // Ada applies with a CV (a clean application_cv upload of hers), a phone number and a link.
    const storage = t.app.get(MediaService).storage;
    const key = `uploads/application_cv/${ada.id}-cv.pdf`;
    const pdf = Buffer.from('%PDF-1.4\n% Ada CV\n%%EOF\n');
    await storage.write(key, pdf, 'application/pdf');
    const [cv] = await t.db
      .insert(s.files)
      .values({ ownerId: ada.id, purpose: 'application_cv', mime: 'application/pdf', declaredMime: 'application/pdf', originalName: 'Ada Mensah CV.pdf', sizeBytes: pdf.length, storageKey: key, scanStatus: 'clean' })
      .returning();
    cvFileId = cv!.id;
    await ada
      .post(`/opportunities/${listing.id}/applications`, {
        note: 'I research ECOWAS trade rules, and I have written "Borders, Markets" — a report, with data.\nSecond line.',
        phone: '+233 20 555 0199',
        link: 'https://ada.example/portfolio',
        cvFileId,
      })
      .expect(201);
    await bayo.post(`/opportunities/${listing.id}/applications`, { note: 'I lead a policy reading group of 300 young professionals in Lagos.' }).expect(201);
    await chi.post(`/opportunities/${listing.id}/applications`, { note: '=HYPERLINK("https://evil.example") I would love to join this.' }).expect(201);
    await chi.delete(`/opportunities/${listing.id}/applications/mine`).expect(200);
    await ada.post(`/opportunities/${memberListing.id}/applications`, { note: 'Happy to run your community events every month.' }).expect(201);
  });
  afterAll(async () => {
    await t.close();
  });

  it('is for staff with opportunity.manage only', async () => {
    await poster.get(`/admin/opportunities/${listing.id}/applications`).expect(403);
    await mod.get(`/admin/opportunities/${listing.id}/applications`).expect(403);
    await mod.get(`/admin/opportunities/${listing.id}/applications/export`).expect(403);
    await mod.patch(`/admin/opportunities/${listing.id}/applications/00000000-0000-4000-8000-000000000001`, { status: 'shortlisted' }).expect(403);
    await mod.get('/admin/opportunities/applications/new-count').expect(403);
    await poster.get(`/admin/opportunities/${listing.id}`).expect(403);
  });

  it('members’ own listings are reviewed by their poster, not here', async () => {
    const res = await admin.get(`/admin/opportunities/${memberListing.id}/applications`).expect(404);
    expect(res.body.error.message).toMatch(/reviewed by their poster/);
    await admin.get(`/admin/opportunities/${memberListing.id}/applications/export`).expect(404);
    await admin.get('/admin/opportunities/not-a-uuid/applications').expect(404);
    await admin.get('/admin/opportunities/00000000-0000-4000-8000-000000000099/applications').expect(404);
  });

  it('the list shows imported listings’ applications and how many are new; the sidebar count adds them up', async () => {
    const row = (await admin.get(`/admin/opportunities/${listing.id}`).expect(200)).body as AdminOpportunityRow;
    expect(row).toMatchObject({ id: listing.id, source: 'import', reviewedInConsole: true, applicationCount: 2, newApplicationCount: 2, page: { id: official.id } });
    const ext = (await admin.get(`/admin/opportunities/${external.id}`).expect(200)).body as AdminOpportunityRow;
    expect(ext.reviewedInConsole).toBe(false);
    const own = (await admin.get(`/admin/opportunities/${memberListing.id}`).expect(200)).body as AdminOpportunityRow;
    expect(own).toMatchObject({ reviewedInConsole: false, applicationCount: 1 });
    // Only imported listings count towards the badge (the member listing's application doesn't).
    expect(((await admin.get('/admin/opportunities/applications/new-count').expect(200)).body as AdminNewApplicationsCount).count).toBe(2);
  });

  it('lists applications with the applicant’s email, phone, link, CV and counts by status', async () => {
    const page = (await admin.get(`/admin/opportunities/${listing.id}/applications`).expect(200)).body as AdminApplicationsPage;
    expect(page.counts).toEqual({ submitted: 2, shortlisted: 0, accepted: 0, declined: 0, withdrawn: 1 });
    expect(page.items.map((a) => a.applicant.id)).toEqual([bayo.id, ada.id]);
    expect(page.items[1]).toMatchObject({
      email: ada.email,
      phone: '+233 20 555 0199',
      link: 'https://ada.example/portfolio',
      location: 'Accra, Ghana',
      status: 'submitted',
      cv: { id: cvFileId, name: 'Ada Mensah CV.pdf' },
      applicant: { name: 'Ada Éloïse Mensah', headline: 'Policy analyst, trade & regional integration' },
    });
    expect(page.items[0]).toMatchObject({ email: bayo.email, phone: null, cv: null, location: 'Nigeria' });
    const withdrawn = (await admin.get(`/admin/opportunities/${listing.id}/applications?status=withdrawn`).expect(200)).body as AdminApplicationsPage;
    expect(withdrawn.items.map((a) => a.applicant.id)).toEqual([chi.id]);
    // Cursor paging.
    const first = (await admin.get(`/admin/opportunities/${listing.id}/applications?limit=1`).expect(200)).body as AdminApplicationsPage;
    const second = (await admin.get(`/admin/opportunities/${listing.id}/applications?limit=1&cursor=${first.nextCursor}`).expect(200)).body as AdminApplicationsPage;
    expect([...first.items, ...second.items].map((a) => a.applicant.id)).toEqual([bayo.id, ada.id]);
    expect(second.nextCursor).toBeNull();
    await admin.get(`/admin/opportunities/${listing.id}/applications?cursor=nonsense`).expect(400);
    // Reviewing staff can open the CV; other members can't.
    const cv = await otherAdmin.get(`/media/${cvFileId}`);
    expect([200, 302]).toContain(cv.status);
    await bayo.get(`/media/${cvFileId}`).expect(404);
  });

  it('staff decide like a poster: the applicant is notified by Charter Mission, and the decision is audited', async () => {
    const page = (await admin.get(`/admin/opportunities/${listing.id}/applications`).expect(200)).body as AdminApplicationsPage;
    const adaApp = page.items.find((a) => a.applicant.id === ada.id)!;
    const bayoApp = page.items.find((a) => a.applicant.id === bayo.id)!;

    // Another staff member (not the importer) decides.
    const shortlisted = (await otherAdmin.patch(`/admin/opportunities/${listing.id}/applications/${adaApp.id}`, { status: 'shortlisted', message: 'We will call you next week.' }).expect(200))
      .body as AdminApplicationView;
    expect(shortlisted).toMatchObject({ id: adaApp.id, status: 'shortlisted', email: ada.email });
    const notes = await eventually(
      () => t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, ada.id), eq(s.notifications.type, 'opportunity_application_updated'))),
      (rows) => rows.length > 0,
    );
    const text = JSON.stringify(notes[0]!.data.segments);
    expect(text).toContain('Charter Mission');
    expect(text).toContain('shortlisted you for');
    expect(text).toContain('We will call you next week.');
    expect(text).not.toContain('Importing Admin');
    expect(text).not.toContain('Reviewing Admin');
    const audit = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'opportunity.application_decided'), eq(s.auditLog.targetId, listing.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(otherAdmin.id);

    await admin.patch(`/admin/opportunities/${listing.id}/applications/${bayoApp.id}`, { status: 'declined' }).expect(200);
    const declined = await eventually(
      () => t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, bayo.id), eq(s.notifications.type, 'opportunity_application_updated'))),
      (rows) => rows.length > 0,
    );
    expect((declined[0]!.data.segments as { text: string }[]).map((x) => x.text).join('')).toBe('Charter Mission reviewed your application for Pan-African Policy Fellowship');
    // The applicant sees the decision on the member site.
    const detail = (await bayo.get(`/opportunities/${listing.slug}`).expect(200)).body as OpportunityDetail;
    expect(detail.viewer.application?.status).toBe('declined');

    const after = (await admin.get(`/admin/opportunities/${listing.id}/applications`).expect(200)).body as AdminApplicationsPage;
    expect(after.counts).toMatchObject({ submitted: 0, shortlisted: 1, declined: 1, withdrawn: 1 });
    expect(((await admin.get('/admin/opportunities/applications/new-count').expect(200)).body as AdminNewApplicationsCount).count).toBe(0);
    expect(((await admin.get(`/admin/opportunities/${listing.id}`).expect(200)).body as AdminOpportunityRow).newApplicationCount).toBe(0);

    // Withdrawn applications, other listings' applications and bad input are refused.
    const chiApp = ((await admin.get(`/admin/opportunities/${listing.id}/applications?status=withdrawn`).expect(200)).body as AdminApplicationsPage).items[0]!;
    await admin.patch(`/admin/opportunities/${listing.id}/applications/${chiApp.id}`, { status: 'accepted' }).expect(404);
    await admin.patch(`/admin/opportunities/${external.id}/applications/${adaApp.id}`, { status: 'accepted' }).expect(404);
    await admin.patch(`/admin/opportunities/${listing.id}/applications/${adaApp.id}`, { status: 'withdrawn' }).expect(422);
    await admin.patch(`/admin/opportunities/${listing.id}/applications/not-a-uuid`, { status: 'accepted' }).expect(404);
  });

  it('exports the applications as a CSV Excel opens correctly, and audits the export', async () => {
    const res = await admin.get(`/admin/opportunities/${listing.id}/applications/export`).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="applications-pan-african-policy-fellowship-[a-f0-9]+-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = res.body as Buffer;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8').slice(1);
    const [header, ...lines] = parseCsv(text);
    expect(header).toEqual(['applied_at', 'status', 'name', 'email', 'phone', 'headline', 'country', 'profile_url', 'link', 'cv_url', 'note']);
    expect(lines).toHaveLength(2);
    const byName = new Map(lines.map((l) => [l[2], l]));
    const adaLine = byName.get('Ada Éloïse Mensah')!;
    const web = env().WEB_URL.replace(/\/+$/, '');
    const api = env().API_PUBLIC_URL.replace(/\/+$/, '');
    expect(adaLine).toEqual([
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      'shortlisted',
      'Ada Éloïse Mensah',
      ada.email,
      "'+233 20 555 0199",
      'Policy analyst, trade & regional integration',
      'Ghana',
      `${web}/${ada.handle}`,
      'https://ada.example/portfolio',
      `${api}/media/${cvFileId}`,
      'I research ECOWAS trade rules, and I have written "Borders, Markets" — a report, with data.\nSecond line.',
    ]);
    expect(byName.get('Bayo Adeyemi')!.slice(1, 5)).toEqual(['declined', 'Bayo Adeyemi', bayo.email, '']);
    // Quoting in the raw text: commas, quotes and line breaks inside quotes.
    expect(text).toContain('"I research ECOWAS trade rules, and I have written ""Borders, Markets"" — a report, with data.\nSecond line."');

    // The status filter; withdrawn applications only when asked for, formulas neutralised.
    const filtered = await admin.get(`/admin/opportunities/${listing.id}/applications/export?status=withdrawn`).buffer(true).parse((r, done) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (body += c));
      r.on('end', () => done(null, body));
    });
    const [, ...withdrawnLines] = parseCsv((filtered.body as string).replace(/^﻿/, ''));
    expect(withdrawnLines.map((l) => l[2])).toEqual(['Chi Okafor']);
    expect(withdrawnLines[0]![10]).toMatch(/^'=HYPERLINK/);
    await admin.get(`/admin/opportunities/${listing.id}/applications/export?status=bogus`).expect(422);

    const audit = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'opportunity.applications_exported'), eq(s.auditLog.targetId, listing.id)));
    expect(audit.map((a) => a.after)).toEqual([{ status: null }, { status: 'withdrawn' }]);
  });
});
