import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { createDb, createPool, type Db } from './client.js';
import * as s from './schema.js';
import { CHAPTERS, COUNTRIES, DEMO_PASSWORD, INTERESTS, LANGUAGES, MEMBERS, SECTORS, SKILLS } from './seed-data.js';
import { PERMISSIONS, ROLES } from '../core/permissions.js';
import { SETTING_DEFAULTS } from '../infra/settings.service.js';
import { DEFAULT_FIELD_VISIBILITY } from '@chartermission/contracts';
import { isMain } from './is-main.js';

const slug = (v: string) => v.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function seedReference(db: Db) {
  await db.insert(s.countries).values(COUNTRIES.map(([code, name, region]) => ({ code, name, region }))).onConflictDoNothing();
  for (const [table, items] of [
    [s.sectors, SECTORS],
    [s.skills, SKILLS],
    [s.interests, INTERESTS],
    [s.languages, LANGUAGES],
  ] as const) {
    await db
      .insert(table)
      .values(items.map((name, i) => ({ slug: slug(name), name, position: i })))
      .onConflictDoNothing();
  }
  await db
    .insert(s.chapters)
    .values(CHAPTERS.map(([sl, name, countryCode]) => ({ slug: sl, name, countryCode })))
    .onConflictDoNothing();
  await db
    .insert(s.permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoNothing();
  for (const [key, role] of Object.entries(ROLES)) {
    const [row] = await db
      .insert(s.roles)
      .values({ key, name: role.name, requiresMfa: role.requiresMfa })
      .onConflictDoUpdate({ target: s.roles.key, set: { name: role.name, requiresMfa: role.requiresMfa } })
      .returning({ id: s.roles.id });
    await db
      .insert(s.rolePermissions)
      .values(role.permissions.map((permissionKey) => ({ roleId: row!.id, permissionKey })))
      .onConflictDoNothing();
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.insert(s.platformSettings).values({ key, value }).onConflictDoNothing();
  }
}

/** Demo members (verified emails, completed onboarding). Returns user ids keyed by SeedMember.key. */
export async function seedMembers(db: Db): Promise<Record<string, string>> {
  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  const roleRows = await db.select().from(s.roles);
  const versions = SETTING_DEFAULTS.policy_versions;
  for (const m of MEMBERS) {
    const [u] = await db
      .insert(s.users)
      .values({
        email: m.email,
        passwordHash,
        status: 'active',
        emailVerifiedAt: new Date(),
        isStaff: !!m.staff,
        verifiedAt: m.verified || m.staff ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: s.users.id });
    const id =
      u?.id ?? (await db.select({ id: s.users.id }).from(s.users).where(sql`lower(email) = ${m.email}`))[0]!.id;
    ids[m.key] = id;
    await db
      .insert(s.memberProfiles)
      .values({
        userId: id,
        handle: m.handle,
        displayName: m.name,
        headline: m.headline,
        countryCode: m.country,
        city: m.city,
        bio: m.bio ?? null,
        organisation: m.organisation ?? null,
        avatarTone: m.tone,
        fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
        onboardingStep: 4,
        onboardingCompletedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.consentRecords)
      .values((['terms', 'privacy', 'guidelines'] as const).map((p) => ({ userId: id, policyType: p, policyVersion: versions[p] })))
      .onConflictDoNothing();
    for (const roleKey of m.roles ?? []) {
      const role = roleRows.find((r) => r.key === roleKey);
      if (role) await db.insert(s.userRoles).values({ userId: id, roleId: role.id }).onConflictDoNothing();
    }
  }
  return ids;
}

export async function resetDatabase(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(', ');
  // audit_log blocks DELETE/UPDATE but TRUNCATE is allowed for dev resets only.
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed demo data in production (pass --force for staging).');
  }
  const pool = createPool();
  const db = createDb(pool);
  try {
    if (process.argv.includes('--reset')) await resetDatabase(db);
    await seedReference(db);
    const ids = await seedMembers(db);
    try {
      const content = (await import('./seed-content.js')) as { seedContent?: (db: Db, ids: Record<string, string>) => Promise<void> };
      await content.seedContent?.(db, ids);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
    console.log(`Seeded ${Object.keys(ids).length} demo members (password: ${DEMO_PASSWORD})`);
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) await main();
