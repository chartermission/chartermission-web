import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Official (staff) accounts are follow-only. When an account becomes one, the members connected
 * to it, or waiting on a request they sent it, follow it instead, and its connections are closed.
 * Safe to run again (migration 0011 does the same for accounts that were already staff).
 */
export async function closeStaffConnections(db: Pick<Db, 'execute'>, userId: string): Promise<void> {
  await db.execute(sql`
    insert into follows (follower_id, target_type, target_id)
    select c.requester_id, 'member', c.addressee_id::text from connections c
      where c.addressee_id = ${userId} and c.status in ('pending','accepted')
    union
    select c.addressee_id, 'member', c.requester_id::text from connections c
      where c.requester_id = ${userId} and c.status = 'accepted'
    on conflict do nothing
  `);
  await db.execute(sql`
    update connections set status = case when status = 'accepted' then 'removed' else 'withdrawn' end, responded_at = now(), updated_at = now()
    where status in ('pending','accepted') and (requester_id = ${userId} or addressee_id = ${userId})
  `);
}
