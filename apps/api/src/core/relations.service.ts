import { Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { blocks, connections } from '../db/schema.js';

/**
 * Block and connection lookups used by every interaction check (spec 4.5, 4.6, 5.1).
 * Blocking works both ways: neither side sees or reaches the other.
 */
@Injectable()
export class RelationsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const rows = await this.db
      .select({ x: sql`1` })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
          and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Every user id the viewer has blocked or been blocked by. */
  async blockedSet(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
    return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
  }

  /** SQL fragment: true when `column` is NOT a user blocked either way with the viewer. */
  notBlockedSql(viewerId: string, column: Parameters<typeof sql>[1]) {
    return sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${column}) or (b.blocked_id = ${viewerId} and b.blocker_id = ${column}))`;
  }

  async areConnected(a: string, b: string): Promise<boolean> {
    if (a === b) return true;
    const rows = await this.db
      .select({ x: sql`1` })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(
            and(eq(connections.requesterId, a), eq(connections.addresseeId, b)),
            and(eq(connections.requesterId, b), eq(connections.addresseeId, a)),
          ),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
