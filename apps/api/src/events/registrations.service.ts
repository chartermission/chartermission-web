import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { HostRegistrationsQuery, Page, RegistrationResult, RegistrationStatus, RegistrationView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { eventRegistrations, events, memberProfiles } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { EventAccess, type EventRow } from './event-access.js';
import { EventSerializer } from './event-serializer.js';
import { EventMessages } from './event-messages.service.js';
import { closed, escapeLike } from './event-util.js';

/**
 * Internal registration (CM-EVT-04, -07). Every change to seats or the waitlist runs in one
 * transaction holding the event row lock (SELECT … FOR UPDATE), so concurrent sign-ups never
 * exceed capacity and the waitlist keeps arrival order.
 */
@Injectable()
export class RegistrationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: EventAccess,
    private readonly serializer: EventSerializer,
    private readonly messages: EventMessages,
    private readonly analytics: AnalyticsService,
    private readonly members: MembersService,
  ) {}

  private async lock(tx: Tx, id: string): Promise<EventRow> {
    const [row] = await tx.select().from(events).where(eq(events.id, id)).for('update');
    if (!row) throw Errors.notFound('Event');
    return row;
  }

  async register(user: AuthUser, id: string): Promise<RegistrationResult> {
    const viewer = await this.access.viewer(user);
    const found = await this.access.visible(id, viewer);
    if (found.registrationMode === 'external') throw closed('This event takes registrations on the host’s own site');
    if (found.status !== 'published') throw closed('Registration isn’t open for this event');

    const status = await this.db.transaction(async (tx) => {
      const ev = await this.lock(tx, found.id);
      const now = Date.now();
      if (ev.status !== 'published') throw closed('Registration isn’t open for this event');
      if (ev.cancelledAt) throw closed('This event was cancelled');
      if (now >= ev.startsAt.getTime()) throw closed('This event has already started');
      if (ev.registrationDeadline && now >= ev.registrationDeadline.getTime()) throw closed('Registration for this event has closed');
      const [existing] = await tx
        .select()
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, ev.id), eq(eventRegistrations.userId, user.id)))
        .limit(1);
      if (existing && existing.status === 'waitlisted') throw Errors.conflict('You’re already on the waitlist');
      if (existing && existing.status !== 'cancelled') throw Errors.conflict('You’re already registered');

      const seat = ev.capacity === null || ev.registeredCount < ev.capacity;
      if (!seat && !ev.waitlistEnabled) throw Errors.conflict('This event is full');
      let position: number | null = null;
      if (seat) {
        await tx.update(events).set({ registeredCount: sql`${events.registeredCount} + 1` }).where(eq(events.id, ev.id));
      } else {
        const [max] = await tx
          .select({ n: sql<number>`coalesce(max(${eventRegistrations.position}), 0)::int` })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.eventId, ev.id));
        position = (max?.n ?? 0) + 1;
        await tx.update(events).set({ waitlistCount: sql`${events.waitlistCount} + 1` }).where(eq(events.id, ev.id));
      }
      const next: RegistrationStatus = seat ? 'registered' : 'waitlisted';
      const values = { status: next, position, registeredAt: new Date(), promotedAt: null, cancelledAt: null, attendedAt: null };
      if (existing) await tx.update(eventRegistrations).set(values).where(eq(eventRegistrations.id, existing.id));
      else await tx.insert(eventRegistrations).values({ eventId: ev.id, userId: user.id, ...values });
      return next as 'registered' | 'waitlisted';
    });

    await this.messages.emit({ type: 'evt.registered', eventId: found.id, userId: user.id, status });
    this.analytics.track('event_registered', user.id, user.countryCode, found.id);
    return this.result(found.id, viewer);
  }

  /** DELETE /events/:id/registrations/me — until start; a freed seat goes to the first waitlisted member. */
  async cancelMine(user: AuthUser, id: string): Promise<RegistrationResult> {
    const viewer = await this.access.viewer(user);
    const found = await this.access.visible(id, viewer);
    const promoted = await this.db.transaction(async (tx) => {
      const ev = await this.lock(tx, found.id);
      const [reg] = await tx
        .select()
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, ev.id), eq(eventRegistrations.userId, user.id)))
        .for('update');
      if (!reg || reg.status === 'cancelled') throw Errors.notFound('Registration');
      if (reg.status === 'attended') throw Errors.conflict('Your attendance was already recorded');
      if (Date.now() >= ev.startsAt.getTime()) throw closed('The event has started, so the registration can’t be cancelled');
      await tx
        .update(eventRegistrations)
        .set({ status: 'cancelled', cancelledAt: new Date(), position: null })
        .where(eq(eventRegistrations.id, reg.id));
      if (reg.status === 'waitlisted') {
        await tx.update(events).set({ waitlistCount: sql`greatest(${events.waitlistCount} - 1, 0)` }).where(eq(events.id, ev.id));
        return [];
      }
      await tx.update(events).set({ registeredCount: sql`greatest(${events.registeredCount} - 1, 0)` }).where(eq(events.id, ev.id));
      return ev.cancelledAt ? [] : this.promote(tx, ev.id);
    });
    for (const userId of promoted) await this.messages.emit({ type: 'evt.promoted', eventId: found.id, userId });
    return this.result(found.id, viewer);
  }

  /**
   * Fill free seats from the waitlist, lowest position first. Call inside a transaction that
   * holds the event row lock. Returns the promoted member ids.
   */
  async promote(tx: Tx, eventId: string): Promise<string[]> {
    const promoted: string[] = [];
    for (;;) {
      const [ev] = await tx
        .select({ capacity: events.capacity, registered: events.registeredCount, waitlist: events.waitlistCount })
        .from(events)
        .where(eq(events.id, eventId));
      if (!ev || ev.waitlist <= 0) break;
      if (ev.capacity !== null && ev.registered >= ev.capacity) break;
      const [next] = await tx
        .select({ id: eventRegistrations.id, userId: eventRegistrations.userId })
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, 'waitlisted')))
        .orderBy(asc(eventRegistrations.position))
        .limit(1);
      if (!next) {
        await tx.update(events).set({ waitlistCount: 0 }).where(eq(events.id, eventId));
        break;
      }
      await tx
        .update(eventRegistrations)
        .set({ status: 'registered', position: null, promotedAt: new Date() })
        .where(eq(eventRegistrations.id, next.id));
      await tx
        .update(events)
        .set({ registeredCount: sql`${events.registeredCount} + 1`, waitlistCount: sql`greatest(${events.waitlistCount} - 1, 0)` })
        .where(eq(events.id, eventId));
      promoted.push(next.userId);
    }
    return promoted;
  }

  private async result(eventId: string, viewer: Awaited<ReturnType<EventAccess['viewer']>>): Promise<RegistrationResult> {
    const [row] = await this.db.select().from(events).where(eq(events.id, eventId)).limit(1);
    const event = await this.serializer.summaryOf(row!, viewer);
    return { status: event.viewer.status ?? 'cancelled', waitlistPosition: event.viewer.waitlistPosition, event };
  }

  async list(user: AuthUser, id: string, q: HostRegistrationsQuery): Promise<Page<RegistrationView>> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    const conds: SQL[] = [eq(eventRegistrations.eventId, row.id)];
    if (q.status === 'active') conds.push(inArray(eventRegistrations.status, ['registered', 'waitlisted', 'attended']));
    else if (q.status !== 'all') conds.push(eq(eventRegistrations.status, q.status));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(memberProfiles.displayName, like), ilike(memberProfiles.handle, like))!);
    }
    const offset = decodeCursor<{ o: number }>(q.cursor)?.o ?? 0;
    const rows = await this.db
      .select({
        userId: eventRegistrations.userId,
        status: eventRegistrations.status,
        registeredAt: eventRegistrations.registeredAt,
        promotedAt: eventRegistrations.promotedAt,
        cancelledAt: eventRegistrations.cancelledAt,
        attendedAt: eventRegistrations.attendedAt,
        place: sql<number | null>`case when ${eventRegistrations.status} = 'waitlisted' then (
          select count(*)::int from ${eventRegistrations} w
          where w.event_id = event_registrations.event_id and w.status = 'waitlisted' and w.position <= event_registrations.position
        ) end`,
      })
      .from(eventRegistrations)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, eventRegistrations.userId))
      .where(and(...conds))
      .orderBy(
        sql`case ${eventRegistrations.status} when 'registered' then 0 when 'attended' then 0 when 'waitlisted' then 1 else 2 end`,
        sql`${eventRegistrations.position} asc nulls last`,
        asc(eventRegistrations.registeredAt),
        asc(eventRegistrations.id),
      )
      .limit(q.limit + 1)
      .offset(offset);
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const refs = await this.members.refs(items.map((r) => r.userId));
    return {
      items: items
        .filter((r) => refs.has(r.userId))
        .map((r) => ({
          member: refs.get(r.userId)!,
          status: r.status as RegistrationStatus,
          registeredAt: r.registeredAt.toISOString(),
          position: r.place,
          promotedAt: r.promotedAt?.toISOString() ?? null,
          cancelledAt: r.cancelledAt?.toISOString() ?? null,
          attendedAt: r.attendedAt?.toISOString() ?? null,
        })),
      nextCursor: more ? encodeCursor({ o: offset + q.limit }) : null,
    };
  }

  async markAttendance(user: AuthUser, id: string, userId: string, attended: boolean): Promise<RegistrationView> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    if (Date.now() < row.startsAt.getTime()) throw Errors.conflict('You can mark attendance once the event has started');
    const [reg] = await this.db
      .select()
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, row.id), eq(eventRegistrations.userId, userId)))
      .limit(1);
    if (!reg) throw Errors.notFound('Registration');
    if (reg.status !== 'registered' && reg.status !== 'attended') throw Errors.conflict('Only members holding a seat can be marked as attended');
    const [updated] = await this.db
      .update(eventRegistrations)
      .set(attended ? { status: 'attended', attendedAt: reg.attendedAt ?? new Date() } : { status: 'registered', attendedAt: null })
      .where(eq(eventRegistrations.id, reg.id))
      .returning();
    const member = await this.members.ref(userId);
    if (!member) throw Errors.notFound('Member');
    return {
      member,
      status: updated!.status as RegistrationStatus,
      registeredAt: updated!.registeredAt.toISOString(),
      position: null,
      promotedAt: updated!.promotedAt?.toISOString() ?? null,
      cancelledAt: updated!.cancelledAt?.toISOString() ?? null,
      attendedAt: updated!.attendedAt?.toISOString() ?? null,
    };
  }
}
