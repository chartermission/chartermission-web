import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { roles, userRoles } from '../db/schema.js';
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
  const rows = await db
    .select({ scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, user.id), isNull(userRoles.revokedAt), eq(roles.key, 'ambassador_manager')));
  if (rows.some((r) => !r.scopeType)) return { all: true };
  return { all: false, countries: [...new Set(rows.filter((r) => r.scopeType === 'country' && r.scopeId).map((r) => r.scopeId!))] };
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
