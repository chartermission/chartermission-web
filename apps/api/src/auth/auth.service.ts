import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_FIELD_VISIBILITY,
  type ForgotPasswordInput,
  type ResendVerificationInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignInResult,
  type SignUpInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { consentRecords, memberProfiles, roles, sessions, userRoles, users } from '../db/schema.js';
import { type AppRequest, type AuthContext, clientIp } from '../core/auth-context.js';
import { PRIVILEGED_ROLES } from '../core/permissions.js';
import { SessionService, audienceOf } from '../core/session.service.js';
import { toneFor } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { EventsService } from '../infra/events.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { hashIp, sha256 } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { HandleService } from '../profiles/handles.js';
import { TaxonomyService } from '../profiles/taxonomy.service.js';
import { isUniqueViolation } from '../profiles/pg-error.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';
import { AuthMailer } from './auth-mail.js';

/** Rate limits (spec 8.2 as assigned): registration 10/hour per IP; login 5 failures / 15 min. */
export const LIMITS = {
  registerPerIpHour: 10,
  loginFailures: 5,
  loginWindowSec: 15 * 60,
  emailPerAccountHour: 3,
} as const;

export const POLICIES = ['terms', 'privacy', 'guidelines'] as const;

/** Rate-limit key for an email address, whether or not an account exists (enumeration safety). */
export const emailKey = (email: string) => sha256(email.trim().toLowerCase()).slice(0, 32);
export const loginAccountKey = (email: string) => `login:fail:acct:${emailKey(email)}`;

/**
 * Registration, verification, sign-in and password reset (spec 4.2, CM-AUTH-01..05).
 * Register, resend, forgot and login answer identically whether or not the email exists.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly mailer: AuthMailer,
    private readonly handles: HandleService,
    private readonly taxonomy: TaxonomyService,
    private readonly settings: SettingsService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly events: EventsService,
  ) {}

  async findByEmail(email: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
      .limit(1);
    return row ?? null;
  }

  async hasPrivilegedRole(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt), inArray(roles.key, PRIVILEGED_ROLES)))
      .limit(1);
    return rows.length > 0;
  }

  /** POST /auth/register (CM-AUTH-01, 02, 05, 06). No session is created. */
  async register(input: SignUpInput, req: Request): Promise<void> {
    const ip = clientIp(req);
    await this.limits.consume(`register:ip:${ip ?? 'unknown'}`, LIMITS.registerPerIpHour, 3600);
    // Rules that do not depend on whether the account exists, so errors cannot reveal it.
    await this.passwords.assertAcceptable(input.password, { email: input.email, name: input.name });
    if (!(await this.taxonomy.countryExists(input.country))) {
      throw Errors.validation({ country: 'Choose a country from the list' });
    }

    const existing = await this.findByEmail(input.email);
    if (existing) return this.registerExisting(existing, input.password, ip);

    const passwordHash = await this.passwords.hash(input.password);
    const versions = await this.settings.get('policy_versions');
    const userId = randomUUID();
    let token: string | undefined;
    for (let attempt = 0; attempt < 3 && !token; attempt++) {
      try {
        token = await this.db.transaction(async (tx) => {
          await tx.insert(users).values({ id: userId, email: input.email, passwordHash, status: 'unverified' });
          await tx.insert(memberProfiles).values({
            userId,
            handle: await this.handles.derive(input.name, tx),
            displayName: input.name,
            countryCode: input.country,
            avatarTone: toneFor(userId),
            fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
          });
          // CM-AUTH-06: policy type, version and timestamp per accepted policy.
          await tx.insert(consentRecords).values(
            POLICIES.map((policyType) => ({ userId, policyType, policyVersion: versions[policyType], ipHash: hashIp(ip) })),
          );
          return this.tokens.issue(userId, 'verify', tx);
        });
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_lower_uq')) {
          const raced = await this.findByEmail(input.email);
          if (raced) return this.registerExisting(raced, input.password, ip, true);
        }
        if (!isUniqueViolation(err, 'member_profiles_handle_uq')) throw err;
      }
    }
    if (!token) throw Errors.conflict('Please try again');

    await this.mailer.verification({ email: input.email, userId }, input.name, token);
    this.analytics.track('account_registered', userId, input.country);
    await this.audit.record({ actorId: userId, action: 'auth.register', targetType: 'user', targetId: userId, ip });
    await this.events.emit({ type: 'user.registered', userId });
  }

  /** Same response as a new registration; the owner gets a heads-up email instead. */
  private async registerExisting(user: typeof users.$inferSelect, password: string, ip: string | undefined, hashed = false) {
    if (!hashed) await this.passwords.hash(password); // equalise timing with the new-account path
    if (user.status !== 'deleted') await this.mailer.alreadyRegistered({ email: user.email, userId: user.id });
    await this.audit.record({ actorId: null, action: 'auth.register.existing_email', targetType: 'user', targetId: user.id, ip });
  }

  /** POST /auth/verify — single-use, 24-hour token; unverified → active. */
  async verifyEmail(token: string, ip?: string): Promise<void> {
    const result = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(token, 'verify', tx);
      const [before] = await tx
        .select({ verifiedAt: users.emailVerifiedAt, status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!before || before.status === 'deleted') throw Errors.invalidToken();
      if (!before.verifiedAt) {
        await tx
          .update(users)
          .set({
            emailVerifiedAt: new Date(),
            status: sql`case when ${users.status} = 'unverified' then 'active' else ${users.status} end`,
          })
          .where(eq(users.id, userId));
      }
      await this.tokens.retireAll(userId, 'verify', tx);
      return { userId, newlyVerified: !before.verifiedAt };
    });
    if (!result.newlyVerified) return;
    const [profile] = await this.db
      .select({ countryCode: memberProfiles.countryCode })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, result.userId));
    this.analytics.track('email_verified', result.userId, profile?.countryCode);
    await this.audit.record({ actorId: result.userId, action: 'auth.email_verified', targetType: 'user', targetId: result.userId, ip });
    await this.events.emit({ type: 'user.verified', userId: result.userId });
  }

  /** POST /auth/resend — the session's account if signed in, else the email; 3 per hour per account. */
  async resend(input: ResendVerificationInput, ctx: AuthContext | undefined): Promise<void> {
    const email = ctx?.user.email ?? input.email;
    if (!email) throw Errors.validation({ email: 'Enter your email address' });
    await this.limits.consume(`resend:${emailKey(email)}`, LIMITS.emailPerAccountHour, 3600);
    const user = await this.findByEmail(email);
    if (!user || user.emailVerifiedAt || user.status === 'deleted' || user.status === 'deletion_pending') return;
    const [profile] = await this.db
      .select({ name: memberProfiles.displayName })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, user.id));
    const token = await this.tokens.issue(user.id, 'verify');
    await this.mailer.verification({ email: user.email, userId: user.id }, profile?.name ?? 'there', token);
  }

  /** POST /auth/login (CM-AUTH-03, CM-AUTH-09). Always a new session (rotation). */
  async login(input: SignInInput, req: AppRequest, res: Response): Promise<SignInResult> {
    const ip = clientIp(req) ?? 'unknown';
    const accountKey = loginAccountKey(input.email);
    const ipKey = `login:fail:ip:${ip}`;
    await this.limits.assertBelow(accountKey, LIMITS.loginFailures);
    await this.limits.assertBelow(ipKey, LIMITS.loginFailures);

    const user = await this.findByEmail(input.email);
    let ok = false;
    if (!user || user.status === 'deleted') await this.passwords.dummyVerify(input.password);
    else ok = await this.passwords.verify(user.passwordHash, input.password);
    // The admin console only admits privileged roles; everyone else gets the same generic error.
    if (ok && input.audience === 'admin' && !(await this.hasPrivilegedRole(user!.id))) ok = false;

    if (!ok || !user) {
      await this.limits.hit(accountKey, LIMITS.loginWindowSec);
      await this.limits.hit(ipKey, LIMITS.loginWindowSec);
      await this.audit.record({
        actorId: null,
        action: 'auth.login.failure',
        targetType: user ? 'user' : undefined,
        targetId: user?.id,
        after: { audience: input.audience },
        ip,
      });
      throw Errors.invalidCredentials();
    }
    await this.limits.reset(accountKey);

    const audience = input.audience;
    if (req.auth && req.auth.session.audience === audience) await this.sessions.revoke(req.auth.session.id);

    const userAgent = (req.headers['user-agent'] ?? '').slice(0, 300) || null;
    const prior = await this.db.select({ userAgent: sessions.userAgent }).from(sessions).where(eq(sessions.userId, user.id));
    const newDevice = prior.length > 0 && !prior.some((p) => p.userAgent === userAgent);

    const { token, expiresAt } = await this.sessions.create(user.id, audience, req);
    this.sessions.setCookie(res, audience, token, expiresAt);
    const now = new Date();
    await this.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    if (newDevice) await this.mailer.newSignIn({ email: user.email, userId: user.id }, userAgent, now);
    await this.audit.record({ actorId: user.id, action: 'auth.login.success', targetType: 'user', targetId: user.id, after: { audience }, ip });

    if (audience === 'admin') return { status: user.mfaEnabledAt ? 'mfa_required' : 'mfa_setup_required' };
    return { status: 'ok' };
  }

  /** POST /auth/logout — revokes the current session for the request's audience. */
  async logout(req: AppRequest, res: Response): Promise<void> {
    const audience = audienceOf(req);
    if (req.auth) {
      await this.sessions.revoke(req.auth.session.id);
      await this.audit.record({
        actorId: req.auth.user.id,
        action: 'auth.logout',
        targetType: 'session',
        targetId: req.auth.session.id,
        ip: clientIp(req),
      });
    }
    this.sessions.clearCookie(res, audience);
  }

  /** POST /auth/password/forgot — identical response; 3 per hour per account; 60-minute token. */
  async forgot(input: ForgotPasswordInput): Promise<void> {
    await this.limits.consume(`forgot:${emailKey(input.email)}`, LIMITS.emailPerAccountHour, 3600);
    const user = await this.findByEmail(input.email);
    if (!user || user.status === 'deleted') return;
    const token = await this.tokens.issue(user.id, 'reset');
    await this.mailer.passwordReset({ email: user.email, userId: user.id }, token);
  }

  /** POST /auth/password/reset (CM-AUTH-04): single use; revokes every session. */
  async reset(input: ResetPasswordInput, ip?: string): Promise<void> {
    const userId = await this.tokens.peek(input.token, 'reset');
    const [user] = await this.db
      .select({ email: users.email, status: users.status, name: memberProfiles.displayName })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId));
    if (!user || user.status === 'deleted') throw Errors.invalidToken();
    await this.passwords.assertAcceptable(input.password, { email: user.email, name: user.name });
    const passwordHash = await this.passwords.hash(input.password);
    await this.db.transaction(async (tx) => {
      await this.tokens.consume(input.token, 'reset', tx);
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    });
    await this.sessions.revokeAll(userId);
    await this.limits.reset(loginAccountKey(user.email));
    await this.mailer.security({ email: user.email, userId }, 'password_reset', 'Your password was reset', [
      'The password for your Charter Mission account was just reset, and every device was signed out.',
    ]);
    await this.audit.record({ actorId: userId, action: 'auth.password.reset', targetType: 'user', targetId: userId, ip });
  }
}
