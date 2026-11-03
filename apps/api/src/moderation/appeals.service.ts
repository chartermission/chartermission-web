import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  AppealView,
  CreateAppealInput,
  ModerationActionKind,
  MyModerationAction,
  PolicyRef,
  ReportTargetType,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { appeals, contentReports, moderationActions } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { TargetsService, targetKey } from './targets.service.js';
import { actionSummary, MEMBER_FACING_ACTIONS } from './copy.js';
import { APPEAL_WINDOW_DAYS, DAY_MS, isUniqueViolation, iso } from './util.js';

type AppealStatus = AppealView['status'];

export function withinAppealWindow(createdAt: Date, now = new Date()) {
  return now.getTime() - createdAt.getTime() < APPEAL_WINDOW_DAYS * DAY_MS;
}

/** Member side of moderation: my actions and one appeal per action (CM-ADM-06). */
@Injectable()
export class AppealsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly targets: TargetsService,
    private readonly audit: AuditService,
  ) {}

  /** GET /me/moderation-actions — actions on me or my content, newest first. */
  async myActions(userId: string): Promise<MyModerationAction[]> {
    const rows = await this.db
      .select({ action: moderationActions, appeal: appeals })
      .from(moderationActions)
      .leftJoin(appeals, eq(appeals.actionId, moderationActions.id))
      .where(and(eq(moderationActions.targetUserId, userId), inArray(moderationActions.action, MEMBER_FACING_ACTIONS)))
      .orderBy(desc(moderationActions.createdAt))
      .limit(100);
    const previews = await this.targets.previews(
      rows
        .filter((r) => r.action.targetType !== 'member')
        .map((r) => ({ type: r.action.targetType, id: r.action.targetId })),
    );
    const now = new Date();
    return rows.map(({ action: a, appeal }) => ({
      id: a.id,
      action: a.action as ModerationActionKind,
      policyRef: (a.policyRef as PolicyRef | null) ?? null,
      summary: actionSummary(
        a.action as ModerationActionKind,
        a.targetType as ReportTargetType,
        a.policyRef,
        a.expiresAt,
      ),
      target: {
        type: a.targetType as ReportTargetType,
        id: a.targetId,
        preview:
          a.targetType === 'member' ? null : (previews.get(targetKey(a.targetType, a.targetId))?.preview ?? null),
      },
      createdAt: a.createdAt.toISOString(),
      expiresAt: iso(a.expiresAt),
      appeal: appeal
        ? { id: appeal.id, status: appeal.status as AppealStatus, decidedAt: iso(appeal.decidedAt) }
        : null,
      canAppeal: !appeal && !a.revokedAt && withinAppealWindow(a.createdAt, now),
    }));
  }

  /** POST /appeals — only the affected member, once per action, within 30 days, while the action stands. */
  async create(ctx: AuthContext, input: CreateAppealInput, ip?: string): Promise<AppealView> {
    const [action] = await this.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, input.actionId))
      .limit(1);
    // Someone else's action is "not found" to the caller: never confirm it exists.
    if (!action || action.targetUserId !== ctx.user.id) throw Errors.notFound('That moderation action');
    if (!MEMBER_FACING_ACTIONS.includes(action.action as ModerationActionKind)) {
      throw Errors.validation({ actionId: 'This action can’t be appealed' });
    }
    const [existing] = await this.db
      .select({ id: appeals.id })
      .from(appeals)
      .where(eq(appeals.actionId, action.id))
      .limit(1);
    if (existing) throw Errors.conflict('You’ve already appealed this decision. Each action can be appealed once.');
    if (action.revokedAt) throw Errors.conflict('This action has already been reversed');
    if (!withinAppealWindow(action.createdAt)) {
      throw Errors.validation({ actionId: `Appeals must be made within ${APPEAL_WINDOW_DAYS} days of the action` });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(appeals)
          .values({ actionId: action.id, appellantId: ctx.user.id, statement: input.statement })
          .returning();
        // Reports closed by this action move to "appealed" (spec 4.15 report states).
        await tx
          .update(contentReports)
          .set({ status: 'appealed' })
          .where(
            and(
              eq(contentReports.targetType, action.targetType),
              eq(contentReports.targetId, action.targetId),
              eq(contentReports.resolvedAt, action.createdAt),
              eq(contentReports.status, 'actioned'),
            ),
          );
        await this.audit.record(
          {
            actorId: ctx.user.id,
            action: 'appeal.created',
            targetType: 'moderation_action',
            targetId: action.id,
            after: { appealId: row!.id, action: action.action },
            ip,
          },
          tx,
        );
        return { id: row!.id, actionId: action.id, status: 'open' as const, createdAt: row!.createdAt.toISOString() };
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw Errors.conflict('You’ve already appealed this decision. Each action can be appealed once.');
      throw err;
    }
  }
}
