import { Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { ChangeEmailInput, CorrectEmailInput, EmailChangeResult } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { memberProfiles, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { isUniqueViolation } from '../profiles/pg-error.js';
import { AccountService } from './account.service.js';
import { AuthMailer } from './auth-mail.js';
import { LIMITS, loginAccountKey } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';

/** Statuses whose email can still be changed (deleted and queued-for-deletion accounts cannot). */
const CHANGEABLE = ['unverified', 'active', 'deactivated', 'suspended'];
const TAKEN = 'That email is already used by another Charter Mission account';

/**
 * Changing an account's email address.
 *
 * - Confirmed accounts: the new address must be proven first. It is kept as `pending_email` and gets
 *   a single-use link (24 hours); the current address gets a heads-up and stays in use until the
 *   link is opened, so a typo in the new address never locks anyone out.
 * - Accounts that never confirmed their address (the usual case: a typo at sign-up) switch at once,
 *   because nobody proved the old address, and the verification link goes to the new one.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly account: AccountService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly mailer: AuthMailer,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private async user(userId: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!row || !CHANGEABLE.includes(row.status)) throw Errors.forbidden('This account’s email can’t be changed.');
    return row;
  }

  /** Throws when another account (any status but deleted) already uses the address. */
  private async assertFree(email: string, userId: string) {
    const [other] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email), ne(users.id, userId), ne(users.status, 'deleted')))
      .limit(1);
    if (other) throw Errors.validation({ email: TAKEN });
  }

  private async nameOf(userId: string) {
    const [p] = await this.db.select({ name: memberProfiles.displayName }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
    return p?.name ?? 'there';
  }

  /** POST /me/email */
  async request(ctx: AuthContext, input: ChangeEmailInput, ip?: string): Promise<EmailChangeResult> {
    await this.account.confirmPassword(ctx.user.id, input.password);
    const user = await this.user(ctx.user.id);
    if (user.email.toLowerCase() === input.email) throw Errors.validation({ email: 'That’s already your email address' });
    await this.limits.consume(`email-change:${user.id}`, LIMITS.emailPerAccountHour, 3600);
    await this.assertFree(input.email, user.id);

    if (!user.emailVerifiedAt) {
      await this.replaceUnconfirmed(user, input.email, ip);
      return { status: 'changed', email: input.email };
    }
    await this.db.update(users).set({ pendingEmail: input.email, pendingEmailAt: new Date() }).where(eq(users.id, user.id));
    const token = await this.tokens.issue(user.id, 'email_change');
    await this.mailer.emailChangeConfirm({ email: input.email, userId: user.id }, token);
    await this.mailer.emailChangeRequested({ email: user.email, userId: user.id }, input.email);
    await this.audit.record({
      actorId: user.id,
      action: 'account.email_change_requested',
      targetType: 'user',
      targetId: user.id,
      after: { pendingEmail: input.email },
      ip,
    });
    return { status: 'pending', email: input.email };
  }

  /** POST /me/email/resend */
  async resend(ctx: AuthContext): Promise<void> {
    const user = await this.user(ctx.user.id);
    if (!user.pendingEmail) throw Errors.validation({ email: 'There’s no email change waiting to be confirmed' });
    await this.limits.consume(`email-change:${user.id}`, LIMITS.emailPerAccountHour, 3600);
    const token = await this.tokens.issue(user.id, 'email_change');
    await this.mailer.emailChangeConfirm({ email: user.pendingEmail, userId: user.id }, token);
  }

  /** DELETE /me/email */
  async cancel(ctx: AuthContext, ip?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ pendingEmail: null, pendingEmailAt: null }).where(eq(users.id, ctx.user.id));
      await this.tokens.retireAll(ctx.user.id, 'email_change', tx);
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'account.email_change_cancelled', targetType: 'user', targetId: ctx.user.id, ip });
  }

  /** POST /auth/email/confirm — opened from the link in the new inbox; the new address becomes the account's email. */
  async confirm(token: string, ip?: string): Promise<void> {
    const done = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(token, 'email_change', tx);
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || !user.pendingEmail || !CHANGEABLE.includes(user.status)) throw Errors.invalidToken();
      const [other] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(sql`lower(${users.email})`, user.pendingEmail), ne(users.id, userId), ne(users.status, 'deleted')))
        .limit(1);
      if (other) throw Errors.validation({ token: TAKEN });
      try {
        await tx
          .update(users)
          .set({
            email: user.pendingEmail,
            emailVerifiedAt: new Date(),
            status: sql`case when ${users.status} = 'unverified' then 'active' else ${users.status} end`,
            pendingEmail: null,
            pendingEmailAt: null,
          })
          .where(eq(users.id, userId));
      } catch (error) {
        if (isUniqueViolation(error)) throw Errors.validation({ token: TAKEN });
        throw error;
      }
      await this.tokens.retireAll(userId, 'email_change', tx);
      await this.tokens.retireAll(userId, 'verify', tx);
      return { userId, from: user.email, to: user.pendingEmail };
    });
    await this.mailer.emailChanged({ email: done.from, userId: done.userId }, done.to);
    await this.audit.record({
      actorId: done.userId,
      action: 'account.email_changed',
      targetType: 'user',
      targetId: done.userId,
      before: { email: done.from },
      after: { email: done.to },
      ip,
    });
  }

  /**
   * POST /auth/email/correct — on the "check your email" page right after sign-up, before the member
   * has signed in: the password proves it's their account; only accounts that never confirmed their
   * address qualify. Counts towards the same failure limits as signing in.
   */
  async correct(input: CorrectEmailInput, ip?: string): Promise<void> {
    const accountKey = loginAccountKey(input.email);
    const ipKey = `login:fail:ip:${ip ?? 'unknown'}`;
    await this.limits.assertBelow(accountKey, LIMITS.loginFailures);
    await this.limits.assertBelow(ipKey, LIMITS.loginFailuresPerIp);
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, input.email), inArray(users.status, CHANGEABLE)))
      .limit(1);
    const ok = user ? await this.passwords.verify(user.passwordHash, input.password) : (await this.passwords.dummyVerify(input.password), false);
    if (!ok || !user) {
      await this.limits.hit(accountKey, LIMITS.loginWindowSec);
      await this.limits.hit(ipKey, LIMITS.loginWindowSec);
      throw Errors.validation({ password: 'That email and password don’t match an account' });
    }
    await this.limits.reset(accountKey);
    if (user.emailVerifiedAt) throw Errors.validation({ newEmail: 'This account’s email is already confirmed. Sign in and change it in Settings.' });
    if (input.newEmail === user.email.toLowerCase()) throw Errors.validation({ newEmail: 'That’s the email you signed up with' });
    await this.limits.consume(`email-change:${user.id}`, LIMITS.emailPerAccountHour, 3600);
    const [other] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, input.newEmail), ne(users.id, user.id), ne(users.status, 'deleted')))
      .limit(1);
    if (other) throw Errors.validation({ newEmail: TAKEN });
    await this.replaceUnconfirmed(user, input.newEmail, ip);
  }

  /** Unconfirmed accounts: switch the address now and send the verification link there. */
  private async replaceUnconfirmed(user: typeof users.$inferSelect, email: string, ip?: string) {
    const token = await this.db.transaction(async (tx) => {
      try {
        await tx.update(users).set({ email, pendingEmail: null, pendingEmailAt: null }).where(eq(users.id, user.id));
      } catch (error) {
        if (isUniqueViolation(error)) throw Errors.validation({ email: TAKEN });
        throw error;
      }
      await this.tokens.retireAll(user.id, 'email_change', tx);
      return this.tokens.issue(user.id, 'verify', tx);
    });
    await this.mailer.verification({ email, userId: user.id }, await this.nameOf(user.id), token);
    await this.audit.record({
      actorId: user.id,
      action: 'account.email_corrected',
      targetType: 'user',
      targetId: user.id,
      before: { email: user.email },
      after: { email },
      ip,
    });
  }
}
