import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  OpportunityInput,
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
import { countries, opportunities, pages, sectors } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
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

/** Where a listing stands for staff (contracts AdminOpportunityState). */
function stateOf(row: OpportunityRow, today: string): AdminOpportunityState {
  if (row.moderationState === 'removed') return 'removed';
  if (row.moderationState === 'hidden') return 'hidden';
  if (row.status === 'closed') return 'closed';
  return row.deadline && row.deadline < today ? 'expired' : 'open';
}

/**
 * Admin console → Opportunities (contracts/opportunity-import.ts): every listing with close, reopen,
 * remove and restore, the official pages staff post as, and the import of listings Claude turned
 * from pasted WhatsApp or forum messages into a CSV. Imported listings are created through
 * OpportunitiesService.createListing (source 'import', posted as the page), which shares them to the
 * feed when asked. Staff imports have no daily limit.
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
    const [posters, pageMap, countryRows] = await Promise.all([
      this.members.refs(list.map((r) => r.posterId)),
      this.pageRefs.refs(list.map((r) => r.pageId).filter((p): p is string => !!p)),
      codes.length ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, codes)) : [],
    ]);
    const countryMap = new Map(countryRows.map((c) => [c.code, c]));
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
        state: stateOf(r, today),
        createdAt: r.createdAt.toISOString(),
      };
    });
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

  /** GET /admin/opportunities/pages: Charter Mission's active official pages, oldest first. */
  async officialPages(): Promise<AdminOpportunityPages> {
    const rows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.official, true), eq(pages.status, 'active')))
      .orderBy(asc(pages.createdAt), asc(pages.id));
    const refs = await this.pageRefs.refs(rows.map((r) => r.id));
    return { items: rows.flatMap((r) => (refs.get(r.id) ? [PageRefsService.toRef(refs.get(r.id)!)] : [])) };
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

  /** Normalises and validates every row; flags possible duplicates of open listings and of earlier rows. */
  private async review(input: OpportunityImportInput): Promise<OpportunityImportRowResult[]> {
    const ref = await this.reference();
    const results: OpportunityImportRowResult[] = input.rows.map((r) => ({ row: r.row, ...normaliseRow(r.values, ref), duplicates: [], duplicateOfRow: null }));
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
    const rows = await this.review(input);
    if (input.dryRun) return { dryRun: true, rows, created: [] };

    if (!input.pageId) throw Errors.validation({ pageId: 'Choose the page to post as' });
    const [page] = await this.db.select({ id: pages.id, official: pages.official, status: pages.status }).from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page || !page.official || page.status !== 'active') {
      throw Errors.validation({ pageId: 'Choose one of Charter Mission’s active official pages' }, 'Imported opportunities are posted as one of Charter Mission’s official pages');
    }

    const created: OpportunityImportResult['created'] = [];
    for (const r of rows) {
      if (!r.input) continue;
      try {
        const parsed = OpportunityInput.parse({ ...r.input, shareToFeed: input.shareToFeed ?? true });
        const row = await this.opportunities.createListing(ctx.user, parsed, { source: 'import', pageId: page.id }, ip);
        created.push({ row: r.row, id: row.id, slug: row.slug, title: row.title });
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
}
