import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminOpportunitiesPage,
  AdminOpportunityPages,
  AdminOpportunityRow,
  AdminPageRow,
  BulkResult,
  OpportunityDetail,
  OpportunityImportResult,
  PageRef,
} from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

/*
 * Admin console → Opportunities: the import of opportunities pasted from WhatsApp groups and forums
 * (Claude turns the text into a CSV, staff review the rows and post them as Charter Mission's official
 * page, or row by row as an organisation page the team runs, which they can create on the spot), the
 * list of every listing with its filters, and close / reopen / remove / restore. Rows without an apply
 * link take applications in Charter Mission (see admin-applications.e2e-spec.ts for their review).
 */

type Member = Awaited<ReturnType<typeof createMember>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A CSV row as the console sends it (column → cell). */
function csvRow(overrides: Record<string, string> = {}) {
  return {
    type: 'Job',
    title: 'Data Analyst, Mobile Money',
    organisation: 'Savanna Pay',
    summary: 'Turn payments data into decisions for a fast-growing wallet.',
    description: 'Savanna Pay is hiring a data analyst in Nairobi to build dashboards, run experiments and work with product teams. Two years of SQL experience needed.',
    remote_mode: 'on-site',
    country: 'Kenya',
    city: 'Nairobi',
    sector: 'Finance & fintech',
    deadline: inDays(14),
    compensation: 'KES 250k a month',
    apply_link: 'careers@savannapay.example',
    more_info_url: 'savannapay.example/jobs/data-analyst',
    ...overrides,
  };
}

const rows = (...values: Record<string, string>[]) => values.map((v, i) => ({ row: i + 2, values: v }));

async function auditRows(t: TestApp, action: string, targetId: string) {
  return t.db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.action, action), eq(s.auditLog.targetId, targetId)));
}

describe('Admin console: opportunities and the import from pasted text', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let member: Member;
  let official: AdminPageRow;
  let ordinary: AdminPageRow;
  let memberPage: { id: string };
  let fintech: { id: string; name: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Amara Member' });
    official = (await admin.post('/admin/pages', { name: 'Charter Mission Jobs', category: 'organisation', official: true }).expect(201)).body as AdminPageRow;
    // Created in the admin console: run by staff (staff_managed) but not official.
    ordinary = (await admin.post('/admin/pages', { name: 'Baobab Ventures', category: 'company' }).expect(201)).body as AdminPageRow;
    memberPage = (await member.post('/pages', { name: 'Amara Studio', category: 'company' }).expect(201)).body as { id: string };
    const [sector] = await t.db.select({ id: s.sectors.id, name: s.sectors.name }).from(s.sectors).where(eq(s.sectors.slug, 'finance-and-fintech'));
    if (sector) fintech = sector;
    else {
      const [created] = await t.db.insert(s.sectors).values({ slug: 'finance-and-fintech', name: 'Finance & fintech' }).returning({ id: s.sectors.id, name: s.sectors.name });
      fintech = created!;
    }
  });
  afterAll(async () => {
    await t.close();
  });

  it('only staff with opportunity.manage can use it', async () => {
    const body = { dryRun: true, rows: rows(csvRow()) };
    await member.get('/admin/opportunities').expect(403);
    await member.post('/admin/opportunities/import', body).expect(403);
    await mod.get('/admin/opportunities').expect(403);
    await mod.get('/admin/opportunities/pages').expect(403);
    await mod.post('/admin/opportunities/import', body).expect(403);
    await mod.post('/admin/opportunities/bulk', { ids: [official.id], action: 'close' }).expect(403);
    await admin.post('/admin/opportunities/import', body).expect(200);
  });

  it('lists the pages to post as: official pages first, then active pages the team runs, never members’ own pages', async () => {
    const res = (await admin.get('/admin/opportunities/pages').expect(200)).body as AdminOpportunityPages;
    expect(res.items.map((p) => p.id)).toEqual([official.id, ordinary.id]);
    expect(res.items[0]).toMatchObject({ official: true, slug: official.slug, name: 'Charter Mission Jobs' });
    expect(res.items[1]).toMatchObject({ official: false, name: 'Baobab Ventures' });
    expect(res.items.map((p) => p.id)).not.toContain(memberPage.id);
  });

  it('normalises labels, country names, sectors, dates and apply links on a dry run', async () => {
    const res = (
      await admin
        .post('/admin/opportunities/import', {
          dryRun: true,
          rows: rows(
            csvRow(),
            csvRow({
              type: 'call for proposals',
              title: 'Clean Cooking Innovation Fund',
              organisation: 'Green Futures Africa',
              remote_mode: 'Remote',
              country: '',
              city: '',
              sector: 'climate-and-energy',
              deadline: `${inDays(30)}T23:59:00Z`,
              apply_link: 'https://greenfutures.example/apply',
              more_info_url: '',
            }),
            csvRow({ type: 'internships', title: 'Graduate Engineering Intern', organisation: 'Volta Grid', country: 'gh', remote_mode: 'In person', sector: 'Basket weaving', apply_link: 'www.voltagrid.example/interns' }),
            csvRow({ type: 'scholarship', title: 'Masters Scholarship in Public Health', organisation: 'Ivory Health Trust', country: 'Ivory Coast', remote_mode: 'hybrid', deadline: '', summary: '', sector: '' }),
          ),
        })
        .expect(200)
    ).body as OpportunityImportResult;

    expect(res.dryRun).toBe(true);
    expect(res.created).toEqual([]);
    const [job, cfp, intern, scholarship] = res.rows;
    expect(job!.errors).toEqual({});
    expect(job!.input).toMatchObject({
      type: 'employment',
      remoteMode: 'in_person',
      countryCode: 'KE',
      sectorId: fintech.id,
      applyUrl: 'mailto:careers@savannapay.example',
      moreInfoUrl: 'https://savannapay.example/jobs/data-analyst',
    });
    expect(cfp!.input).toMatchObject({ type: 'call_for_proposals', remoteMode: 'remote', countryCode: null, deadline: inDays(30), applyUrl: 'https://greenfutures.example/apply' });
    expect(intern!.input).toMatchObject({ type: 'internship', countryCode: 'GH', remoteMode: 'in_person', sectorId: null, applyUrl: 'https://www.voltagrid.example/interns' });
    expect(intern!.warnings.join(' ')).toMatch(/Basket weaving/);
    expect(scholarship!.input).toMatchObject({ type: 'scholarship', countryCode: 'CI', remoteMode: 'hybrid', deadline: null });
    expect(scholarship!.input!.summary).toBe('Savanna Pay is hiring a data analyst in Nairobi to build dashboards, run experiments and work with product teams.');
    expect(scholarship!.warnings.join(' ')).toMatch(/No deadline/);
    expect(scholarship!.warnings.join(' ')).toMatch(/No summary/);
    // Nothing was written.
    expect(await t.db.select().from(s.opportunities)).toHaveLength(0);
  });

  it('reports problems per CSV column without stopping the other rows', async () => {
    const res = (
      await admin
        .post('/admin/opportunities/import', {
          dryRun: true,
          rows: rows(
            csvRow({ apply_link: 'not a link' }),
            csvRow({ apply_link: '+254 700 000000' }),
            csvRow({ deadline: '2020-01-01' }),
            csvRow({ deadline: '31/12/2026' }),
            csvRow({ type: 'Party' }),
            csvRow({ remote_mode: 'sometimes' }),
            csvRow({ country: 'Atlantis' }),
            csvRow({ country: '', remote_mode: 'on_site' }),
            csvRow({ title: 'Hi', description: 'Too short' }),
            csvRow(),
          ),
        })
        .expect(200)
    ).body as OpportunityImportResult;
    const errs = res.rows.map((r) => r.errors);
    expect(errs[0]).toHaveProperty('apply_link');
    expect(errs[1]).toHaveProperty('apply_link');
    expect(errs[2]!.deadline).toMatch(/passed/);
    expect(errs[3]!.deadline).toMatch(/2026-12-31/);
    expect(errs[4]).toHaveProperty('type');
    expect(errs[5]).toHaveProperty('remote_mode');
    expect(errs[6]).toHaveProperty('country');
    expect(errs[7]).toHaveProperty('country');
    expect(Object.keys(errs[8]!).sort()).toEqual(['description', 'title']);
    expect(res.rows.slice(0, 9).every((r) => r.input === null)).toBe(true);
    expect(res.rows[9]!.input).not.toBeNull();
    // No apply link: the listing takes applications in Charter Mission (not an error, not a warning).
    const inApp = (await admin.post('/admin/opportunities/import', { dryRun: true, rows: rows(csvRow({ apply_link: '' }), csvRow({ apply_link: undefined as unknown as string })) }).expect(200))
      .body as OpportunityImportResult;
    for (const r of inApp.rows) {
      expect(r.errors).toEqual({});
      expect(r.input!.applyUrl).toBeNull();
      expect(r.warnings.join(' ')).not.toMatch(/apply/i);
    }
    // An unknown country on a remote listing is only a warning.
    const remote = (await admin.post('/admin/opportunities/import', { dryRun: true, rows: rows(csvRow({ country: 'Atlantis', remote_mode: 'remote' })) }).expect(200)).body as OpportunityImportResult;
    expect(remote.rows[0]!.errors).toEqual({});
    expect(remote.rows[0]!.input!.countryCode).toBeNull();

    await admin.post('/admin/opportunities/import', { dryRun: true, rows: [] }).expect(422);
  });

  it('posts valid rows as an official page with the apply link, and refuses other pages', async () => {
    const body = { rows: rows(csvRow(), csvRow({ title: 'Broken row', apply_link: 'call +254 700 000000' })), shareToFeed: false };
    const noPage = await admin.post('/admin/opportunities/import', body).expect(422);
    expect(noPage.body.error.fields).toHaveProperty('pageId');
    const notOfficial = await admin.post('/admin/opportunities/import', { ...body, pageId: ordinary.id }).expect(422);
    expect(notOfficial.body.error.fields).toHaveProperty('pageId');
    expect(await t.db.select().from(s.opportunities)).toHaveLength(0);

    const res = (await admin.post('/admin/opportunities/import', { ...body, pageId: official.id }).expect(200)).body as OpportunityImportResult;
    expect(res.dryRun).toBe(false);
    expect(res.created).toHaveLength(1);
    expect(res.created[0]).toMatchObject({ row: 2, title: 'Data Analyst, Mobile Money', pageId: official.id });
    expect(res.rows[1]!.errors).toHaveProperty('apply_link');

    const [row] = await t.db.select().from(s.opportunities).where(eq(s.opportunities.id, res.created[0]!.id));
    expect(row).toMatchObject({ source: 'import', pageId: official.id, posterId: admin.id, applyUrl: 'mailto:careers@savannapay.example', countryCode: 'KE' });
    expect(await auditRows(t, 'opportunity.import', row!.id)).toHaveLength(1);

    // Members see the page as the poster and the external apply link.
    const detail = (await member.get(`/opportunities/${row!.slug}`).expect(200)).body as OpportunityDetail;
    expect(detail.page).toMatchObject({ id: official.id, official: true });
    expect(detail.applyUrl).toBe('mailto:careers@savannapay.example');
  });

  it('flags possible duplicates of open listings and within the batch', async () => {
    const res = (
      await admin
        .post('/admin/opportunities/import', {
          dryRun: true,
          rows: rows(
            csvRow({ title: 'DATA ANALYST, MOBILE MONEY', organisation: 'savanna pay', apply_link: 'https://other.example/apply' }),
            csvRow({ title: 'A different title entirely', organisation: 'Someone Else' }),
            csvRow({ title: 'Brand New Fellowship', organisation: 'New Org', apply_link: 'https://new.example/fellowship' }),
            csvRow({ title: 'Brand new fellowship', organisation: 'NEW ORG', apply_link: 'https://new.example/fellowship-2' }),
          ),
        })
        .expect(200)
    ).body as OpportunityImportResult;
    const [byTitle, byLink, first, repeat] = res.rows;
    expect(byTitle!.duplicates.map((d) => d.title)).toEqual(['Data Analyst, Mobile Money']);
    expect(byTitle!.errors).toEqual({});
    expect(byLink!.duplicates).toHaveLength(1); // same apply link (mailto:careers@…)
    expect(first!.duplicates).toEqual([]);
    expect(first!.duplicateOfRow).toBeNull();
    expect(repeat!.duplicateOfRow).toBe(first!.row);
    expect(repeat!.warnings.join(' ')).toMatch(/Row 4/);
  });

  it('lists every listing with filters and acts on them one by one or in bulk', async () => {
    // A member's own listing next to the imported one.
    const own = (
      await member
        .post('/opportunities', {
          type: 'fellowship',
          title: 'Community Builders Fellowship',
          organisation: 'Amara Collective',
          summary: 'Six months of support for community organisers.',
          description: 'A six-month fellowship for people building communities across the continent, with mentoring and a stipend.',
          remoteMode: 'remote',
          deadline: inDays(40),
        })
        .expect(201)
    ).body as OpportunityDetail;
    const imported = (await t.db.select().from(s.opportunities).where(eq(s.opportunities.source, 'import')))[0]!;

    const all = (await admin.get('/admin/opportunities').expect(200)).body as AdminOpportunitiesPage;
    expect(all.items.map((o) => o.id)).toEqual([own.id, imported.id]);
    expect(all.counts).toEqual({ all: 2, open: 2, closed: 0, removed: 0 });
    const importedRow = all.items[1]!;
    expect(importedRow).toMatchObject({ source: 'import', page: { id: official.id }, poster: { id: admin.id }, applyUrl: 'mailto:careers@savannapay.example', state: 'open' });
    expect(all.items[0]).toMatchObject({ source: 'member', page: null, poster: { id: member.id } });

    const ids = async (query: string) => ((await admin.get(`/admin/opportunities?${query}`).expect(200)).body as AdminOpportunitiesPage).items.map((o) => o.id);
    expect(await ids('source=import')).toEqual([imported.id]);
    expect(await ids('source=member')).toEqual([own.id]);
    expect(await ids('postedAs=page')).toEqual([imported.id]);
    expect(await ids('postedAs=member')).toEqual([own.id]);
    expect(await ids('type=fellowship')).toEqual([own.id]);
    expect(await ids('q=savanna')).toEqual([imported.id]);
    expect(await ids('q=builders')).toEqual([own.id]);
    // Cursor paging.
    const first = (await admin.get('/admin/opportunities?limit=1').expect(200)).body as AdminOpportunitiesPage;
    expect(first.items).toHaveLength(1);
    const second = (await admin.get(`/admin/opportunities?limit=1&cursor=${first.nextCursor}`).expect(200)).body as AdminOpportunitiesPage;
    expect(second.items.map((o) => o.id)).toEqual([imported.id]);
    expect(second.nextCursor).toBeNull();
    await admin.get('/admin/opportunities?cursor=nonsense').expect(400);

    // Close one, then bulk: closing it again fails, the other closes.
    const closed = (await admin.post(`/admin/opportunities/${own.id}`, { action: 'close' }).expect(200)).body as AdminOpportunityRow;
    expect(closed.state).toBe('closed');
    expect(await auditRows(t, 'opportunity.closed', own.id)).toHaveLength(1);
    const bulkClose = (await admin.post('/admin/opportunities/bulk', { ids: [own.id, imported.id], action: 'close' }).expect(200)).body as BulkResult;
    expect(bulkClose.done).toEqual([imported.id]);
    expect(bulkClose.failed).toEqual([{ id: own.id, error: expect.stringMatching(/already closed/) }]);
    expect(await ids('status=closed')).toEqual([own.id, imported.id]);
    expect(await ids('status=open')).toEqual([]);

    const reopened = (await admin.post('/admin/opportunities/bulk', { ids: [own.id], action: 'reopen' }).expect(200)).body as BulkResult;
    expect(reopened.done).toEqual([own.id]);

    // Remove both: members no longer see them; staff find them under Removed and can restore.
    const removed = (await admin.post('/admin/opportunities/bulk', { ids: [own.id, imported.id], action: 'remove' }).expect(200)).body as BulkResult;
    expect(removed.done.sort()).toEqual([own.id, imported.id].sort());
    expect(await auditRows(t, 'opportunity.removed', imported.id)).toHaveLength(1);
    const [row] = await t.db.select().from(s.opportunities).where(eq(s.opportunities.id, imported.id));
    expect(row!.moderationState).toBe('removed');
    const viewer = await createMember(t, { name: 'Another Member' });
    await viewer.get(`/opportunities/${imported.slug}`).expect(404);
    expect(await ids('status=removed')).toEqual([own.id, imported.id]);
    const counts = ((await admin.get('/admin/opportunities').expect(200)).body as AdminOpportunitiesPage).counts;
    expect(counts).toEqual({ all: 2, open: 0, closed: 0, removed: 2 });

    await admin.post(`/admin/opportunities/${own.id}`, { action: 'reopen' }).expect(409);
    const restored = (await admin.post(`/admin/opportunities/${own.id}`, { action: 'restore' }).expect(200)).body as AdminOpportunityRow;
    expect(restored.state).toBe('open');
    await admin.post('/admin/opportunities/00000000-0000-4000-8000-000000000099', { action: 'close' }).expect(404);
    await admin.post('/admin/opportunities/not-a-uuid', { action: 'close' }).expect(404);
  });

  it('with "share each to the feed", every imported listing reaches every member’s feed as a post from the page', async () => {
    const stranger = await createMember(t, { name: 'Unconnected Member' });
    const res = (
      await admin
        .post('/admin/opportunities/import', { rows: rows(csvRow({ title: 'Feed Bound Analyst Role' })), pageId: official.id, shareToFeed: true })
        .expect(200)
    ).body as OpportunityImportResult;
    const id = res.created[0]!.id;
    const shared = await t.db.select().from(s.posts).where(eq(s.posts.opportunityId, id));
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ pageId: official.id, authorId: admin.id });
    const feed = await stranger.get('/feed?tab=latest&limit=50').expect(200);
    const item = feed.body.items.find((p: { id: string }) => p.id === shared[0]!.id);
    expect(item).toBeDefined();
    expect(item.isOpportunityShare).toBe(true);
    expect(item.opportunity).toMatchObject({ id, title: 'Feed Bound Analyst Role', applyUrl: 'mailto:careers@savannapay.example' });
  });

  it('a row without an apply link becomes a listing members apply to in Charter Mission', async () => {
    const res = (
      await admin.post('/admin/opportunities/import', { rows: rows(csvRow({ title: 'In-App Applications Officer', apply_link: '' })), pageId: official.id, shareToFeed: false }).expect(200)
    ).body as OpportunityImportResult;
    const [row] = await t.db.select().from(s.opportunities).where(eq(s.opportunities.id, res.created[0]!.id));
    expect(row).toMatchObject({ source: 'import', applyUrl: null, pageId: official.id });
    const applicant = await createMember(t, { name: 'In-App Applicant' });
    const detail = (await applicant.get(`/opportunities/${row!.slug}`).expect(200)).body as OpportunityDetail;
    expect(detail.applyUrl).toBeNull();
    expect(detail.viewer.canApply).toBe(true);
    await applicant.post(`/opportunities/${row!.id}/applications`, { note: 'I have five years of programme operations experience.' }).expect(201);
    const listed = ((await admin.get('/admin/opportunities?source=import').expect(200)).body as AdminOpportunitiesPage).items.find((o) => o.id === row!.id)!;
    expect(listed).toMatchObject({ reviewedInConsole: true, applicationCount: 1, newApplicationCount: 1 });
  });

  it('creates organisation pages the team runs, with the admin page form’s rules', async () => {
    const body = { name: 'Flutterwave', category: 'company', website: 'https://flutterwave.example', countryCode: 'NG', city: 'Lagos', tagline: 'Payments for Africa' };
    await member.post('/admin/opportunities/organisations', body).expect(403);
    await mod.post('/admin/opportunities/organisations', body).expect(403);
    const bad = await admin.post('/admin/opportunities/organisations', { ...body, website: 'flutterwave', countryCode: 'ZZ', category: 'shop' }).expect(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(expect.arrayContaining(['category', 'website']));
    await admin.post('/admin/opportunities/organisations', { ...body, countryCode: 'QQ' }).expect(422);
    // Someone else's logo upload is refused.
    const [othersLogo] = await t.db
      .insert(s.files)
      .values({ ownerId: member.id, purpose: 'page_logo', mime: 'image/png', declaredMime: 'image/png', originalName: 'logo.png', sizeBytes: 10, storageKey: `uploads/page_logo/${member.id}`, scanStatus: 'clean' })
      .returning();
    await admin.post('/admin/opportunities/organisations', { ...body, logoFileId: othersLogo!.id }).expect(422);
    const [logo] = await t.db
      .insert(s.files)
      .values({ ownerId: admin.id, purpose: 'page_logo', mime: 'image/png', declaredMime: 'image/png', originalName: 'logo.png', sizeBytes: 10, storageKey: `uploads/page_logo/${admin.id}`, scanStatus: 'clean' })
      .returning();

    const page = (await admin.post('/admin/opportunities/organisations', { ...body, logoFileId: logo!.id }).expect(201)).body as PageRef;
    expect(page).toMatchObject({ name: 'Flutterwave', official: false, verified: false, logoUrl: expect.stringContaining(logo!.id) });
    const [row] = await t.db.select().from(s.pages).where(eq(s.pages.id, page.id));
    expect(row).toMatchObject({ status: 'active', staffManaged: true, official: false, createdBy: admin.id, countryCode: 'NG', city: 'Lagos', website: 'https://flutterwave.example', category: 'company' });
    const [owner] = await t.db.select().from(s.pageAdmins).where(eq(s.pageAdmins.pageId, page.id));
    expect(owner).toMatchObject({ userId: admin.id, role: 'owner' });
    expect(await auditRows(t, 'page.created', page.id)).toHaveLength(1);
    // Live on the member site, and offered under Post as.
    await member.get(`/pages/${page.slug}`).expect(200);
    const offered = (await admin.get('/admin/opportunities/pages').expect(200)).body as AdminOpportunityPages;
    expect(offered.items.map((p) => p.id)).toContain(page.id);
    // The same name again (any case) is refused: choose the existing page.
    const again = await admin.post('/admin/opportunities/organisations', { name: 'FLUTTERWAVE', category: 'company' }).expect(422);
    expect(again.body.error.fields.name).toMatch(/already a page called Flutterwave/);
  });

  it('posts rows as an organisation page the team runs, shared to the feed from the official page; members’ pages are refused', async () => {
    const stranger = await createMember(t, { name: 'Feed Reader Far Away' });
    const dry = (
      await admin
        .post('/admin/opportunities/import', {
          dryRun: true,
          rows: [
            { row: 2, values: csvRow({ title: 'Baobab Growth Lead' }), pageId: ordinary.id },
            { row: 3, values: csvRow({ title: 'Studio Assistant' }), pageId: memberPage.id },
            { row: 4, values: csvRow({ title: 'Unknown Page Role' }), pageId: '00000000-0000-4000-8000-000000000123' },
          ],
        })
        .expect(200)
    ).body as OpportunityImportResult;
    expect(dry.rows[0]!.errors).toEqual({});
    expect(dry.rows[1]!.errors.page).toMatch(/official page or an organisation page/);
    expect(dry.rows[1]!.input).toBeNull();
    expect(dry.rows[2]!.errors).toHaveProperty('page');

    // The batch page must still be official: a staff-run page can't be the default.
    await admin.post('/admin/opportunities/import', { rows: rows(csvRow({ title: 'Default As Org' })), pageId: ordinary.id }).expect(422);

    const res = (
      await admin
        .post('/admin/opportunities/import', {
          pageId: official.id,
          shareToFeed: true,
          rows: [
            { row: 2, values: csvRow({ title: 'Baobab Growth Lead', apply_link: '' }), pageId: ordinary.id },
            { row: 3, values: csvRow({ title: 'Studio Assistant' }), pageId: memberPage.id },
            { row: 4, values: csvRow({ title: 'Official Page Role' }), pageId: official.id },
            { row: 5, values: csvRow({ title: 'Default Page Role' }) },
          ],
        })
        .expect(200)
    ).body as OpportunityImportResult;
    expect(res.created.map((c) => [c.title, c.pageId])).toEqual([
      ['Baobab Growth Lead', ordinary.id],
      ['Official Page Role', official.id],
      ['Default Page Role', official.id],
    ]);
    expect(res.rows[1]!.errors).toHaveProperty('page');

    const orgListing = res.created[0]!;
    const [row] = await t.db.select().from(s.opportunities).where(eq(s.opportunities.id, orgListing.id));
    expect(row).toMatchObject({ pageId: ordinary.id, posterId: admin.id, source: 'import' });
    // The listing shows the organisation page as the poster…
    const detail = (await stranger.get(`/opportunities/${row!.slug}`).expect(200)).body as OpportunityDetail;
    expect(detail.page).toMatchObject({ id: ordinary.id, name: 'Baobab Ventures', official: false });
    // …and its feed post comes from the official page, so a member who follows nobody sees it.
    const shared = await t.db.select().from(s.posts).where(eq(s.posts.opportunityId, orgListing.id));
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ pageId: official.id, authorId: admin.id });
    const feed = await stranger.get('/feed?tab=latest&limit=50').expect(200);
    const item = feed.body.items.find((p: { id: string }) => p.id === shared[0]!.id);
    expect(item).toBeDefined();
    expect(item.opportunity).toMatchObject({ id: orgListing.id, title: 'Baobab Growth Lead' });
    // Listings posted as an official page are shared as that page.
    const officialShare = await t.db.select().from(s.posts).where(eq(s.posts.opportunityId, res.created[1]!.id));
    expect(officialShare[0]).toMatchObject({ pageId: official.id });
  });
});
