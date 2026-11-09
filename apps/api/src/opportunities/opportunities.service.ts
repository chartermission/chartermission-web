import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  OpportunityInput,
  OpportunityType,
  type ApplicationStatus,
  type ApplicationsPage,
  type ApplicationsQuery,
  type ApplyInput,
  type DecideApplicationInput,
  type MyOpportunitiesQuery,
  type OpportunitiesQuery,
  type OpportunityDetail,
  type OpportunityInputParsed,
  type OpportunitySummary,
  type Page,
} from '@chartermission/contracts';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookmarks, countries, memberProfiles, opportunities, opportunityApplications, sectors, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { EventsService } from '../infra/events.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor, paginate } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { escapeLike, slugify } from '../events/event-util.js';
import { assertNotRestricted } from '../posts/posts.service.js';

export type OpportunityRow = typeof opportunities.$inferSelect;
type ApplicationRow = typeof opportunityApplications.$inferSelect;

/** Posters who can't be shown (their listings drop out of lists). */
const HIDDEN_POSTER = ['deleted', 'deletion_pending', 'deactivated', 'suspended'];
const LISTINGS_PER_DAY = 10;
const APPLICATIONS_PER_DAY = 30;
const STATUS_ORDER: ApplicationStatus[] = ['submitted', 'shortlisted', 'accepted', 'declined', 'withdrawn'];

/** Today's date in UTC as YYYY-MM-DD (deadlines are whole days). */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

/**
 * Opportunities (contracts/opportunities.ts): verified members post listings that go live
 * straight away; members apply in the app with their profile and a note; the poster reviews
 * applicants. Moderators hide or remove listings from reports.
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly events: EventsService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------ Browse ------------------------------ */

  /** GET /opportunities — open listings with filters; offset cursor (sorts aren't keyset-friendly). */
  async list(user: AuthUser, q: OpportunitiesQuery): Promise<Page<OpportunitySummary>> {
    const today = todayIso();
    const blocked = await this.relations.blockedSet(user.id);
    const where: (SQL | undefined)[] = [
      isNull(opportunities.deletedAt),
      eq(opportunities.status, 'open'),
      eq(opportunities.moderationState, 'visible'),
      or(isNull(opportunities.deadline), sql`${opportunities.deadline} >= ${today}`),
      notInArray(users.status, HIDDEN_POSTER),
      blocked.size ? notInArray(opportunities.posterId, [...blocked]) : undefined,
    ];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(or(ilike(opportunities.title, like), ilike(opportunities.organisation, like), ilike(opportunities.summary, like)));
    }
    if (q.type) {
      const types = q.type.split(',').filter((t) => OpportunityType.safeParse(t).success);
      if (types.length) where.push(inArray(opportunities.type, types));
    }
    if (q.country) where.push(eq(opportunities.countryCode, q.country));
    if (q.remote) where.push(inArray(opportunities.remoteMode, ['remote', 'hybrid']));
    if (q.sector) {
      const [sector] = await this.db.select({ id: sectors.id }).from(sectors).where(isUuid(q.sector) ? eq(sectors.id, q.sector) : eq(sectors.slug, q.sector)).limit(1);
      if (!sector) return { items: [], nextCursor: null };
      where.push(eq(opportunities.sectorId, sector.id));
    }
    if (q.deadline === 'week') where.push(lte(opportunities.deadline, addDays(today, 7)));
    if (q.deadline === 'month') where.push(lte(opportunities.deadline, endOfMonth(today)));

    const offset = Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0) || 0;
    const order =
      q.sort === 'closing'
        ? [sql`${opportunities.deadline} asc nulls last`, desc(opportunities.createdAt), desc(opportunities.id)]
        : [desc(opportunities.createdAt), desc(opportunities.id)];
    const rows = await this.db
      .select({ o: opportunities })
      .from(opportunities)
      .innerJoin(users, eq(users.id, opportunities.posterId))
      .where(and(...where))
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const more = rows.length > q.limit;
    const items = await this.summaries(user, rows.slice(0, q.limit).map((r) => r.o));
    return { items, nextCursor: more ? encodeCursor({ o: offset + q.limit }) : null };
  }

  /** GET /me/opportunities?tab=posted|applied|saved */
  async mine(user: AuthUser, q: MyOpportunitiesQuery): Promise<Page<OpportunitySummary>> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = (col: SQL | PgColumn) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    let rows: { o: OpportunityRow; t: string }[];
    if (q.tab === 'posted') {
      rows = await this.db
        .select({ o: opportunities, t: ts(opportunities.createdAt) })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.posterId, user.id),
            isNull(opportunities.deletedAt),
            c ? sql`(${opportunities.createdAt}, ${opportunities.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(opportunities.createdAt), desc(opportunities.id))
        .limit(q.limit + 1);
    } else if (q.tab === 'applied') {
      rows = await this.db
        .select({ o: opportunities, t: ts(opportunityApplications.createdAt) })
        .from(opportunityApplications)
        .innerJoin(opportunities, eq(opportunities.id, opportunityApplications.opportunityId))
        .where(
          and(
            eq(opportunityApplications.applicantId, user.id),
            isNull(opportunities.deletedAt),
            ne(opportunities.moderationState, 'removed'),
            c ? sql`(${opportunityApplications.createdAt}, ${opportunities.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(opportunityApplications.createdAt), desc(opportunities.id))
        .limit(q.limit + 1);
    } else {
      rows = await this.db
        .select({ o: opportunities, t: ts(bookmarks.createdAt) })
        .from(bookmarks)
        .innerJoin(opportunities, sql`${opportunities.id}::text = ${bookmarks.targetId}::text`)
        .where(
          and(
            eq(bookmarks.userId, user.id),
            eq(bookmarks.targetType, 'opportunity'),
            isNull(opportunities.deletedAt),
            eq(opportunities.moderationState, 'visible'),
            c ? sql`(${bookmarks.createdAt}, ${opportunities.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(bookmarks.createdAt), desc(opportunities.id))
        .limit(q.limit + 1);
    }
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.o.id }));
    return { items: await this.summaries(user, page.items.map((r) => r.o)), nextCursor: page.nextCursor };
  }

  /** GET /opportunities/{idOrSlug} */
  async detail(user: AuthUser, idOrSlug: string): Promise<OpportunityDetail> {
    const row = await this.visibleRow(user, idOrSlug);
    return this.toDetail(user, row);
  }

  /* ------------------------------ Posting ------------------------------ */

  /** POST /opportunities — live straight away. */
  async create(user: AuthUser, raw: OpportunityInput, ip?: string): Promise<OpportunityDetail> {
    assertNotRestricted(user);
    const input = OpportunityInput.parse(raw);
    await this.checkInput(input);
    await this.limits.consume(`opportunities:${user.id}`, LISTINGS_PER_DAY, 24 * 3600);
    const [row] = await this.db
      .insert(opportunities)
      .values({ ...this.columns(input), slug: `${slugify(input.title).slice(0, 60).replace(/-$/, '')}-${randomBytes(3).toString('hex')}`, posterId: user.id })
      .returning();
    await this.audit.record({ actorId: user.id, action: 'opportunity.create', targetType: 'opportunity', targetId: row!.id, ip });
    return this.toDetail(user, row!);
  }

  /** PATCH /opportunities/{id} — the poster edits the whole listing. */
  async update(user: AuthUser, id: string, raw: OpportunityInput): Promise<OpportunityDetail> {
    const row = await this.ownRow(user, id);
    const input = OpportunityInput.parse(raw);
    await this.checkInput(input, row);
    const [next] = await this.db.update(opportunities).set(this.columns(input)).where(eq(opportunities.id, row.id)).returning();
    return this.toDetail(user, next!);
  }

  /** POST /opportunities/{id}/close and /reopen */
  async setOpen(user: AuthUser, id: string, open: boolean): Promise<OpportunityDetail> {
    const row = await this.ownRow(user, id);
    if (open && row.deadline && row.deadline < todayIso())
      throw Errors.validation({ deadline: 'The deadline has passed. Set a new one to reopen.' }, 'Set a new deadline to reopen this listing');
    const [next] = await this.db
      .update(opportunities)
      .set({ status: open ? 'open' : 'closed', closedAt: open ? null : new Date() })
      .where(eq(opportunities.id, row.id))
      .returning();
    return this.toDetail(user, next!);
  }

  /** DELETE /opportunities/{id} — the poster takes the listing down for good. */
  async remove(user: AuthUser, id: string, ip?: string): Promise<void> {
    const row = await this.ownRow(user, id);
    await this.db.update(opportunities).set({ deletedAt: new Date(), status: 'closed', closedAt: row.closedAt ?? new Date() }).where(eq(opportunities.id, row.id));
    await this.audit.record({ actorId: user.id, action: 'opportunity.delete', targetType: 'opportunity', targetId: row.id, ip });
  }

  /* ---------------------------- Applications ---------------------------- */

  /** POST /opportunities/{id}/applications — apply with your profile and a note. */
  async apply(user: AuthUser, id: string, input: ApplyInput): Promise<OpportunityDetail> {
    const row = await this.visibleRow(user, id);
    const reason = this.cannotApply(user, row);
    if (reason) throw Errors.conflict(reason);
    await this.limits.consume(`applications:${user.id}`, APPLICATIONS_PER_DAY, 24 * 3600);
    const [existing] = await this.db
      .select()
      .from(opportunityApplications)
      .where(and(eq(opportunityApplications.opportunityId, row.id), eq(opportunityApplications.applicantId, user.id)))
      .limit(1);
    let applicationId: string;
    if (existing) {
      if (existing.status !== 'withdrawn') throw Errors.conflict('You’ve already applied to this opportunity');
      await this.db
        .update(opportunityApplications)
        .set({ note: input.note, status: 'submitted', decidedAt: null, createdAt: new Date() })
        .where(eq(opportunityApplications.id, existing.id));
      applicationId = existing.id;
    } else {
      const [created] = await this.db
        .insert(opportunityApplications)
        .values({ opportunityId: row.id, applicantId: user.id, note: input.note })
        .onConflictDoNothing()
        .returning({ id: opportunityApplications.id });
      if (!created) throw Errors.conflict('You’ve already applied to this opportunity');
      applicationId = created.id;
    }
    await this.recount(row.id);
    await this.events.emit({ type: 'opportunity.applied', applicationId });
    return this.detail(user, row.id);
  }

  /** DELETE /opportunities/{id}/applications/mine */
  async withdraw(user: AuthUser, id: string): Promise<OpportunityDetail> {
    const row = await this.visibleRow(user, id);
    const [app] = await this.db
      .select()
      .from(opportunityApplications)
      .where(and(eq(opportunityApplications.opportunityId, row.id), eq(opportunityApplications.applicantId, user.id)))
      .limit(1);
    if (!app || app.status === 'withdrawn') throw Errors.notFound('Your application');
    if (app.status === 'accepted' || app.status === 'declined')
      throw Errors.conflict('The poster has already made a decision on this application');
    await this.db.update(opportunityApplications).set({ status: 'withdrawn' }).where(eq(opportunityApplications.id, app.id));
    await this.recount(row.id);
    return this.detail(user, row.id);
  }

  /** GET /opportunities/{id}/applications — the poster's applicant list (withdrawn ones are left out). */
  async applications(user: AuthUser, id: string, q: ApplicationsQuery): Promise<ApplicationsPage> {
    const row = await this.ownRow(user, id);
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = sql<string>`to_char(${opportunityApplications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const [rows, counted] = await Promise.all([
      this.db
        .select({ a: opportunityApplications, t: ts, countryName: countries.name })
        .from(opportunityApplications)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, opportunityApplications.applicantId))
        .leftJoin(countries, eq(countries.code, memberProfiles.countryCode))
        .where(
          and(
            eq(opportunityApplications.opportunityId, row.id),
            q.status ? eq(opportunityApplications.status, q.status) : ne(opportunityApplications.status, 'withdrawn'),
            c ? sql`(${opportunityApplications.createdAt}, ${opportunityApplications.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(opportunityApplications.createdAt), desc(opportunityApplications.id))
        .limit(q.limit + 1),
      this.db
        .select({ status: opportunityApplications.status, n: count() })
        .from(opportunityApplications)
        .where(eq(opportunityApplications.opportunityId, row.id))
        .groupBy(opportunityApplications.status),
    ]);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.a.id }));
    const refs = await this.members.refs(page.items.map((r) => r.a.applicantId));
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
    for (const r of counted) counts[r.status as ApplicationStatus] = r.n;
    return {
      items: page.items.flatMap((r) => {
        const applicant = refs.get(r.a.applicantId);
        if (!applicant) return [];
        return [
          {
            id: r.a.id,
            applicant,
            location: r.countryName ?? null,
            note: r.a.note,
            status: r.a.status as ApplicationStatus,
            createdAt: r.a.createdAt.toISOString(),
            updatedAt: r.a.updatedAt.toISOString(),
          },
        ];
      }),
      nextCursor: page.nextCursor,
      counts,
    };
  }

  /** PATCH /opportunities/{id}/applications/{applicationId} — shortlist, accept or decline. */
  async decide(user: AuthUser, id: string, applicationId: string, input: DecideApplicationInput) {
    const row = await this.ownRow(user, id);
    const [app] = await this.db
      .select()
      .from(opportunityApplications)
      .where(and(eq(opportunityApplications.id, applicationId), eq(opportunityApplications.opportunityId, row.id)))
      .limit(1);
    if (!app || app.status === 'withdrawn') throw Errors.notFound('That application');
    if (app.status === input.status) return this.applicationView(app);
    const [next] = await this.db
      .update(opportunityApplications)
      .set({ status: input.status, decidedAt: input.status === 'submitted' ? null : new Date() })
      .where(eq(opportunityApplications.id, app.id))
      .returning();
    if (input.status !== 'submitted') {
      await this.events.emit({ type: 'opportunity.application_decided', applicationId: app.id, status: input.status, message: input.message ?? null });
    }
    return this.applicationView(next!);
  }

  /* ------------------------------ Helpers ------------------------------ */

  /** Loads a listing the viewer may see: live or closed listings; hidden/removed only for the poster and moderators. */
  async visibleRow(user: AuthUser, idOrSlug: string): Promise<OpportunityRow> {
    const key = idOrSlug.toLowerCase();
    const [found] = await this.db
      .select({ o: opportunities, posterStatus: users.status })
      .from(opportunities)
      .innerJoin(users, eq(users.id, opportunities.posterId))
      .where(isUuid(key) ? eq(opportunities.id, key) : eq(opportunities.slug, key))
      .limit(1);
    const row = found?.o;
    if (!row || row.deletedAt) throw Errors.notFound('That opportunity');
    const own = row.posterId === user.id;
    const mod = user.permissions.has('moderation.view');
    if (!own && !mod) {
      if (row.moderationState !== 'visible' || HIDDEN_POSTER.includes(found.posterStatus)) throw Errors.notFound('That opportunity');
      if (await this.relations.isBlockedEitherWay(user.id, row.posterId)) throw Errors.notFound('That opportunity');
    }
    return row;
  }

  private async ownRow(user: AuthUser, idOrSlug: string): Promise<OpportunityRow> {
    const row = await this.visibleRow(user, idOrSlug);
    if (row.posterId !== user.id) throw Errors.forbidden('Only the member who posted this opportunity can do that');
    return row;
  }

  private cannotApply(user: AuthUser, row: OpportunityRow): string | null {
    if (row.posterId === user.id) return 'This is your listing';
    if (row.moderationState !== 'visible') return 'This listing is not available';
    if (row.status !== 'open') return 'Applications for this opportunity are closed';
    if (row.deadline && row.deadline < todayIso()) return 'The deadline for this opportunity has passed';
    if (!user.emailVerified) return 'Verify your email address to apply';
    return null;
  }

  private async checkInput(input: OpportunityInputParsed, existing?: OpportunityRow) {
    const fields: Record<string, string> = {};
    if (input.deadline && input.deadline < todayIso() && input.deadline !== existing?.deadline) fields.deadline = 'Choose today or a later date';
    if (input.deadline && input.deadline > addDays(todayIso(), 366)) fields.deadline = 'Choose a date within the next year';
    if (input.countryCode) {
      const [c] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, input.countryCode)).limit(1);
      if (!c) fields.countryCode = 'Choose a country from the list';
    }
    if (input.sectorId) {
      const [s] = await this.db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, input.sectorId)).limit(1);
      if (!s) fields.sectorId = 'Choose a sector from the list';
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);
  }

  private columns(input: OpportunityInputParsed) {
    return {
      type: input.type,
      title: input.title,
      organisation: input.organisation,
      summary: input.summary,
      description: input.description,
      remoteMode: input.remoteMode,
      countryCode: input.countryCode,
      city: input.city || null,
      sectorId: input.sectorId,
      deadline: input.deadline,
      compensation: input.compensation || null,
      moreInfoUrl: input.moreInfoUrl || null,
    };
  }

  private async recount(opportunityId: string) {
    await this.db
      .update(opportunities)
      .set({
        applicationCount: sql`(select count(*)::int from ${opportunityApplications} where ${opportunityApplications.opportunityId} = ${opportunityId} and ${opportunityApplications.status} <> 'withdrawn')`,
      })
      .where(eq(opportunities.id, opportunityId));
  }

  private applicationView(a: ApplicationRow) {
    return { id: a.id, status: a.status as ApplicationStatus, note: a.note, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() };
  }

  async summaries(user: AuthUser, rows: OpportunityRow[]): Promise<OpportunitySummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const countryCodes = [...new Set(rows.map((r) => r.countryCode).filter((c): c is string => !!c))];
    const sectorIds = [...new Set(rows.map((r) => r.sectorId).filter((s): s is string => !!s))];
    const [posters, countryRows, sectorRows, saved, applied] = await Promise.all([
      this.members.refs(rows.map((r) => r.posterId)),
      countryCodes.length ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, countryCodes)) : [],
      sectorIds.length ? this.db.select({ id: sectors.id, slug: sectors.slug, name: sectors.name }).from(sectors).where(inArray(sectors.id, sectorIds)) : [],
      this.db
        .select({ id: bookmarks.targetId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.targetType, 'opportunity'), inArray(bookmarks.targetId, ids))),
      this.db
        .select({ id: opportunityApplications.opportunityId, status: opportunityApplications.status })
        .from(opportunityApplications)
        .where(and(eq(opportunityApplications.applicantId, user.id), inArray(opportunityApplications.opportunityId, ids))),
    ]);
    const countryMap = new Map(countryRows.map((c) => [c.code, c]));
    const sectorMap = new Map(sectorRows.map((s) => [s.id, s]));
    const savedSet = new Set(saved.map((s) => s.id));
    const appliedMap = new Map(applied.map((a) => [a.id, a.status as ApplicationStatus]));
    const today = todayIso();
    return rows.flatMap((r) => {
      const poster = posters.get(r.posterId);
      if (!poster) return [];
      const expired = r.status === 'open' && !!r.deadline && r.deadline < today;
      return [
        {
          id: r.id,
          slug: r.slug,
          type: r.type as OpportunitySummary['type'],
          title: r.title,
          organisation: r.organisation,
          summary: r.summary,
          remoteMode: r.remoteMode as OpportunitySummary['remoteMode'],
          country: r.countryCode ? (countryMap.get(r.countryCode) ?? { code: r.countryCode, name: r.countryCode }) : null,
          city: r.city,
          sector: r.sectorId ? (sectorMap.get(r.sectorId) ?? null) : null,
          deadline: r.deadline,
          compensation: r.compensation,
          status: expired ? 'closed' : (r.status as OpportunitySummary['status']),
          moderationState: r.moderationState as OpportunitySummary['moderationState'],
          applicationCount: r.applicationCount,
          poster,
          createdAt: r.createdAt.toISOString(),
          viewer: { saved: savedSet.has(r.id), isOwner: r.posterId === user.id, applicationStatus: appliedMap.get(r.id) ?? null },
        },
      ];
    });
  }

  private async toDetail(user: AuthUser, row: OpportunityRow): Promise<OpportunityDetail> {
    const [summary] = await this.summaries(user, [row]);
    if (!summary) throw Errors.notFound('That opportunity');
    const [app] = await this.db
      .select()
      .from(opportunityApplications)
      .where(and(eq(opportunityApplications.opportunityId, row.id), eq(opportunityApplications.applicantId, user.id)))
      .limit(1);
    const own = row.posterId === user.id;
    let reason = this.cannotApply(user, row);
    if (!reason && app && app.status !== 'withdrawn') reason = 'You’ve already applied';
    return {
      ...summary,
      description: row.description,
      moreInfoUrl: row.moreInfoUrl,
      sectorId: row.sectorId,
      countryCode: row.countryCode,
      viewer: {
        ...summary.viewer,
        canApply: !reason,
        cannotApplyReason: own ? null : reason,
        canManage: own,
        canReport: !own && user.permissions.has('report.create'),
        application: app ? this.applicationView(app) : null,
      },
    };
  }
}
