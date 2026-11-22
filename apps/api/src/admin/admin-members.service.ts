import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
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
  Ok,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  badges,
  featuredMembers,
  memberBadges,
  memberProfiles,
  mfaDevices,
  roles,
  userRoles,
  users,
} from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
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
  isUniqueViolation,
  likePrefix,
  uuidOr404,
} from '../moderation/util.js';

type BadgeRow = typeof badges.$inferSelect;

/** Accounts the Members page lists and counts: every account except deleted ones. */
const LISTED = ne(users.status, 'deleted');
/** Suggested to new members at sign-up. */
const FEATURED = sql`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`;

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
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
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
   * GET /admin/members: search by name, handle or email. The first page (no cursor) also carries
   * `total` (matching the filter and search) and `counts` (per filter, ignoring the search).
   */
  async list(q: AdminMembersQuery): Promise<AdminMembersPage> {
    const offset = q.cursor
      ? Number(Buffer.from(q.cursor, 'base64url').toString())
      : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000)
      throw Errors.badRequest('Invalid cursor');
    const conds: SQL[] = [LISTED];
    if (q.q) {
      const term = `%${likePrefix(q.q.replace(/^@/, '')).slice(0, -1)}%`;
      conds.push(
        or(
          ilike(memberProfiles.displayName, term),
          ilike(memberProfiles.handle, term),
          ilike(users.email, term),
        )!,
      );
    }
    if (q.filter === 'verified') conds.push(isNotNull(users.verifiedAt));
    if (q.filter === 'unverified') conds.push(isNull(users.verifiedAt));
    if (q.filter === 'featured') conds.push(FEATURED);
    if (q.filter === 'badge') {
      if (!q.badge) throw Errors.validation({ badge: 'Choose a badge' });
      conds.push(
        sql`exists (select 1 from ${memberBadges} mb join ${badges} b on b.id = mb.badge_id where mb.user_id = ${users.id} and b.slug = ${q.badge})`,
      );
    }
    const first = !q.cursor;
    const [rows, counts, matching] = await Promise.all([
      this.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(and(...conds))
        .orderBy(desc(users.createdAt), asc(users.id))
        .limit(q.limit + 1)
        .offset(offset),
      first ? this.counts() : null,
      // "All" without a search is counts.all: no second count.
      first && (q.q || q.filter !== 'all') ? this.countWhere(and(...conds)!) : null,
    ]);
    const ids = rows.slice(0, q.limit).map((r) => r.id);
    return {
      items: await this.rows(ids),
      nextCursor:
        rows.length > q.limit
          ? Buffer.from(String(offset + q.limit)).toString('base64url')
          : null,
      total: first ? (matching ?? counts!.all) : null,
      counts,
    };
  }

  /** Members per filter of the Members page (the search left aside). */
  private async counts(): Promise<AdminMemberCounts> {
    const [row] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${users.verifiedAt} is not null)::int`,
        featured: sql<number>`count(*) filter (where ${FEATURED})::int`,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(LISTED);
    const all = row?.all ?? 0;
    const verified = row?.verified ?? 0;
    return { all, verified, unverified: all - verified, featured: row?.featured ?? 0 };
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
        createdAt: users.createdAt,
        handle: memberProfiles.handle,
        name: memberProfiles.displayName,
        headline: memberProfiles.headline,
        avatarFileId: memberProfiles.avatarFileId,
        countryCode: memberProfiles.countryCode,
        featured: sql<boolean>`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`,
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
        badges: byUser.get(r.id) ?? [],
        roles: (r.roles ?? []) as AdminAssignableRole[],
        twoStep: !!r.mfaEnabledAt,
        joinedAt: r.createdAt.toISOString(),
      }));
  }
}
