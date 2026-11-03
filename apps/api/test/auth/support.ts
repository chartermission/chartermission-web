import { and, desc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import { client, lastEmail, s, tokenFrom, type TestApp } from '../helpers.js';

/** A password that passes every rule (length, common list, name/email checks). */
export const STRONG = 'Savanna-Lantern-42-Orbit';

/** Clear rate-limit and MFA replay keys so tests in one file don't trip each other's limits. */
export async function resetLimits() {
  const redis = new Redis(process.env.REDIS_URL!);
  const keys = [...(await redis.keys('rl:*')), ...(await redis.keys('mfa:*'))];
  if (keys.length) await redis.del(...keys);
  await redis.quit();
}

export async function setLimitCounter(key: string, value: number) {
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.set(`rl:${key}`, String(value), 'EX', 3600);
  await redis.quit();
}

let n = 0;
export function uniqueEmail(prefix = 'member') {
  n += 1;
  return `${prefix}.${Date.now().toString(36)}${n}@example.test`;
}

/** Registers through the API, verifies through the emailed link, and signs in. */
export async function registerVerified(
  t: TestApp,
  opts: { name?: string; email?: string; country?: string; verify?: boolean } = {},
) {
  const name = opts.name ?? `Kofi Boateng`;
  const email = opts.email ?? uniqueEmail('kofi');
  const c = client(t);
  await c
    .post('/auth/register', { name, email, password: STRONG, country: opts.country ?? 'GH', acceptTerms: true })
    .expect(202);
  if (opts.verify !== false) {
    const mail = await lastEmail(t.db, email);
    await c.post('/auth/verify', { token: tokenFrom(mail?.textBody) }).expect(200);
  }
  await c.post('/auth/login', { email, password: STRONG }).expect(200);
  const [user] = await t.db.select().from(s.users).where(eq(s.users.email, email));
  return { ...c, email, name, id: user!.id };
}

export async function userByEmail(t: TestApp, email: string) {
  const [user] = await t.db.select().from(s.users).where(eq(s.users.email, email));
  return user!;
}

export async function profileOf(t: TestApp, userId: string) {
  const [p] = await t.db.select().from(s.memberProfiles).where(eq(s.memberProfiles.userId, userId));
  return p!;
}

export async function notificationsFor(t: TestApp, userId: string, type?: string) {
  return t.db
    .select()
    .from(s.notifications)
    .where(type ? and(eq(s.notifications.userId, userId), eq(s.notifications.type, type)) : eq(s.notifications.userId, userId))
    .orderBy(desc(s.notifications.createdAt));
}

export function totp(secret: string, offsetSteps = 0) {
  return TOTP.generate({ secret: Secret.fromBase32(secret), timestamp: Date.now() + offsetSteps * 30_000 });
}
