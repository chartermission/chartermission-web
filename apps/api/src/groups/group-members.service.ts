import { RelationshipService } from '../profiles/relationship.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  BulkResult,
  GroupDetail,
  GroupInviteInput,
  GroupJoinInput,
  GroupMemberAction,
  GroupMemberStatus,
  GroupMemberView,
  GroupMembersBulkInput,
  GroupMembersQuery,
  GroupRole,
  Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { groupMembers, groups, memberProfiles, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { likePrefix } from '../moderation/util.js';
import { notBlockedSql } from '../posts/visibility.js';
import { roleAtLeast, syncGroupMemberCount, type GroupAccess, type GroupRow } from './group-access.js';
import { GroupsService } from './groups.service.js';

/** Invitations one member may send per day, across groups (against spam). */
export const GROUP_INVITES_PER_DAY = 200;
/** Join requests one member may send per day. */
export const GROUP_JOINS_PER_DAY = 50;

const RANK: Record<GroupRole, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

type MemberRow = typeof groupMembers.$inferSelect;

/**
 * Memberships: joining, asking, invitations, leaving, and what moderators, admins and the owner do with
 * members. member_count (active members only) is recounted in the same transaction as every change,
 * with the group row locked so concurrent changes can't miscount.
 */
@Injectable()
export class GroupMembersService {
  private readonly logger = new Logger('GroupMembers');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly groupsService: GroupsService,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly relationships: RelationshipService,
  ) {}

  /** Runs a membership change with the group row locked, then recounts its active members. */
  private async change<T>(groupId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${groups} where id = ${groupId} for update`);
      const out = await fn(tx);
      await syncGroupMemberCount(tx, groupId);
      return out;
    });
  }

  private async row(groupId: string, userId: string, tx: Pick<Db, 'select'> = this.db): Promise<MemberRow | undefined> {
    const [row] = await tx
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    return row;
  }

  private async fresh(user: AuthUser, groupId: string): Promise<GroupDetail> {
    const { row, access } = await this.groupsService.visibleRow(user, groupId);
    return this.groupsService.toDetail(row, access, user);
  }

  /**
   * POST /groups/{slug}/join: join a public group at once, ask to join a private one (answering its
   * question, if it has one), or accept an invitation. Banned members can't come back; archived and
   * suspended groups take no one.
   */
  async join(user: AuthUser, idOrSlug: string, input: GroupJoinInput): Promise<GroupDetail> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    const status = access.membership.status;
    if (status === 'banned') throw Errors.forbidden('You can’t join this group');
    if (status === 'active' || access.role !== null) throw Errors.conflict('You’re already in this group');
    if (status === 'pending') throw Errors.conflict('You already asked to join. The group’s admins will decide.');
    if (row.status !== 'active') throw Errors.conflict(row.status === 'archived' ? 'This group is archived and doesn’t take new members.' : 'This group doesn’t take new members right now.');
    if (status === 'invited' || row.visibility === 'public') {
      await this.change(row.id, async (tx) => {
        const now = new Date();
        await tx
          .insert(groupMembers)
          .values({ groupId: row.id, userId: user.id, role: 'member', status: 'active', joinedAt: now })
          .onConflictDoUpdate({
            target: [groupMembers.groupId, groupMembers.userId],
            set: { status: 'active', role: 'member', joinedAt: now, updatedAt: now },
            where: sql`${groupMembers.status} in ('invited','pending')`,
          });
      });
      return this.fresh(user, row.id);
    }
    const answer = input.answer?.trim() || null;
    if (row.joinQuestion && !answer) throw Errors.validation({ answer: 'Answer the group’s question to ask to join' });
    await this.limits.consume(`group-join:${user.id}`, GROUP_JOINS_PER_DAY, 24 * 3600, `You can ask to join ${GROUP_JOINS_PER_DAY} groups a day.`);
    await this.change(row.id, async (tx) => {
      await tx
        .insert(groupMembers)
        .values({ groupId: row.id, userId: user.id, role: 'member', status: 'pending', requestAnswer: row.joinQuestion ? answer : null })
        .onConflictDoNothing();
    });
    await this.events.emit({ type: 'group.join_requested', groupId: row.id, userId: user.id });
    return this.fresh(user, row.id);
  }

  /**
   * POST /groups/{slug}/leave: leave, withdraw a request or turn down an invitation. The owner can't
   * leave: they hand the group to someone else or delete it first.
   */
  async leave(user: AuthUser, idOrSlug: string): Promise<GroupDetail> {
    const { row } = await this.groupsService.visibleRow(user, idOrSlug);
    const mine = await this.row(row.id, user.id);
    if (!mine || mine.status === 'banned') throw Errors.conflict('You’re not in this group');
    if (mine.role === 'owner' && mine.status === 'active') {
      throw Errors.conflict('You own this group. Hand it to another member or delete the group first.');
    }
    await this.change(row.id, (tx) => tx.delete(groupMembers).where(and(eq(groupMembers.groupId, row.id), eq(groupMembers.userId, user.id))));
    return this.fresh(user, row.id);
  }

  /**
   * POST /groups/{slug}/invitations: people who may invite (abilities.invite) invite members. Each id is
   * reported on its own: people already in, asked, invited or banned, blocked either way, or no longer
   * active are skipped. Invitations count against a daily allowance per inviter.
   */
  async invite(user: AuthUser, idOrSlug: string, input: GroupInviteInput): Promise<BulkResult> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    if (!access.abilities.invite) {
      throw Errors.forbidden(row.visibility === 'private' ? 'Only the group’s admins and moderators can invite people' : 'Join the group to invite people');
    }
    const ids = [...new Set(input.memberIds)];
    const [accounts, existing, blocked] = await Promise.all([
      this.db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ids), inArray(users.status, ['active', 'unverified']))),
      this.db
        .select({ userId: groupMembers.userId, status: groupMembers.status })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, row.id), inArray(groupMembers.userId, ids))),
      this.relations.blockedSet(user.id),
    ]);
    const live = new Set(accounts.map((a) => a.id));
    const status = new Map(existing.map((e) => [e.userId, e.status]));
    const invited: string[] = [];
    const result = await runEach(
      ids,
      async (id) => {
        if (id === user.id) throw Errors.conflict('You’re already in this group');
        if (!live.has(id) || blocked.has(id)) throw Errors.notFound('That member');
        const current = status.get(id);
        if (current === 'active') throw Errors.conflict('Already a member');
        if (current === 'invited') throw Errors.conflict('Already invited');
        if (current === 'pending') throw Errors.conflict('Already asked to join. Approve their request instead.');
        if (current === 'banned') throw Errors.conflict('Banned from this group');
        await this.limits.consume(`group-invites:${user.id}`, GROUP_INVITES_PER_DAY, 24 * 3600, `You can send ${GROUP_INVITES_PER_DAY} group invitations a day.`);
        const [added] = await this.db
          .insert(groupMembers)
          .values({ groupId: row.id, userId: id, role: 'member', status: 'invited', invitedBy: user.id })
          .onConflictDoNothing()
          .returning({ userId: groupMembers.userId });
        if (!added) throw Errors.conflict('Already in this group');
        invited.push(id);
      },
      this.logger,
    );
    if (invited.length) await this.events.emit({ type: 'group.invited', groupId: row.id, userIds: invited, inviterId: user.id });
    return result;
  }

  /**
   * GET /groups/{slug}/members: active members for anyone who may see the group's content; people
   * waiting, invited or banned for its moderators and up. Owner, admins and moderators first, then the
   * newest. Blocked members (either way) are left out.
   */
  async list(user: AuthUser, idOrSlug: string, q: GroupMembersQuery): Promise<Page<GroupMemberView>> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    const moderates = roleAtLeast(access.role, 'moderator') || access.staff;
    if (!access.abilities.seeContent) throw Errors.forbidden('Only members can see who is in this group');
    if (q.status !== 'active' && !moderates) throw Errors.forbidden('Only the group’s moderators can see this list');
    const rank = sql<number>`(case ${groupMembers.role} when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end)`;
    const since = sql`coalesce(${groupMembers.joinedAt}, ${groupMembers.updatedAt})`;
    const ts = sql<string>`to_char(${since} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const c = decodeCursor<{ r: number; t: string; id: string }>(q.cursor);
    checkCursor(c, { r: 'int', t: 'date', id: 'uuid' });
    const conds: (SQL | undefined)[] = [
      eq(groupMembers.groupId, row.id),
      eq(groupMembers.status, q.status),
      q.role ? eq(groupMembers.role, q.role) : undefined,
      inArray(users.status, ['active', 'unverified']),
      notBlockedSql(user.id, sql`${groupMembers.userId}`),
      c ? sql`(${rank}, ${since}, ${groupMembers.userId}) < (${Number(c.r)}::int, ${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
    ];
    if (q.q) {
      const term = likePrefix(q.q.replace(/^@/, ''));
      conds.push(or(ilike(memberProfiles.displayName, `%${term}`), ilike(memberProfiles.handle, term)));
    }
    const rows = await this.db
      .select({ m: groupMembers, r: rank, t: ts })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .innerJoin(memberProfiles, eq(memberProfiles.userId, groupMembers.userId))
      .where(and(...conds))
      .orderBy(sql`${rank} desc`, sql`${since} desc`, sql`${groupMembers.userId} desc`)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ r: last.r, t: last.t, id: last.m.userId }));
    const refs = await this.members.refs(page.items.flatMap((r) => [r.m.userId, ...(r.m.invitedBy ? [r.m.invitedBy] : [])]));
    // Connect / Follow buttons in the members list.
    const relationships = await this.relationships.many(
      user?.id,
      page.items.map((r) => r.m.userId),
    );
    return {
      items: page.items.flatMap(({ m }) => {
        const member = refs.get(m.userId);
        if (!member) return [];
        return [
          {
            member,
            role: m.role as GroupRole,
            status: m.status as GroupMemberStatus,
            requestAnswer: moderates ? m.requestAnswer : null,
            invitedBy: moderates && m.invitedBy ? (refs.get(m.invitedBy) ?? null) : null,
            joinedAt: m.joinedAt?.toISOString() ?? null,
            since: (m.status === 'active' ? (m.joinedAt ?? m.createdAt) : m.updatedAt).toISOString(),
            ...(relationships.get(m.userId) ? { relationship: relationships.get(m.userId) } : {}),
          },
        ];
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** POST /groups/{slug}/members/{memberId} */
  async act(user: AuthUser, idOrSlug: string, memberId: string, input: GroupMemberAction, ip?: string): Promise<{ ok: true; member: GroupMemberView | null }> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    await this.apply(user, row, access, memberId, input, ip);
    return { ok: true, member: await this.view(row.id, memberId) };
  }

  /** POST /groups/{slug}/members/bulk: the same actions for several people; each reported on its own. */
  async bulk(user: AuthUser, idOrSlug: string, input: GroupMembersBulkInput, ip?: string): Promise<BulkResult> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    return runEach(input.ids, (id) => this.apply(user, row, access, id, { action: input.action } as GroupMemberAction, ip), this.logger);
  }

  /** One member as the acting moderator sees them (null when they are no longer in the group). */
  private async view(groupId: string, memberId: string): Promise<GroupMemberView | null> {
    const m = await this.row(groupId, memberId);
    if (!m) return null;
    const refs = await this.members.refs([m.userId, ...(m.invitedBy ? [m.invitedBy] : [])]);
    const member = refs.get(m.userId);
    if (!member) return null;
    return {
      member,
      role: m.role as GroupRole,
      status: m.status as GroupMemberStatus,
      requestAnswer: m.requestAnswer,
      invitedBy: m.invitedBy ? (refs.get(m.invitedBy) ?? null) : null,
      joinedAt: m.joinedAt?.toISOString() ?? null,
      since: (m.status === 'active' ? (m.joinedAt ?? m.createdAt) : m.updatedAt).toISOString(),
    };
  }

  /**
   * The rules: moderators approve and decline requests and cancel invitations (as does whoever sent
   * one); admins remove, ban and unban people below their own role and make moderators; only the owner
   * (or the page or chapter running the group) makes admins and hands over ownership. The owner can't
   * be removed, banned or demoted.
   */
  private async apply(user: AuthUser, row: GroupRow, access: GroupAccess, memberId: string, input: GroupMemberAction, ip?: string): Promise<void> {
    if (row.status === 'suspended') throw Errors.forbidden('This group is suspended by Charter Mission.');
    const own = access.abilities.own;
    const actorRank = own ? RANK.owner : access.role ? RANK[access.role] : -1;
    const target = await this.row(row.id, memberId);
    const below = (m: MemberRow) => m.role !== 'owner' && RANK[m.role as GroupRole] < actorRank;
    const now = new Date();
    const where = and(eq(groupMembers.groupId, row.id), eq(groupMembers.userId, memberId));
    const record = (action: string, extra: Record<string, unknown> = {}) =>
      this.audit.record({ actorId: user.id, action: `group.member_${action}`, targetType: 'group', targetId: row.id, after: { userId: memberId, ...extra }, ip });

    switch (input.action) {
      case 'approve':
      case 'decline': {
        if (!roleAtLeast(access.role, 'moderator')) throw Errors.forbidden('Only the group’s moderators can answer requests');
        if (!target || target.status !== 'pending') throw Errors.notFound('That request');
        if (input.action === 'approve') {
          if (row.status !== 'active') throw Errors.conflict('This group is archived and doesn’t take new members.');
          await this.change(row.id, (tx) =>
            tx.update(groupMembers).set({ status: 'active', role: 'member', joinedAt: now, decidedBy: user.id, updatedAt: now }).where(and(where, eq(groupMembers.status, 'pending'))),
          );
          await this.events.emit({ type: 'group.request_approved', groupId: row.id, userId: memberId, actorId: user.id });
        } else {
          await this.change(row.id, (tx) => tx.delete(groupMembers).where(and(where, eq(groupMembers.status, 'pending'))));
        }
        return;
      }
      case 'cancel_invite': {
        if (!target || target.status !== 'invited') throw Errors.notFound('That invitation');
        if (!roleAtLeast(access.role, 'moderator') && target.invitedBy !== user.id) throw Errors.forbidden('Only the group’s moderators or the person who sent it can cancel an invitation');
        await this.change(row.id, (tx) => tx.delete(groupMembers).where(and(where, eq(groupMembers.status, 'invited'))));
        return;
      }
      case 'remove': {
        if (!access.abilities.manage) throw Errors.forbidden('Only the group’s admins can remove people');
        if (!target || target.status !== 'active') throw Errors.notFound('That member');
        if (!below(target)) throw Errors.forbidden(target.role === 'owner' ? 'The owner can’t be removed' : 'You can only remove people with a lower role than yours');
        await this.change(row.id, (tx) => tx.delete(groupMembers).where(where));
        await record('removed');
        return;
      }
      case 'ban': {
        if (!access.abilities.manage) throw Errors.forbidden('Only the group’s admins can ban people');
        if (memberId === user.id) throw Errors.validation({ memberId: 'You can’t ban yourself' });
        if (target?.status === 'banned') throw Errors.conflict('Already banned');
        if (target && target.status === 'active' && !below(target)) {
          throw Errors.forbidden(target.role === 'owner' ? 'The owner can’t be banned' : 'You can only ban people with a lower role than yours');
        }
        if (!target) {
          const [account] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, memberId)).limit(1);
          if (!account) throw Errors.notFound('That member');
        }
        await this.change(row.id, (tx) =>
          tx
            .insert(groupMembers)
            .values({ groupId: row.id, userId: memberId, role: 'member', status: 'banned', decidedBy: user.id })
            .onConflictDoUpdate({
              target: [groupMembers.groupId, groupMembers.userId],
              set: { status: 'banned', role: 'member', decidedBy: user.id, joinedAt: null, requestAnswer: null, updatedAt: now },
            }),
        );
        await record('banned');
        return;
      }
      case 'unban': {
        if (!access.abilities.manage) throw Errors.forbidden('Only the group’s admins can unban people');
        if (!target || target.status !== 'banned') throw Errors.notFound('That ban');
        await this.change(row.id, (tx) => tx.delete(groupMembers).where(and(where, eq(groupMembers.status, 'banned'))));
        await record('unbanned');
        return;
      }
      case 'set_role': {
        if (!access.abilities.manage) throw Errors.forbidden('Only the group’s admins can change roles');
        if (!target || target.status !== 'active') throw Errors.notFound('That member');
        if (target.role === 'owner') throw Errors.forbidden('The owner’s role changes only when they hand the group over');
        if ((input.role === 'admin' || target.role === 'admin') && !own) throw Errors.forbidden('Only the group’s owner can make or unmake admins');
        if (target.role === input.role) return;
        await this.db.update(groupMembers).set({ role: input.role, updatedAt: now }).where(and(where, eq(groupMembers.status, 'active')));
        await record('role_changed', { from: target.role, to: input.role });
        if (input.role !== 'member') await this.events.emit({ type: 'group.role_changed', groupId: row.id, userId: memberId, role: input.role, actorId: user.id });
        return;
      }
      case 'transfer_ownership': {
        if (!own) throw Errors.forbidden('Only the group’s owner can hand it over');
        if (!target || target.status !== 'active') throw Errors.validation({ memberId: 'Choose an active member of the group' });
        if (target.role === 'owner') return;
        await this.change(row.id, async (tx) => {
          // The previous owner stays on as an admin.
          await tx
            .update(groupMembers)
            .set({ role: 'admin', updatedAt: now })
            .where(and(eq(groupMembers.groupId, row.id), eq(groupMembers.role, 'owner')));
          await tx.update(groupMembers).set({ role: 'owner', updatedAt: now }).where(where);
        });
        await record('owner_changed');
        await this.events.emit({ type: 'group.role_changed', groupId: row.id, userId: memberId, role: 'owner', actorId: user.id });
        return;
      }
    }
  }
}
