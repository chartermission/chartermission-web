import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import type { MfaSetupResponse } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { SessionService } from '../core/session.service.js';
import { InjectRedis } from '../infra/redis.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { AuthService } from './auth.service.js';
import { AuthMailer } from './auth-mail.js';
import { PasswordService } from './password.service.js';
import { AccountService } from './account.service.js';

/** TOTP parameters (CM-AUTH-09): issuer "Charter Mission", SHA-1, 6 digits, 30 s, ±1 step. */
export const TOTP_CONFIG = { issuer: 'Charter Mission', algorithm: 'SHA1', digits: 6, period: 30 } as const;
const WINDOW = 1;
const MFA_FAILURES = 5;
const MFA_WINDOW_SEC = 15 * 60;

/**
 * TOTP multi-factor authentication, required for privileged roles' admin sessions and
 * optional for members. Secrets are AES-256-GCM encrypted at rest; codes cannot be reused.
 */
@Injectable()
export class MfaService {
  constructor(
    @InjectDb() private readonly db: Db,
    @InjectRedis() private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly passwords: PasswordService,
    private readonly mailer: AuthMailer,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private async user(userId: string) {
    const [row] = await this.db
      .select({ email: users.email, secretEnc: users.mfaSecretEnc, enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) throw Errors.unauthenticated();
    return row;
  }

  /** POST /auth/mfa/setup — stores a pending secret; mfaEnabledAt stays null until /enable. */
  async setup(ctx: AuthContext, ip?: string): Promise<MfaSetupResponse> {
    const user = await this.user(ctx.user.id);
    if (user.enabledAt) throw Errors.conflict('Two-step verification is already on');
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ ...TOTP_CONFIG, label: user.email, secret });
    await this.db.update(users).set({ mfaSecretEnc: encrypt(secret.base32) }).where(eq(users.id, ctx.user.id));
    const otpauthUrl = totp.toString();
    const qrSvg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.setup_started', targetType: 'user', targetId: ctx.user.id, ip });
    return { secret: secret.base32, otpauthUrl, qrSvg };
  }

  /** POST /auth/mfa/enable — confirms the pending secret and verifies the current session. */
  async enable(ctx: AuthContext, code: string, ip?: string): Promise<void> {
    const user = await this.user(ctx.user.id);
    if (user.enabledAt) throw Errors.conflict('Two-step verification is already on');
    if (!user.secretEnc) throw Errors.badRequest('Start two-step verification setup first');
    await this.checkOrFail(ctx.user.id, user.secretEnc, code, ip);
    await this.db.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, ctx.user.id));
    await this.sessions.markMfaVerified(ctx.session.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.enabled', targetType: 'user', targetId: ctx.user.id, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_enabled', 'Two-step verification is on', [
      'Two-step verification was turned on for your Charter Mission account.',
    ]);
  }

  /** POST /auth/mfa/verify — second step after an admin sign-in; 5 failures / 15 min, then 429. */
  async verify(ctx: AuthContext, code: string, ip?: string): Promise<void> {
    const user = await this.user(ctx.user.id);
    if (!user.enabledAt || !user.secretEnc) throw Errors.mfaSetupRequired();
    await this.checkOrFail(ctx.user.id, user.secretEnc, code, ip);
    await this.sessions.markMfaVerified(ctx.session.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'auth.mfa.verified',
      targetType: 'session',
      targetId: ctx.session.id,
      ip,
    });
  }

  /** POST /auth/mfa/disable — members only; privileged roles must keep MFA (CM-AUTH-09). */
  async disable(ctx: AuthContext, password: string, ip?: string): Promise<void> {
    if (await this.auth.hasPrivilegedRole(ctx.user.id)) {
      throw Errors.forbidden('Your role requires two-step verification');
    }
    await this.account.confirmPassword(ctx.user.id, password);
    const user = await this.user(ctx.user.id);
    if (!user.enabledAt) throw Errors.conflict('Two-step verification is already off');
    await this.db.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null }).where(eq(users.id, ctx.user.id));
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.disabled', targetType: 'user', targetId: ctx.user.id, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_disabled', 'Two-step verification is off', [
      'Two-step verification was turned off for your Charter Mission account.',
    ]);
  }

  private async checkOrFail(userId: string, secretEnc: string, code: string, ip?: string) {
    const key = `mfa:fail:${userId}`;
    await this.limits.assertBelow(key, MFA_FAILURES);
    if (await this.check(userId, secretEnc, code)) {
      await this.limits.reset(key);
      return;
    }
    await this.limits.hit(key, MFA_WINDOW_SEC);
    await this.audit.record({ actorId: userId, action: 'auth.mfa.failure', targetType: 'user', targetId: userId, ip });
    throw Errors.invalidMfa();
  }

  /** Valid within ±1 step and not a reuse of an already accepted time step (replay protection). */
  private async check(userId: string, secretEnc: string, code: string): Promise<boolean> {
    let secret: Secret;
    try {
      secret = Secret.fromBase32(decrypt(secretEnc));
    } catch {
      return false;
    }
    const delta = TOTP.validate({ ...TOTP_CONFIG, token: code, secret, window: WINDOW });
    if (delta === null) return false;
    const step = TOTP.counter({ period: TOTP_CONFIG.period }) + delta;
    const lastKey = `mfa:last-step:${userId}`;
    const last = Number((await this.redis.get(lastKey)) ?? -1);
    if (step <= last) return false;
    // NX on the exact step makes two concurrent submissions of one code race-safe.
    const claimed = await this.redis.set(`mfa:step:${userId}:${step}`, '1', 'EX', 120, 'NX');
    if (claimed !== 'OK') return false;
    await this.redis.set(lastKey, String(step), 'EX', (WINDOW * 2 + 2) * TOTP_CONFIG.period);
    return true;
  }
}
