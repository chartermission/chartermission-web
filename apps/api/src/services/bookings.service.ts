import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  BOOKINGS_OPEN_PER_HOST,
  BOOKINGS_PER_DAY,
  type BookingInput,
  type BookingsQuery,
  type BookingView,
  type CancelBookingInput,
  type Page,
  type SlotsQuery,
  type SlotsView,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { bookings, hostAvailability, services } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { EventsService } from '../infra/events.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { env } from '../config/env.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { renderIcs } from '../events/ics.js';
import {
  calendarKey,
  FALLBACK_MEMBER,
  hostColumns,
  hostOf,
  ServiceHosts,
  type AvailabilityRow,
  type HostKey,
  type ServiceRow,
  type ServiceViewer,
} from './service-hosts.service.js';
import { ServicesService } from './services.service.js';
import { computeSlots, openSlots, type Busy } from './slots.js';
import { DAY_MS, dayKey, formatLocal } from './time.js';

export type BookingRow = typeof bookings.$inferSelect;

/** Shown when the slot went between loading the times and booking. */
export const SLOT_TAKEN = 'That time was just taken. Pick another.';
const OWN_CLASH = 'You already have a consultation at that time';

/** The booking as a calendar file (either side; the link is in the booking emails). */
export const bookingIcsUrl = (id: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}/bookings/${id}/calendar.ics`;
export const bookingHref = (id: string) => `/bookings/${id}`;

/**
 * Free consultations (contracts/services.ts): open slots, booking, the two sides' lists, cancelling
 * and calendar files. A booking is only taken in a slot that is open when it is made: inside one
 * transaction holding advisory locks on the host's and the booker's calendars (taken in a fixed
 * order), the clashes are checked again before the insert, so two people can never get one slot.
 */
@Injectable()
export class BookingsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly hosts: ServiceHosts,
    private readonly servicesService: ServicesService,
    private readonly members: MembersService,
    private readonly limits: RateLimitService,
    private readonly events: EventsService,
  ) {}

  /* ------------------------------ Slots ------------------------------ */

  /**
   * The host's confirmed consultations (for clashes, the buffer and the daily limit), the viewer's
   * own (as booker or host) and, for a member host, the ones they booked themselves (viewerBusy has
   * both: no buffer, not counted towards the daily limit).
   */
  private async busy(db: Db | Tx, host: HostKey, viewerId: string | undefined, from: Date, to: Date) {
    const inRange = and(eq(bookings.status, 'confirmed'), gt(bookings.endsAt, from), lt(bookings.startsAt, to));
    const pick = { startsAt: bookings.startsAt, endsAt: bookings.endsAt };
    // One after another: inside the booking transaction they share one connection.
    const hostBusy: Busy[] = await db
      .select(pick)
      .from(bookings)
      .where(and(inRange, host.type === 'member' ? eq(bookings.hostUserId, host.userId) : eq(bookings.hostPageId, host.pageId)));
    const own: Busy[] = viewerId
      ? await db.select(pick).from(bookings).where(and(inRange, or(eq(bookings.bookerId, viewerId), eq(bookings.hostUserId, viewerId))))
      : [];
    const hostBooked: Busy[] = host.type === 'member' ? await db.select(pick).from(bookings).where(and(inRange, eq(bookings.bookerId, host.userId))) : [];
    return { hostBusy, viewerBusy: [...own, ...hostBooked], own };
  }

  private rules(row: ServiceRow, avail: AvailabilityRow) {
    return {
      hostTimezone: avail.timezone,
      windows: avail.windows,
      daysOff: avail.daysOff,
      bufferMinutes: avail.bufferMinutes,
      maxPerDay: avail.maxPerDay,
      durationMinutes: row.durationMinutes ?? 0,
      noticeHours: row.noticeHours,
      windowDays: row.windowDays,
    };
  }

  private bookableNow(row: ServiceRow, avail: AvailabilityRow | undefined): avail is AvailabilityRow {
    return !!avail && row.bookable && row.active && !row.deletedAt && !!row.durationMinutes && !!row.mode;
  }

  /** GET /services/:id/slots?from=&days=&tz= */
  async slots(user: AuthUser | undefined, id: string, q: SlotsQuery): Promise<SlotsView> {
    const v = await this.hosts.viewer(user);
    const row = await this.hosts.visibleService(id, v);
    const host = hostOf(row);
    const avail = await this.hosts.availability(host);
    const hostTimezone = avail?.timezone ?? (await this.hosts.defaultTimezone(host));
    const timezone = q.tz ?? hostTimezone;
    const now = new Date();
    const from = q.from ?? dayKey(now, timezone);
    const empty: SlotsView = {
      timezone,
      hostTimezone,
      durationMinutes: row.durationMinutes ?? 0,
      days: Array.from({ length: q.days }, (_, i) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10), slots: [] })),
      nextAvailable: null,
    };
    if (!this.bookableNow(row, avail)) return empty;
    const rangeEnd = Math.max(Date.parse(`${from}T00:00:00Z`) + (q.days + 2) * DAY_MS, now.getTime() + (row.windowDays + 2) * DAY_MS);
    const busy = await this.busy(this.db, host, v.user?.id, new Date(now.getTime() - 2 * DAY_MS), new Date(rangeEnd));
    const result = computeSlots({ ...this.rules(row, avail), now, hostBusy: busy.hostBusy, viewerBusy: busy.viewerBusy, timezone, from, days: q.days });
    return { timezone, hostTimezone, durationMinutes: row.durationMinutes!, ...result };
  }

  /** Whether `startsAt` is an open slot now, given the bookings (host-zone days around it). */
  private isOpen(row: ServiceRow, avail: AvailabilityRow, startsAt: Date, now: Date, busy: { hostBusy: Busy[]; viewerBusy: Busy[] }) {
    const rules = this.rules(row, avail);
    const fromKey = dayKey(new Date(startsAt.getTime() - DAY_MS), rules.hostTimezone);
    const toKey = dayKey(new Date(startsAt.getTime() + DAY_MS), rules.hostTimezone);
    return openSlots({ ...rules, now, ...busy }, fromKey, toKey).some((s) => s.startsAt.getTime() === startsAt.getTime());
  }

  /* ------------------------------ Booking ------------------------------ */

  /** POST /services/:id/bookings — verified members, in an open slot; 409 when it was just taken. */
  async book(user: AuthUser, id: string, input: BookingInput): Promise<BookingView> {
    const v = await this.hosts.viewer(user);
    const row = await this.hosts.visibleService(id, v);
    const host = hostOf(row);
    const avail = await this.hosts.availability(host);
    const reason = this.servicesService.cantBookReason(row, v, !!avail);
    if (reason) throw this.hosts.isHost(host, v) ? Errors.forbidden(reason) : Errors.conflict(reason);
    if (!this.bookableNow(row, avail)) throw Errors.conflict('Not taking bookings right now');

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + row.durationMinutes! * 60_000);
    const now = new Date();
    const window = (n: Date) => [new Date(n.getTime() - 2 * DAY_MS), new Date(startsAt.getTime() + 2 * DAY_MS)] as const;
    const busy = await this.busy(this.db, host, user.id, ...window(now));
    if (!this.isOpen(row, avail, startsAt, now, busy)) throw this.notOpen(row, avail, startsAt, endsAt, now, busy.own);
    await this.assertOpenWithHost(this.db, user.id, host, now);
    await this.limits.consume(`bookings:${user.id}`, BOOKINGS_PER_DAY, 24 * 3600, `You can book ${BOOKINGS_PER_DAY} consultations a day.`);

    const created = await this.db.transaction(async (tx) => {
      const keys = [...new Set([calendarKey(host), calendarKey({ type: 'member', userId: user.id })])].sort();
      for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      // The host may have just removed or paused the service (they take the same lock to do it).
      const [current] = await tx.select().from(services).where(eq(services.id, row.id)).limit(1);
      if (!current || !this.bookableNow(current, avail) || current.durationMinutes !== row.durationMinutes) throw Errors.conflict('Not taking bookings right now');
      const fresh = await this.busy(tx, host, user.id, ...window(now));
      if (!this.isOpen(row, avail, startsAt, now, fresh)) {
        throw Errors.conflict(fresh.own.some((b) => startsAt < b.endsAt && endsAt > b.startsAt) ? OWN_CLASH : SLOT_TAKEN);
      }
      await this.assertOpenWithHost(tx, user.id, host, now);
      const [inserted] = await tx
        .insert(bookings)
        .values({ serviceId: row.id, ...hostColumns(host), bookerId: user.id, startsAt, endsAt, status: 'confirmed', note: input.note || null })
        .returning();
      return inserted!;
    });
    await this.events.emit({ type: 'booking.created', bookingId: created.id });
    return (await this.views([created], v))[0]!;
  }

  /** Not an open slot: taken (409) if it would be open without the bookings, else not a slot (422). */
  private notOpen(row: ServiceRow, avail: AvailabilityRow, startsAt: Date, endsAt: Date, now: Date, own: Busy[]) {
    const relaxed = { ...avail, maxPerDay: null };
    if (this.isOpen(row, relaxed, startsAt, now, { hostBusy: [], viewerBusy: [] })) {
      return Errors.conflict(own.some((b) => startsAt < b.endsAt && endsAt > b.startsAt) ? OWN_CLASH : SLOT_TAKEN);
    }
    return Errors.validation({ startsAt: 'Pick one of the open times' });
  }

  private async assertOpenWithHost(db: Db | Tx, bookerId: string, host: HostKey, now: Date) {
    const [open] = await db
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.bookerId, bookerId),
          eq(bookings.status, 'confirmed'),
          gt(bookings.startsAt, now),
          host.type === 'member' ? eq(bookings.hostUserId, host.userId) : eq(bookings.hostPageId, host.pageId),
        ),
      );
    if ((open?.n ?? 0) >= BOOKINGS_OPEN_PER_HOST) {
      throw Errors.conflict(`You can have up to ${BOOKINGS_OPEN_PER_HOST} upcoming consultations with the same host.`);
    }
  }

  /* ------------------------------ Lists ------------------------------ */

  /** GET /bookings?role=booker|host&pageId=&when=upcoming|past|cancelled */
  async list(user: AuthUser, q: BookingsQuery): Promise<Page<BookingView>> {
    const v = await this.hosts.viewer(user);
    const now = new Date();
    let who: SQL;
    if (q.role === 'booker') who = eq(bookings.bookerId, user.id);
    else if (q.pageId) {
      if (!v.pages.has(q.pageId)) throw Errors.forbidden('Only the page’s admins can do that');
      who = eq(bookings.hostPageId, q.pageId);
    } else who = eq(bookings.hostUserId, user.id);
    const when =
      q.when === 'upcoming'
        ? and(eq(bookings.status, 'confirmed'), gt(bookings.endsAt, now))
        : q.when === 'past'
          ? and(eq(bookings.status, 'confirmed'), lte(bookings.endsAt, now))
          : eq(bookings.status, 'cancelled');
    const order = q.when === 'upcoming' ? [asc(bookings.startsAt), asc(bookings.id)] : [desc(bookings.startsAt), desc(bookings.id)];
    const offset = Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0) || 0;
    const rows = await this.db
      .select()
      .from(bookings)
      .where(and(who, when))
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const more = rows.length > q.limit;
    return { items: await this.views(rows.slice(0, q.limit), v), nextCursor: more ? encodeCursor({ o: offset + q.limit }) : null };
  }

  /** The booking if the viewer is its booker or its host (the member, or an admin of the page). */
  private async mine(id: string, v: ServiceViewer): Promise<BookingRow> {
    if (!isUuid(id)) throw Errors.notFound('That booking');
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id.toLowerCase())).limit(1);
    if (!row || (row.bookerId !== v.user?.id && !this.hosts.isHost(hostOf(row), v))) throw Errors.notFound('That booking');
    return row;
  }

  /** GET /bookings/:id */
  async detail(user: AuthUser, id: string): Promise<BookingView> {
    const v = await this.hosts.viewer(user);
    return (await this.views([await this.mine(id, v)], v))[0]!;
  }

  /** POST /bookings/:id/cancel — either side, before it starts. The other side is told. */
  async cancel(user: AuthUser, id: string, input: CancelBookingInput): Promise<BookingView> {
    const v = await this.hosts.viewer(user);
    const found = await this.mine(id, v);
    const by = found.bookerId === user.id ? 'booker' : 'host';
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(bookings).where(eq(bookings.id, found.id)).for('update');
      if (!row || row.status !== 'confirmed') throw Errors.conflict('This consultation was already cancelled');
      if (row.startsAt.getTime() <= Date.now()) throw Errors.conflict('This consultation has started, so it can’t be cancelled');
      const now = new Date();
      const [done] = await tx
        .update(bookings)
        .set({ status: 'cancelled', cancelledBy: by, cancelReason: input.reason || null, cancelledAt: now, updatedAt: now })
        .where(eq(bookings.id, row.id))
        .returning();
      return done!;
    });
    await this.events.emit({ type: 'booking.cancelled', bookingId: updated.id, actorId: user.id });
    return (await this.views([updated], v))[0]!;
  }

  /** GET /bookings/:id/calendar.ics */
  async ics(user: AuthUser, id: string): Promise<{ filename: string; body: string }> {
    const v = await this.hosts.viewer(user);
    const row = await this.mine(id, v);
    const [view] = await this.views([row], v);
    const b = view!;
    const other = b.viewer.role === 'booker' ? (b.host.type === 'member' ? b.host.member.name : b.host.page.name) : b.booker.name;
    const tz = b.hostTimezone;
    const url = webUrl(bookingHref(row.id));
    const description = [
      row.status === 'cancelled' ? `CANCELLED${row.cancelReason ? `: ${row.cancelReason}` : ''}` : null,
      `${b.service.title} with ${other}`,
      `Local time: ${formatLocal(row.startsAt, tz)}`,
      b.meetingDetails ? `Meeting details: ${b.meetingDetails}` : null,
      row.note ? `Note: ${row.note}` : null,
      `Booking: ${url}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const host = new URL(webUrl('/')).hostname;
    const body = renderIcs({
      uid: `booking-${row.id}@${host}`,
      title: `${b.service.title} with ${other}`,
      description,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: tz,
      location: b.meetingDetails ?? b.locationHint,
      url,
      cancelled: row.status === 'cancelled',
      sequence: Math.max(0, Math.floor((row.updatedAt.getTime() - row.createdAt.getTime()) / 1000)),
      updatedAt: row.updatedAt,
    });
    return { filename: `consultation-${dayKey(row.startsAt, tz)}.ics`, body };
  }

  /* ------------------------------ Views ------------------------------ */

  /** Host zones in bulk: saved availability, else the host's country. */
  async hostZones(hostKeys: HostKey[]): Promise<(host: HostKey) => string> {
    const userIds = [...new Set(hostKeys.flatMap((h) => (h.type === 'member' ? [h.userId] : [])))];
    const pageIds = [...new Set(hostKeys.flatMap((h) => (h.type === 'page' ? [h.pageId] : [])))];
    const rows =
      userIds.length || pageIds.length
        ? await this.db
            .select({ userId: hostAvailability.hostUserId, pageId: hostAvailability.hostPageId, timezone: hostAvailability.timezone })
            .from(hostAvailability)
            .where(
              or(
                userIds.length ? inArray(hostAvailability.hostUserId, userIds) : undefined,
                pageIds.length ? inArray(hostAvailability.hostPageId, pageIds) : undefined,
              ),
            )
        : [];
    const zones = new Map(rows.map((r) => [(r.userId ?? r.pageId)!, r.timezone]));
    for (const h of hostKeys) {
      const key = h.type === 'member' ? h.userId : h.pageId;
      if (!zones.has(key)) zones.set(key, await this.hosts.defaultTimezone(h));
    }
    return (h) => zones.get(h.type === 'member' ? h.userId : h.pageId)!;
  }

  async views(rows: BookingRow[], v: ServiceViewer): Promise<BookingView[]> {
    if (!rows.length) return [];
    const hostKeys = rows.map(hostOf);
    const serviceIds = [...new Set(rows.map((r) => r.serviceId))];
    const [serviceRows, hostView, zoneOf, bookers] = await Promise.all([
      this.db.select().from(services).where(inArray(services.id, serviceIds)),
      this.hosts.hostViews(hostKeys),
      this.hostZones(hostKeys),
      this.members.refs(rows.map((r) => r.bookerId)),
    ]);
    const serviceById = new Map(serviceRows.map((s) => [s.id, s]));
    const now = Date.now();
    return rows.map((row) => {
      const service = serviceById.get(row.serviceId)!;
      const host = hostOf(row);
      const role = row.bookerId === v.user?.id ? 'booker' : 'host';
      const confirmed = row.status === 'confirmed';
      return {
        id: row.id,
        service: {
          id: service.id,
          title: service.title,
          durationMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
          mode: (service.mode as BookingView['service']['mode']) ?? 'video',
        },
        host: hostView(host),
        booker: bookers.get(row.bookerId) ?? FALLBACK_MEMBER,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        hostTimezone: zoneOf(host),
        status: row.status as BookingView['status'],
        note: row.note,
        meetingDetails: confirmed || role === 'host' ? service.meetingDetails : null,
        locationHint: service.locationHint,
        cancelledBy: (row.cancelledBy as BookingView['cancelledBy']) ?? null,
        cancelReason: row.cancelReason,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        past: row.endsAt.getTime() <= now,
        viewer: { role, canCancel: confirmed && row.startsAt.getTime() > now },
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
