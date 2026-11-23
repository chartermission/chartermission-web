import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { rolePermissions, roles, userRoles } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';

/** Which countries' leads someone may see and edit. */
export type AmbassadorScope = { all: true } | { all: false; countries: string[] };

/**
 * Platform Admins and above (ambassador.managers) cover every country. A manager covers the
 * countries on their ambassador_manager role rows; a row with no scope means every country.
 */
export async function scopeFor(db: Db | Tx, user: AuthUser): Promise<AmbassadorScope> {
  if (user.permissions.has('ambassador.managers')) return { all: true };
  return managerScope(db, user.id);
}

/** What someone's ambassador_manager role rows cover. */
async function managerScope(db: Db | Tx, userId: string): Promise<AmbassadorScope> {
  const rows = await db
    .select({ scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt), eq(roles.key, 'ambassador_manager')));
  if (rows.some((r) => !r.scopeType)) return { all: true };
  return { all: false, countries: [...new Set(rows.filter((r) => r.scopeType === 'country' && r.scopeId).map((r) => r.scopeId!))] };
}

/**
 * The countries someone else covers (for choosing a lead's owner), by the same rules as scopeFor:
 * ambassador.managers through any active role covers every country, otherwise their
 * ambassador_manager rows decide.
 */
export async function scopeForUserId(db: Db | Tx, userId: string): Promise<AmbassadorScope> {
  const [all] = await db
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt), eq(rolePermissions.permissionKey, 'ambassador.managers')))
    .limit(1);
  if (all) return { all: true };
  return managerScope(db, userId);
}

export function covers(scope: AmbassadorScope, countryCode: string): boolean {
  return scope.all || scope.countries.includes(countryCode);
}

/** 404 rather than 403 for leads outside the scope, so other countries' leads stay invisible. */
export function assertCovers(scope: AmbassadorScope, countryCode: string, what: 'lead' | 'country' = 'lead') {
  if (covers(scope, countryCode)) return;
  if (what === 'lead') throw Errors.notFound('That lead');
  throw Errors.forbidden('You don’t manage ambassador leads for that country');
}
