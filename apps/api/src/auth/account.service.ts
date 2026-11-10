import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type {
  AccountExport,
  ChangePasswordInput,
  ConsentRecordView,
  DeletionRequestInput,
  SessionUser,
  SessionView,
} from '@chartermission/contracts';
import { Locale } from '@chartermission/contracts';
import { env } from '../config/env.js';
import { ADMIN_SIGNIN_ROLES } from '../core/permissions.js';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  comments,
  connections,
  consentRecords,
  deletionRequests,
  follows,
  memberProfiles,
  posts,
  sessions,
  users,
} from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl, MembersService, toneFor } from '../core/members.service.js';
import { isActiveUntil } from '../core/policy.js';
import { SessionService } from '../core/session.service.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { hashIp } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { AuthMailer } from './auth-mail.js';
import { PasswordService } from './password.service.js';
import { POLICIES } from './auth.service.js';
import { mustUseMfa } from '../core/permissions.js';

const CONFIRM_FAILURES = 5;
const CONFIRM_WINDOW_SEC = 15 * 60;

/** The signed-in account: /me, consents, password, sessions, deactivation, deletion, export (spec 4.2, 8.3). */
@Injectable()
export class AccountService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly mailer: AuthMailer,
    private readonly profiles: ProfilesService,
    private readonly members: MembersService,
  ) {}

  /** GET /me */
  async me(ctx: AuthContext): Promise<SessionUser> {
    const [row] = await this.db
      .select({ user: users, profile: memberProfiles })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, ctx.user.id));
    if (!row) throw Errors.unauthenticated();
    const { user, profile } = row;
    const active = (d: Date | null) => (isActiveUntil(d) ? d.toISOString() : null);
    return {
      id: user.id,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      status: user.status as SessionUser['status'],
      handle: profile.handle,
      name: profile.displayName,
      headline: profile.headline,
      avatarUrl: mediaUrl(profile.avatarFileId),
      tone: (profile.avatarTone as SessionUser['tone']) ?? toneFor(user.id),
      countryCode: profile.countryCode,
      roles: [...ctx.user.roles],
      permissions: [...ctx.user.permissions],
      onboarding: { step: profile.onboardingStep, completed: !!profile.onboardingCompletedAt },
      mfa: { enabled: !!user.mfaEnabledAt, verifiedThisSession: ctx.session.mfaVerified, required: mustUseMfa(ctx.user) },
      needsPolicyReaccept: await this.needsPolicyReaccept(user.id),
      restrictions: { postingUntil: active(user.restrictedPostingUntil), connectingUntil: active(user.restrictedConnectingUntil) },
      sessionAudience: ctx.session.audience,
      adminConsoleUrl: ctx.user.roles.some((r) => ADMIN_SIGNIN_ROLES.includes(r)) ? env().ADMIN_URL.replace(/\/+$/, '') : null,
      locale: (Locale.safeParse(user.locale).data ?? null) as SessionUser['locale'],
    };
  }

  /** PUT /me/locale — the interface language, remembered across devices. */
  async setLocale(ctx: AuthContext, locale: Locale): Promise<void> {
    await this.db.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
  }

  /** Spec 4.2 rule: a policy version change prompts re-acceptance (latest consent per policy vs current). */
  async needsPolicyReaccept(userId: string): Promise<boolean> {
    const versions = await this.settings.get('policy_versions');
    const latest = await this.db
      .selectDistinctOn([consentRecords.policyType], { policyType: consentRecords.policyType, version: consentRecords.policyVersion })
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(consentRecords.policyType, desc(consentRecords.acceptedAt), desc(consentRecords.createdAt));
    const map = new Map(latest.map((r) => [r.policyType, r.version]));
    return POLICIES.some((p) => map.get(p) !== versions[p]);
  }

  /** POST /me/consents — records a new consent row per policy at the current versions (CM-AUTH-06). */
  async acceptPolicies(ctx: AuthContext, ip?: string): Promise<ConsentRecordView[]> {
    const versions = await this.settings.get('policy_versions');
    await this.db.insert(consentRecords).values(
      POLICIES.map((policyType) => ({ userId: ctx.user.id, policyType, policyVersion: versions[policyType], ipHash: hashIp(ip) })),
    );
    await this.audit.record({ actorId: ctx.user.id, action: 'account.policies_accepted', targetType: 'user', targetId: ctx.user.id, after: versions, ip });
    return this.consents(ctx.user.id);
  }

  /** GET /me/consents — append-only history, newest first. */
  async consents(userId: string): Promise<ConsentRecordView[]> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(desc(consentRecords.acceptedAt), asc(consentRecords.policyType));
    return rows.map((r) => ({
      policyType: r.policyType as ConsentRecordView['policyType'],
      policyVersion: r.policyVersion,
      acceptedAt: r.acceptedAt.toISOString(),
    }));
  }

  /** Re-check the password for sensitive changes; 5 failures per 15 minutes, then 429. */
  async confirmPassword(userId: string, password: string, field = 'password'): Promise<void> {
    const key = `confirm:fail:${userId}`;
    await this.limits.assertBelow(key, CONFIRM_FAILURES);
    const [user] = await this.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (user && (await this.passwords.verify(user.hash, password))) {
      await this.limits.reset(key);
      return;
    }
    await this.limits.hit(key, CONFIRM_WINDOW_SEC);
    throw Errors.validation({ [field]: 'That password isn’t right' });
  }

  /** POST /me/password — keeps this session, revokes the others, sends a security email. */
  async changePassword(ctx: AuthContext, input: ChangePasswordInput, ip?: string): Promise<void> {
    await this.confirmPassword(ctx.user.id, input.currentPassword, 'currentPassword');
    const row = await this.profiles.rowFor(ctx.user.id);
    await this.passwords.assertAcceptable(input.newPassword, { email: row.email, name: row.displayName }, 'newPassword');
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, ctx.user.id));
    await this.sessions.revokeAll(ctx.user.id, ctx.session.id);
    await this.mailer.security({ email: row.email, userId: ctx.user.id }, 'password_changed', 'Your password was changed', [
      'The password for your Charter Mission account was changed. Other devices were signed out.',
    ]);
    await this.audit.record({ actorId: ctx.user.id, action: 'account.password_changed', targetType: 'user', targetId: ctx.user.id, ip });
  }

  /** GET /me/sessions — live sessions, both audiences. */
  async listSessions(ctx: AuthContext): Promise<SessionView[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.userId, ctx.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now)),
      )
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({
      id: s.id,
      current: s.id === ctx.session.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    }));
  }

  /** DELETE /me/sessions/{id} */
  async revokeSession(ctx: AuthContext, id: string, res: Response, ip?: string): Promise<void> {
    const [row] = await this.db
      .select({ id: sessions.id, audience: sessions.audience })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.user.id), isNull(sessions.revokedAt)));
    if (!row) throw Errors.notFound('Session');
    await this.sessions.revoke(row.id);
    if (row.id === ctx.session.id) this.sessions.clearCookie(res, ctx.session.audience);
    await this.audit.record({ actorId: ctx.user.id, action: 'account.session_revoked', targetType: 'session', targetId: row.id, ip });
  }

  /** POST /me/deactivate (CM-AUTH-08) — reversible; the profile and content disappear until reactivation. */
  async deactivate(ctx: AuthContext, password: string, ip?: string): Promise<void> {
    await this.confirmPassword(ctx.user.id, password);
    const [row] = await this.db
      .update(users)
      .set({ status: 'deactivated', deactivatedAt: new Date() })
      .where(and(eq(users.id, ctx.user.id), or(eq(users.status, 'active'), eq(users.status, 'unverified'))))
      .returning({ id: users.id });
    if (!row) throw Errors.conflict('Your account can’t be deactivated right now');
    await this.audit.record({ actorId: ctx.user.id, action: 'account.deactivated', targetType: 'user', targetId: ctx.user.id, ip });
  }

  /** POST /me/reactivate — back to active (or unverified if the email was never confirmed). */
  async reactivate(ctx: AuthContext, password: string, ip?: string): Promise<void> {
    await this.confirmPassword(ctx.user.id, password);
    const [row] = await this.db
      .update(users)
      .set({
        status: sql`case when ${users.emailVerifiedAt} is null then 'unverified' else 'active' end`,
        deactivatedAt: null,
      })
      .where(and(eq(users.id, ctx.user.id), eq(users.status, 'deactivated')))
      .returning({ id: users.id });
    if (!row) throw Errors.conflict('Your account is not deactivated');
    await this.audit.record({ actorId: ctx.user.id, action: 'account.reactivated', targetType: 'user', targetId: ctx.user.id, ip });
  }

  /** POST /me/deletion-request (CM-AUTH-08) — routed to the admin queue; signs out everywhere. */
  async requestDeletion(ctx: AuthContext, input: DeletionRequestInput, res: Response, ip?: string): Promise<void> {
    await this.confirmPassword(ctx.user.id, input.password);
    const done = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({ status: 'deletion_pending' })
        .where(and(eq(users.id, ctx.user.id), sql`${users.status} not in ('deletion_pending', 'deleted')`))
        .returning({ email: users.email });
      if (!user) return null;
      const [req] = await tx
        .insert(deletionRequests)
        .values({ userId: ctx.user.id, reason: input.reason?.trim() || null })
        .returning({ id: deletionRequests.id });
      return { email: user.email, requestId: req!.id };
    });
    if (!done) throw Errors.conflict('A deletion request is already pending');
    await this.sessions.revokeAll(ctx.user.id);
    this.sessions.clearCookie(res, 'member');
    this.sessions.clearCookie(res, 'admin');
    await this.mailer.deletionRequested({ email: done.email, userId: ctx.user.id });
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'account.deletion_requested',
      targetType: 'deletion_request',
      targetId: done.requestId,
      ip,
    });
  }

  /** GET /me/export (spec 8.3) — the member's own profile, posts, comments, connections, follows, consents. */
  async export(userId: string): Promise<AccountExport> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw Errors.unauthenticated();
    const [profile, postRows, commentRows, connectionRows, followRows, consentRows] = await Promise.all([
      this.profiles.own(userId),
      this.db
        .select({ id: posts.id, body: posts.body, createdAt: posts.createdAt, editedAt: posts.editedAt })
        .from(posts)
        .where(and(eq(posts.authorId, userId), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt)),
      this.db
        .select({ id: comments.id, postId: comments.postId, body: comments.body, createdAt: comments.createdAt, editedAt: comments.editedAt })
        .from(comments)
        .where(and(eq(comments.authorId, userId), isNull(comments.deletedAt)))
        .orderBy(desc(comments.createdAt)),
      this.db
        .select()
        .from(connections)
        .where(or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)))
        .orderBy(desc(connections.createdAt)),
      this.db
        .select({ targetType: follows.targetType, targetId: follows.targetId, createdAt: follows.createdAt })
        .from(follows)
        .where(eq(follows.followerId, userId))
        .orderBy(desc(follows.createdAt)),
      this.consents(userId),
    ]);
    const refs = await this.members.refs(connectionRows.map((c) => (c.requesterId === userId ? c.addresseeId : c.requesterId)));
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        status: user.status,
        emailVerifiedAt: iso(user.emailVerifiedAt),
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: iso(user.lastLoginAt),
      },
      profile,
      posts: postRows.map((p) => ({ id: p.id, body: p.body, createdAt: p.createdAt.toISOString(), editedAt: iso(p.editedAt) })),
      comments: commentRows.map((c) => ({
        id: c.id,
        postId: c.postId,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        editedAt: iso(c.editedAt),
      })),
      connections: connectionRows.map((c) => {
        const other = refs.get(c.requesterId === userId ? c.addresseeId : c.requesterId);
        return {
          handle: other?.handle ?? 'deleted-member',
          name: other?.name ?? 'Former member',
          status: c.status,
          direction: c.requesterId === userId ? ('outgoing' as const) : ('incoming' as const),
          createdAt: c.createdAt.toISOString(),
        };
      }),
      follows: followRows.map((f) => ({ targetType: f.targetType, targetId: f.targetId, createdAt: f.createdAt.toISOString() })),
      consents: consentRows,
    };
  }
}
