import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import type {
  AdminActionInput,
  AdminActionView,
  AppealDecisionInput,
  MemberRef,
  ModerationActionKind,
  PolicyRef,
  ReportTargetType,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { appeals, comments, contentReports, moderationActions, messages, opportunities, posts, stories, trendingOverrides, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, toneFor } from '../core/members.service.js';
import { SessionService } from '../core/session.service.js';
import { AuditService } from '../infra/audit.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { TargetsService, targetKey, type ResolvedTarget } from './targets.service.js';
import { OPEN_STATUSES } from './reports.service.js';
import { iso, truncate } from './util.js';

type ActionRow = typeof moderationActions.$inferSelect;
type AppealStatus = AdminActionView['appealStatus'];

/** Default length of posting/connecting restrictions: 7 days (spec 4.15 CM-ADM-04, proposed). */
export const DEFAULT_RESTRICTION_HOURS = 168;

const CONTENT_ACTIONS: ModerationActionKind[] = ['hide', 'remove', 'restore'];
const USER_ACTIONS: ModerationActionKind[] = ['warn', 'restrict_posting', 'restrict_connecting', 'suspend'];
/** Actions that affect the target's author and therefore need the privilege check. */
const AFFECTS_AUTHOR: ModerationActionKind[] = [
  'hide',
  'remove',
  'warn',
  'restrict_posting',
  'restrict_connecting',
  'suspend',
];

const hoursFrom = (now: Date, h: number) => new Date(now.getTime() + h * 3600_000);
const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Placeholder for actors with no profile (system jobs, erased accounts). */
export function formerMember(id: string): MemberRef {
  return {
    id,
    handle: 'deleted-member',
    name: 'Former member',
    headline: null,
    avatarUrl: null,
    tone: toneFor(id),
    verified: false,
    staff: false,
    official: false,
  };
}

/**
 * Moderation actions and appeal decisions (CM-ADM-04/05/06). Every action records
 * reason, actor, time, target, action and policy reference, resolves the reports on
 * the target, is audited, and is announced by domain events that notify members.
 */
@Injectable()
export class ModerationActionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly targets: TargetsService,
    private readonly members: MembersService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
  ) {}

  /** Act on a target, optionally from a specific report (POST /admin/reports/{id}/actions). */
  async act(
    ctx: AuthContext,
    ref: { type: ReportTargetType; id: string },
    input: AdminActionInput,
    opts: { reportId?: string; ip?: string } = {},
  ): Promise<AdminActionView> {
    const kind = input.action;
    const target = await this.targets.resolve(ref.type, ref.id);
    this.validate(kind, target);
    if (target.userId && AFFECTS_AUTHOR.includes(kind)) await this.targets.assertCanActOn(ctx.user, target.userId);

    const openReports = await this.db
      .select({ id: contentReports.id, createdAt: contentReports.createdAt })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.targetType, target.type),
          eq(contentReports.targetId, target.id),
          inArray(contentReports.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(asc(contentReports.createdAt));
    if ((kind === 'dismiss' || kind === 'escalate') && openReports.length === 0) {
      throw Errors.validation({ action: 'There are no open reports on this item' });
    }

    const now = new Date();
    const expiresAt =
      kind === 'restrict_posting' || kind === 'restrict_connecting'
        ? hoursFrom(now, input.durationHours ?? DEFAULT_RESTRICTION_HOURS)
        : (kind === 'suspend' || ((kind === 'hide' || kind === 'remove') && target.type === 'hashtag')) &&
            input.durationHours
          ? hoursFrom(now, input.durationHours)
          : null;
    const resolvedStatus =
      kind === 'escalate' ? null : kind === 'dismiss' || kind === 'restore' ? 'dismissed' : 'actioned';

    const action = await this.db.transaction(async (tx) => {
      const before = await this.snapshot(tx, target);
      await this.applyEffect(tx, ctx.user.id, kind, target, input, now, expiresAt);
      const [row] = await tx
        .insert(moderationActions)
        .values({
          reportId: opts.reportId ?? openReports[0]?.id ?? null,
          moderatorId: ctx.user.id,
          targetType: target.type,
          targetId: target.id,
          targetUserId: target.userId,
          action: kind,
          reason: input.reason,
          policyRef: input.policyRef ?? null,
          expiresAt,
          createdAt: now,
        })
        .returning();
      const reportIds = openReports.map((r) => r.id);
      if (reportIds.length) {
        await tx
          .update(contentReports)
          .set(resolvedStatus ? { status: resolvedStatus, resolvedAt: now } : { status: 'in_review', priority: 'high' })
          .where(and(inArray(contentReports.id, reportIds), inArray(contentReports.status, [...OPEN_STATUSES])));
      }
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: `moderation.${kind}`,
          targetType: target.type,
          targetId: target.id,
          before,
          after: {
            ...(await this.snapshot(tx, target)),
            actionId: row!.id,
            reason: input.reason,
            policyRef: input.policyRef ?? null,
            expiresAt: iso(expiresAt),
            reportIds,
            reportStatus: resolvedStatus ?? 'in_review',
          },
          ip: opts.ip,
        },
        tx,
      );
      return row!;
    });

    if (kind === 'suspend' && target.userId) await this.sessions.revokeAll(target.userId);
    await this.events.emit({ type: 'moderation.actioned', actionId: action.id });
    if (resolvedStatus) {
      for (const r of openReports) {
        this.analytics.track('report_resolved', ctx.user.id, ctx.user.countryCode);
        await this.events.emit({ type: 'report.resolved', reportId: r.id, outcome: resolvedStatus });
      }
    }
    if (this.affectsTrending(kind, target.type)) await this.queue.add('trending', 'compute', {});
    return (await this.views([action]))[0]!;
  }

  private affectsTrending(kind: ModerationActionKind, type: ReportTargetType) {
    return type === 'hashtag' || (type === 'post' && CONTENT_ACTIONS.includes(kind)) || kind === 'suspend';
  }

  private validate(kind: ModerationActionKind, t: ResolvedTarget) {
    if (t.type === 'member' && CONTENT_ACTIONS.includes(kind)) {
      throw Errors.validation({
        action: 'Members can’t be hidden or removed. Warn, restrict or suspend the account instead.',
      });
    }
    if (t.type === 'hashtag' && USER_ACTIONS.includes(kind)) {
      throw Errors.validation({ action: 'Topics have no single author. Hide the topic or act on individual posts.' });
    }
    if (USER_ACTIONS.includes(kind) && !t.userId)
      throw Errors.validation({ action: 'This item has no author to act on' });
    if (kind === 'hide' || kind === 'remove') {
      if (t.state === 'deleted') throw Errors.conflict('This content was deleted by its author');
      if (t.state === 'removed' || (t.state === 'hidden' && kind === 'hide'))
        throw Errors.conflict(`This ${t.type} is already ${t.state}`);
    }
    if (kind === 'restore' && t.state !== 'hidden' && t.state !== 'removed')
      throw Errors.conflict(`This ${t.type} is not hidden`);
  }

  /** Before/after state for the audit log. */
  private async snapshot(tx: Tx, t: ResolvedTarget) {
    const out: Record<string, unknown> = {};
    if (t.type === 'post') {
      const [p] = await tx.select({ s: posts.moderationState }).from(posts).where(eq(posts.id, t.id));
      out.moderationState = p?.s ?? null;
    } else if (t.type === 'comment') {
      const [c] = await tx.select({ s: comments.moderationState }).from(comments).where(eq(comments.id, t.id));
      out.moderationState = c?.s ?? null;
    } else if (t.type === 'story') {
      const [st] = await tx.select({ s: stories.moderationState }).from(stories).where(eq(stories.id, t.id));
      out.moderationState = st?.s ?? null;
    } else if (t.type === 'opportunity') {
      const [o] = await tx.select({ s: opportunities.moderationState }).from(opportunities).where(eq(opportunities.id, t.id));
      out.moderationState = o?.s ?? null;
    } else if (t.type === 'message') {
      const [m] = await tx.select({ s: messages.moderationState }).from(messages).where(eq(messages.id, t.id));
      out.moderationState = m?.s ?? null;
    } else if (t.type === 'hashtag' && t.hashtagId) {
      const [o] = await tx
        .select({ id: trendingOverrides.id })
        .from(trendingOverrides)
        .where(
          and(
            eq(trendingOverrides.hashtagId, t.hashtagId),
            eq(trendingOverrides.action, 'suppress'),
            eq(trendingOverrides.scopeType, 'global'),
            isNull(trendingOverrides.revokedAt),
          ),
        );
      out.suppressed = !!o;
    }
    if (t.userId) {
      const [u] = await tx
        .select({
          status: users.status,
          suspendedUntil: users.suspendedUntil,
          restrictedPostingUntil: users.restrictedPostingUntil,
          restrictedConnectingUntil: users.restrictedConnectingUntil,
        })
        .from(users)
        .where(eq(users.id, t.userId));
      if (u)
        out.account = {
          status: u.status,
          suspendedUntil: iso(u.suspendedUntil),
          restrictedPostingUntil: iso(u.restrictedPostingUntil),
          restrictedConnectingUntil: iso(u.restrictedConnectingUntil),
        };
    }
    return out;
  }

  private async setContentState(tx: Tx, t: ResolvedTarget, state: 'visible' | 'hidden' | 'removed') {
    if (t.type === 'post') await tx.update(posts).set({ moderationState: state }).where(eq(posts.id, t.id));
    if (t.type === 'comment') await tx.update(comments).set({ moderationState: state }).where(eq(comments.id, t.id));
    if (t.type === 'story') await tx.update(stories).set({ moderationState: state }).where(eq(stories.id, t.id));
    if (t.type === 'opportunity') await tx.update(opportunities).set({ moderationState: state }).where(eq(opportunities.id, t.id));
    if (t.type === 'message') await tx.update(messages).set({ moderationState: state }).where(eq(messages.id, t.id));
  }

  private async applyEffect(
    tx: Tx,
    actorId: string,
    kind: ModerationActionKind,
    t: ResolvedTarget,
    input: AdminActionInput,
    now: Date,
    expiresAt: Date | null,
  ) {
    switch (kind) {
      case 'hide':
      case 'remove':
        if (t.type === 'hashtag') {
          // Hiding a topic suppresses it from trending (global scope); recompute follows.
          await this.revokeOverrides(
            tx,
            t.hashtagId!,
            'global',
            '',
            actorId,
            `Replaced by suppression: ${input.reason}`,
            now,
          );
          await tx.insert(trendingOverrides).values({
            hashtagId: t.hashtagId!,
            action: 'suppress',
            scopeType: 'global',
            scopeId: '',
            reason: input.reason,
            actorId,
            expiresAt,
          });
        } else {
          await this.setContentState(tx, t, kind === 'hide' ? 'hidden' : 'removed');
        }
        return;
      case 'restore':
        if (t.type === 'hashtag') {
          await this.revokeOverrides(tx, t.hashtagId!, 'global', '', actorId, input.reason, now, 'suppress');
        } else {
          await this.setContentState(tx, t, 'visible');
        }
        // The restore supersedes the earlier hide/remove.
        await tx
          .update(moderationActions)
          .set({ revokedAt: now, revokedBy: actorId })
          .where(
            and(
              eq(moderationActions.targetType, t.type),
              eq(moderationActions.targetId, t.id),
              inArray(moderationActions.action, ['hide', 'remove']),
              isNull(moderationActions.revokedAt),
            ),
          );
        return;
      case 'restrict_posting':
      case 'restrict_connecting': {
        const col = kind === 'restrict_posting' ? 'restrictedPostingUntil' : 'restrictedConnectingUntil';
        const [u] = await tx.select({ v: users[col] }).from(users).where(eq(users.id, t.userId!));
        await tx
          .update(users)
          .set({ [col]: later(u?.v ?? null, expiresAt) })
          .where(eq(users.id, t.userId!));
        return;
      }
      case 'suspend': {
        const [u] = await tx
          .select({ status: users.status, until: users.suspendedUntil })
          .from(users)
          .where(eq(users.id, t.userId!));
        if (!u || ['deleted', 'deletion_pending', 'deactivated'].includes(u.status)) {
          throw Errors.conflict('This account is deactivated or being deleted and can’t be suspended');
        }
        const indefinite = !expiresAt || (u.status === 'suspended' && !u.until);
        await tx
          .update(users)
          .set({ status: 'suspended', suspendedUntil: indefinite ? null : later(u.until, expiresAt) })
          .where(eq(users.id, t.userId!));
        return;
      }
      default:
        // warn: record only; escalate / dismiss: handled on the reports.
        return;
    }
  }

  /** Revoke active trending overrides for a tag and scope (optionally one kind only). */
  async revokeOverrides(
    tx: Tx | Db,
    hashtagId: string,
    scopeType: string,
    scopeId: string,
    actorId: string | null,
    reason: string,
    now: Date,
    action?: 'pin' | 'suppress',
  ) {
    return tx
      .update(trendingOverrides)
      .set({ revokedAt: now, revokedBy: actorId, revokeReason: reason })
      .where(
        and(
          eq(trendingOverrides.hashtagId, hashtagId),
          eq(trendingOverrides.scopeType, scopeType),
          eq(trendingOverrides.scopeId, scopeId),
          isNull(trendingOverrides.revokedAt),
          action ? eq(trendingOverrides.action, action) : undefined,
        ),
      )
      .returning();
  }

  /**
   * POST /admin/appeals/{id}/decide (CM-ADM-06): a different moderator from the one who
   * took the action decides. "overturned" reverses the effect and revokes the action.
   */
  async decideAppeal(ctx: AuthContext, appealId: string, input: AppealDecisionInput, ip?: string) {
    const [row] = await this.db
      .select({ appeal: appeals, action: moderationActions })
      .from(appeals)
      .innerJoin(moderationActions, eq(moderationActions.id, appeals.actionId))
      .where(eq(appeals.id, appealId))
      .limit(1);
    if (!row) throw Errors.notFound('That appeal');
    const { appeal, action } = row;
    if (appeal.status !== 'open' && appeal.status !== 'in_review')
      throw Errors.conflict('This appeal has already been decided');
    if (action.moderatorId === ctx.user.id) {
      throw Errors.forbidden('A different moderator must review this appeal (you took the original action)');
    }
    if (appeal.appellantId === ctx.user.id) throw Errors.forbidden('You can’t decide your own appeal');

    const now = new Date();
    const target = { type: action.targetType as ReportTargetType, id: action.targetId };
    await this.db.transaction(async (tx) => {
      const resolved = await this.targets.resolve(target.type, target.id).catch(() => null);
      const before = resolved ? await this.snapshot(tx, resolved) : {};
      if (input.decision === 'overturned') await this.reverse(tx, ctx.user.id, action, now, input.reason);
      await tx
        .update(appeals)
        .set({ status: input.decision, reviewerId: ctx.user.id, decisionReason: input.reason, decidedAt: now })
        .where(eq(appeals.id, appeal.id));
      await tx
        .update(contentReports)
        .set({ status: input.decision })
        .where(
          and(
            eq(contentReports.targetType, action.targetType),
            eq(contentReports.targetId, action.targetId),
            eq(contentReports.resolvedAt, action.createdAt),
            inArray(contentReports.status, ['actioned', 'appealed']),
          ),
        );
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'appeal.decided',
          targetType: 'appeal',
          targetId: appeal.id,
          before: { ...before, appealStatus: appeal.status, actionId: action.id, action: action.action },
          after: {
            ...(resolved ? await this.snapshot(tx, resolved) : {}),
            appealStatus: input.decision,
            reason: input.reason,
            actionRevoked: input.decision === 'overturned',
          },
          ip,
        },
        tx,
      );
    });

    await this.events.emit({ type: 'appeal.decided', appealId: appeal.id });
    if (input.decision === 'overturned' && this.affectsTrending(action.action as ModerationActionKind, target.type)) {
      await this.queue.add('trending', 'compute', {});
    }
  }

  /** Undo an action's effect. Other still-active actions on the same target or member keep theirs. */
  private async reverse(tx: Tx, actorId: string, action: ActionRow, now: Date, reason: string) {
    await tx
      .update(moderationActions)
      .set({ revokedAt: now, revokedBy: actorId })
      .where(eq(moderationActions.id, action.id));
    const others = (kinds: string[], byUser: boolean) =>
      tx
        .select({ expiresAt: moderationActions.expiresAt })
        .from(moderationActions)
        .where(
          and(
            byUser
              ? eq(moderationActions.targetUserId, action.targetUserId!)
              : and(
                  eq(moderationActions.targetType, action.targetType),
                  eq(moderationActions.targetId, action.targetId),
                ),
            inArray(moderationActions.action, kinds),
            isNull(moderationActions.revokedAt),
            ne(moderationActions.id, action.id),
            or(isNull(moderationActions.expiresAt), gt(moderationActions.expiresAt, now)),
          ),
        );

    switch (action.action) {
      case 'hide':
      case 'remove': {
        if ((await others(['hide', 'remove'], false)).length > 0) return;
        if (action.targetType === 'hashtag') {
          const t = await this.targets.resolve('hashtag', action.targetId).catch(() => null);
          if (t?.hashtagId)
            await this.revokeOverrides(
              tx,
              t.hashtagId,
              'global',
              '',
              actorId,
              `Appeal overturned: ${reason}`,
              now,
              'suppress',
            );
        } else if (action.targetType === 'post') {
          await tx.update(posts).set({ moderationState: 'visible' }).where(eq(posts.id, action.targetId));
        } else if (action.targetType === 'comment') {
          await tx.update(comments).set({ moderationState: 'visible' }).where(eq(comments.id, action.targetId));
        } else if (action.targetType === 'story') {
          await tx.update(stories).set({ moderationState: 'visible' }).where(eq(stories.id, action.targetId));
        } else if (action.targetType === 'opportunity') {
          await tx.update(opportunities).set({ moderationState: 'visible' }).where(eq(opportunities.id, action.targetId));
        } else if (action.targetType === 'message') {
          await tx.update(messages).set({ moderationState: 'visible' }).where(eq(messages.id, action.targetId));
        }
        return;
      }
      case 'restrict_posting':
      case 'restrict_connecting': {
        if (!action.targetUserId) return;
        const col = action.action === 'restrict_posting' ? 'restrictedPostingUntil' : 'restrictedConnectingUntil';
        const rest = await others([action.action], true);
        const until = rest.reduce<Date | null>((m, r) => later(m, r.expiresAt), null);
        await tx
          .update(users)
          .set({ [col]: until })
          .where(eq(users.id, action.targetUserId));
        return;
      }
      case 'suspend': {
        if (!action.targetUserId) return;
        const [u] = await tx
          .select({ status: users.status, verified: users.emailVerifiedAt })
          .from(users)
          .where(eq(users.id, action.targetUserId));
        if (!u || u.status !== 'suspended') return;
        const rest = await others(['suspend'], true);
        if (rest.length > 0) {
          const indefinite = rest.some((r) => !r.expiresAt);
          const until = indefinite ? null : rest.reduce<Date | null>((m, r) => later(m, r.expiresAt), null);
          await tx.update(users).set({ suspendedUntil: until }).where(eq(users.id, action.targetUserId));
          return;
        }
        await tx
          .update(users)
          .set({ status: u.verified ? 'active' : 'unverified', suspendedUntil: null })
          .where(eq(users.id, action.targetUserId));
        return;
      }
      default:
        return;
    }
  }

  /** Serialise actions for the admin console (moderator, appeal status, what the action was about). */
  async views(rows: ActionRow[]): Promise<AdminActionView[]> {
    if (rows.length === 0) return [];
    const refs = await this.members.refs(rows.map((r) => r.moderatorId));
    const previews = await this.targets.previews(rows.map((r) => ({ type: r.targetType, id: r.targetId })));
    const appealRows = await this.db
      .select({ actionId: appeals.actionId, status: appeals.status })
      .from(appeals)
      .where(
        inArray(
          appeals.actionId,
          rows.map((r) => r.id),
        ),
      );
    const appealOf = new Map(appealRows.map((a) => [a.actionId, a.status as AppealStatus]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action as ModerationActionKind,
      reason: r.reason,
      policyRef: (r.policyRef as PolicyRef | null) ?? null,
      moderator: refs.get(r.moderatorId) ?? formerMember(r.moderatorId),
      createdAt: r.createdAt.toISOString(),
      expiresAt: iso(r.expiresAt),
      revokedAt: iso(r.revokedAt),
      appealStatus: appealOf.get(r.id) ?? null,
      targetType: r.targetType as ReportTargetType,
      targetId: r.targetId,
      targetPreview: truncate(previews.get(targetKey(r.targetType, r.targetId))?.preview, 80) || null,
    }));
  }

  /** Actions on a target or against a member, newest first (report detail). */
  async history(where: { targetType: string; targetId: string } | { userId: string }, limit = 20) {
    const cond =
      'userId' in where
        ? eq(moderationActions.targetUserId, where.userId)
        : and(eq(moderationActions.targetType, where.targetType), eq(moderationActions.targetId, where.targetId));
    return this.db
      .select()
      .from(moderationActions)
      .where(cond)
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(limit);
  }
}
