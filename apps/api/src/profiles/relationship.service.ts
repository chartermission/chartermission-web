import { Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Relationship } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { blocks, connections, follows } from '../db/schema.js';

const NONE: Omit<Relationship, 'self'> = {
  connection: 'none',
  connectionId: null,
  following: false,
  followsYou: false,
  blocked: false,
};

/** Read-side relationship facts between a viewer and many members, in a few batched queries. */
@Injectable()
export class RelationshipService {
  constructor(@InjectDb() private readonly db: Db) {}

  async many(viewerId: string | undefined, targetIds: string[]): Promise<Map<string, Relationship>> {
    const map = new Map<string, Relationship>();
    for (const id of targetIds) map.set(id, { ...NONE, self: id === viewerId });
    const others = targetIds.filter((id) => id !== viewerId);
    if (!viewerId || others.length === 0) return map;

    const [conns, followRows, blockRows] = await Promise.all([
      this.db
        .select({ id: connections.id, requesterId: connections.requesterId, addresseeId: connections.addresseeId, status: connections.status })
        .from(connections)
        .where(
          and(
            inArray(connections.status, ['pending', 'accepted']),
            or(
              and(eq(connections.requesterId, viewerId), inArray(connections.addresseeId, others)),
              and(eq(connections.addresseeId, viewerId), inArray(connections.requesterId, others)),
            ),
          ),
        ),
      this.db
        .select({ followerId: follows.followerId, targetId: follows.targetId })
        .from(follows)
        .where(
          and(
            eq(follows.targetType, 'member'),
            or(
              and(eq(follows.followerId, viewerId), inArray(follows.targetId, others)),
              and(eq(follows.targetId, viewerId), inArray(follows.followerId, others)),
            ),
          ),
        ),
      this.db
        .select({ blockedId: blocks.blockedId })
        .from(blocks)
        .where(and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, others))),
    ]);

    for (const c of conns) {
      const other = c.requesterId === viewerId ? c.addresseeId : c.requesterId;
      const rel = map.get(other);
      if (!rel) continue;
      rel.connectionId = c.id;
      rel.connection =
        c.status === 'accepted' ? 'connected' : c.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming';
    }
    for (const f of followRows) {
      if (f.followerId === viewerId) {
        const rel = map.get(f.targetId);
        if (rel) rel.following = true;
      } else {
        const rel = map.get(f.followerId);
        if (rel) rel.followsYou = true;
      }
    }
    for (const b of blockRows) {
      const rel = map.get(b.blockedId);
      if (rel) rel.blocked = true;
    }
    return map;
  }

  async one(viewerId: string | undefined, targetId: string): Promise<Relationship> {
    return (await this.many(viewerId, [targetId])).get(targetId)!;
  }

  /** Accepted connections of a member, as user ids. */
  async connectionIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ requesterId: connections.requesterId, addresseeId: connections.addresseeId })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)),
        ),
      );
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  /** Number of accepted connections each target shares with the viewer. */
  async mutualCounts(viewerId: string, targetIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(targetIds.map((id) => [id, 0]));
    if (targetIds.length === 0) return counts;
    const mine = await this.connectionIds(viewerId);
    if (mine.length === 0) return counts;
    const rows = await this.db
      .select({ requesterId: connections.requesterId, addresseeId: connections.addresseeId })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(
            and(inArray(connections.requesterId, targetIds), inArray(connections.addresseeId, mine)),
            and(inArray(connections.addresseeId, targetIds), inArray(connections.requesterId, mine)),
          ),
        ),
      );
    const targets = new Set(targetIds);
    const friends = new Set(mine);
    for (const r of rows) {
      if (targets.has(r.requesterId) && friends.has(r.addresseeId)) counts.set(r.requesterId, counts.get(r.requesterId)! + 1);
      if (targets.has(r.addresseeId) && friends.has(r.requesterId)) counts.set(r.addresseeId, counts.get(r.addresseeId)! + 1);
    }
    return counts;
  }
}
