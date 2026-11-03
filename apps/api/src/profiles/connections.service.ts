import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { ConnectionView, ConnectionsQuery, CreateConnectionInput, Page } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { isActiveUntil } from '../core/policy.js';
import { EventsService } from '../infra/events.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { ProfilesService } from './profiles.service.js';
import { isUniqueViolation } from './pg-error.js';

/** Spec 4.6 (proposed): 30-day cool-off after a decline; 50 outgoing requests per day. */
export const DECLINE_COOL_OFF_DAYS = 30;
export const DAILY_REQUEST_CAP = 50;

const HIDDEN_STATUSES = ['deactivated', 'deletion_pending', 'deleted'];

type Row = typeof connections.$inferSelect;

/**
 * Connection requests (CM-NET-03). States: pending → accepted, declined or withdrawn;
 * accepted → removed. One open request per unordered pair (unique index).
 */
@Injectable()
export class ConnectionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly profiles: ProfilesService,
    private readonly relations: RelationsService,
    private readonly members: MembersService,
    private readonly events: EventsService,
    private readonly analytics: AnalyticsService,
    private readonly limits: RateLimitService,
  ) {}

  /** POST /connections */
  async request(ctx: AuthContext, input: CreateConnectionInput): Promise<ConnectionView> {
    const me = ctx.user;
    if (input.memberId === me.id) throw Errors.badRequest('You can’t connect with yourself');
    if (isActiveUntil(me.restrictedConnectingUntil)) throw Errors.restricted('connecting', me.restrictedConnectingUntil);

    const target = await this.profiles.findRow(input.memberId);
    if (!target || HIDDEN_STATUSES.includes(target.status)) throw Errors.notFound('Member');
    // Blocked either way: behave as if the member does not exist (spec 4.6; the blocked member is not told).
    if (await this.relations.isBlockedEitherWay(me.id, target.userId)) throw Errors.notFound('Member');
    if (target.connectionRequestsFrom === 'nobody') throw Errors.forbidden('This member isn’t accepting connection requests');

    const dailyKey = `connections:day:${me.id}`;
    await this.limits.assertBelow(dailyKey, DAILY_REQUEST_CAP);

    const [open] = await this.db
      .select({ requesterId: connections.requesterId, status: connections.status })
      .from(connections)
      .where(and(this.pair(me.id, target.userId), inArray(connections.status, ['pending', 'accepted'])))
      .limit(1);
    if (open?.status === 'accepted') throw Errors.conflict('You’re already connected');
    if (open) {
      throw Errors.conflict(
        open.requesterId === me.id ? 'Your request is already pending' : 'This member already sent you a request. Accept it instead.',
      );
    }

    const coolOffStart = new Date(Date.now() - DECLINE_COOL_OFF_DAYS * 86_400_000);
    const [declined] = await this.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.requesterId, me.id),
          eq(connections.addresseeId, target.userId),
          eq(connections.status, 'declined'),
          gt(connections.respondedAt, coolOffStart),
        ),
      )
      .limit(1);
    if (declined) throw Errors.conflict('You can’t send another request to this member yet');

    let row: Row;
    try {
      [row] = (await this.db
        .insert(connections)
        .values({ requesterId: me.id, addresseeId: target.userId, note: input.note?.trim() || null })
        .returning()) as [Row];
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('A request between you is already open');
      throw err;
    }
    await this.limits.hit(dailyKey, 86_400);
    await this.events.emit({ type: 'connection.requested', connectionId: row.id, requesterId: me.id, addresseeId: target.userId });
    this.analytics.track('connection_requested', me.id, me.countryCode);
    return this.view(row, me.id);
  }

  /** POST /connections/{id}/accept — addressee only. */
  async accept(ctx: AuthContext, id: string): Promise<ConnectionView> {
    const row = await this.transition(ctx.user.id, id, 'addressee', 'pending', 'accepted');
    await this.events.emit({ type: 'connection.accepted', connectionId: row.id, requesterId: row.requesterId, addresseeId: row.addresseeId });
    this.analytics.track('connection_accepted', ctx.user.id, ctx.user.countryCode);
    return this.view(row, ctx.user.id);
  }

  /** POST /connections/{id}/decline — addressee only; starts the sender's cool-off. Sender is not notified. */
  async decline(userId: string, id: string): Promise<ConnectionView> {
    return this.view(await this.transition(userId, id, 'addressee', 'pending', 'declined'), userId);
  }

  /** POST /connections/{id}/withdraw — requester only. */
  async withdraw(userId: string, id: string): Promise<ConnectionView> {
    return this.view(await this.transition(userId, id, 'requester', 'pending', 'withdrawn'), userId);
  }

  /** DELETE /connections/{id} — either side removes an accepted connection. */
  async remove(userId: string, id: string): Promise<ConnectionView> {
    return this.view(await this.transition(userId, id, 'either', 'accepted', 'removed'), userId);
  }

  private async transition(
    userId: string,
    id: string,
    who: 'requester' | 'addressee' | 'either',
    from: string,
    to: string,
  ): Promise<Row> {
    const [row] = await this.db.select().from(connections).where(eq(connections.id, id)).limit(1);
    const party =
      !!row &&
      ((who !== 'addressee' && row.requesterId === userId) || (who !== 'requester' && row.addresseeId === userId));
    if (!row || !party) throw Errors.notFound('Connection');
    const other = row.requesterId === userId ? row.addresseeId : row.requesterId;
    if (to === 'accepted' && (await this.relations.isBlockedEitherWay(userId, other))) throw Errors.notFound('Connection');
    if (row.status !== from) throw Errors.conflict(`This request is already ${row.status}`);
    const [updated] = await this.db
      .update(connections)
      .set({ status: to, respondedAt: new Date() })
      .where(and(eq(connections.id, id), eq(connections.status, from)))
      .returning();
    if (!updated) throw Errors.conflict('This request was changed. Reload and try again.');
    return updated;
  }

  /** GET /me/connections?filter=connected|incoming|outgoing */
  async list(userId: string, query: ConnectionsQuery): Promise<Page<ConnectionView>> {
    const cursor = decodeCursor<{ c: string; id: string }>(query.cursor);
    const other = sql`case when ${connections.requesterId} = ${userId} then ${connections.addresseeId} else ${connections.requesterId} end`;
    const filter =
      query.filter === 'connected'
        ? and(eq(connections.status, 'accepted'), or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)))
        : query.filter === 'incoming'
          ? and(eq(connections.status, 'pending'), eq(connections.addresseeId, userId))
          : and(eq(connections.status, 'pending'), eq(connections.requesterId, userId));
    const rows = await this.db
      .select({ row: connections, cursorAt: sql<string>`${connections.createdAt}::text` })
      .from(connections)
      .innerJoin(users, sql`${users.id} = ${other}`)
      .where(
        and(
          filter,
          sql`${users.status} not in ('deactivated', 'deletion_pending', 'deleted')`,
          this.relations.notBlockedSql(userId, other),
          cursor ? sql`(${connections.createdAt}, ${connections.id}) < (${cursor.c}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(connections.createdAt), desc(connections.id))
      .limit(query.limit + 1);
    const page = paginate(rows, query.limit, (r) => ({ c: r.cursorAt, id: r.row.id }));
    const refs = await this.members.refs(page.items.map((r) => (r.row.requesterId === userId ? r.row.addresseeId : r.row.requesterId)));
    return {
      items: page.items.map((r) => this.toView(r.row, userId, refs)).filter((v): v is ConnectionView => !!v),
      nextCursor: page.nextCursor,
    };
  }

  private pair(a: string, b: string) {
    return or(
      and(eq(connections.requesterId, a), eq(connections.addresseeId, b)),
      and(eq(connections.requesterId, b), eq(connections.addresseeId, a)),
    );
  }

  private async view(row: Row, viewerId: string): Promise<ConnectionView> {
    const other = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
    return this.toView(row, viewerId, await this.members.refs([other]))!;
  }

  private toView(row: Row, viewerId: string, refs: Map<string, ConnectionView['member']>): ConnectionView | null {
    const outgoing = row.requesterId === viewerId;
    const member = refs.get(outgoing ? row.addresseeId : row.requesterId);
    if (!member) return null;
    return {
      id: row.id,
      member,
      status: row.status as ConnectionView['status'],
      direction: outgoing ? 'outgoing' : 'incoming',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
