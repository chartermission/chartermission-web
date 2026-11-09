import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb, createPool } from './client.js';
import * as s from './schema.js';
import { seedReference } from './seed.js';
import { isMain } from './is-main.js';

/**
 * Production-safe setup, idempotent (no demo data):
 *   node dist/db/bootstrap.js                        reference data: countries, taxonomies, chapters,
 *                                                    roles, permissions and setting defaults
 *   node dist/db/bootstrap.js --super-admin <email>  also makes an existing, registered account a Super Admin
 * The Docker image runs the first form on every start so roles and permissions follow the code.
 */
export async function bootstrap(superAdminEmail?: string) {
  const pool = createPool();
  const db = createDb(pool);
  try {
    await seedReference(db);
    if (!superAdminEmail) return;
    const email = superAdminEmail.trim().toLowerCase();
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(sql`lower(${s.users.email}) = ${email}`)
      .limit(1);
    if (!user) throw new Error(`No account with the email ${email}. Register it on the member site first.`);
    const [role] = await db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, 'super_admin')).limit(1);
    if (!role) throw new Error('The super_admin role is missing after seeding reference data.');
    await db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, user.id));
    const existing = await db
      .select({ id: s.userRoles.id })
      .from(s.userRoles)
      .where(
        and(
          eq(s.userRoles.userId, user.id),
          eq(s.userRoles.roleId, role.id),
          sql`${s.userRoles.scopeType} is null`,
          isNull(s.userRoles.revokedAt),
        ),
      )
      .limit(1);
    if (!existing.length) await db.insert(s.userRoles).values({ userId: user.id, roleId: role.id });
    console.log(`${email} is a Super Admin. Two-step verification setup is required at the next sign-in.`);
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--super-admin');
  await bootstrap(i > -1 ? process.argv[i + 1] : undefined);
  console.log('Reference data is up to date');
}
