import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  LEAD_OPEN_STAGES,
  type AmbassadorTrainingInput,
  type AmbassadorTrainingView,
  type CreateManagerInput,
  type ManagerView,
  type TeamMember,
  type UpdateManagerInput,
} from '@chartermission/contracts';
import type { CreateManagerInput as CreateManagerSchema } from '@chartermission/contracts';
import type { z } from 'zod';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { ambassadorLeads, countries, courses, memberProfiles, rolePermissions, roles, userRoles, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { randomToken } from '../common/crypto.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { HandleService } from '../profiles/handles.js';
import { AmbassadorMailer } from './ambassador-mail.js';
import { closeStaffConnections } from '../profiles/staff-connections.js';

type CreateManager = z.output<typeof CreateManagerSchema>;
const MANAGER_ROLE = 'ambassador_manager';

/**
 * Ambassador Manager sub-accounts (ambassador.managers: Platform Admin and above). A manager is
 * an account with the ambassador_manager role, one row per country they cover (or one unscoped
 * row for every country). New people get a staff account and a set-password email; existing
 * members just gain the role. Also: the ambassador team picker and required training courses.
 */
@Injectable()
export class ManagersService {
  private readonly log = new Logger('Ambassadors');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly handles: HandleService,
    private readonly mail: AmbassadorMailer,
  ) {}

  /** GET /admin/ambassadors/managers */
  async list(): Promise<ManagerView[]> {
    const roleId = await this.roleId();
    const rows = await this.db
      .select({
        userId: users.id,
        email: users.email,
        name: memberProfiles.displayName,
        lastLoginAt: users.lastLoginAt,
        mfaEnabledAt: users.mfaEnabledAt,
        scopeType: userRoles.scopeType,
        scopeId: userRoles.scopeId,
        grantedAt: userRoles.grantedAt,
      })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(eq(userRoles.roleId, roleId), isNull(userRoles.revokedAt)));
    if (!rows.length) return [];

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [countryRows, leadCounts] = await Promise.all([
      this.db.select({ code: countries.code, name: countries.name }).from(countries),
      this.db
        .select({ ownerId: ambassadorLeads.ownerId, n: sql<number>`count(*)::int` })
        .from(ambassadorLeads)
        .where(and(inArray(ambassadorLeads.ownerId, userIds), inArray(ambassadorLeads.stage, [...LEAD_OPEN_STAGES])))
        .groupBy(ambassadorLeads.ownerId),
    ]);
    const countryName = new Map(countryRows.map((c) => [c.code, c.name]));
    const byUser = new Map<string, ManagerView>();
    for (const r of rows) {
      const view =
        byUser.get(r.userId) ??
        ({
          userId: r.userId,
          name: r.name ?? r.email,
          email: r.email,
          countries: [],
          allCountries: false,
          status: r.lastLoginAt ? 'active' : 'invited',
          mfaEnabled: !!r.mfaEnabledAt,
          grantedAt: r.grantedAt.toISOString(),
          openLeads: leadCounts.find((l) => l.ownerId === r.userId)?.n ?? 0,
        } satisfies ManagerView);
      if (!r.scopeType) view.allCountries = true;
      else if (r.scopeType === 'country' && r.scopeId) view.countries.push({ code: r.scopeId, name: countryName.get(r.scopeId) ?? r.scopeId });
      if (r.grantedAt.toISOString() < view.grantedAt) view.grantedAt = r.grantedAt.toISOString();
      byUser.set(r.userId, view);
    }
    for (const v of byUser.values()) {
      if (v.allCountries) v.countries = [];
      v.countries.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** POST /admin/ambassadors/managers */
  async create(ctx: AuthContext, rawInput: CreateManagerInput, ip?: string): Promise<ManagerView> {
    const input = rawInput as CreateManager;
    const codes = await this.validCountries(input.countryCodes);
    const roleId = await this.roleId();
    const inviter = await this.displayName(ctx.user.id);
    const [existing] = await this.db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);

    let userId: string;
    let token: string | null = null;
    if (existing) {
      if (['deleted', 'deletion_pending', 'deactivated'].includes(existing.status)) {
        throw Errors.conflict('That account is closed or being deleted. Use a different email.');
      }
      const active = await this.db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, existing.id), eq(userRoles.roleId, roleId), isNull(userRoles.revokedAt)))
        .limit(1);
      if (active.length) throw Errors.conflict('This person is already an Ambassador Manager. Edit their countries instead.');
      userId = existing.id;
      await this.db.transaction(async (tx) => {
        await this.setScopes(tx, userId, roleId, codes, ctx.user.id);
        await tx.update(users).set({ isStaff: true }).where(eq(users.id, userId));
        await closeStaffConnections(tx, userId);
      });
    } else {
      // A staff account with an unknown random password: they choose their own from the email link.
      const passwordHash = await this.passwords.hash(randomToken(32));
      userId = await this.db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash, status: 'active', emailVerifiedAt: new Date(), isStaff: true })
          .returning({ id: users.id });
        await tx.insert(memberProfiles).values({
          userId: u!.id,
          handle: await this.handles.derive(input.name, tx),
          displayName: input.name,
          countryCode: codes.length === 1 ? codes[0] : null,
          onboardingStep: 4,
          onboardingCompletedAt: new Date(),
        });
        await this.setScopes(tx, u!.id, roleId, codes, ctx.user.id);
        return u!.id;
      });
      token = await this.tokens.issue(userId, 'reset');
    }

    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.manager.grant', targetType: 'user', targetId: userId, after: { countries: codes.length ? codes : 'all', newAccount: !existing }, ip });
    try {
      if (token) await this.mail.managerInvite({ email: input.email, userId }, { name: input.name, invitedBy: inviter, token });
      else await this.mail.managerAdded({ email: input.email, userId }, { name: (await this.displayName(userId)) || input.name, invitedBy: inviter });
    } catch (err) {
      this.log.warn(`Manager invitation email to ${userId} failed: ${String(err)}`);
    }
    return this.view(userId);
  }

  /** PATCH /admin/ambassadors/managers/:userId — change the countries covered. */
  async update(ctx: AuthContext, userId: string, input: UpdateManagerInput, ip?: string): Promise<ManagerView> {
    const roleId = await this.roleId();
    await this.assertManager(userId, roleId);
    const codes = await this.validCountries(input.countryCodes);
    await this.db.transaction((tx) => this.setScopes(tx, userId, roleId, codes, ctx.user.id));
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.manager.scope', targetType: 'user', targetId: userId, after: { countries: codes.length ? codes : 'all' }, ip });
    return this.view(userId);
  }

  /** DELETE /admin/ambassadors/managers/:userId — their leads keep the owner name for history. */
  async revoke(ctx: AuthContext, userId: string, ip?: string): Promise<void> {
    const roleId = await this.roleId();
    await this.assertManager(userId, roleId);
    if (userId === ctx.user.id) throw Errors.badRequest('You can’t remove your own manager access');
    await this.db
      .update(userRoles)
      .set({ revokedAt: new Date() })
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), isNull(userRoles.revokedAt)));
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.manager.revoke', targetType: 'user', targetId: userId, ip });
  }

  /** POST /admin/ambassadors/managers/:userId/invite — a fresh set-password link. */
  async resendInvite(ctx: AuthContext, userId: string): Promise<ManagerView> {
    const roleId = await this.roleId();
    await this.assertManager(userId, roleId);
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Errors.notFound('That manager');
    const token = await this.tokens.issue(userId, 'reset');
    await this.mail.managerInvite({ email: u.email, userId }, { name: await this.displayName(userId), invitedBy: await this.displayName(ctx.user.id), token });
    return this.view(userId);
  }

  /** GET /admin/ambassadors/team — everyone who can own leads. */
  async team(): Promise<TeamMember[]> {
    const rows = await this.db
      .selectDistinct({ id: users.id, email: users.email, name: memberProfiles.displayName })
      .from(userRoles)
      .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, userRoles.roleId), eq(rolePermissions.permissionKey, 'ambassador.manage')))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(isNull(userRoles.revokedAt), eq(users.status, 'active')));
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name ?? r.email })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** GET /admin/ambassadors/training */
  async training(): Promise<AmbassadorTrainingView> {
    const ids = (await this.settings.get('ambassador_training')).courseIds;
    if (!ids.length) return { courses: [] };
    const rows = await this.db
      .select({ id: courses.id, title: courses.title, startUrl: courses.startUrl, thumbnailUrl: courses.thumbnailUrl, hidden: courses.hidden, removedAt: courses.removedAt })
      .from(courses)
      .where(inArray(courses.id, ids));
    return {
      courses: ids
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ id: r.id, title: r.title, startUrl: r.startUrl, thumbnailUrl: r.thumbnailUrl, available: !r.hidden && !r.removedAt })),
    };
  }

  /** PUT /admin/ambassadors/training — applies to onboarding started from now on, and to open checklists. */
  async setTraining(ctx: AuthContext, input: AmbassadorTrainingInput, ip?: string): Promise<AmbassadorTrainingView> {
    const ids = [...new Set(input.courseIds)];
    if (ids.length) {
      const found = await this.db.select({ id: courses.id }).from(courses).where(inArray(courses.id, ids));
      if (found.length !== ids.length) throw Errors.validation({ courseIds: 'One of those courses no longer exists. Reload and choose again.' });
    }
    const before = (await this.settings.get('ambassador_training')).courseIds;
    await this.settings.set('ambassador_training', { courseIds: ids }, ctx.user.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.training.set', targetType: 'setting', targetId: 'ambassador_training', before: { courseIds: before }, after: { courseIds: ids }, ip });
    return this.training();
  }

  /* ----------------------------- Helpers ----------------------------- */

  private async view(userId: string): Promise<ManagerView> {
    const hit = (await this.list()).find((m) => m.userId === userId);
    if (!hit) throw Errors.notFound('That manager');
    return hit;
  }

  private async roleId(): Promise<string> {
    const [r] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.key, MANAGER_ROLE)).limit(1);
    if (!r) throw new Error('The "ambassador_manager" role is missing; run the database migrations');
    return r.id;
  }

  private async assertManager(userId: string, roleId: string) {
    const [hit] = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), isNull(userRoles.revokedAt)))
      .limit(1);
    if (!hit) throw Errors.notFound('That manager');
  }

  private async validCountries(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    if (!unique.length) return [];
    const found = await this.db.select({ code: countries.code }).from(countries).where(inArray(countries.code, unique)).orderBy(asc(countries.code));
    if (found.length !== unique.length) throw Errors.validation({ countryCodes: 'Choose countries from the list' });
    return unique;
  }

  /**
   * Makes the active role rows match `codes` (empty = one unscoped row for every country).
   * The unique index includes revoked rows, so earlier rows are revived instead of re-inserted.
   */
  private async setScopes(tx: Tx, userId: string, roleId: string, codes: string[], actorId: string) {
    const rows = await tx.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    const wanted = codes.length ? codes.map((c) => ({ scopeType: 'country' as string | null, scopeId: c as string | null })) : [{ scopeType: null, scopeId: null }];
    const key = (t: string | null, i: string | null) => `${t ?? ''}:${i ?? ''}`;
    const wantedKeys = new Set(wanted.map((w) => key(w.scopeType, w.scopeId)));
    const now = new Date();
    for (const r of rows) {
      const keep = wantedKeys.has(key(r.scopeType, r.scopeId));
      if (keep && r.revokedAt) await tx.update(userRoles).set({ revokedAt: null, grantedAt: now, grantedBy: actorId }).where(eq(userRoles.id, r.id));
      if (!keep && !r.revokedAt) await tx.update(userRoles).set({ revokedAt: now }).where(eq(userRoles.id, r.id));
    }
    const have = new Set(rows.map((r) => key(r.scopeType, r.scopeId)));
    const fresh = wanted.filter((w) => !have.has(key(w.scopeType, w.scopeId)));
    if (fresh.length) await tx.insert(userRoles).values(fresh.map((w) => ({ userId, roleId, scopeType: w.scopeType, scopeId: w.scopeId, grantedBy: actorId })));
  }

  private async displayName(userId: string): Promise<string> {
    const [r] = await this.db
      .select({ name: memberProfiles.displayName, email: users.email })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    return r?.name ?? r?.email ?? 'A Charter Mission administrator';
  }
}
