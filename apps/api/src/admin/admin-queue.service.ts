import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
import type {
  AdminAppealRow,
  AdminAppealsQuery,
  AdminHiddenQuery,
  AdminHiddenRow,
  AdminQueueQuery,
  AdminReportDetail,
  AdminReportRow,
  ModerationActionKind,
  Page,
  QueueStats,
  ReportPriority,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  appeals,
  comments,
  contentReports,
  files,
  memberProfiles,
  moderationActions,
  postAttachments,
  posts,
  users,
} from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { TargetsService, targetKey } from '../moderation/targets.service.js';
import { formerMember, ModerationActionsService } from '../moderation/actions.service.js';
import { OPEN_STATUSES } from '../moderation/reports.service.js';
import { iso, truncate, tsKey, uuidOr404 } from '../moderation/util.js';

type ReportRow = typeof contentReports.$inferSelect;

const PRIORITY_RANK: Record<ReportPriority, number> = { high: 0, medium: 1, low: 2 };
const RANK_PRIORITY: ReportPriority[] = ['high', 'medium', 'low'];
const RESOLVED: ReportStatus[] = ['actioned', 'dismissed', 'appealed', 'upheld', 'overturned'];
const STATUS_FILTER: Record<AdminQueueQuery['status'], ReportStatus[]> = {
  open: ['open', 'in_review'],
  in_review: ['in_review'],
  resolved: RESOLVED,
  all: ['open', 'in_review', ...RESOLVED],
};
const ACTIONED: ReportStatus[] = ['actioned', 'appealed', 'upheld'];
const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

function mostCommon<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Report queue, case detail, hidden content and appeals for the admin console (CM-ADM-02/06). */
@Injectable()
export class AdminQueueService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly targets: TargetsService,
    private readonly actions: ModerationActionsService,
    private readonly audit: AuditService,
  ) {}

  async stats(): Promise<QueueStats> {
    const openTargets = await this.db.execute<{ open: number; high: number }>(sql`
      select count(*)::int as open, count(*) filter (where high)::int as high from (
        select bool_or(priority = 'high') as high from ${contentReports}
        where status in ('open', 'in_review') group by target_type, target_id
      ) g`);
    const median = await this.db.execute<{ m: number | null }>(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 60) as m
      from ${contentReports}
      where resolved_at is not null and resolved_at > now() - interval '30 days'`);
    const hidden = await this.db.execute<{ n: number }>(sql`
      select (select count(*) from ${posts} where moderation_state in ('hidden','removed') and deleted_at is null)::int
           + (select count(*) from ${comments} where moderation_state in ('hidden','removed') and deleted_at is null)::int as n`);
    const [openAppeals] = await this.db
      .select({ n: count() })
      .from(appeals)
      .where(inArray(appeals.status, ['open', 'in_review']));
    const [blocked] = await this.db
      .select({ n: count() })
      .from(files)
      .where(inArray(files.scanStatus, ['rejected', 'infected']));
    const m = median.rows[0]?.m;
    return {
      openReports: openTargets.rows[0]?.open ?? 0,
      highPriority: openTargets.rows[0]?.high ?? 0,
      medianResolveMinutes: m === null || m === undefined ? null : Math.round(Number(m)),
      hiddenContent: hidden.rows[0]?.n ?? 0,
      openAppeals: openAppeals?.n ?? 0,
      blockedUploads: blocked?.n ?? 0,
    };
  }

  /**
   * GET /admin/reports — one row per reported target, highest priority first, then oldest.
   * Keyset pagination on (priority rank, first report time, first report id).
   */
  async list(ctx: AuthContext, q: AdminQueueQuery): Promise<Page<AdminReportRow>> {
    const statuses = STATUS_FILTER[q.status];
    const cur = decodeCursor<{ p: number; t: string; id: string }>(q.cursor);
    const res = await this.db.execute<{
      id: string;
      target_type: ReportTargetType;
      target_id: string;
      first_at: Date;
      first_key: string;
      report_count: number;
      prio: number;
      reason: ReportReason;
      any_review: boolean;
      last_status: ReportStatus;
      assigned_to: string | null;
    }>(sql`
      with g as (
        select r.target_type, r.target_id,
          (array_agg(r.id order by r.created_at, r.id))[1] as id,
          min(r.created_at) as first_at,
          count(*)::int as report_count,
          min(case r.priority when 'high' then 0 when 'medium' then 1 else 2 end)::int as prio,
          mode() within group (order by r.reason_code) as reason,
          bool_or(r.status = 'in_review') as any_review,
          (array_agg(r.status order by r.created_at desc, r.id desc))[1] as last_status,
          (array_agg(r.assigned_to order by r.created_at, r.id) filter (where r.assigned_to is not null))[1] as assigned_to
        from ${contentReports} r
        where r.status in (${sql.join(
          statuses.map((s) => sql`${s}`),
          sql`, `,
        )})
          ${q.targetType ? sql`and r.target_type = ${q.targetType}` : sql``}
        group by r.target_type, r.target_id
      )
      select g.*, ${tsKey(sql`g.first_at`)} as first_key from g
      where true
        ${q.priority ? sql`and g.prio = ${PRIORITY_RANK[q.priority]}` : sql``}
        ${q.assignee === 'me' ? sql`and g.assigned_to = ${ctx.user.id}` : sql``}
        ${q.assignee === 'unassigned' ? sql`and g.assigned_to is null` : sql``}
        ${cur ? sql`and (g.prio, g.first_at, g.id) > (${cur.p}, ${cur.t}::timestamptz, ${cur.id}::uuid)` : sql``}
      order by g.prio, g.first_at, g.id
      limit ${q.limit + 1}`);
    const page = paginate(res.rows, q.limit, (r) => ({ p: r.prio, t: r.first_key, id: r.id }));
    const previews = await this.targets.previews(page.items.map((r) => ({ type: r.target_type, id: r.target_id })));
    const refs = await this.members.refs(page.items.map((r) => r.assigned_to).filter((x): x is string => !!x));
    const unresolvedView = q.status === 'open' || q.status === 'in_review';
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((r) => ({
        id: r.id,
        target: {
          type: r.target_type,
          id: r.target_id,
          preview: previews.get(targetKey(r.target_type, r.target_id))?.preview ?? 'Deleted content',
        },
        reason: r.reason,
        reportCount: r.report_count,
        priority: RANK_PRIORITY[r.prio]!,
        status: unresolvedView ? (r.any_review ? 'in_review' : 'open') : r.last_status,
        createdAt: new Date(r.first_at).toISOString(),
        assignedTo: r.assigned_to ? (refs.get(r.assigned_to) ?? null) : null,
      })),
    };
  }

  private async loadReport(id: string): Promise<ReportRow> {
    const [rep] = await this.db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, uuidOr404(id, 'That report')))
      .limit(1);
    if (!rep) throw Errors.notFound('That report');
    return rep;
  }

  /** Reports handled together with this one: open ones on the target, or those resolved by the same action. */
  private async group(rep: ReportRow): Promise<ReportRow[]> {
    const sameTarget = and(eq(contentReports.targetType, rep.targetType), eq(contentReports.targetId, rep.targetId));
    const cond = isOpen(rep.status)
      ? inArray(contentReports.status, [...OPEN_STATUSES])
      : rep.resolvedAt
        ? eq(contentReports.resolvedAt, rep.resolvedAt)
        : eq(contentReports.id, rep.id);
    return this.db
      .select()
      .from(contentReports)
      .where(and(sameTarget, cond))
      .orderBy(asc(contentReports.createdAt), asc(contentReports.id));
  }

  private async groupRow(rep: ReportRow, group: ReportRow[], preview: string): Promise<AdminReportRow> {
    const first = group[0] ?? rep;
    const assignee = group.find((r) => r.assignedTo)?.assignedTo ?? null;
    const prio = Math.min(...group.map((r) => PRIORITY_RANK[r.priority as ReportPriority]));
    return {
      id: first.id,
      target: { type: rep.targetType as ReportTargetType, id: rep.targetId, preview },
      reason: mostCommon(group.map((r) => r.reasonCode as ReportReason)),
      reportCount: group.length,
      priority: RANK_PRIORITY[prio]!,
      status: isOpen(rep.status)
        ? group.some((r) => r.status === 'in_review')
          ? 'in_review'
          : 'open'
        : (rep.status as ReportStatus),
      createdAt: first.createdAt.toISOString(),
      assignedTo: assignee ? await this.members.ref(assignee) : null,
    };
  }

  /** GET /admin/reports/{id}: content, reporter reasons, author history and previous actions (CM-FED acceptance). */
  async detail(id: string): Promise<AdminReportDetail> {
    const rep = await this.loadReport(id);
    const group = await this.group(rep);
    const target = await this.targets.resolve(rep.targetType as ReportTargetType, rep.targetId).catch(() => null);
    const row = await this.groupRow(rep, group, target?.preview ?? 'Deleted content');

    let attachmentCount = 0;
    if (target?.type === 'post') {
      const [c] = await this.db
        .select({ n: count() })
        .from(postAttachments)
        .where(eq(postAttachments.postId, target.id));
      attachmentCount = c?.n ?? 0;
    }
    const authorId = rep.targetUserId ?? target?.userId ?? null;

    const reasonMap = new Map<string, { reason: ReportReason; detail: string | null; count: number }>();
    for (const r of group) {
      const detail = r.detail?.trim() || null;
      const key = `${r.reasonCode}\u0000${detail ?? ''}`;
      const entry = reasonMap.get(key) ?? { reason: r.reasonCode as ReportReason, detail, count: 0 };
      entry.count += 1;
      reasonMap.set(key, entry);
    }

    const onTarget = await this.actions.history({ targetType: rep.targetType, targetId: rep.targetId });
    const onAuthor = authorId ? await this.actions.history({ userId: authorId }) : [];
    const previous = [...new Map([...onTarget, ...onAuthor].map((a) => [a.id, a])).values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);

    return {
      ...row,
      content: {
        body: target?.body ?? null,
        attachmentCount,
        createdAt: iso(target?.createdAt),
        moderationState: target ? (target.state ?? null) : 'deleted',
        href: target?.href ?? null,
      },
      author: authorId ? await this.members.ref(authorId) : null,
      reasons: [...reasonMap.values()].sort((a, b) => b.count - a.count),
      authorHistory: authorId
        ? await this.authorHistory(
            authorId,
            group.map((r) => r.id),
            onAuthor,
          )
        : null,
      previousActions: await this.actions.views(previous),
    };
  }

  private async authorHistory(
    userId: string,
    excludeReportIds: string[],
    actions: (typeof moderationActions.$inferSelect)[],
  ): Promise<AdminReportDetail['authorHistory']> {
    const [u] = await this.db
      .select({
        createdAt: users.createdAt,
        emailVerifiedAt: users.emailVerifiedAt,
        status: users.status,
        suspendedUntil: users.suspendedUntil,
        avatar: memberProfiles.avatarFileId,
      })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return null;
    const against = and(
      eq(contentReports.targetUserId, userId),
      excludeReportIds.length ? notInArray(contentReports.id, excludeReportIds) : undefined,
    );
    const [prev] = await this.db
      .select({
        n: count(),
        actioned: sql<number>`count(*) filter (where ${inArray(contentReports.status, ACTIONED)})::int`,
      })
      .from(contentReports)
      .where(against);
    const hidden = await this.db.execute<{ n: number }>(sql`
      select (select count(*) from ${posts} where author_id = ${userId} and moderation_state in ('hidden','removed') and deleted_at is null)::int
           + (select count(*) from ${comments} where author_id = ${userId} and moderation_state in ('hidden','removed') and deleted_at is null)::int as n`);
    const status = u.status === 'active' && u.suspendedUntil && u.suspendedUntil > new Date() ? 'suspended' : u.status;
    return {
      joinedAt: u.createdAt.toISOString(),
      emailVerified: !!u.emailVerifiedAt,
      hasAvatar: !!u.avatar,
      previousReports: prev?.n ?? 0,
      previousActioned: Number(prev?.actioned ?? 0),
      hiddenItems: hidden.rows[0]?.n ?? 0,
      status,
      recentActions: actions
        .filter((a) => a.action !== 'dismiss' && a.action !== 'escalate')
        .slice(0, 5)
        .map((a) => ({ action: a.action as ModerationActionKind, createdAt: a.createdAt.toISOString() })),
    };
  }

  /** POST /admin/reports/{id}/assign — take a case (in review) or release it (open). */
  async assign(ctx: AuthContext, id: string, assignee: 'me' | 'none', ip?: string): Promise<AdminReportRow> {
    const rep = await this.loadReport(id);
    if (!isOpen(rep.status)) throw Errors.conflict('This report has already been resolved');
    const group = await this.group(rep);
    const ids = group.map((r) => r.id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(contentReports)
        .set(
          assignee === 'me' ? { assignedTo: ctx.user.id, status: 'in_review' } : { assignedTo: null, status: 'open' },
        )
        .where(and(inArray(contentReports.id, ids), inArray(contentReports.status, [...OPEN_STATUSES])));
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: assignee === 'me' ? 'report.assigned' : 'report.unassigned',
          targetType: rep.targetType,
          targetId: rep.targetId,
          before: { assignedTo: group.find((r) => r.assignedTo)?.assignedTo ?? null },
          after: { assignedTo: assignee === 'me' ? ctx.user.id : null, reportIds: ids },
          ip,
        },
        tx,
      );
    });
    const fresh = await this.loadReport(rep.id);
    const preview = (await this.targets.previews([{ type: rep.targetType, id: rep.targetId }])).get(
      targetKey(rep.targetType, rep.targetId),
    );
    return this.groupRow(fresh, await this.group(fresh), preview?.preview ?? 'Deleted content');
  }

  /** The report a report-scoped action applies to (must still be open). */
  async openReportTarget(id: string) {
    const rep = await this.loadReport(id);
    if (!isOpen(rep.status)) throw Errors.conflict('This report has already been resolved');
    return rep;
  }

  /** GET /admin/hidden — hidden or removed posts and comments with the action that hid them, newest first. */
  async hidden(q: AdminHiddenQuery): Promise<Page<AdminHiddenRow>> {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    const lastAction = (type: 'post' | 'comment', idCol: ReturnType<typeof sql>) => sql`
      left join lateral (
        select m.id, m.created_at from ${moderationActions} m
        where m.target_type = ${type} and m.target_id = ${idCol}::text and m.action in ('hide','remove') and m.revoked_at is null
        order by m.created_at desc limit 1
      ) a on true`;
    const parts = [];
    if (q.targetType !== 'comment') {
      parts.push(sql`
        select 'post' as type, p.id, p.body, p.author_id, p.moderation_state, null::uuid as post_id,
          coalesce(a.created_at, p.updated_at) as hidden_at, a.id as action_id
        from ${posts} p ${lastAction('post', sql`p.id`)}
        where p.moderation_state in ('hidden','removed') and p.deleted_at is null`);
    }
    if (q.targetType !== 'post') {
      parts.push(sql`
        select 'comment' as type, c.id, c.body, c.author_id, c.moderation_state, c.post_id,
          coalesce(a.created_at, c.updated_at) as hidden_at, a.id as action_id
        from ${comments} c ${lastAction('comment', sql`c.id`)}
        where c.moderation_state in ('hidden','removed') and c.deleted_at is null`);
    }
    const res = await this.db.execute<{
      type: 'post' | 'comment';
      id: string;
      body: string;
      author_id: string;
      moderation_state: 'hidden' | 'removed';
      post_id: string | null;
      hidden_at: Date;
      hidden_key: string;
      action_id: string | null;
    }>(sql`
      select x.*, ${tsKey(sql`x.hidden_at`)} as hidden_key from (${sql.join(parts, sql` union all `)}) x
      where true ${cur ? sql`and (x.hidden_at, x.id) < (${cur.t}::timestamptz, ${cur.id}::uuid)` : sql``}
      order by x.hidden_at desc, x.id desc
      limit ${q.limit + 1}`);
    const page = paginate(res.rows, q.limit, (r) => ({ t: r.hidden_key, id: r.id }));
    const refs = await this.members.refs(page.items.map((r) => r.author_id));
    const actionIds = page.items.map((r) => r.action_id).filter((x): x is string => !!x);
    const actionRows = actionIds.length
      ? await this.db.select().from(moderationActions).where(inArray(moderationActions.id, actionIds))
      : [];
    const views = new Map((await this.actions.views(actionRows)).map((v) => [v.id, v]));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((r) => ({
        target: { type: r.type, id: r.id, preview: truncate(r.body) || (r.type === 'post' ? 'Post' : 'Comment') },
        moderationState: r.moderation_state,
        author: refs.get(r.author_id) ?? null,
        href: r.type === 'post' ? `/posts/${r.id}` : `/posts/${r.post_id}#comment-${r.id}`,
        hiddenAt: new Date(r.hidden_at).toISOString(),
        action: r.action_id ? (views.get(r.action_id) ?? null) : null,
      })),
    };
  }

  /** GET /admin/appeals — oldest first; canDecide is false for the moderator who took the action. */
  async appeals(ctx: AuthContext, q: AdminAppealsQuery): Promise<Page<AdminAppealRow>> {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    const statuses = q.status === 'all' ? undefined : q.status === 'open' ? ['open', 'in_review'] : [q.status];
    const rows = await this.db
      .select({ appeal: appeals, action: moderationActions, key: tsKey(appeals.createdAt) })
      .from(appeals)
      .innerJoin(moderationActions, eq(moderationActions.id, appeals.actionId))
      .where(
        and(
          statuses ? inArray(appeals.status, statuses) : undefined,
          cur
            ? or(
                gt(appeals.createdAt, sql`${cur.t}::timestamptz`),
                and(eq(appeals.createdAt, sql`${cur.t}::timestamptz`), gt(appeals.id, cur.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(appeals.createdAt), asc(appeals.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.key, id: r.appeal.id }));
    return { nextCursor: page.nextCursor, items: await this.appealRows(ctx, page.items) };
  }

  async appealRow(ctx: AuthContext, appealId: string): Promise<AdminAppealRow> {
    const rows = await this.db
      .select({ appeal: appeals, action: moderationActions })
      .from(appeals)
      .innerJoin(moderationActions, eq(moderationActions.id, appeals.actionId))
      .where(eq(appeals.id, appealId))
      .limit(1);
    if (!rows[0]) throw Errors.notFound('That appeal');
    return (await this.appealRows(ctx, rows))[0]!;
  }

  private async appealRows(
    ctx: AuthContext,
    rows: { appeal: typeof appeals.$inferSelect; action: typeof moderationActions.$inferSelect }[],
  ): Promise<AdminAppealRow[]> {
    const views = new Map((await this.actions.views(rows.map((r) => r.action))).map((v) => [v.id, v]));
    const refs = await this.members.refs(rows.map((r) => r.appeal.appellantId));
    const previews = await this.targets.previews(
      rows.map((r) => ({ type: r.action.targetType, id: r.action.targetId })),
    );
    return rows.map(({ appeal, action }) => {
      const pending = appeal.status === 'open' || appeal.status === 'in_review';
      return {
        id: appeal.id,
        appellant: refs.get(appeal.appellantId) ?? formerMember(appeal.appellantId),
        statement: appeal.statement,
        status: appeal.status as AdminAppealRow['status'],
        createdAt: appeal.createdAt.toISOString(),
        action: views.get(action.id)!,
        target: {
          type: action.targetType as ReportTargetType,
          id: action.targetId,
          preview: previews.get(targetKey(action.targetType, action.targetId))?.preview ?? null,
        },
        canDecide:
          pending &&
          ctx.user.permissions.has('appeal.decide') &&
          action.moderatorId !== ctx.user.id &&
          appeal.appellantId !== ctx.user.id,
      };
    });
  }
}
