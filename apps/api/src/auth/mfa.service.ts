import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import {
  MFA_DEFAULT_DEVICE_NAME,
  MFA_MAX_DEVICES,
  type AddMfaDeviceInput,
  type MfaDeviceSetup,
  type MfaDeviceView,
  type MfaSetupResponse,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { mfaDevices, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { SessionService } from '../core/session.service.js';
import { InjectRedis } from '../infra/redis.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../moderation/util.js';
import { AuthService } from './auth.service.js';
import { AuthMailer } from './auth-mail.js';
import { PasswordService } from './password.service.js';
import { AccountService } from './account.service.js';

/** TOTP parameters (CM-AUTH-09): issuer "Charter Mission", SHA-1, 6 digits, 30 s, ±1 step. */
export const TOTP_CONFIG = { issuer: 'Charter Mission', algorithm: 'SHA1', digits: 6, period: 30 } as const;
const WINDOW = 1;
const MFA_FAILURES = 5;
const MFA_WINDOW_SEC = 15 * 60;
/** A device being added must be confirmed within this long of its QR code being shown. */
const PENDING_DEVICE_TTL_MS = 15 * 60_000;

type DeviceRow = typeof mfaDevices.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** The two-step columns on the account's own row. */
type Account = { email: string; secretEnc: string | null; enabledAt: Date | null };

const deviceView = (d: DeviceRow): MfaDeviceView => ({
  id: d.id,
  name: d.name,
  addedAt: (d.confirmedAt ?? d.createdAt).toISOString(),
  lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
});

/**
 * TOTP multi-factor authentication, required for privileged roles' admin sessions and
 * optional for members. An account can have several devices (authenticator apps), each with its
 * own secret; a code from any confirmed one is accepted. Secrets are AES-256-GCM encrypted at
 * rest; codes cannot be reused.
 *
 * Every change to an account's devices (and the admin reset) first locks the account's row, so
 * they happen one at a time: an account with two-step verification on always keeps a confirmed
 * device, and one with it off has none that count.
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

  private async user(userId: string): Promise<Account> {
    const [row] = await this.db
      .select({ email: users.email, secretEnc: users.mfaSecretEnc, enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) throw Errors.unauthenticated();
    return row;
  }

  /** The account's row as it is now, locked until the transaction ends. */
  private async lockUser(tx: Tx, userId: string): Promise<Account> {
    const [row] = await tx
      .select({ email: users.email, secretEnc: users.mfaSecretEnc, enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!row) throw Errors.unauthenticated();
    return row;
  }

  private load(db: Db | Tx, userId: string): Promise<DeviceRow[]> {
    return db.select().from(mfaDevices).where(eq(mfaDevices.userId, userId)).orderBy(asc(mfaDevices.createdAt), asc(mfaDevices.id));
  }

  /**
   * The account's devices, oldest first.
   *
   * Accounts enrolled before devices existed keep their one secret on their own row
   * (users.mfa_secret_enc). The migration copied it into a device; this catches any it missed (an
   * account enrolled by the previous version while this one was starting): with two-step
   * verification on and no confirmed device, that secret becomes the device; with it off and no
   * device at all, a setup begun before carries on. It is decided from the row as it is now, under
   * the lock, never from what `seen` was read earlier, so a secret that was reset, turned off or
   * removed in the meantime can't come back.
   */
  private async devicesOf(userId: string, seen: Account): Promise<DeviceRow[]> {
    const rows = await this.load(this.db, userId);
    const missing = seen.enabledAt ? !rows.some((d) => d.confirmedAt) : rows.length === 0;
    if (!seen.secretEnc || !missing) return rows;
    return this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, userId);
      const current = await this.load(tx, userId);
      if (!live.secretEnc) return current;
      if (live.enabledAt && !current.some((d) => d.confirmedAt)) {
        await tx
          .insert(mfaDevices)
          .values({ userId, name: MFA_DEFAULT_DEVICE_NAME, secretEnc: live.secretEnc, confirmedAt: live.enabledAt, createdAt: live.enabledAt })
          .onConflictDoUpdate({ target: [mfaDevices.userId, mfaDevices.secretEnc], set: { confirmedAt: live.enabledAt } });
      } else if (!live.enabledAt && !current.length) {
        await tx.insert(mfaDevices).values({ userId, name: MFA_DEFAULT_DEVICE_NAME, secretEnc: live.secretEnc }).onConflictDoNothing();
      } else {
        return current;
      }
      return this.load(tx, userId);
    });
  }

  /**
   * A fresh secret as a device waiting to be confirmed; any earlier unconfirmed one is dropped.
   * `first`: the device that turns two-step verification on. While it is off nothing else counts,
   * so every other device row and the old secret on the account's row are cleared.
   */
  private async pendingDevice(userId: string, name: string, first: boolean): Promise<MfaDeviceSetup> {
    const secret = new Secret({ size: 20 });
    const { device, email } = await this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, userId);
      if (first) {
        if (live.enabledAt) throw Errors.conflict('Two-step verification is already on');
        await tx.delete(mfaDevices).where(eq(mfaDevices.userId, userId));
        if (live.secretEnc) await tx.update(users).set({ mfaSecretEnc: null }).where(eq(users.id, userId));
      } else {
        if (!live.enabledAt) throw Errors.conflict('Turn on two-step verification first');
        await tx.delete(mfaDevices).where(and(eq(mfaDevices.userId, userId), isNull(mfaDevices.confirmedAt)));
      }
      const [row] = await tx.insert(mfaDevices).values({ userId, name, secretEnc: encrypt(secret.base32) }).returning();
      return { device: row!, email: live.email };
    });
    const otpauthUrl = new TOTP({ ...TOTP_CONFIG, label: email, secret }).toString();
    const qrSvg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { deviceId: device.id, secret: secret.base32, otpauthUrl, qrSvg };
  }

  /** POST /auth/mfa/setup — the first device, waiting; mfaEnabledAt stays null until /enable. */
  async setup(ctx: AuthContext, ip?: string): Promise<MfaSetupResponse> {
    const { secret, otpauthUrl, qrSvg } = await this.pendingDevice(ctx.user.id, MFA_DEFAULT_DEVICE_NAME, true);
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.setup_started', targetType: 'user', targetId: ctx.user.id, ip });
    return { secret, otpauthUrl, qrSvg };
  }

  /** POST /auth/mfa/enable — confirms the waiting first device and verifies the current session. */
  async enable(ctx: AuthContext, code: string, ip?: string): Promise<void> {
    const user = await this.user(ctx.user.id);
    if (user.enabledAt) throw Errors.conflict('Two-step verification is already on');
    const pending = (await this.devicesOf(ctx.user.id, user)).filter((d) => !d.confirmedAt);
    if (!pending.length) throw Errors.badRequest('Start two-step verification setup first');
    const device = await this.checkOrFail(ctx.user.id, pending, code, ip);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, ctx.user.id);
      if (live.enabledAt) throw Errors.conflict('Two-step verification is already on');
      const [confirmed] = await tx
        .update(mfaDevices)
        .set({ confirmedAt: now, lastUsedAt: now })
        .where(and(eq(mfaDevices.id, device.id), eq(mfaDevices.userId, ctx.user.id), isNull(mfaDevices.confirmedAt)))
        .returning({ id: mfaDevices.id });
      // Setup was started again in the meantime (another tab): that newer QR code is the one to confirm.
      if (!confirmed) throw Errors.conflict('This setup was replaced by a newer one. Scan the new QR code and try again.');
      // Turning it on starts from this one device: nothing left over from before counts.
      await tx.delete(mfaDevices).where(and(eq(mfaDevices.userId, ctx.user.id), ne(mfaDevices.id, device.id)));
      await tx.update(users).set({ mfaEnabledAt: now, mfaSecretEnc: null }).where(eq(users.id, ctx.user.id));
    });
    await this.sessions.markMfaVerified(ctx.session.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.enabled', targetType: 'user', targetId: ctx.user.id, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_enabled', 'Two-step verification is on', [
      'Two-step verification was turned on for your Charter Mission account.',
    ]);
  }

  /** POST /auth/mfa/verify — second step after sign-in, with a code from any of the account's devices; 5 failures / 15 min, then 429. */
  async verify(ctx: AuthContext, code: string, ip?: string): Promise<void> {
    const user = await this.user(ctx.user.id);
    const devices = user.enabledAt ? await this.confirmed(ctx.user.id, user) : [];
    if (!devices.length) throw Errors.mfaSetupRequired();
    await this.checkOrFail(ctx.user.id, devices, code, ip);
    await this.sessions.markMfaVerified(ctx.session.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'auth.mfa.verified',
      targetType: 'session',
      targetId: ctx.session.id,
      ip,
    });
  }

  /** POST /auth/mfa/disable — members only; privileged roles must keep MFA (CM-AUTH-09). Every device goes. */
  async disable(ctx: AuthContext, password: string, ip?: string): Promise<void> {
    if (ctx.user.isStaff || (await this.auth.hasPrivilegedRole(ctx.user.id))) {
      throw Errors.forbidden('Your role requires two-step verification');
    }
    await this.account.confirmPassword(ctx.user.id, password);
    const user = await this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, ctx.user.id);
      if (!live.enabledAt) throw Errors.conflict('Two-step verification is already off');
      await tx.delete(mfaDevices).where(eq(mfaDevices.userId, ctx.user.id));
      await tx.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null }).where(eq(users.id, ctx.user.id));
      return live;
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.disabled', targetType: 'user', targetId: ctx.user.id, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_disabled', 'Two-step verification is off', [
      'Two-step verification was turned off for your Charter Mission account.',
    ]);
  }

  /* ----------------------------- Devices ----------------------------- */

  /** GET /auth/mfa/devices — the confirmed devices, oldest first (none while two-step verification is off). */
  async listDevices(ctx: AuthContext): Promise<MfaDeviceView[]> {
    const user = await this.user(ctx.user.id);
    if (!user.enabledAt) return [];
    return (await this.confirmed(ctx.user.id, user)).map(deviceView);
  }

  /**
   * POST /auth/mfa/devices — start adding another device. The member proves they hold one already
   * (a code from it); the new device's secret is shown once and waits for /confirm.
   */
  async addDevice(ctx: AuthContext, input: AddMfaDeviceInput, ip?: string): Promise<MfaDeviceSetup> {
    const { devices } = await this.manageable(ctx);
    if (devices.length >= MFA_MAX_DEVICES) throw Errors.conflict(`You can have up to ${MFA_MAX_DEVICES} devices. Remove one to add another.`);
    await this.checkOrFail(ctx.user.id, devices, input.code, ip);
    const setup = await this.pendingDevice(ctx.user.id, input.name, false);
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.device_add_started', targetType: 'user', targetId: ctx.user.id, after: { name: input.name }, ip });
    return setup;
  }

  /** POST /auth/mfa/devices/:id/confirm — a code from the new device makes it count. */
  async confirmDevice(ctx: AuthContext, deviceId: string, code: string, ip?: string): Promise<MfaDeviceView> {
    const { user, devices } = await this.manageable(ctx);
    const [pending] = isUuid(deviceId)
      ? await this.db
          .select()
          .from(mfaDevices)
          .where(and(eq(mfaDevices.id, deviceId), eq(mfaDevices.userId, ctx.user.id), isNull(mfaDevices.confirmedAt)))
          .limit(1)
      : [];
    if (!pending) throw Errors.notFound('That device');
    if (pending.createdAt.getTime() < Date.now() - PENDING_DEVICE_TTL_MS) {
      await this.db.delete(mfaDevices).where(and(eq(mfaDevices.id, pending.id), isNull(mfaDevices.confirmedAt)));
      throw Errors.conflict('That took too long. Start adding the device again.');
    }
    if (devices.length >= MFA_MAX_DEVICES) throw Errors.conflict(`You can have up to ${MFA_MAX_DEVICES} devices. Remove one to add another.`);
    await this.checkOrFail(ctx.user.id, [pending], code, ip);
    const now = new Date();
    const row = await this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, ctx.user.id);
      if (!live.enabledAt) throw Errors.conflict('Turn on two-step verification first');
      const held = await tx
        .select({ id: mfaDevices.id })
        .from(mfaDevices)
        .where(and(eq(mfaDevices.userId, ctx.user.id), isNotNull(mfaDevices.confirmedAt)));
      if (held.length >= MFA_MAX_DEVICES) throw Errors.conflict(`You can have up to ${MFA_MAX_DEVICES} devices. Remove one to add another.`);
      const [confirmed] = await tx
        .update(mfaDevices)
        .set({ confirmedAt: now, lastUsedAt: now })
        .where(and(eq(mfaDevices.id, pending.id), eq(mfaDevices.userId, ctx.user.id), isNull(mfaDevices.confirmedAt)))
        .returning();
      return confirmed;
    });
    // Gone in the meantime: replaced by another "add", or two-step verification was reset.
    if (!row) throw Errors.notFound('That device');
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.device_added', targetType: 'user', targetId: ctx.user.id, after: { name: pending.name }, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_device_added', 'A two-step device was added', [
      `A new device (“${pending.name}”) can now give sign-in codes for your Charter Mission account.`,
    ]);
    return deviceView(row);
  }

  /**
   * POST /auth/mfa/devices/:id/remove — with a code from any device on the account. The last one
   * stays. The account's other sessions are signed out: a session opened with the device being
   * removed (a lost phone) must not outlive it.
   */
  async removeDevice(ctx: AuthContext, deviceId: string, code: string, ip?: string): Promise<MfaDeviceView[]> {
    const { user, devices } = await this.manageable(ctx);
    const target = devices.find((d) => d.id === deviceId);
    if (!target) throw Errors.notFound('That device');
    if (devices.length <= 1) throw Errors.conflict('This is your only device. Add another one before removing it.');
    await this.checkOrFail(ctx.user.id, devices, code, ip);
    // Counted again under the lock, so two removals at once can't take the account's last two devices.
    const left = await this.db.transaction(async (tx) => {
      const live = await this.lockUser(tx, ctx.user.id);
      const held = (await this.load(tx, ctx.user.id)).filter((d) => d.confirmedAt);
      if (held.length <= 1 || !held.some((d) => d.id === target.id)) return null;
      await tx.delete(mfaDevices).where(eq(mfaDevices.id, target.id));
      // The device from before devices existed takes its copy on the account's row with it.
      if (live.secretEnc && live.secretEnc === target.secretEnc) await tx.update(users).set({ mfaSecretEnc: null }).where(eq(users.id, ctx.user.id));
      return held.filter((d) => d.id !== target.id);
    });
    if (!left) throw Errors.conflict('This is your only device. Add another one before removing it.');
    await this.sessions.revokeAll(ctx.user.id, ctx.session.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'auth.mfa.device_removed', targetType: 'user', targetId: ctx.user.id, before: { name: target.name }, ip });
    await this.mailer.security({ email: user.email, userId: ctx.user.id }, 'mfa_device_removed', 'A two-step device was removed', [
      `The device “${target.name}” can no longer give sign-in codes for your Charter Mission account, and your other sessions were signed out.`,
    ]);
    return left.map(deviceView);
  }

  /** Changing devices needs two-step verification on and this session to have passed it. */
  private async manageable(ctx: AuthContext) {
    const user = await this.user(ctx.user.id);
    if (!user.enabledAt) throw Errors.conflict('Turn on two-step verification first');
    if (!ctx.session.mfaVerified) throw Errors.mfaRequired();
    return { user, devices: await this.confirmed(ctx.user.id, user) };
  }

  private async confirmed(userId: string, seen: Account): Promise<DeviceRow[]> {
    return (await this.devicesOf(userId, seen)).filter((d) => d.confirmedAt);
  }

  /** The device the code belongs to (and a note of when it was last used), or a counted failure. */
  private async checkOrFail(userId: string, devices: DeviceRow[], code: string, ip?: string): Promise<DeviceRow> {
    const key = `mfa:fail:${userId}`;
    await this.limits.assertBelow(key, MFA_FAILURES);
    for (const device of devices) {
      if (!(await this.check(device, code))) continue;
      await this.limits.reset(key);
      await this.db.update(mfaDevices).set({ lastUsedAt: new Date() }).where(eq(mfaDevices.id, device.id));
      return device;
    }
    await this.limits.hit(key, MFA_WINDOW_SEC);
    await this.audit.record({ actorId: userId, action: 'auth.mfa.failure', targetType: 'user', targetId: userId, ip });
    throw Errors.invalidMfa();
  }

  /** Valid for this device within ±1 step and not a reuse of a time step it already accepted (replay protection). */
  private async check(device: DeviceRow, code: string): Promise<boolean> {
    let secret: Secret;
    try {
      secret = Secret.fromBase32(decrypt(device.secretEnc));
    } catch {
      return false;
    }
    const delta = TOTP.validate({ ...TOTP_CONFIG, token: code, secret, window: WINDOW });
    if (delta === null) return false;
    const step = TOTP.counter({ period: TOTP_CONFIG.period }) + delta;
    const lastKey = `mfa:last-step:${device.id}`;
    const last = Number((await this.redis.get(lastKey)) ?? -1);
    if (step <= last) return false;
    // NX on the exact step makes two concurrent submissions of one code race-safe.
    const claimed = await this.redis.set(`mfa:step:${device.id}:${step}`, '1', 'EX', 120, 'NX');
    if (claimed !== 'OK') return false;
    await this.redis.set(lastKey, String(step), 'EX', (WINDOW * 2 + 2) * TOTP_CONFIG.period);
    return true;
  }
}
