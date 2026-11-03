import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { and, desc, eq, gte, isNull, like, lt, type SQL } from 'drizzle-orm';
import type {
  AuditEntry,
  AuditExportQuery,
  AuditQuery,
  MemberRef,
  ModerationActionKind,
  Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { auditLog } from '../db/schema.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { ACTION_PAST } from '../moderation/copy.js';
import { isUuid, likePrefix } from '../moderation/util.js';

type AuditRow = Pick<
  typeof auditLog.$inferSelect,
  'id' | 'actorId' | 'action' | 'targetType' | 'targetId' | 'ipHash' | 'createdAt'
>;

const short = (id: string) => (isUuid(id) ? id.slice(0, 8) : id);

/** Human label for an audit target; members by @handle when known. */
function targetLabel(type: string | null, id: string | null, refs: Map<string, MemberRef>): string {
  if (!type || !id) return '';
  switch (type) {
    case 'member': {
      const ref = refs.get(id);
      return ref ? `member @${ref.handle}` : `member ${short(id)}`;
    }
    case 'user': {
      const ref = refs.get(id);
      return ref ? `@${ref.handle}` : `account ${short(id)}`;
    }
    case 'hashtag':
      return `#${id}`;
    case 'setting':
      return `setting ${id}`;
    default:
      return `${type.replace(/_/g, ' ')} ${short(id)}`;
  }
}

const MEMBER_PAST: Record<string, string> = {
  warn: 'Warned',
  restrict_posting: 'Restricted posting for',
  restrict_connecting: 'Restricted connecting for',
  suspend: 'Suspended',
};

/** Area names for the generic fallback, e.g. "profile.updated" → "Profile: updated". */
const AREA_LABELS: Record<string, string> = {
  auth: 'Sign-in',
  account: 'Account',
  member: 'Member',
  profile: 'Profile',
  privacy: 'Privacy',
  connection: 'Connection',
  upload: 'Upload',
  post: 'Post',
  comment: 'Comment',
  report: 'Report',
  appeal: 'Appeal',
  moderation: 'Moderation',
  trending: 'Trending',
  audit: 'Audit log',
};

/**
 * Summary text derived from action, actor and target only; before/after payloads are never shown here.
 * Self-service actions (actor is the target account) read without the target, e.g. "Signed in".
 */
export function auditSummary(
  row: Pick<AuditRow, 'action' | 'targetType' | 'targetId'> & { actorId?: string | null },
  refs: Map<string, MemberRef> = new Map(),
) {
  const target = targetLabel(row.targetType, row.targetId, refs);
  const [area, verb] = [row.action.split('.')[0]!, row.action.split('.').slice(1).join('.')];
  if (area === 'moderation' && verb in ACTION_PAST) {
    const past =
      row.targetType === 'member'
        ? (MEMBER_PAST[verb] ?? ACTION_PAST[verb as ModerationActionKind])
        : ACTION_PAST[verb as ModerationActionKind];
    return `${past} ${target}`.trim();
  }
  const self = !!row.actorId && row.targetType === 'user' && row.targetId === row.actorId;
  /** "Did X" for self-service, "Did X for @handle" when someone else's account was the target. */
  const forTarget = (text: string) => (self || !target ? text : `${text} for ${target}`);
  const known: Record<string, string> = {
    'report.created': `Reported ${target}`,
    'report.assigned': `Took the reports on ${target}`,
    'report.unassigned': `Released the reports on ${target}`,
    'appeal.created': `Appealed ${target}`,
    'appeal.decided': `Decided ${target}`,
    'moderation.restriction_expired': `Restriction ended for ${target}`,
    'moderation.suspension_expired': `Suspension ended for ${target}`,
    'trending.pin': `Pinned ${target} in trending`,
    'trending.suppress': `Suppressed ${target} in trending`,
    'trending.unpin': `Unpinned ${target}`,
    'trending.unsuppress': `Restored ${target} to trending`,
    'trending.override.expired': `Trending override ${short(row.targetId ?? '')} expired`,
    'trending.rules.updated': 'Updated the trending rules',
    'audit.exported': 'Exported the audit log',
    // Sign-in and account security
    'auth.register': forTarget('Created an account'),
    'auth.register.existing_email': `Sign-up attempted with the email of ${target || 'an existing account'}`,
    'auth.email_verified': forTarget('Verified their email address'),
    'auth.login.success': forTarget('Signed in'),
    'auth.login.failure': target ? `Failed sign-in for ${target}` : 'Failed sign-in for an unknown email',
    'auth.logout': 'Signed out',
    'auth.password.reset': forTarget('Reset their password'),
    'account.password_changed': forTarget('Changed their password'),
    'auth.mfa.setup_started': forTarget('Started two-factor setup'),
    'auth.mfa.enabled': forTarget('Turned on two-factor authentication'),
    'auth.mfa.disabled': forTarget('Turned off two-factor authentication'),
    'auth.mfa.verified': 'Verified a two-factor code',
    'auth.mfa.failure': forTarget('Entered a wrong two-factor code'),
    'account.policies_accepted': forTarget('Accepted the terms and privacy policy'),
    'account.consent_updated': forTarget('Updated their consent choices'),
    'account.session_revoked': 'Signed out another session',
    'account.sessions_revoked': 'Signed out all other sessions',
    'account.deactivated': forTarget('Deactivated their account'),
    'account.reactivated': forTarget('Reactivated their account'),
    'account.deletion_requested': 'Requested account deletion',
    // Profile, privacy and connections
    'profile.updated': forTarget('Updated their profile'),
    'privacy.updated': forTarget('Changed their privacy settings'),
    'account.privacy_updated': forTarget('Changed their privacy settings'),
    'connection.requested': `Sent a connection request to ${target}`,
    'connection.accepted': `Accepted a connection with ${target}`,
    'connection.declined': `Declined a connection request from ${target}`,
    'connection.removed': `Removed the connection with ${target}`,
    'member.block': `Blocked ${target}`,
    'member.unblock': `Unblocked ${target}`,
    // Content and uploads
    'post.announce': `Published an announcement (${target})`,
    'post.delete': `Deleted ${target}`,
    'comment.delete': `Deleted ${target}`,
    'upload.infected': `Blocked an infected upload (${target})`,
    'upload.rejected': `Rejected an upload (${target})`,
  };
  if (known[row.action]) return known[row.action]!;
  const words = verb.replace(/[._]/g, ' ').trim();
  const label = AREA_LABELS[area] ?? area.charAt(0).toUpperCase() + area.slice(1);
  return `${label}${words ? `: ${words}` : ''}${target ? ` · ${target}` : ''}`;
}

const CSV_COLUMNS = [
  'id',
  'created_at',
  'actor_id',
  'actor_handle',
  'action',
  'target_type',
  'target_id',
  'summary',
  'ip_hash',
];

/** RFC 4180 quoting, plus a leading apostrophe on values a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Append-only audit log viewer and CSV export (CM-ADM-09). */
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Filters: actor by id, @handle or "system"; action prefix (e.g. "moderation."); exact target type;
   * created_at in [from, to).
   */
  private async filters(q: AuditExportQuery): Promise<SQL[] | null> {
    const conds: SQL[] = [];
    if (q.actor) {
      const actor = q.actor.trim();
      if (actor === 'system') conds.push(isNull(auditLog.actorId));
      else if (isUuid(actor)) conds.push(eq(auditLog.actorId, actor));
      else {
        const handle = actor.replace(/^@/, '').toLowerCase();
        const id = (await this.members.idsForHandles([handle])).get(handle);
        if (!id) return null;
        conds.push(eq(auditLog.actorId, id));
      }
    }
    if (q.action) conds.push(like(auditLog.action, likePrefix(q.action.trim())));
    if (q.targetType) conds.push(eq(auditLog.targetType, q.targetType.trim()));
    if (q.from) conds.push(gte(auditLog.createdAt, new Date(q.from)));
    if (q.to) conds.push(lt(auditLog.createdAt, new Date(q.to)));
    return conds;
  }

  private async rows(conds: SQL[], beforeId: number | null, limit: number): Promise<AuditRow[]> {
    return this.db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        ipHash: auditLog.ipHash,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(...conds, beforeId !== null ? lt(auditLog.id, beforeId) : undefined))
      .orderBy(desc(auditLog.id))
      .limit(limit);
  }

  private async refsFor(rows: AuditRow[]) {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.actorId) ids.add(r.actorId);
      if ((r.targetType === 'member' || r.targetType === 'user') && r.targetId && isUuid(r.targetId)) ids.add(r.targetId);
    }
    return this.members.refs(ids);
  }

  async list(q: AuditQuery): Promise<Page<AuditEntry>> {
    const conds = await this.filters(q);
    if (!conds) return { items: [], nextCursor: null };
    const cur = decodeCursor<{ id: number }>(q.cursor);
    const rows = await this.rows(conds, cur ? Number(cur.id) : null, q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ id: r.id }));
    const refs = await this.refsFor(page.items);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((r) => ({
        id: String(r.id),
        actor: r.actorId ? (refs.get(r.actorId) ?? null) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: auditSummary(r, refs),
        createdAt: r.createdAt.toISOString(),
        ipHash: r.ipHash,
      })),
    };
  }

  /** Streams the filtered log as CSV in pages of 500. Before/after payloads are never exported. */
  async exportCsv(ctx: AuthContext, q: AuditExportQuery, res: Response, ip?: string) {
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'audit.exported',
      targetType: 'audit_log',
      after: {
        filters: {
          actor: q.actor ?? null,
          action: q.action ?? null,
          targetType: q.targetType ?? null,
          from: q.from ?? null,
          to: q.to ?? null,
        },
      },
      ip,
    });
    const conds = await this.filters(q);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    await this.write(res, `${CSV_COLUMNS.join(',')}\r\n`);
    let beforeId: number | null = null;
    while (conds) {
      const rows = await this.rows(conds, beforeId, 500);
      if (rows.length === 0) break;
      const refs = await this.refsFor(rows);
      const chunk = rows
        .map((r) =>
          [
            r.id,
            r.createdAt.toISOString(),
            r.actorId,
            r.actorId ? (refs.get(r.actorId)?.handle ?? '') : 'system',
            r.action,
            r.targetType,
            r.targetId,
            auditSummary(r, refs),
            r.ipHash,
          ]
            .map(csvCell)
            .join(','),
        )
        .join('\r\n');
      await this.write(res, `${chunk}\r\n`);
      beforeId = rows[rows.length - 1]!.id;
      if (rows.length < 500) break;
    }
    res.end();
  }

  private write(res: Response, chunk: string): Promise<void> {
    return new Promise((resolve) => {
      if (res.write(chunk)) resolve();
      else res.once('drain', () => resolve());
    });
  }
}
