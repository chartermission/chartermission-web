import {
  POLICY_REF_LABELS,
  type ModerationActionKind,
  type MyReportStatus,
  type PolicyRef,
  type ReportReason,
  type ReportTargetType,
} from '@chartermission/contracts';

/*
 * Member-facing wording for reports, actions and appeals. Always general terms:
 * reporters never learn what happened to the other member, and affected members
 * never learn who reported them (spec 4.15, 8.5).
 */

const NOUN: Record<ReportTargetType, string> = {
  post: 'post',
  comment: 'comment',
  member: 'profile',
  hashtag: 'topic',
};

const date = (d: Date) => d.toISOString().slice(0, 10);

/** What the reporter sees straight after reporting (spec 8.5: each report shows what happens next). */
export function reportNextSteps(reason: ReportReason, targetType: ReportTargetType): string {
  const parts = [
    'Thanks for telling us. A moderator will review this against our Community Guidelines, most urgent reports first.',
    'We’ll let you know when we’ve made a decision. To protect everyone’s privacy we won’t share details of any action taken, and we never tell the other person who reported them.',
  ];
  if (targetType === 'member' || targetType === 'post' || targetType === 'comment') {
    parts.push(
      'If you don’t want to see this person’s content in the meantime, you can block them from their profile.',
    );
  }
  if (reason === 'self_harm' || reason === 'violence') {
    parts.push('If someone is in immediate danger, contact your local emergency services now.');
  }
  return parts.join(' ');
}

export function myReportStatus(status: string): { status: MyReportStatus; summary: string } {
  switch (status) {
    case 'open':
      return { status: 'received', summary: 'We’ve received your report and it’s waiting for review.' };
    case 'in_review':
      return { status: 'in_review', summary: 'A moderator is reviewing your report.' };
    case 'actioned':
    case 'appealed':
    case 'upheld':
      return {
        status: 'action_taken',
        summary: 'We reviewed your report and took action. Thanks for helping keep the community safe.',
      };
    default:
      return {
        status: 'no_action',
        summary: 'We reviewed your report and found it didn’t break our Community Guidelines.',
      };
  }
}

export function reportOutcomeText(outcome: 'actioned' | 'dismissed'): string {
  return outcome === 'actioned'
    ? 'We reviewed your report and took action. Thanks for helping keep Charter Mission safe.'
    : 'We reviewed your report and found it didn’t break our Community Guidelines. Thanks for letting us know.';
}

export function policyLabel(ref: string | null | undefined): string | null {
  return ref && ref in POLICY_REF_LABELS ? POLICY_REF_LABELS[ref as PolicyRef] : null;
}

/** One-sentence explanation of an action, written to the affected member. */
export function actionSummary(
  action: ModerationActionKind,
  targetType: ReportTargetType,
  policyRef: string | null,
  expiresAt: Date | null,
): string {
  const noun = NOUN[targetType];
  const policy = policyLabel(policyRef);
  const because = policy
    ? ` because it goes against our Community Guidelines (${policy})`
    : ' because it goes against our Community Guidelines';
  const conduct = policy ? ` under our Community Guidelines (${policy})` : ' under our Community Guidelines';
  switch (action) {
    case 'hide':
      return `We hid your ${noun}${because}. Other members can no longer see it.`;
    case 'remove':
      return `We removed your ${noun}${because}.`;
    case 'warn':
      return targetType === 'member'
        ? `We’ve sent you a warning about your activity${conduct}.`
        : `We’ve sent you a warning about your ${noun}${conduct}. It stays visible.`;
    case 'restrict_posting':
      return `You can’t post, comment or react until ${expiresAt ? date(expiresAt) : 'further notice'}${conduct}.`;
    case 'restrict_connecting':
      return `You can’t send connection requests until ${expiresAt ? date(expiresAt) : 'further notice'}${conduct}.`;
    case 'suspend':
      return expiresAt
        ? `Your account is suspended until ${date(expiresAt)}${conduct}.`
        : `Your account is suspended${conduct} until further review.`;
    case 'restore':
      return `We reviewed your ${noun} again and restored it. It’s visible to members.`;
    default:
      return 'A moderator reviewed your content.';
  }
}

/** Actions the affected member is told about and can appeal (dismiss, escalate and restore are not). */
export const MEMBER_FACING_ACTIONS: ModerationActionKind[] = [
  'hide',
  'remove',
  'warn',
  'restrict_posting',
  'restrict_connecting',
  'suspend',
];

export const ACTION_PAST: Record<ModerationActionKind, string> = {
  hide: 'Hid',
  remove: 'Removed',
  warn: 'Warned the author of',
  restrict_posting: 'Restricted posting for the author of',
  restrict_connecting: 'Restricted connecting for the author of',
  suspend: 'Suspended the author of',
  escalate: 'Escalated',
  dismiss: 'Dismissed reports on',
  restore: 'Restored',
};
