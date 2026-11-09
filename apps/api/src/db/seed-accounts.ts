import { createHash } from 'node:crypto';
import { and, inArray, isNull } from 'drizzle-orm';
import { Secret } from 'otpauth';
import type { Db } from './client.js';
import * as s from './schema.js';
import { encrypt } from '../common/crypto.js';
import { MEMBERS } from './seed-data.js';

/**
 * The two-step verification secret of a demo staff account: derived from its email, so it is the same on
 * every machine that runs the seed and can be shared with testers (docs: demo accounts PDF).
 */
export function demoMfaSecret(email: string): string {
  const bytes = createHash('sha256').update(`charter-mission-demo-mfa:${email.toLowerCase()}`).digest().subarray(0, 20);
  return new Secret({ buffer: Uint8Array.from(bytes).buffer }).base32;
}

/** Seeded staff accounts: flagged as staff or holding a role. Two-step verification is mandatory for them. */
export const SEED_STAFF_EMAILS = MEMBERS.filter((m) => m.staff || (m.roles?.length ?? 0) > 0).map((m) => m.email.toLowerCase());

/**
 * Development and staging only (never with NODE_ENV=production): the seeded staff accounts get two-step
 * verification turned on with the known secret, so testers add them to an authenticator app instead of
 * each enrolling their own. Accounts that already set it up keep their own secret. In production staff
 * enrol on their first sign-in (it is enforced in both the admin console and the member app).
 */
export async function seedDemoMfa(db: Db): Promise<string[]> {
  if (process.env.NODE_ENV === 'production' || !SEED_STAFF_EMAILS.length) return [];
  const rows = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(and(inArray(s.users.email, SEED_STAFF_EMAILS), isNull(s.users.mfaEnabledAt)));
  for (const r of rows) {
    await db
      .update(s.users)
      .set({ mfaSecretEnc: encrypt(demoMfaSecret(r.email)), mfaEnabledAt: new Date() })
      .where(inArray(s.users.id, [r.id]));
  }
  return rows.map((r) => r.email);
}
