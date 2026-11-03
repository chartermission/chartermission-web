import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { BlockView, MuteInput, MuteView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { blocks, connections, follows, mutes } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { ProfilesService } from './profiles.service.js';
import { normaliseHashtag } from './follows.service.js';

/** Blocks (CM-PRF-06, CM-NET-06) and mutes. Neither side is told. */
@Injectable()
export class BlocksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly profiles: ProfilesService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
  ) {}

  private async memberId(userId: string, idOrHandle: string): Promise<string> {
    const row = await this.profiles.findRow(idOrHandle);
    if (!row || row.status === 'deleted') throw Errors.notFound('Member');
    if (row.userId === userId) throw Errors.badRequest('You can’t do that to yourself');
    return row.userId;
  }

  /**
   * POST /blocks/{memberId}. Spec 4.6 rule: blocking removes any connection and follow
   * both ways and prevents new requests, follows, comments and mentions.
   */
  async block(userId: string, target: string, ip?: string): Promise<void> {
    const targetId = await this.memberId(userId, target);
    const pair = or(
      and(eq(connections.requesterId, userId), eq(connections.addresseeId, targetId)),
      and(eq(connections.requesterId, targetId), eq(connections.addresseeId, userId)),
    );
    const now = new Date();
    const created = await this.db.transaction(async (tx) => {
      const rows = await tx.insert(blocks).values({ blockerId: userId, blockedId: targetId }).onConflictDoNothing().returning();
      await tx
        .update(connections)
        .set({ status: 'removed', respondedAt: now })
        .where(and(pair, eq(connections.status, 'accepted')));
      await tx
        .update(connections)
        .set({ status: 'withdrawn', respondedAt: now })
        .where(and(pair, eq(connections.status, 'pending')));
      await tx
        .delete(follows)
        .where(
          and(
            eq(follows.targetType, 'member'),
            or(
              and(eq(follows.followerId, userId), eq(follows.targetId, targetId)),
              and(eq(follows.followerId, targetId), eq(follows.targetId, userId)),
            ),
          ),
        );
      return rows.length > 0;
    });
    if (created) await this.audit.record({ actorId: userId, action: 'member.block', targetType: 'user', targetId, ip });
  }

  /** DELETE /blocks/{memberId}. Removed connections and follows are not restored. */
  async unblock(userId: string, target: string, ip?: string): Promise<void> {
    const targetId = await this.memberId(userId, target);
    const rows = await this.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, targetId)))
      .returning();
    if (rows.length > 0) await this.audit.record({ actorId: userId, action: 'member.unblock', targetType: 'user', targetId, ip });
  }

  /** GET /me/blocks — members this member blocked (never who blocked them). */
  async list(userId: string): Promise<BlockView[]> {
    const rows = await this.db
      .select({ blockedId: blocks.blockedId, createdAt: blocks.createdAt })
      .from(blocks)
      .where(eq(blocks.blockerId, userId))
      .orderBy(desc(blocks.createdAt))
      .limit(500);
    const refs = await this.members.refs(rows.map((r) => r.blockedId));
    return rows
      .filter((r) => refs.has(r.blockedId))
      .map((r) => ({ member: refs.get(r.blockedId)!, createdAt: r.createdAt.toISOString() }));
  }

  private async muteTarget(userId: string, input: MuteInput): Promise<string> {
    if (input.targetType === 'hashtag') return normaliseHashtag(input.targetId).tag;
    return this.memberId(userId, input.targetId);
  }

  /** POST /mutes — hides a member's or hashtag's posts from the viewer's feeds (honoured by the feed). */
  async mute(userId: string, input: MuteInput): Promise<void> {
    const targetId = await this.muteTarget(userId, input);
    await this.db.insert(mutes).values({ userId, targetType: input.targetType, targetId }).onConflictDoNothing();
  }

  /** DELETE /mutes */
  async unmute(userId: string, input: MuteInput): Promise<void> {
    const targetId = await this.muteTarget(userId, input);
    await this.db
      .delete(mutes)
      .where(and(eq(mutes.userId, userId), eq(mutes.targetType, input.targetType), eq(mutes.targetId, targetId)));
  }

  /** GET /me/mutes */
  async listMutes(userId: string): Promise<MuteView[]> {
    const rows = await this.db
      .select({ targetType: mutes.targetType, targetId: mutes.targetId, createdAt: mutes.createdAt })
      .from(mutes)
      .where(and(eq(mutes.userId, userId), inArray(mutes.targetType, ['member', 'hashtag'])))
      .orderBy(desc(mutes.createdAt))
      .limit(500);
    const refs = await this.members.refs(rows.filter((r) => r.targetType === 'member').map((r) => r.targetId));
    return rows.map((r) => {
      const view: MuteView = {
        targetType: r.targetType as MuteView['targetType'],
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
      };
      const ref = r.targetType === 'member' ? refs.get(r.targetId) : undefined;
      if (ref) view.member = ref;
      return view;
    });
  }
}
