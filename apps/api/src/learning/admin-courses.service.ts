import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminCourseView,
  AdminCoursesQuery,
  CursorQuery,
  Page,
  SyncRunView,
  UpdateCourseCurationInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { analyticsEvents, courses, learningSyncRuns, memberProfiles } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { isUuid } from '../media/uuid-param.js';
import { topicsFor, toSummary, type CourseRow } from './course-views.js';
import { likeContains } from './courses.service.js';
import type { SyncRunRow } from './learning-sync.js';

const tsKey = (col: typeof learningSyncRuns.startedAt) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Admin Learning section: the whole synced catalogue with curation, link status and sync history. */
@Injectable()
export class AdminCoursesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** GET /admin/courses — A–Z by title, including hidden and removed courses. */
  async list(q: AdminCoursesQuery): Promise<Page<AdminCourseView>> {
    const filters: (SQL | undefined)[] = [];
    if (q.q) {
      const pat = likeContains(q.q);
      filters.push(or(ilike(courses.title, pat), ilike(courses.provider, pat), ilike(courses.externalId, pat), ilike(courses.slug, pat)));
    }
    switch (q.status) {
      case 'visible':
        filters.push(eq(courses.hidden, false), isNull(courses.removedAt));
        break;
      case 'hidden':
        filters.push(eq(courses.hidden, true));
        break;
      case 'removed':
        filters.push(isNotNull(courses.removedAt));
        break;
      case 'broken':
        filters.push(eq(courses.linkStatus, 'broken'));
        break;
      case 'featured':
        filters.push(eq(courses.featured, true));
        break;
    }
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c) {
      if (typeof c.t !== 'string' || !isUuid(c.id)) throw Errors.badRequest('Invalid cursor');
      filters.push(sql`(lower(${courses.title}), ${courses.id}) > (${c.t}, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: courses, t: sql<string>`lower(${courses.title})` })
      .from(courses)
      .where(and(...filters))
      .orderBy(sql`lower(${courses.title}) asc`, asc(courses.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.row.id }));
    return { items: await this.views(page.items.map((r) => r.row)), nextCursor: page.nextCursor };
  }

  /** PATCH /admin/courses/:id — hide/unhide and feature/unfeature only; audited. */
  async curate(ctx: AuthContext, id: string, input: UpdateCourseCurationInput, ip?: string): Promise<AdminCourseView> {
    if (!isUuid(id)) throw Errors.notFound('Course');
    const updated = await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(courses).where(eq(courses.id, id.toLowerCase())).for('update').limit(1);
      if (!before) throw Errors.notFound('Course');
      const patch: Partial<typeof courses.$inferInsert> = {};
      if (input.hidden !== undefined && input.hidden !== before.hidden) patch.hidden = input.hidden;
      if (input.featured !== undefined && input.featured !== before.featured) {
        patch.featured = input.featured;
        patch.featuredAt = input.featured ? new Date() : null;
      }
      if (Object.keys(patch).length === 0) return before;
      const [after] = await tx.update(courses).set(patch).where(eq(courses.id, before.id)).returning();
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'course.curated',
          targetType: 'course',
          targetId: before.id,
          before: { hidden: before.hidden, featured: before.featured, title: before.title },
          after: { hidden: after!.hidden, featured: after!.featured },
          ip,
        },
        tx,
      );
      return after!;
    });
    const [view] = await this.views([updated]);
    return view!;
  }

  /** GET /admin/learning/sync-runs — newest first. */
  async runs(q: CursorQuery): Promise<Page<SyncRunView>> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c && (typeof c.t !== 'string' || !isUuid(c.id))) throw Errors.badRequest('Invalid cursor');
    const rows = await this.db
      .select({ row: learningSyncRuns, t: tsKey(learningSyncRuns.startedAt) })
      .from(learningSyncRuns)
      .where(c ? sql`(${learningSyncRuns.startedAt}, ${learningSyncRuns.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined)
      .orderBy(desc(learningSyncRuns.startedAt), desc(learningSyncRuns.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.row.id }));
    return { items: await this.runViews(page.items.map((r) => r.row)), nextCursor: page.nextCursor };
  }

  async runViews(rows: SyncRunRow[]): Promise<SyncRunView[]> {
    const adminIds = [...new Set(rows.map((r) => r.triggeredBy).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (adminIds.length) {
      const profiles = await this.db
        .select({ id: memberProfiles.userId, name: memberProfiles.displayName })
        .from(memberProfiles)
        .where(inArray(memberProfiles.userId, adminIds));
      for (const p of profiles) names.set(p.id, p.name);
    }
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as SyncRunView['kind'],
      trigger: r.trigger as SyncRunView['trigger'],
      triggeredBy: r.triggeredBy ? (names.get(r.triggeredBy) ?? null) : null,
      status: r.status as SyncRunView['status'],
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      created: r.createdCount,
      updated: r.updatedCount,
      removed: r.removedCount,
      checked: r.checkedCount,
      broken: r.brokenCount,
      error: r.error,
    }));
  }

  private async views(rows: CourseRow[]): Promise<AdminCourseView[]> {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const [topics, clicks] = await Promise.all([
      topicsFor(this.db, ids),
      this.db
        .select({ id: analyticsEvents.subjectId, n: sql<number>`count(*)::int` })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.name, 'charter_center_click'),
            inArray(analyticsEvents.subjectId, ids),
            gte(analyticsEvents.createdAt, new Date(Date.now() - 30 * 24 * 3600_000)),
          ),
        )
        .groupBy(analyticsEvents.subjectId),
    ]);
    const clickMap = new Map(clicks.map((c) => [c.id, c.n]));
    return rows.map((r) => ({
      ...toSummary(r, topics.get(r.id) ?? [], false),
      hidden: r.hidden,
      removedAt: r.removedAt?.toISOString() ?? null,
      lastCheckedAt: r.linkCheckedAt?.toISOString() ?? null,
      httpStatus: r.linkHttpStatus,
      sourceUrl: r.startUrl,
      externalId: r.externalId,
      syncedAt: r.syncedAt.toISOString(),
      sourceUpdatedAt: r.sourceUpdatedAt?.toISOString() ?? null,
      clicks30d: clickMap.get(r.id) ?? 0,
    }));
  }
}
