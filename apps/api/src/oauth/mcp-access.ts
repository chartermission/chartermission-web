import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { mcpAccessGrants, oauthGrants, users } from '../db/schema.js';

/**
 * The one rule for Claude (MCP) access: staff accounts, and members an admin switched on, while
 * the account isn't deleted. Everything that issues or honours a token asks this.
 */
export async function hasMcpAccess(
  db: Db | Tx,
  user: { id: string; isStaff: boolean; status: string },
): Promise<boolean> {
  if (user.status === 'deleted') return false;
  if (user.isStaff) return true;
  const [row] = await db
    .select({ userId: mcpAccessGrants.userId })
    .from(mcpAccessGrants)
    .where(eq(mcpAccessGrants.userId, user.id))
    .limit(1);
  return !!row;
}

/** hasMcpAccess as SQL over the `users` table, for lists and filters (same rule). */
export function mcpAccessSql(): SQL<boolean> {
  return sql<boolean>`(${users.status} <> 'deleted' and (${users.isStaff} or exists (select 1 from ${mcpAccessGrants} mag where mag.user_id = ${users.id})))`;
}

/** Live Claude connections of the row's user (not revoked, refresh token still valid). */
export function mcpConnectionsSql(): SQL<number> {
  return sql<number>`(select count(*)::int from ${oauthGrants} og where og.user_id = ${users.id} and og.revoked_at is null and og.refresh_expires_at > now())`;
}
