import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { countries, eventRegistrations, events } from '../db/schema.js';
import { QueueService } from '../infra/queue.service.js';
import { NotifyService } from '../core/notify.service.js';
import { env } from '../config/env.js';
import type { EventRow } from './event-access.js';
import { locationOf } from './event-serializer.js';
import { formatLocal } from './event-util.js';

/**
 * Domain events of the Events module. Like infra/events.service.ts they travel on the "events"
 * queue and are handled by workers (spec 4.13: notifications never inline in request handlers);
 * emit after the transaction commits. Handlers are idempotent (dedupe keys).
 */
export type EventMessage =
  | { type: 'evt.registered'; eventId: string; userId: string; status: 'registered' | 'waitlisted' }
  | { type: 'evt.promoted'; eventId: string; userId: string }
  | { type: 'evt.cancelled'; eventId: string }
  | { type: 'evt.updated'; eventId: string; changed: ('time' | 'venue' | 'online')[] }
  | { type: 'evt.reviewed'; eventId: string; decision: 'approve' | 'request_changes' | 'reject'; note: string };

const TYPES = new Set<EventMessage['type']>(['evt.registered', 'evt.promoted', 'evt.cancelled', 'evt.updated', 'evt.reviewed']);

export const icsUrl = (id: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}/events/${id}.ics`;

@Injectable()
export class EventMessages implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.queue.process('events', async (name, data) => {
      if (TYPES.has(name as EventMessage['type'])) await this.handle(data as EventMessage);
    });
  }

  async emit(message: EventMessage) {
    await this.queue.add('events', message.type, message);
  }

  private async handle(m: EventMessage) {
    const [row] = await this.db.select().from(events).where(eq(events.id, m.eventId)).limit(1);
    if (!row) return;
    switch (m.type) {
      case 'evt.registered':
        return m.status === 'registered' ? this.confirmed(row, m.userId) : this.waitlisted(row, m.userId);
      case 'evt.promoted':
        return this.promoted(row, m.userId);
      case 'evt.cancelled':
        return this.cancelled(row);
      case 'evt.updated':
        return this.updated(row, m.changed);
      case 'evt.reviewed':
        return this.reviewed(row, m.decision, m.note);
    }
  }

  private href = (row: EventRow) => `/events/${row.slug}`;

  private async whereLine(row: EventRow): Promise<string> {
    let name = row.countryCode ?? '';
    if (row.countryCode) {
      const [c] = await this.db.select({ name: countries.name }).from(countries).where(eq(countries.code, row.countryCode)).limit(1);
      name = c?.name ?? row.countryCode;
    }
    const loc = locationOf(row, () => name);
    const venue = row.format !== 'online' && row.venueName ? `${row.venueName}, ` : '';
    return `Where: ${venue}${loc.label}${row.format !== 'in_person' && row.onlinePlatform ? ` (${row.onlinePlatform})` : ''}`;
  }

  private whenLine(row: EventRow) {
    return `When: ${formatLocal(row.startsAt, row.timezone)}`;
  }

  private async confirmed(row: EventRow, userId: string) {
    const online = row.format !== 'in_person';
    await this.notify.notify({
      userId,
      type: 'event_registration_confirmed',
      objectType: 'event',
      objectId: row.id,
      segments: [
        { text: 'You’re registered for ', strong: false },
        { text: row.title, strong: true },
      ],
      href: this.href(row),
      icon: 'calendar',
      dedupeKey: `event_registration:${row.id}`,
      email: {
        subject: `You’re registered: ${row.title}`,
        heading: 'You’re registered',
        paragraphs: [
          `Your place at ${row.title} is confirmed.`,
          this.whenLine(row),
          await this.whereLine(row),
          ...(online ? ['The join link appears on the event page 24 hours before the start.'] : []),
          `Add it to your calendar: ${icsUrl(row.id)}`,
          'Can’t make it? Cancel from the event page so someone on the waitlist can take your seat.',
        ],
        buttonLabel: 'View the event',
      },
    });
  }

  private async waitlisted(row: EventRow, userId: string) {
    const [reg] = await this.db
      .select({ position: eventRegistrations.position, status: eventRegistrations.status })
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, row.id), eq(eventRegistrations.userId, userId)))
      .limit(1);
    if (!reg || reg.status !== 'waitlisted') return;
    const place = await this.waitlistPlace(row.id, reg.position!);
    await this.notify.notify({
      userId,
      type: 'event_waitlisted',
      objectType: 'event',
      objectId: row.id,
      segments: [
        { text: `You’re number ${place} on the waitlist for `, strong: false },
        { text: row.title, strong: true },
      ],
      href: this.href(row),
      icon: 'clock',
      dedupeKey: `event_waitlisted:${row.id}`,
      email: {
        subject: `You’re on the waitlist: ${row.title}`,
        heading: 'You’re on the waitlist',
        paragraphs: [
          `${row.title} is full, so we’ve added you to the waitlist. You’re number ${place}.`,
          this.whenLine(row),
          'If a seat opens up we’ll give it to the next person on the list and email you straight away.',
        ],
        buttonLabel: 'View the event',
      },
    });
  }

  private async waitlistPlace(eventId: string, position: number) {
    const rows = await this.db
      .select({ position: eventRegistrations.position })
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, 'waitlisted')));
    return rows.filter((r) => (r.position ?? 0) <= position).length;
  }

  private async promoted(row: EventRow, userId: string) {
    await this.notify.notify({
      userId,
      type: 'event_waitlist_promoted',
      objectType: 'event',
      objectId: row.id,
      segments: [
        { text: 'A seat opened up: you’re now registered for ', strong: false },
        { text: row.title, strong: true },
      ],
      href: this.href(row),
      icon: 'check',
      dedupeKey: `event_promoted:${row.id}`,
      email: {
        subject: `A seat opened up: ${row.title}`,
        heading: 'You’ve got a seat',
        paragraphs: [
          `A place opened up at ${row.title} and it’s yours: you’ve moved from the waitlist to registered.`,
          this.whenLine(row),
          await this.whereLine(row),
          `Add it to your calendar: ${icsUrl(row.id)}`,
          'Can’t make it any more? Cancel from the event page so the next person can go.',
        ],
        buttonLabel: 'View the event',
      },
    });
  }

  /** Everyone holding a seat or a waitlist place. */
  private async audience(eventId: string) {
    const rows = await this.db
      .select({ userId: eventRegistrations.userId })
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, eventId), inArray(eventRegistrations.status, ['registered', 'waitlisted'])));
    return rows.map((r) => r.userId);
  }

  private async cancelled(row: EventRow) {
    const reason = row.cancelReason ?? '';
    for (const userId of await this.audience(row.id)) {
      await this.notify.notify({
        userId,
        type: 'event_cancelled',
        objectType: 'event',
        objectId: row.id,
        segments: [
          { text: row.title, strong: true },
          { text: ` has been cancelled${reason ? `: ${reason}` : ''}`, strong: false },
        ],
        href: this.href(row),
        icon: 'alert',
        dedupeKey: `event_cancelled:${row.id}`,
        email: {
          subject: `Cancelled: ${row.title}`,
          heading: 'This event has been cancelled',
          paragraphs: [
            `${row.title}, planned for ${formatLocal(row.startsAt, row.timezone)}, has been cancelled by the host.`,
            ...(reason ? [`The host said: “${reason}”`] : []),
            'You don’t need to do anything. If you added it to your calendar, you can remove it.',
          ],
          buttonLabel: 'View the event',
        },
      });
    }
  }

  private async updated(row: EventRow, changed: ('time' | 'venue' | 'online')[]) {
    if (row.status !== 'published' || row.cancelledAt) return;
    const what = changed.map((c) => (c === 'time' ? 'time' : c === 'venue' ? 'venue' : 'online access')).join(' and ');
    for (const userId of await this.audience(row.id)) {
      await this.notify.notify({
        userId,
        type: 'event_updated',
        objectType: 'event',
        objectId: row.id,
        segments: [
          { text: `The ${what} changed for `, strong: false },
          { text: row.title, strong: true },
        ],
        href: this.href(row),
        icon: 'calendar',
        dedupeKey: `event_updated:${row.id}`,
        email: {
          subject: `Updated: ${row.title}`,
          heading: `The ${what} changed`,
          paragraphs: [
            `The host updated the ${what} for ${row.title}.`,
            this.whenLine(row),
            await this.whereLine(row),
            ...(changed.includes('time') ? [`Update your calendar: ${icsUrl(row.id)}`] : []),
          ],
          buttonLabel: 'View the event',
        },
      });
    }
  }

  private async reviewed(row: EventRow, decision: 'approve' | 'request_changes' | 'reject', note: string) {
    const recipients = new Set([row.createdBy, ...(row.hostMemberId ? [row.hostMemberId] : [])]);
    const copy = {
      approve: {
        type: 'event_review_approved' as const,
        icon: 'check' as const,
        text: ' was approved and is now live',
        subject: `Approved: ${row.title}`,
        heading: 'Your event is live',
        body: `${row.title} passed review and is now listed on Charter Mission.`,
      },
      request_changes: {
        type: 'event_review_changes_requested' as const,
        icon: 'lightbulb' as const,
        text: ': the reviewer asked for changes',
        subject: `Changes requested: ${row.title}`,
        heading: 'A few changes before it goes live',
        body: `The reviewer asked for some changes to ${row.title}. Edit the event and submit it again.`,
      },
      reject: {
        type: 'event_review_rejected' as const,
        icon: 'alert' as const,
        text: ' was not approved',
        subject: `Not approved: ${row.title}`,
        heading: 'Your event was not approved',
        body: `${row.title} was not approved for listing.`,
      },
    }[decision];
    for (const userId of recipients) {
      await this.notify.notify({
        userId,
        type: copy.type,
        objectType: 'event',
        objectId: row.id,
        segments: [
          { text: row.title, strong: true },
          { text: copy.text, strong: false },
        ],
        href: this.href(row),
        icon: copy.icon,
        dedupeKey: `${copy.type}:${row.id}:${row.reviewedAt?.toISOString() ?? ''}`,
        email: {
          subject: copy.subject,
          heading: copy.heading,
          paragraphs: [copy.body, ...(note ? [`Reviewer’s note: “${note}”`] : [])],
          buttonLabel: 'Open the event',
        },
      });
    }
  }
}
