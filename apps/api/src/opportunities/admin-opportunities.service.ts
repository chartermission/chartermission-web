import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  ADMIN_APPLICATION_CSV_COLUMNS,
  OpportunityInput,
  type AdminApplicationsExportQuery,
  type AdminApplicationsPage,
  type AdminApplicationsQuery,
  type AdminApplicationView,
  type AdminNewApplicationsCount,
  type AdminOrganisationInput,
  type ApplicationStatus,
  type DecideApplicationInput,
  type PageRef,
  type AdminOpportunitiesBulkInput,
  type AdminOpportunitiesPage,
  type AdminOpportunitiesQuery,
  type AdminOpportunityActionKind,
  type AdminOpportunityPages,
  type AdminOpportunityRow,
  type AdminOpportunityState,
  type BulkResult,
  type OpportunityImportDuplicate,
  type OpportunityImportInput,
  type OpportunityImportResult,
  type OpportunityImportRowResult,
  type OpportunityType,
  type RemoteMode,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { countries, memberProfiles, opportunities, opportunityApplications, pages, sectors, users } from '../db/schema.js';
import { env } from '../config/env.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { PagesService } from '../pages/pages.service.js';
import { csvCell } from '../admin/admin-audit.service.js';
import { AppError, Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { likePrefix, tsKey, uuidOr404 } from '../moderation/util.js';
import { OpportunitiesService, todayIso, type OpportunityRow } from './opportunities.service.js';
import { columnOfField, normaliseRow, type ImportReference } from './opportunity-import.normalise.js';

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const lower = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

const STATUS_ORDER: ApplicationStatus[] = ['submitted', 'shortlisted', 'accepted', 'declined', 'withdrawn'];

type ApplicationRow = typeof opportunityApplications.$inferSelect;

/** A page an imported listing may be posted as: active, and official or run by staff. */
type PostAsPage = { id: string; official: boolean };

function write(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

/** Where a listing stands for staff (contracts AdminOpportunityState). */
function stateOf(row: OpportunityRow, today: string): AdminOpportunityState {
  if (row.moderationState === 'removed') return 'removed';
  if (row.moderationState === 'hidden') return 'hidden';
  if (row.status === 'closed') return 'closed';
  return row.deadline && row.deadline < today ? 'expired' : 'open';
}

/**
 * Admin console → Opportunities (contracts/opportunity-import.ts): every listing with close, reopen,
 * remove and restore, the pages staff post as (official ones, and organisation pages staff create and
 * run), and the import of listings Claude turned from pasted WhatsApp or forum messages into a CSV.
 * Imported listings are created through OpportunitiesService.createListing (source 'import', posted
 * as the page), which shares them to the feed when asked. Staff imports have no daily limit.
 *
 * Imported listings without an apply link take applications in Charter Mission; staff review those
 * here (list, shortlist / accept / decline, CSV export) instead of the importing staff member doing
 * it on the member site. Decisions notify the applicant through the same domain event as a poster's.
 */
@Injectable()
export class AdminOpportunitiesService {
  private readonly log = new Logger('AdminOpportunities');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly opportunities: OpportunitiesService,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly pagesService: PagesService,
  ) {}

  /* ------------------------------ List ------------------------------ */

  /** Filters other than the status tab (the tab counts use these). */
  private filterConds(q: AdminOpportunitiesQuery): (SQL | undefined)[] {
    const conds: (SQL | undefined)[] = [isNull(opportunities.deletedAt)];
    if (q.q) {
      const contains = `%${likePrefix(q.q)}`;
      conds.push(or(ilike(opportunities.title, contains), ilike(opportunities.organisation, contains)));
    }
    if (q.type) conds.push(eq(opportunities.type, q.type));
    if (q.source) conds.push(eq(opportunities.source, q.source));
    if (q.postedAs === 'page') conds.push(sql`${opportunities.pageId} is not null`);
    if (q.postedAs === 'member') conds.push(isNull(opportunities.pageId));
    return conds;
  }

  private statusCond(status: AdminOpportunitiesQuery['status'], today: string): SQL | undefined {
    const live = eq(opportunities.moderationState, 'visible');
    if (status === 'open') return and(live, eq(opportunities.status, 'open'), sql`(${opportunities.deadline} is null or ${opportunities.deadline} >= ${today})`);
    if (status === 'closed') return and(live, sql`(${opportunities.status} = 'closed' or ${opportunities.deadline} < ${today})`);
    if (status === 'removed') return ne(opportunities.moderationState, 'visible');
    return undefined;
  }

  /** GET /admin/opportunities: newest first, keyset cursor on (created_at, id). */
  async list(q: AdminOpportunitiesQuery): Promise<AdminOpportunitiesPage> {
    const today = todayIso();
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    checkCursor(cursor, { t: 'date', id: 'uuid' });
    const conds = [...this.filterConds(q), this.statusCond(q.status, today)];
    if (cursor) conds.push(sql`(${opportunities.createdAt}, ${opportunities.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const [rows, counts] = await Promise.all([
      this.db
        .select({ o: opportunities, t: tsKey(opportunities.createdAt) })
        .from(opportunities)
        .where(and(...conds))
        .orderBy(desc(opportunities.createdAt), desc(opportunities.id))
        .limit(q.limit + 1),
      this.counts(q, today),
    ]);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.o.id }));
    return { items: await this.rows(page.items.map((r) => r.o)), nextCursor: page.nextCursor, counts };
  }

  private async counts(q: AdminOpportunitiesQuery, today: string): Promise<AdminOpportunitiesPage['counts']> {
    const live = sql`${opportunities.moderationState} = 'visible'`;
    const [row] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${live} and ${opportunities.status} = 'open' and (${opportunities.deadline} is null or ${opportunities.deadline} >= ${today}))::int`,
        closed: sql<number>`count(*) filter (where ${live} and (${opportunities.status} = 'closed' or ${opportunities.deadline} < ${today}))::int`,
        removed: sql<number>`count(*) filter (where ${opportunities.moderationState} <> 'visible')::int`,
      })
      .from(opportunities)
      .where(and(...this.filterConds(q)));
    return { all: row?.all ?? 0, open: row?.open ?? 0, closed: row?.closed ?? 0, removed: row?.removed ?? 0 };
  }

  private async rows(list: OpportunityRow[]): Promise<AdminOpportunityRow[]> {
    if (!list.length) return [];
    const today = todayIso();
    const codes = [...new Set(list.map((r) => r.countryCode).filter((c): c is string => !!c))];
    const [posters, pageMap, countryRows, fresh] = await Promise.all([
      this.members.refs(list.map((r) => r.posterId)),
      this.pageRefs.refs(list.map((r) => r.pageId).filter((p): p is string => !!p)),
      codes.length ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, codes)) : [],
      this.db
        .select({ id: opportunityApplications.opportunityId, n: count() })
        .from(opportunityApplications)
        .where(and(inArray(opportunityApplications.opportunityId, list.map((r) => r.id)), eq(opportunityApplications.status, 'submitted')))
        .groupBy(opportunityApplications.opportunityId),
    ]);
    const countryMap = new Map(countryRows.map((c) => [c.code, c]));
    const freshMap = new Map(fresh.map((f) => [f.id, f.n]));
    return list.map((r) => {
      const page = r.pageId ? pageMap.get(r.pageId) : undefined;
      return {
        id: r.id,
        slug: r.slug,
        type: r.type as OpportunityType,
        title: r.title,
        organisation: r.organisation,
        remoteMode: r.remoteMode as RemoteMode,
        country: r.countryCode ? (countryMap.get(r.countryCode) ?? { code: r.countryCode, name: r.countryCode }) : null,
        city: r.city,
        poster: posters.get(r.posterId) ?? null,
        page: page ? PageRefsService.toRef(page) : null,
        source: r.source === 'import' ? 'import' : 'member',
        deadline: r.deadline,
        applyUrl: r.applyUrl,
        applicationCount: r.applicationCount,
        newApplicationCount: freshMap.get(r.id) ?? 0,
        reviewedInConsole: r.source === 'import' && !r.applyUrl,
        state: stateOf(r, today),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** GET /admin/opportunities/{id}: one listing as the list shows it (the applications page's header). */
  async one(rawId: string): Promise<AdminOpportunityRow> {
    const id = uuidOr404(rawId, 'That opportunity');
    const [row] = await this.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (!row) throw Errors.notFound('That opportunity');
    const [view] = await this.rows([row]);
    return view!;
  }

  /* ------------------------------ Actions ------------------------------ */

  /** POST /admin/opportunities/{id}: close, reopen, remove (moderation state 'removed') or restore. */
  async act(ctx: AuthContext, rawId: string, action: AdminOpportunityActionKind, ip?: string): Promise<AdminOpportunityRow> {
    const id = uuidOr404(rawId, 'That opportunity');
    const [row] = await this.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (!row) throw Errors.notFound('That opportunity');
    const today = todayIso();
    let set: Partial<typeof opportunities.$inferInsert>;
    switch (action) {
      case 'close':
        if (row.status === 'closed') throw Errors.conflict('This opportunity is already closed');
        set = { status: 'closed', closedAt: new Date() };
        break;
      case 'reopen':
        if (row.moderationState !== 'visible') throw Errors.conflict('Restore this opportunity before reopening it');
        if (row.status === 'open' && !(row.deadline && row.deadline < today)) throw Errors.conflict('This opportunity is already open');
        if (row.deadline && row.deadline < today) throw Errors.conflict('The deadline has passed. The poster needs to set a new one to reopen it.');
        set = { status: 'open', closedAt: null };
        break;
      case 'remove':
        if (row.moderationState === 'removed') throw Errors.conflict('This opportunity is already removed');
        set = { moderationState: 'removed' };
        break;
      case 'restore':
        if (row.moderationState === 'visible') throw Errors.conflict('This opportunity isn’t removed');
        set = { moderationState: 'visible' };
        break;
    }
    const [next] = await this.db.update(opportunities).set(set).where(eq(opportunities.id, row.id)).returning();
    await this.audit.record({
      actorId: ctx.user.id,
      action: `opportunity.${{ close: 'closed', reopen: 'reopened', remove: 'removed', restore: 'restored' }[action]}`,
      targetType: 'opportunity',
      targetId: row.id,
      before: { status: row.status, moderationState: row.moderationState },
      after: { status: next!.status, moderationState: next!.moderationState },
      ip,
    });
    const [view] = await this.rows([next!]);
    return view!;
  }

  /** POST /admin/opportunities/bulk → BulkResult. */
  bulk(ctx: AuthContext, input: AdminOpportunitiesBulkInput, ip?: string): Promise<BulkResult> {
    return runEach(input.ids, (id) => this.act(ctx, id, input.action, ip), this.log);
  }

  /* ------------------------------ Pages ------------------------------ */

  /** Active pages staff may post imported listings as: official ones, and organisation pages staff run. */
  private postAsCond(): SQL {
    return and(eq(pages.status, 'active'), or(eq(pages.official, true), eq(pages.staffManaged, true)))!;
  }

  /**
   * GET /admin/opportunities/pages: Charter Mission's active official pages first (the one named
   * "Charter Mission" first, then oldest first), then the active organisation pages staff run, A–Z.
   */
  async postAsPages(): Promise<AdminOpportunityPages> {
    const rows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(this.postAsCond())
      .orderBy(
        desc(pages.official),
        sql`case when ${pages.official} and lower(${pages.name}) = 'charter mission' then 0 else 1 end`,
        sql`case when ${pages.official} then ${pages.createdAt} end asc nulls last`,
        sql`lower(${pages.name})`,
        asc(pages.id),
      )
      .limit(1000);
    const refs = await this.pageRefs.refs(rows.map((r) => r.id));
    return { items: rows.flatMap((r) => (refs.get(r.id) ? [PageRefsService.toRef(refs.get(r.id)!)] : [])) };
  }

  /** The pages among these ids that imported listings may be posted as. */
  private async postAsMap(ids: (string | null | undefined)[]): Promise<Map<string, PostAsPage>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map();
    const rows = await this.db
      .select({ id: pages.id, official: pages.official })
      .from(pages)
      .where(and(inArray(pages.id, wanted), this.postAsCond()));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * POST /admin/opportunities/organisations: "Create organisation" in the import. A live page run by
   * staff (staff_managed, not official), owned by the staff member, with the admin page form's rules.
   * A second staff-run page with the same name is refused: pick the existing one instead.
   */
  async createOrganisation(ctx: AuthContext, input: AdminOrganisationInput, ip?: string): Promise<PageRef> {
    const [same] = await this.db
      .select({ name: pages.name })
      .from(pages)
      .where(and(this.postAsCond(), sql`lower(${pages.name}) = ${lower(input.name)}`))
      .limit(1);
    if (same) throw Errors.validation({ name: `There’s already a page called ${same.name}. Choose it under Post as.` }, `There’s already a page called ${same.name}`);
    const row = await this.pagesService.insert(input, { status: 'active', createdBy: ctx.user.id, ownerId: ctx.user.id, official: false, staffManaged: true });
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'page.created',
      targetType: 'page',
      targetId: row.id,
      after: { name: row.name, official: false, verified: false, staffManaged: true, ownerId: ctx.user.id, from: 'opportunity_import' },
      ip,
    });
    const refs = await this.pageRefs.refs([row.id]);
    return PageRefsService.toRef(refs.get(row.id)!);
  }

  /* ------------------------------ Import ------------------------------ */

  private async reference(): Promise<ImportReference> {
    const today = todayIso();
    const [countryRows, sectorRows] = await Promise.all([
      this.db.select({ code: countries.code, name: countries.name }).from(countries),
      this.db.select({ id: sectors.id, slug: sectors.slug, name: sectors.name }).from(sectors).where(eq(sectors.status, 'active')),
    ]);
    return { countries: countryRows, sectors: sectorRows, today, latestDeadline: addDays(today, 366) };
  }

  /** Open listings with the same organisation and title, or the same apply link, as any of these. */
  private async existingMatches(inputs: { title: string; organisation: string; applyUrl: string | null }[]) {
    if (!inputs.length) return [];
    const titles = [...new Set(inputs.map((i) => lower(i.title)))];
    const links = [...new Set(inputs.map((i) => i.applyUrl).filter((u): u is string => !!u))];
    return this.db
      .select({ id: opportunities.id, slug: opportunities.slug, title: opportunities.title, organisation: opportunities.organisation, applyUrl: opportunities.applyUrl })
      .from(opportunities)
      .where(
        and(
          isNull(opportunities.deletedAt),
          eq(opportunities.status, 'open'),
          ne(opportunities.moderationState, 'removed'),
          or(inArray(sql`lower(${opportunities.title})`, titles), links.length ? inArray(opportunities.applyUrl, links) : undefined),
        ),
      )
      .limit(500);
  }

  /**
   * Normalises and validates every row (and the page it's posted as, when it has its own); flags
   * possible duplicates of open listings and of earlier rows.
   */
  private async review(input: OpportunityImportInput, postAs: Map<string, PostAsPage>): Promise<OpportunityImportRowResult[]> {
    const ref = await this.reference();
    const results: OpportunityImportRowResult[] = input.rows.map((r) => {
      const result: OpportunityImportRowResult = { row: r.row, ...normaliseRow(r.values, ref), duplicates: [], duplicateOfRow: null };
      if (r.pageId && !postAs.has(r.pageId)) {
        result.errors.page = 'Post this as Charter Mission’s official page or an organisation page the team runs';
        result.input = null;
      }
      return result;
    });
    const valid = results.filter((r) => r.input);
    const existing = await this.existingMatches(valid.map((r) => r.input!));
    const seen = new Map<string, number>();
    for (const r of valid) {
      const i = r.input!;
      const dupes: OpportunityImportDuplicate[] = existing
        .filter((e) => (lower(e.title) === lower(i.title) && lower(e.organisation) === lower(i.organisation)) || (!!i.applyUrl && e.applyUrl === i.applyUrl))
        .map(({ id, slug, title, organisation }) => ({ id, slug, title, organisation }));
      if (dupes.length) {
        r.duplicates = dupes;
        r.warnings.push(dupes.length === 1 ? 'An open listing looks like the same opportunity.' : `${dupes.length} open listings look like the same opportunity.`);
      }
      const keys = [`t:${lower(i.organisation)}|${lower(i.title)}`, ...(i.applyUrl ? [`u:${i.applyUrl}`] : [])];
      const earlier = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
      if (earlier !== undefined) {
        r.duplicateOfRow = earlier;
        r.warnings.push(`Row ${earlier} looks like the same opportunity.`);
      }
      for (const k of keys) if (!seen.has(k)) seen.set(k, r.row);
    }
    return results;
  }

  /**
   * POST /admin/opportunities/import. dryRun: check the rows. Otherwise create each valid row as a
   * listing posted as the chosen official page (duplicates are only warnings: staff reviewed them),
   * and report the rows that couldn't be created.
   */
  async import(ctx: AuthContext, input: OpportunityImportInput, ip?: string): Promise<OpportunityImportResult> {
    const postAs = await this.postAsMap([...input.rows.map((r) => r.pageId), input.pageId]);
    const rows = await this.review(input, postAs);
    if (input.dryRun) return { dryRun: true, rows, created: [] };

    if (!input.pageId) throw Errors.validation({ pageId: 'Choose the page to post as' });
    const page = postAs.get(input.pageId);
    if (!page?.official) {
      throw Errors.validation({ pageId: 'Choose one of Charter Mission’s active official pages' }, 'Imported opportunities are posted as one of Charter Mission’s official pages');
    }

    const created: OpportunityImportResult['created'] = [];
    for (const [i, r] of rows.entries()) {
      if (!r.input) continue;
      // The row's own page, or the batch's. A listing posted as an organisation page is shared to the
      // feed from the batch's official page, which every member sees.
      const target = postAs.get(input.rows[i]!.pageId ?? '') ?? page;
      try {
        const parsed = OpportunityInput.parse({ ...r.input, shareToFeed: input.shareToFeed ?? true });
        const row = await this.opportunities.createListing(ctx.user, parsed, { source: 'import', pageId: target.id, feedPageId: target.official ? null : page.id }, ip);
        created.push({ row: r.row, id: row.id, slug: row.slug, title: row.title, pageId: target.id });
      } catch (e) {
        r.input = null;
        if (e instanceof AppError && e.fields) {
          for (const [field, message] of Object.entries(e.fields)) r.errors[columnOfField(field)] = message;
        } else {
          this.log.warn(`import row ${r.row} failed: ${e instanceof Error ? e.message : String(e)}`);
          r.errors.row = e instanceof AppError ? e.message : 'This row couldn’t be posted. Try again.';
        }
      }
    }
    return { dryRun: false, rows, created };
  }

  /* ---------------------- Applications (imported listings) ---------------------- */

  /**
   * An imported listing (not deleted): its applications are reviewed here. Members' own listings are
   * reviewed by their poster on the member site, so they're "not found" here.
   */
  private async importedListing(rawId: string): Promise<OpportunityRow> {
    const id = uuidOr404(rawId, 'That opportunity');
    const [row] = await this.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (!row) throw Errors.notFound('That opportunity');
    if (row.source !== 'import') throw new AppError(404, 'NOT_FOUND', 'Applications to members’ listings are reviewed by their poster on the member site');
    return row;
  }

  /** One page of applications, newest first (keyset on created_at, id), with the applicant's email and place. */
  private async applicationPage(opportunityId: string, q: { status?: ApplicationStatus; cursor?: string; limit: number }) {
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    checkCursor(cursor, { t: 'date', id: 'uuid' });
    const rows = await this.db
      .select({ a: opportunityApplications, t: tsKey(opportunityApplications.createdAt), email: users.email, city: memberProfiles.city, country: countries.name })
      .from(opportunityApplications)
      .innerJoin(users, eq(users.id, opportunityApplications.applicantId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, opportunityApplications.applicantId))
      .leftJoin(countries, eq(countries.code, memberProfiles.countryCode))
      .where(
        and(
          eq(opportunityApplications.opportunityId, opportunityId),
          q.status ? eq(opportunityApplications.status, q.status) : ne(opportunityApplications.status, 'withdrawn'),
          cursor ? sql`(${opportunityApplications.createdAt}, ${opportunityApplications.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(opportunityApplications.createdAt), desc(opportunityApplications.id))
      .limit(q.limit + 1);
    return paginate(rows, q.limit, (last) => ({ t: last.t, id: last.a.id }));
  }

  private async applicationViews(rows: { a: ApplicationRow; email: string | null; city: string | null; country: string | null }[]): Promise<AdminApplicationView[]> {
    if (!rows.length) return [];
    const [refs, cvs] = await Promise.all([this.members.refs(rows.map((r) => r.a.applicantId)), this.opportunities.cvRefs(rows.map((r) => r.a.cvFileId))]);
    return rows.flatMap((r) => {
      const applicant = refs.get(r.a.applicantId);
      if (!applicant) return [];
      return [
        {
          id: r.a.id,
          applicant,
          email: r.email,
          location: [r.city, r.country].filter(Boolean).join(', ') || null,
          note: r.a.note,
          phone: r.a.phone,
          link: r.a.link,
          cv: (r.a.cvFileId && cvs.get(r.a.cvFileId)) || null,
          status: r.a.status as ApplicationStatus,
          createdAt: r.a.createdAt.toISOString(),
          updatedAt: r.a.updatedAt.toISOString(),
        },
      ];
    });
  }

  private async applicationCounts(opportunityId: string): Promise<Record<ApplicationStatus, number>> {
    const rows = await this.db
      .select({ status: opportunityApplications.status, n: count() })
      .from(opportunityApplications)
      .where(eq(opportunityApplications.opportunityId, opportunityId))
      .groupBy(opportunityApplications.status);
    const counts = Object.fromEntries(STATUS_ORDER.map((st) => [st, 0])) as Record<ApplicationStatus, number>;
    for (const r of rows) counts[r.status as ApplicationStatus] = r.n;
    return counts;
  }

  /** GET /admin/opportunities/{id}/applications */
  async applications(rawId: string, q: AdminApplicationsQuery): Promise<AdminApplicationsPage> {
    const row = await this.importedListing(rawId);
    const [page, counts] = await Promise.all([this.applicationPage(row.id, q), this.applicationCounts(row.id)]);
    return { items: await this.applicationViews(page.items), nextCursor: page.nextCursor, counts };
  }

  /**
   * PATCH /admin/opportunities/{id}/applications/{applicationId}: shortlist, accept or decline (or
   * back to submitted). The applicant is told through the same event as a poster's decision; audited.
   */
  async decide(ctx: AuthContext, rawId: string, rawApplicationId: string, input: DecideApplicationInput, ip?: string): Promise<AdminApplicationView> {
    const row = await this.importedListing(rawId);
    const applicationId = uuidOr404(rawApplicationId, 'That application');
    const [app] = await this.db
      .select()
      .from(opportunityApplications)
      .where(and(eq(opportunityApplications.id, applicationId), eq(opportunityApplications.opportunityId, row.id)))
      .limit(1);
    if (!app || app.status === 'withdrawn') throw Errors.notFound('That application');
    if (app.status !== input.status) {
      await this.db
        .update(opportunityApplications)
        .set({ status: input.status, decidedAt: input.status === 'submitted' ? null : new Date() })
        .where(eq(opportunityApplications.id, app.id));
      if (input.status !== 'submitted') {
        await this.events.emit({ type: 'opportunity.application_decided', applicationId: app.id, status: input.status, message: input.message ?? null });
      }
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'opportunity.application_decided',
        targetType: 'opportunity',
        targetId: row.id,
        before: { applicationId: app.id, status: app.status },
        after: { applicationId: app.id, status: input.status, message: !!input.message },
        ip,
      });
    }
    const [view] = await this.db
      .select({ a: opportunityApplications, email: users.email, city: memberProfiles.city, country: countries.name })
      .from(opportunityApplications)
      .innerJoin(users, eq(users.id, opportunityApplications.applicantId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, opportunityApplications.applicantId))
      .leftJoin(countries, eq(countries.code, memberProfiles.countryCode))
      .where(eq(opportunityApplications.id, app.id))
      .limit(1);
    const [out] = await this.applicationViews(view ? [view] : []);
    if (!out) throw Errors.notFound('That application');
    return out;
  }

  /**
   * GET /admin/opportunities/{id}/applications/export: the applications (the status filter, or every
   * one but withdrawn) as a UTF-8 CSV with a BOM, so Excel shows accents. Audited before it streams.
   */
  async exportApplications(ctx: AuthContext, rawId: string, q: AdminApplicationsExportQuery, res: Response, ip?: string): Promise<void> {
    const row = await this.importedListing(rawId);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'opportunity.applications_exported',
      targetType: 'opportunity',
      targetId: row.id,
      after: { status: q.status ?? null },
      ip,
    });
    const web = env().WEB_URL.replace(/\/+$/, '');
    const api = env().API_PUBLIC_URL.replace(/\/+$/, '');
    const stem = `applications-${row.slug.slice(0, 60)}${q.status ? `-${q.status}` : ''}-${new Date().toISOString().slice(0, 10)}`;
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${stem}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    await write(res, `\uFEFF${ADMIN_APPLICATION_CSV_COLUMNS.join(',')}\r\n`);
    let cursor: string | undefined;
    for (;;) {
      const page = await this.applicationPage(row.id, { status: q.status, cursor, limit: 200 });
      const views = await this.applicationViews(page.items);
      const countryOf = new Map(page.items.map((r) => [r.a.id, r.country]));
      const lines = views.map((v) =>
        [
          v.createdAt,
          v.status,
          v.applicant.name,
          v.email,
          v.phone,
          v.applicant.headline,
          countryOf.get(v.id) ?? '',
          `${web}/${v.applicant.handle}`,
          v.link,
          v.cv ? `${api}/media/${v.cv.id}` : '',
          v.note,
        ]
          .map(csvCell)
          .join(','),
      );
      if (lines.length) await write(res, `${lines.join('\r\n')}\r\n`);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    res.end();
  }

  /** GET /admin/opportunities/applications/new-count: undecided applications to live imported listings. */
  async newApplicationsCount(): Promise<AdminNewApplicationsCount> {
    const [row] = await this.db
      .select({ n: count() })
      .from(opportunityApplications)
      .innerJoin(opportunities, eq(opportunities.id, opportunityApplications.opportunityId))
      .where(
        and(
          eq(opportunityApplications.status, 'submitted'),
          eq(opportunities.source, 'import'),
          isNull(opportunities.applyUrl),
          isNull(opportunities.deletedAt),
          eq(opportunities.moderationState, 'visible'),
        ),
      );
    return { count: row?.n ?? 0 };
  }
}
