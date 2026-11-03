import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ModerationActionKind, ReportTargetType } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { appeals, contentReports, moderationActions } from '../db/schema.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { TargetsService } from './targets.service.js';
import { actionSummary, MEMBER_FACING_ACTIONS, policyLabel, reportOutcomeText } from './copy.js';
import { APPEAL_WINDOW_DAYS } from './util.js';

/** Where reporters follow their reports in the web app. */
export const MY_REPORTS_HREF = '/settings/reports';

/**
 * Notifications for moderation outcomes, created from domain events (spec 4.13).
 * Affected members get the action, policy and appeal route; reporters only learn
 * the outcome in general terms; appellants get the decision.
 */
@Injectable()
export class ModerationEventsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly targets: TargetsService,
  ) {}

  onModuleInit() {
    this.events.on('moderation.actioned', (e) => this.onActioned(e.actionId));
    this.events.on('report.resolved', (e) => this.onReportResolved(e.reportId, e.outcome));
    this.events.on('appeal.decided', (e) => this.onAppealDecided(e.appealId));
  }

  async onActioned(actionId: string) {
    const [a] = await this.db.select().from(moderationActions).where(eq(moderationActions.id, actionId)).limit(1);
    if (!a?.targetUserId) return;
    const kind = a.action as ModerationActionKind;
    const type = a.targetType as ReportTargetType;
    const summary = actionSummary(kind, type, a.policyRef, a.expiresAt);

    if (kind === 'restore') {
      const href =
        type === 'member'
          ? '/feed'
          : ((await this.targets.previews([{ type, id: a.targetId }])).get(`${type}:${a.targetId}`)?.href ?? '/feed');
      await this.notify.notify({
        userId: a.targetUserId,
        type: 'moderation_action',
        objectType: 'moderation_action',
        objectId: a.id,
        segments: [{ text: summary, strong: false }],
        href,
        icon: 'shield',
        dedupeKey: `moderation_action:${a.id}`,
      });
      return;
    }
    if (!MEMBER_FACING_ACTIONS.includes(kind)) return;

    const policy = policyLabel(a.policyRef);
    const appealText = `If you think we got this wrong, you can appeal once within ${APPEAL_WINDOW_DAYS} days.`;
    await this.notify.notify({
      userId: a.targetUserId,
      type: 'moderation_action',
      objectType: 'moderation_action',
      objectId: a.id,
      segments: [
        { text: summary, strong: true },
        { text: ` ${appealText}`, strong: false },
      ],
      href: `/appeals/${a.id}`,
      icon: 'shield',
      dedupeKey: `moderation_action:${a.id}`,
      email: {
        subject:
          kind === 'suspend'
            ? 'Your Charter Mission account has been suspended'
            : 'A moderator reviewed your activity on Charter Mission',
        heading: 'A note from the Charter Mission moderators',
        paragraphs: [summary, ...(policy ? [`Policy: Community Guidelines — ${policy}.`] : []), appealText],
        buttonLabel: 'Review and appeal',
      },
    });
  }

  async onReportResolved(reportId: string, outcome: 'actioned' | 'dismissed') {
    const [r] = await this.db
      .select({ reporterId: contentReports.reporterId })
      .from(contentReports)
      .where(eq(contentReports.id, reportId))
      .limit(1);
    if (!r) return;
    await this.notify.notify({
      userId: r.reporterId,
      type: 'report_outcome',
      objectType: 'report',
      objectId: reportId,
      segments: [{ text: reportOutcomeText(outcome), strong: false }],
      href: MY_REPORTS_HREF,
      icon: 'flag',
      dedupeKey: `report_outcome:${reportId}`,
    });
  }

  async onAppealDecided(appealId: string) {
    const [row] = await this.db
      .select({ appeal: appeals, action: moderationActions })
      .from(appeals)
      .innerJoin(moderationActions, eq(moderationActions.id, appeals.actionId))
      .where(eq(appeals.id, appealId))
      .limit(1);
    if (!row) return;
    const overturned = row.appeal.status === 'overturned';
    const text = overturned
      ? 'We reviewed your appeal and reversed our decision. Any restriction has been lifted and hidden content restored.'
      : 'We reviewed your appeal and our original decision stands. Appeal decisions are final.';
    await this.notify.notify({
      userId: row.appeal.appellantId,
      type: 'appeal_outcome',
      objectType: 'appeal',
      objectId: appealId,
      segments: [{ text, strong: false }],
      href: `/appeals/${row.action.id}`,
      icon: 'shield',
      dedupeKey: `appeal_outcome:${appealId}`,
      email: {
        subject: overturned ? 'Your appeal was successful' : 'The outcome of your appeal',
        heading: 'Your appeal has been reviewed',
        paragraphs: [text, 'A different moderator from the one who took the original action reviewed it.'],
        buttonLabel: 'View details',
      },
    });
  }
}
