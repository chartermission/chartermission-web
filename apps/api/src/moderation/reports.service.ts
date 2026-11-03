import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type {
  CreateReportInput,
  CreateReportResponse,
  CursorQuery,
  MyReport,
  Page,
  ReportPriority,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { contentReports } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { TargetsService } from './targets.service.js';
import { myReportStatus, reportNextSteps } from './copy.js';
import { isUniqueViolation, iso, tsKey } from './util.js';

export const OPEN_STATUSES = ['open', 'in_review'] as const;

/** Reports per member per day (spec 8.2, proposed). */
export const REPORT_DAILY_LIMIT = 20;

const HIGH: ReportReason[] = ['scam', 'violence', 'self_harm', 'hate', 'harassment'];
const MEDIUM: ReportReason[] = ['spam', 'misinformation', 'impersonation', 'sexual_content', 'trend_manipulation'];
/** A target with this many open reports already is treated as urgent. */
export const PILE_ON_THRESHOLD = 4;

export function basePriority(reason: ReportReason): ReportPriority {
  if (HIGH.includes(reason)) return 'high';
  if (MEDIUM.includes(reason)) return 'medium';
  return 'low';
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly targets: TargetsService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly limits: RateLimitService,
  ) {}

  /**
   * POST /reports (CM-FED-06, CM-PRF-06, CM-NET-06). One open report per reporter and target:
   * a repeat returns the existing report. Members cannot report themselves or their own content.
   */
  async create(ctx: AuthContext, input: CreateReportInput, ip?: string): Promise<CreateReportResponse> {
    const reporterId = ctx.user.id;
    await this.limits.consume(`report:${reporterId}`, REPORT_DAILY_LIMIT, 24 * 3600);

    const target = await this.targets.resolve(input.targetType, input.targetId);
    if (!target.visibleToMembers) throw Errors.notFound(input.targetType === 'member' ? 'That member' : 'That content');
    if (target.userId === reporterId) {
      throw Errors.validation(
        { targetId: input.targetType === 'member' ? 'You can’t report yourself' : 'You can’t report your own content' },
        'You can’t report yourself or your own content',
      );
    }

    const existing = await this.findOpen(reporterId, target.type, target.id);
    if (existing)
      return {
        id: existing.id,
        status: existing.status as ReportStatus,
        nextSteps: reportNextSteps(input.reason, target.type),
      };

    let created: typeof contentReports.$inferSelect;
    try {
      created = await this.db.transaction(async (tx) => {
        // Serialise concurrent reports on one target so the pile-on count is exact.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`report:${target.type}:${target.id}`}))`);
        const openOnTarget = await tx
          .select({ id: contentReports.id })
          .from(contentReports)
          .where(
            and(
              eq(contentReports.targetType, target.type),
              eq(contentReports.targetId, target.id),
              inArray(contentReports.status, [...OPEN_STATUSES]),
            ),
          );
        const pileOn = openOnTarget.length >= PILE_ON_THRESHOLD;
        const priority: ReportPriority = pileOn ? 'high' : basePriority(input.reason);
        const [row] = await tx
          .insert(contentReports)
          .values({
            reporterId,
            targetType: target.type,
            targetId: target.id,
            targetUserId: target.userId,
            reasonCode: input.reason,
            detail: input.detail || null,
            priority,
          })
          .returning();
        if (pileOn) {
          await tx
            .update(contentReports)
            .set({ priority: 'high' })
            .where(
              and(
                eq(contentReports.targetType, target.type),
                eq(contentReports.targetId, target.id),
                inArray(contentReports.status, [...OPEN_STATUSES]),
                ne(contentReports.priority, 'high'),
              ),
            );
        }
        await this.audit.record(
          {
            actorId: reporterId,
            action: 'report.created',
            targetType: target.type,
            targetId: target.id,
            after: { reportId: row!.id, reason: input.reason, priority },
            ip,
          },
          tx,
        );
        return row!;
      });
    } catch (err) {
      // Lost a race with the same reporter's duplicate request: return the winner.
      const again = isUniqueViolation(err) ? await this.findOpen(reporterId, target.type, target.id) : null;
      if (!again) throw err;
      return {
        id: again.id,
        status: again.status as ReportStatus,
        nextSteps: reportNextSteps(input.reason, target.type),
      };
    }
    this.analytics.track('report_created', reporterId, ctx.user.countryCode);
    return { id: created.id, status: 'open', nextSteps: reportNextSteps(input.reason, target.type) };
  }

  private async findOpen(reporterId: string, targetType: ReportTargetType, targetId: string) {
    const [row] = await this.db
      .select({ id: contentReports.id, status: contentReports.status })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterId, reporterId),
          eq(contentReports.targetType, targetType),
          eq(contentReports.targetId, targetId),
          inArray(contentReports.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** GET /me/reports — the reporter's own reports, status in general terms only. */
  async mine(userId: string, q: CursorQuery): Promise<Page<MyReport>> {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await this.db
      .select({
        id: contentReports.id,
        targetType: contentReports.targetType,
        reason: contentReports.reasonCode,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        key: tsKey(contentReports.createdAt),
      })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.reporterId, userId),
          cur
            ? or(
                lt(contentReports.createdAt, sql`${cur.t}::timestamptz`),
                and(eq(contentReports.createdAt, sql`${cur.t}::timestamptz`), lt(contentReports.id, cur.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(contentReports.createdAt), desc(contentReports.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.key, id: r.id }));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((r) => {
        const general = myReportStatus(r.status);
        return {
          id: r.id,
          targetType: r.targetType as ReportTargetType,
          reason: r.reason as ReportReason,
          status: general.status,
          summary: general.summary,
          createdAt: r.createdAt.toISOString(),
          resolvedAt: general.status === 'received' || general.status === 'in_review' ? null : iso(r.resolvedAt),
        };
      }),
    };
  }
}
