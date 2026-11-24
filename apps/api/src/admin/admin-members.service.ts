import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  MEMBERS_EXPORT_MAX,
  type AdminMemberGroup,
  type AdminMemberOverview,
  type AdminMembersBulkInput,
  type AdminMembersExportInput,
  type AdminMembersExportQuery,
  type AdminMembersFilters,
  type AdminMembersSort,
  type BulkResult,
} from '@chartermission/contracts';
import type {
  AdminAssignableRole,
  AdminSetRoleInput,
  AdminAwardBadgeInput,
  AdminBadge,
  AdminBadgeInput,
  AdminBadgeUpdateInput,
  AdminMemberCounts,
  AdminMemberRow,
  AdminMembersPage,
  AdminMembersQuery,
  BadgeTone,
  McpActivityQuery,
  McpActivityView,
  Ok,
  Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  auditLog,
  badges,
  chapters,
  connections,
  contentReports,
  featuredMembers,
  follows,
  groupMembers,
  groups,
  mcpAccessGrants,
  memberBadges,
  memberProfiles,
  mfaDevices,
  posts,
  profileInterests,
  profileLanguages,
  profileSectors,
  profileSkills,
  referrals,
  roles,
  sessions,
  userRoles,
  users,
} from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { runEach } from '../common/bulk.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { auditSummary, csvCell } from './admin-audit.service.js';
import { SessionService } from '../core/session.service.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { closeStaffConnections } from '../profiles/staff-connections.js';
import { Errors } from '../common/errors.js';
import { MailService } from '../infra/mail.service.js';
import { adminUrl, webUrl } from '../infra/mail-layout.js';
import { PRIVILEGED_ROLES, ROLES, mustUseMfa } from '../core/permissions.js';
import { can } from '../core/policy.js';
import {
  DAY_MS,
  isUniqueViolation,
  isUuid,
  likePrefix,
  tsKey,
  uuidOr404,
} from '../moderation/util.js';
import { mcpAccessSql, mcpConnectionsSql } from '../oauth/mcp-access.js';
import { OAuthService } from '../oauth/oauth.service.js';
import { McpActivityService } from '../oauth/mcp-activity.service.js';

type BadgeRow = typeof badges.$inferSelect;

/** Accounts the Members page lists and counts: every account except deleted ones. */
const LISTED = ne(users.status, 'deleted');
/** Suggested to new members at sign-up. */
const FEATURED = sql`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`;
/** Claude access: given by an admin, or staff (who have it without a grant). */
const CLAUDE_ACCESS = sql`(${users.isStaff} or exists (select 1 from ${mcpAccessGrants} mag where mag.user_id = ${users.id}))`;

/**
 * Chapters a member belongs to: those they follow, and those they hold a role in (Chapter Lead,
 * Ambassador; user_roles scoped to the chapter). Chapter ids as text.
 */
const chapterIdsOf = (userId: SQL | string) =>
  sql`select f.target_id from ${follows} f where f.follower_id = ${userId} and f.target_type = 'chapter'
      union select ur.scope_id from ${userRoles} ur where ur.user_id = ${userId} and ur.scope_type = 'chapter' and ur.revoked_at is null`;
/** In the chapter: follows it or holds a role in it (both lookups use the tables' keys). */
const inChapter = (chapterId: string) =>
  sql`(exists (select 1 from ${follows} f where f.follower_id = ${users.id} and f.target_type = 'chapter' and f.target_id = ${chapterId})
      or exists (select 1 from ${userRoles} ur where ur.user_id = ${users.id} and ur.scope_type = 'chapter' and ur.scope_id = ${chapterId} and ur.revoked_at is null))`;
/** Reports still waiting for a decision. */
const OPEN_REPORT = ['open', 'in_review'];

/** Start of a YYYY-MM-DD day in UTC. */
function utcDay(day: string, field: string): Date {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) throw Errors.validation({ [field]: 'Use a real date (YYYY-MM-DD)' });
  return d;
}

const MEMBER_CSV_COLUMNS = ['name', 'handle', 'email', 'country', 'status', 'joined', 'email_confirmed', 'verified', 'roles', 'badges', 'two_step'];

/** The filters an export used, for its audit entry (only those that were set). */
function exportedFilters(q: AdminMembersFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter(([k, v]) => v !== undefined && v !== '' && !(k === 'filter' && v === 'all'))) as Record<string, string>;
}

function write(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

const slugify = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Admin console: the badge catalogue and per-member controls (verified tick, badges, featured suggestion). */
@Injectable()
export class AdminMembersService {
  private readonly log = new Logger(AdminMembersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly oauth: OAuthService,
    private readonly mcpActivity: McpActivityService,
    private readonly memberRefs: MembersService,
  ) {}

  /* ------------------------------ Two-step verification ------------------------------ */

  /**
   * POST /admin/members/{id}/two-step/reset (Super Admins). For someone who has lost every device:
   * all their devices are removed, two-step verification is switched off and they are signed out
   * everywhere. Team members must set it up again at their next sign-in; for anyone else it stays
   * off until they turn it back on. Nobody resets their own. Audited, and the account owner is emailed.
   */
  async resetTwoStep(ctx: AuthContext, rawId: string, ip?: string): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.id === ctx.user.id) throw Errors.forbidden('You can’t reset your own two-step verification. Ask another Super Admin.');
    if (before.status === 'deleted' || before.status === 'deletion_pending') throw Errors.conflict('This account is closed or being deleted');
    const removed = await this.db.transaction(async (tx) => {
      // The account's row is locked first, as MfaService does for every device change, so a request of
      // theirs that is mid-flight can't put a device back after this.
      const [had] = await tx.select({ secret: users.mfaSecretEnc, enabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, before.id)).for('update');
      const gone = await tx.delete(mfaDevices).where(eq(mfaDevices.userId, before.id)).returning({ id: mfaDevices.id });
      if (!gone.length && !had?.secret && !had?.enabledAt) return null;
      await tx.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null, updatedAt: new Date() }).where(eq(users.id, before.id));
      return gone.length;
    });
    if (removed === null) throw Errors.conflict('Two-step verification isn’t set up on this account');
    await this.sessions.revokeAll(before.id);
    await this.limits.reset(`mfa:fail:${before.id}`);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'auth.mfa.reset',
      targetType: 'user',
      targetId: before.id,
      before: { twoStep: before.twoStep, devices: removed },
      after: { twoStep: false, devices: 0 },
      ip,
    });
    const mustSetUp = mustUseMfa({ isStaff: before.staff, roles: before.roles });
    await this.mail
      .compose({
        to: before.email,
        userId: before.id,
        template: 'security.mfa_reset',
        subject: 'Two-step verification was reset on your account',
        transactional: true,
        heading: 'Two-step verification was reset',
        paragraphs: [
          'A Charter Mission administrator reset two-step verification on your account. Your authenticator devices were removed and you have been signed out everywhere.',
          mustSetUp
            ? 'The next time you sign in, you will be asked to set up an authenticator app again.'
            : 'Two-step verification is now off. You can turn it on again in your security settings.',
          'If you didn’t ask for this, contact the Charter Mission team straight away and change your password.',
        ],
        button: { label: 'Sign in', url: webUrl('/signin') },
        footer: 'You received this email because of activity on your Charter Mission account.',
      })
      .catch(() => undefined);
    return this.row(before.id);
  }

  /* ------------------------------ Roles ------------------------------ */

  /**
   * PUT /admin/members/{id}/roles. Gives or takes away a platform-wide role. Only Super Admins can
   * give or take away Super Admin; nobody changes their own roles; the last Super Admin stays.
   * Console roles mark the account as team (staff) and need two-step verification at sign-in.
   */
  async setRole(
    ctx: AuthContext,
    rawId: string,
    input: AdminSetRoleInput,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.id === ctx.user.id)
      throw Errors.forbidden('You can’t change your own roles');
    if (input.role === 'super_admin' && !can(ctx.user, 'superadmin.assign'))
      throw Errors.forbidden(
        'Only a Super Admin can give or take away Super Admin',
      );
    if (before.status === 'deleted' || before.status === 'deletion_pending')
      throw Errors.conflict('This account is closed or being deleted');
    const held = before.roles.includes(input.role);
    if (held === input.granted) return before;

    const [role] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, input.role))
      .limit(1);
    if (!role) throw Errors.notFound('That role');
    await this.db.transaction(async (tx) => {
      if (input.granted) {
        await tx
          .insert(userRoles)
          .values({
            userId: before.id,
            roleId: role.id,
            grantedBy: ctx.user.id,
          });
      } else {
        if (input.role === 'super_admin') {
          const [{ n }] = await tx
            .select({
              n: sql<number>`count(distinct ${userRoles.userId})::int`,
            })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(eq(roles.key, 'super_admin'), isNull(userRoles.revokedAt)),
            );
          if (n <= 1)
            throw Errors.conflict(
              'This is the last Super Admin. Make someone else a Super Admin first.',
            );
        }
        await tx
          .update(userRoles)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(userRoles.userId, before.id),
              eq(userRoles.roleId, role.id),
              isNull(userRoles.scopeType),
              isNull(userRoles.revokedAt),
            ),
          );
      }
      // Team flag: on while they hold any console role.
      const remaining = input.granted
        ? [...before.roles, input.role]
        : before.roles.filter((r) => r !== input.role);
      const staff = remaining.some((r) => PRIVILEGED_ROLES.includes(r));
      if (staff !== before.staff)
        await tx
          .update(users)
          .set({ isStaff: staff, updatedAt: new Date() })
          .where(eq(users.id, before.id));
    });
    await this.audit.record({
      actorId: ctx.user.id,
      action: `role.${input.granted ? 'granted' : 'revoked'}.${input.role}`,
      targetType: 'user',
      targetId: before.id,
      before: { role: input.role, held },
      after: { role: input.role, held: input.granted },
      ip,
    });
    if (input.granted && PRIVILEGED_ROLES.includes(input.role)) {
      const name = ROLES[input.role]?.name ?? input.role;
      await this.mail
        .compose({
          to: before.email,
          userId: before.id,
          template: 'admin.role_granted',
          subject: `You now have ${name} access to Charter Mission`,
          transactional: true,
          heading: `You are now a ${name} on Charter Mission`,
          paragraphs: [
            `A Charter Mission administrator gave your account ${name} access to the admin console.`,
            'Sign in with your usual email and password. The first time, you will be asked to set up an authenticator app for two-step verification.',
          ],
          button: { label: 'Open the admin console', url: adminUrl('/signin') },
          footer:
            'You received this email because a Charter Mission administrator changed your access.',
        })
        .catch(() => undefined);
    }
    return this.row(before.id);
  }

  /* ------------------------------ Badge catalogue ------------------------------ */

  /** GET /admin/badges */
  async badges(): Promise<AdminBadge[]> {
    const holders = sql<number>`(select count(*)::int from ${memberBadges} mb where mb.badge_id = ${badges.id})`;
    const rows = await this.db
      .select({ badge: badges, holders })
      .from(badges)
      .orderBy(asc(badges.position), asc(badges.name));
    return rows.map(({ badge, holders }) => this.badgeView(badge, holders));
  }

  /** POST /admin/badges */
  async createBadge(
    ctx: AuthContext,
    input: AdminBadgeInput,
    ip?: string,
  ): Promise<AdminBadge> {
    const base = slugify(input.name) || 'badge';
    const [{ next } = { next: 0 }] = await this.db
      .select({
        next: sql<number>`coalesce(max(${badges.position}) + 1, 0)::int`,
      })
      .from(badges);
    for (let n = 1; n < 20; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        const [row] = await this.db
          .insert(badges)
          .values({ ...input, slug, position: next })
          .returning();
        await this.audit.record({
          actorId: ctx.user.id,
          action: 'badge.created',
          targetType: 'badge',
          targetId: row!.id,
          after: input,
          ip,
        });
        return this.badgeView(row!, 0);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw Errors.conflict('Choose a different badge name.');
  }

  /** PATCH /admin/badges/{id} */
  async updateBadge(
    ctx: AuthContext,
    rawId: string,
    input: AdminBadgeUpdateInput,
    ip?: string,
  ): Promise<AdminBadge> {
    const id = uuidOr404(rawId, 'That badge');
    const [before] = await this.db
      .select()
      .from(badges)
      .where(eq(badges.id, id))
      .limit(1);
    if (!before) throw Errors.notFound('That badge');
    const [row] = await this.db
      .update(badges)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(badges.id, id))
      .returning();
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'badge.updated',
      targetType: 'badge',
      targetId: id,
      before,
      after: input,
      ip,
    });
    return (await this.badges()).find((b) => b.id === row!.id)!;
  }

  /** DELETE /admin/badges/{id}: also takes the badge off every member who holds it. */
  async removeBadge(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = uuidOr404(rawId, 'That badge');
    const [before] = await this.db
      .select()
      .from(badges)
      .where(eq(badges.id, id))
      .limit(1);
    if (!before) throw Errors.notFound('That badge');
    await this.db.delete(badges).where(eq(badges.id, id));
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'badge.removed',
      targetType: 'badge',
      targetId: id,
      before,
      ip,
    });
    return { ok: true };
  }

  private badgeView(b: BadgeRow, holders: number): AdminBadge {
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      tone: b.tone as BadgeTone,
      icon: b.icon,
      status: b.status as AdminBadge['status'],
      position: b.position,
      holders,
    };
  }

  /* ---------------------------------- Members ---------------------------------- */

  /**
   * GET /admin/members: search by name, handle or email, narrowed by the page's filters, in keyset
   * pages (sort key + id). The first page (no cursor) also carries `total` (matching everything
   * asked) and `counts` (per quick filter, ignoring the search and the other filters).
   */
  async list(q: AdminMembersQuery): Promise<AdminMembersPage> {
    const conds = await this.memberConds(q);
    const first = !q.cursor;
    const narrowed = !!q.q || conds.length > 1;
    const [page, counts, matching] = await Promise.all([
      this.pageOfIds(conds, q.sort, q.limit, q.cursor),
      first ? this.counts() : null,
      // "All" without a search or filters is counts.all: no second count.
      first && narrowed ? this.countWhere(and(...conds)!) : null,
    ]);
    return {
      items: await this.rows(page.ids),
      nextCursor: page.nextCursor,
      total: first ? (matching ?? counts!.all) : null,
      counts,
    };
  }

  /** The WHERE conditions for the Members page's search and filters (index-friendly: equality and exists on keyed tables). */
  private async memberConds(q: AdminMembersFilters): Promise<SQL[]> {
    const conds: SQL[] = [LISTED];
    if (q.q) {
      const term = `%${likePrefix(q.q.replace(/^@/, '')).slice(0, -1)}%`;
      conds.push(or(ilike(memberProfiles.displayName, term), ilike(memberProfiles.handle, term), ilike(users.email, term))!);
    }
    if (q.filter === 'verified') conds.push(isNotNull(users.verifiedAt));
    if (q.filter === 'unverified') conds.push(isNull(users.verifiedAt));
    if (q.filter === 'featured') conds.push(FEATURED);
    // Claude access: given by an admin, or staff (who have it without a grant).
    if (q.filter === 'claude') conds.push(CLAUDE_ACCESS);
    if (q.filter === 'badge') {
      if (!q.badge) throw Errors.validation({ badge: 'Choose a badge' });
      conds.push(
        sql`exists (select 1 from ${memberBadges} mb join ${badges} b on b.id = mb.badge_id where mb.user_id = ${users.id} and b.slug = ${q.badge})`,
      );
    }
    if (q.country) conds.push(eq(memberProfiles.countryCode, q.country));
    if (q.chapter) conds.push(inChapter(q.chapter));
    if (q.status) conds.push(eq(users.status, q.status));
    if (q.role === 'team') conds.push(eq(users.isStaff, true));
    else if (q.role === 'official') conds.push(eq(users.isOfficial, true));
    else if (q.role)
      conds.push(
        sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and ur.revoked_at is null and ur.scope_type is null and r.key = ${q.role})`,
      );
    if (q.joinedFrom && q.joinedTo && q.joinedFrom > q.joinedTo)
      throw Errors.validation({ joinedTo: 'The end date must be on or after the start date' });
    if (q.joinedFrom) conds.push(gte(users.createdAt, utcDay(q.joinedFrom, 'joinedFrom')));
    if (q.joinedTo) conds.push(lt(users.createdAt, new Date(utcDay(q.joinedTo, 'joinedTo').getTime() + DAY_MS)));
    if (q.emailVerified) conds.push(q.emailVerified === 'yes' ? isNotNull(users.emailVerifiedAt) : isNull(users.emailVerifiedAt));
    if (q.twoStep) conds.push(q.twoStep === 'on' ? isNotNull(users.mfaEnabledAt) : isNull(users.mfaEnabledAt));
    if (q.photo) conds.push(q.photo === 'yes' ? isNotNull(memberProfiles.avatarFileId) : isNull(memberProfiles.avatarFileId));
    if (q.referred) {
      const referred = sql`exists (select 1 from ${referrals} rf where rf.invitee_id = ${users.id})`;
      conds.push(q.referred === 'yes' ? referred : sql`not ${referred}`);
    }
    const option = (table: typeof profileSkills, itemId: string | undefined) => {
      if (itemId) conds.push(sql`exists (select 1 from ${table} po where po.user_id = ${users.id} and po.item_id = ${itemId})`);
    };
    option(profileSkills, q.skill);
    option(profileSectors, q.sector);
    option(profileInterests, q.interest);
    option(profileLanguages, q.language);
    return conds;
  }

  /**
   * One keyset page of member ids. The cursor holds the sort, the last row's sort key (a
   * microsecond-exact timestamp, or the name) and its id, so new sign-ups never shift a page.
   */
  private async pageOfIds(
    conds: SQL[],
    sort: AdminMembersSort,
    limit: number,
    cursor?: string,
  ): Promise<{ ids: string[]; nextCursor: string | null }> {
    const where = [...conds];
    const after = decodeCursor<{ s: string; k: string; id: string }>(cursor);
    if (after) {
      if (after.s !== sort || typeof after.k !== 'string' || !isUuid(after.id)) throw Errors.badRequest('Invalid cursor');
      if (sort === 'name') where.push(sql`(${memberProfiles.displayName}, ${users.id}) > (${after.k}, ${after.id}::uuid)`);
      else if (sort === 'oldest') where.push(sql`(${users.createdAt}, ${users.id}) > (${after.k}::timestamptz, ${after.id}::uuid)`);
      else where.push(sql`(${users.createdAt}, ${users.id}) < (${after.k}::timestamptz, ${after.id}::uuid)`);
    }
    const order =
      sort === 'name'
        ? [asc(memberProfiles.displayName), asc(users.id)]
        : sort === 'oldest'
          ? [asc(users.createdAt), asc(users.id)]
          : [desc(users.createdAt), desc(users.id)];
    const rows = await this.db
      .select({ id: users.id, key: sort === 'name' ? memberProfiles.displayName : tsKey(users.createdAt) })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(...where))
      .orderBy(...order)
      .limit(limit + 1);
    const page = paginate(rows, limit, (last) => ({ s: sort, k: last.key, id: last.id }));
    return { ids: page.items.map((r) => r.id), nextCursor: page.nextCursor };
  }

  /** Members per filter of the Members page (the search left aside). */
  private async counts(): Promise<AdminMemberCounts> {
    const [row] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${users.verifiedAt} is not null)::int`,
        featured: sql<number>`count(*) filter (where ${FEATURED})::int`,
        claude: sql<number>`count(*) filter (where ${CLAUDE_ACCESS})::int`,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(LISTED);
    const all = row?.all ?? 0;
    const verified = row?.verified ?? 0;
    return { all, verified, unverified: all - verified, featured: row?.featured ?? 0, claude: row?.claude ?? 0 };
  }

  private async countWhere(where: SQL): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(where);
    return row?.n ?? 0;
  }

  async row(rawId: string): Promise<AdminMemberRow> {
    const id = uuidOr404(rawId, 'That member');
    const [row] = await this.rows([id]);
    if (!row) throw Errors.notFound('That member');
    return row;
  }

  /* ------------------------------ Members: export ------------------------------ */

  /**
   * GET /admin/members/export.csv: the list's filters (or just the picked `ids`) as a CSV download,
   * in the list's order, at most MEMBERS_EXPORT_MAX rows. Streamed in pages; audited first.
   */
  async exportCsv(ctx: AuthContext, q: AdminMembersExportQuery, res: Response, ip?: string): Promise<void> {
    const { ids, ...filters } = q;
    return this.writeCsv(ctx, filters, ids, res, ip);
  }

  /** POST /admin/members/export.csv: just the picked members (a body, for picks too long for a link). */
  async exportPickedCsv(ctx: AuthContext, input: AdminMembersExportInput, res: Response, ip?: string): Promise<void> {
    return this.writeCsv(ctx, { filter: 'all', sort: input.sort }, input.ids, res, ip);
  }

  private async writeCsv(ctx: AuthContext, filters: AdminMembersFilters, ids: string[] | undefined, res: Response, ip?: string): Promise<void> {
    const conds = ids?.length ? [LISTED, inArray(users.id, ids)] : await this.memberConds(filters);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'members.exported',
      targetType: 'members',
      after: ids?.length ? { ids: ids.length } : { filters: exportedFilters(filters) },
      ip,
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    await write(res, `${MEMBER_CSV_COLUMNS.join(',')}\r\n`);
    let cursor: string | undefined;
    let written = 0;
    while (written < MEMBERS_EXPORT_MAX) {
      const page = await this.pageOfIds(conds, filters.sort, Math.min(500, MEMBERS_EXPORT_MAX - written), cursor);
      if (!page.ids.length) break;
      const rows = await this.rows(page.ids);
      const lines = rows.map((r) =>
        [
          r.name,
          r.handle,
          r.email,
          r.countryCode,
          r.status,
          r.joinedAt.slice(0, 10),
          r.emailVerified ? 'yes' : 'no',
          r.verified ? 'yes' : 'no',
          [...r.roles.map((role) => ROLES[role]?.name ?? role), ...(r.staff ? ['Team'] : []), ...(r.official ? ['Official account'] : [])].join('; '),
          r.badges.map((b) => b.name).join('; '),
          r.twoStep ? 'on' : 'off',
        ]
          .map(csvCell)
          .join(','),
      );
      await write(res, `${lines.join('\r\n')}\r\n`);
      written += rows.length;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    res.end();
  }

  /* ------------------------------ Members: bulk ------------------------------ */

  /**
   * POST /admin/members/bulk: one change to many members, each through the same method as the
   * single change (same rules, audit entries and emails). Failures are reported per id.
   */
  async bulk(ctx: AuthContext, input: AdminMembersBulkInput, ip?: string): Promise<BulkResult> {
    if (input.action === 'award_badge' || input.action === 'remove_badge') {
      const [badge] = await this.db.select({ id: badges.id, status: badges.status }).from(badges).where(eq(badges.id, input.badgeId!)).limit(1);
      if (!badge) throw Errors.notFound('That badge');
      if (input.action === 'award_badge' && badge.status !== 'active')
        throw Errors.validation({ badgeId: 'This badge is disabled. Turn it on before awarding it.' });
    }
    const change: Record<AdminMembersBulkInput['action'], (id: string) => Promise<unknown>> = {
      verify: (id) => this.setVerified(ctx, id, true, ip),
      unverify: (id) => this.setVerified(ctx, id, false, ip),
      feature: (id) => this.setFeatured(ctx, id, true, ip),
      unfeature: (id) => this.setFeatured(ctx, id, false, ip),
      award_badge: (id) => this.award(ctx, id, { badgeId: input.badgeId!, note: input.note }, ip),
      remove_badge: (id) => this.revoke(ctx, id, input.badgeId!, ip),
      claude_on: (id) => this.setMcpAccess(ctx, id, true, ip),
      claude_off: (id) => this.setMcpAccess(ctx, id, false, ip),
    };
    return runEach(input.ids, change[input.action], this.log);
  }

  /* ------------------------------ Members: detail panel ------------------------------ */

  /** GET /admin/members/{id}/overview: the member detail panel. */
  async overview(rawId: string): Promise<AdminMemberOverview> {
    const member = await this.row(rawId);
    const id = member.id;
    const [[profile], chapterRows, [counts], [inviter], invited, [invitedTotal], openReports, [reportTotal], auditRows] = await Promise.all([
      this.db.select({ city: memberProfiles.city }).from(memberProfiles).where(eq(memberProfiles.userId, id)).limit(1),
      this.db
        .select({ id: chapters.id, slug: chapters.slug, name: chapters.name })
        .from(chapters)
        .where(sql`${chapters.id}::text in (${chapterIdsOf(id)})`)
        .orderBy(asc(chapters.name)),
      this.db.execute<{ posts: number; connections: number; followers: number }>(sql`select
          (select count(*)::int from ${posts} p where p.author_id = ${id} and p.deleted_at is null) as posts,
          (select count(*)::int from ${connections} c where c.status = 'accepted' and (c.requester_id = ${id} or c.addressee_id = ${id})) as connections,
          (select count(*)::int from ${follows} f where f.target_type = 'member' and f.target_id = ${id}) as followers`).then((r) => r.rows),
      this.db.select({ inviterId: referrals.inviterId }).from(referrals).where(eq(referrals.inviteeId, id)).limit(1),
      this.db
        .select({ inviteeId: referrals.inviteeId })
        .from(referrals)
        .where(eq(referrals.inviterId, id))
        .orderBy(desc(referrals.createdAt))
        .limit(10),
      this.db.select({ n: sql<number>`count(*)::int` }).from(referrals).where(eq(referrals.inviterId, id)),
      this.db
        .select({
          id: contentReports.id,
          targetType: contentReports.targetType,
          reasonCode: contentReports.reasonCode,
          status: contentReports.status,
          createdAt: contentReports.createdAt,
        })
        .from(contentReports)
        .where(and(eq(contentReports.targetUserId, id), inArray(contentReports.status, OPEN_REPORT)))
        .orderBy(desc(contentReports.createdAt))
        .limit(5),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(contentReports)
        .where(and(eq(contentReports.targetUserId, id), inArray(contentReports.status, OPEN_REPORT))),
      this.db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          action: auditLog.action,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(and(inArray(auditLog.targetType, ['user', 'member']), eq(auditLog.targetId, id)))
        .orderBy(desc(auditLog.id))
        .limit(10),
    ]);
    const runs = and(eq(groupMembers.userId, id), eq(groupMembers.status, 'active'), inArray(groupMembers.role, ['owner', 'admin']), isNull(groups.deletedAt));
    const [groupRows, [groupTotal]] = await Promise.all([
      this.db
        .select({ id: groups.id, slug: groups.slug, name: groups.name, visibility: groups.visibility, role: groupMembers.role, memberCount: groups.memberCount, status: groups.status })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(runs)
        .orderBy(sql`case ${groupMembers.role} when 'owner' then 0 else 1 end`, desc(groups.createdAt))
        .limit(10),
      this.db.select({ n: sql<number>`count(*)::int` }).from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId)).where(runs),
    ]);
    const refs = await this.memberRefs.refs([
      id,
      ...(inviter ? [inviter.inviterId] : []),
      ...invited.map((r) => r.inviteeId),
      ...auditRows.flatMap((r) => (r.actorId ? [r.actorId] : [])),
    ]);
    return {
      member,
      city: profile?.city ?? null,
      chapters: chapterRows,
      counts: { posts: counts?.posts ?? 0, connections: counts?.connections ?? 0, followers: counts?.followers ?? 0 },
      invitedBy: inviter ? (refs.get(inviter.inviterId) ?? null) : null,
      invited: { total: invitedTotal?.n ?? 0, recent: invited.flatMap((r) => refs.get(r.inviteeId) ?? []) },
      openReports: {
        total: reportTotal?.n ?? 0,
        recent: openReports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      },
      audit: auditRows.map((r) => ({
        id: String(r.id),
        actor: r.actorId ? (refs.get(r.actorId) ?? null) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: auditSummary(r, refs),
        createdAt: r.createdAt.toISOString(),
        // The panel is for members.manage; IP hashes stay in the audit log itself.
        ipHash: null,
      })),
      groups: { total: groupTotal?.n ?? 0, items: groupRows.map((g) => ({ ...g }) as AdminMemberGroup) },
    };
  }

  /** PUT /admin/members/{id}/verified */
  async setVerified(
    ctx: AuthContext,
    rawId: string,
    verified: boolean,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.verified !== verified) {
      await this.db
        .update(users)
        .set({
          verifiedAt: verified ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, before.id));
      await this.audit.record({
        actorId: ctx.user.id,
        action: verified ? 'member.verified' : 'member.unverified',
        targetType: 'user',
        targetId: before.id,
        ip,
      });
    }
    return this.row(before.id);
  }

  /**
   * PUT /admin/members/{id}/official. An official account stands for an organisation, so it is
   * follow-only: members connected to it (or waiting on a request) follow it instead. Turning it
   * off lets the account connect like any member again; nobody is reconnected automatically.
   */
  async setOfficial(
    ctx: AuthContext,
    rawId: string,
    official: boolean,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.official !== official) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            isOfficial: official,
            ...(official && !before.verified ? { verifiedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, before.id));
        if (official) await closeStaffConnections(tx, before.id);
      });
      await this.audit.record({
        actorId: ctx.user.id,
        action: official ? 'member.official_on' : 'member.official_off',
        targetType: 'user',
        targetId: before.id,
        ip,
      });
    }
    return this.row(before.id);
  }

  /** PUT /admin/members/{id}/featured */
  async setFeatured(
    ctx: AuthContext,
    rawId: string,
    featured: boolean,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.featured !== featured) {
      if (featured) {
        await this.db
          .insert(featuredMembers)
          .values({ userId: before.id, addedBy: ctx.user.id })
          .onConflictDoNothing();
      } else {
        await this.db
          .delete(featuredMembers)
          .where(eq(featuredMembers.userId, before.id));
      }
      await this.audit.record({
        actorId: ctx.user.id,
        action: featured ? 'member.featured' : 'member.unfeatured',
        targetType: 'user',
        targetId: before.id,
        ip,
      });
    }
    return this.row(before.id);
  }

  /**
   * PUT /admin/members/{id}/mcp-access. Turning it off disconnects every Claude connection on the
   * account. Staff keep access without a grant, so for them it only removes the grant row.
   */
  async setMcpAccess(
    ctx: AuthContext,
    rawId: string,
    enabled: boolean,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (enabled) {
      if (before.status === 'deleted' || before.status === 'deletion_pending')
        throw Errors.conflict('This account is closed or being deleted');
      const inserted = await this.db
        .insert(mcpAccessGrants)
        .values({ userId: before.id, grantedBy: ctx.user.id })
        .onConflictDoNothing()
        .returning({ userId: mcpAccessGrants.userId });
      if (inserted.length)
        await this.audit.record({
          actorId: ctx.user.id,
          action: 'member.mcp_access_granted',
          targetType: 'user',
          targetId: before.id,
          ip,
        });
      return this.row(before.id);
    }
    const { removed, disconnected } = await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(mcpAccessGrants)
        .where(eq(mcpAccessGrants.userId, before.id))
        .returning({ userId: mcpAccessGrants.userId });
      const n = before.staff ? 0 : await this.oauth.revokeAllForUser(before.id, tx);
      return { removed: rows.length > 0, disconnected: n };
    });
    if (removed || disconnected)
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'member.mcp_access_revoked',
        targetType: 'user',
        targetId: before.id,
        after: { disconnected },
        ip,
      });
    return this.row(before.id);
  }

  /** GET /admin/members/{id}/mcp-activity */
  async mcpActivityPage(
    rawId: string,
    q: McpActivityQuery,
  ): Promise<Page<McpActivityView>> {
    const member = await this.row(rawId);
    return this.mcpActivity.list(member.id, q);
  }

  /** POST /admin/members/{id}/badges */
  async award(
    ctx: AuthContext,
    rawId: string,
    input: AdminAwardBadgeInput,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const member = await this.row(rawId);
    const [badge] = await this.db
      .select()
      .from(badges)
      .where(eq(badges.id, input.badgeId))
      .limit(1);
    if (!badge) throw Errors.notFound('That badge');
    if (badge.status !== 'active')
      throw Errors.validation({
        badgeId: 'This badge is disabled. Turn it on before awarding it.',
      });
    const inserted = await this.db
      .insert(memberBadges)
      .values({
        userId: member.id,
        badgeId: badge.id,
        awardedBy: ctx.user.id,
        note: input.note || null,
      })
      .onConflictDoNothing()
      .returning({ id: memberBadges.id });
    if (inserted.length) {
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'member.badge_awarded',
        targetType: 'user',
        targetId: member.id,
        after: { badge: badge.slug, note: input.note ?? null },
        ip,
      });
    }
    return this.row(member.id);
  }

  /** DELETE /admin/members/{id}/badges/{badgeId} */
  async revoke(
    ctx: AuthContext,
    rawId: string,
    rawBadgeId: string,
    ip?: string,
  ): Promise<AdminMemberRow> {
    const member = await this.row(rawId);
    const badgeId = uuidOr404(rawBadgeId, 'That badge');
    const removed = await this.db
      .delete(memberBadges)
      .where(
        and(
          eq(memberBadges.userId, member.id),
          eq(memberBadges.badgeId, badgeId),
        ),
      )
      .returning({ id: memberBadges.id });
    if (removed.length) {
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'member.badge_revoked',
        targetType: 'user',
        targetId: member.id,
        before: { badgeId },
        ip,
      });
    }
    return this.row(member.id);
  }

  /** Rows in the order of `ids`. Disabled badges are listed too, so admins can still revoke them. */
  private async rows(ids: string[]): Promise<AdminMemberRow[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        verifiedAt: users.verifiedAt,
        isStaff: users.isStaff,
        isOfficial: users.isOfficial,
        mfaEnabledAt: users.mfaEnabledAt,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        lastActiveAt: sql<string | null>`greatest(${users.lastLoginAt}, (select max(se.last_seen_at) from ${sessions} se where se.user_id = ${users.id}))`,
        chapterNames: sql<string[]>`coalesce((select array_agg(c.name order by c.name) from (select ch.name from ${chapters} ch where ch.id::text in (${chapterIdsOf(sql`${users.id}`)}) order by ch.name limit 3) c), '{}')`,
        handle: memberProfiles.handle,
        name: memberProfiles.displayName,
        headline: memberProfiles.headline,
        avatarFileId: memberProfiles.avatarFileId,
        countryCode: memberProfiles.countryCode,
        featured: sql<boolean>`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`,
        mcpAccess: mcpAccessSql(),
        mcpConnections: mcpConnectionsSql(),
        roles: sql<
          string[]
        >`coalesce((select array_agg(distinct r.key) from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and ur.revoked_at is null and ur.scope_type is null and r.key in ('event_host','moderator','platform_admin','super_admin')), '{}')`,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(inArray(users.id, ids));
    const awarded = await this.db
      .select({ userId: memberBadges.userId, badge: badges })
      .from(memberBadges)
      .innerJoin(badges, eq(badges.id, memberBadges.badgeId))
      .where(inArray(memberBadges.userId, ids))
      .orderBy(asc(badges.position), asc(badges.name));
    const byUser = new Map<string, AdminMemberRow['badges']>();
    for (const { userId, badge: b } of awarded) {
      const list = byUser.get(userId) ?? [];
      list.push({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        tone: b.tone as BadgeTone,
        icon: b.icon,
      });
      byUser.set(userId, list);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        handle: r.handle,
        name: r.name,
        email: r.email,
        headline: r.headline,
        avatarUrl: mediaUrl(r.avatarFileId),
        countryCode: r.countryCode,
        status: r.status,
        verified: !!r.verifiedAt,
        staff: r.isStaff,
        official: r.isOfficial,
        featured: r.featured,
        mcpAccess: r.mcpAccess,
        mcpConnections: r.mcpConnections,
        badges: byUser.get(r.id) ?? [],
        roles: (r.roles ?? []) as AdminAssignableRole[],
        twoStep: !!r.mfaEnabledAt,
        joinedAt: r.createdAt.toISOString(),
        emailVerified: !!r.emailVerifiedAt,
        lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
        chapterNames: r.chapterNames ?? [],
      }));
  }
}
