import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CONSULTATION_MODE_LABELS, type ConsultationMode } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookings, services, users } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { hostOf, ServiceHosts } from './service-hosts.service.js';
import { bookingHref, bookingIcsUrl, type BookingRow } from './bookings.service.js';
import { formatLocal, formatShort } from './time.js';

type ServiceRow = typeof services.$inferSelect;

const quote = (text: string, max = 140) => `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;

/** "Video call: https://meet.example.com/abc" */
export function meetingLine(service: ServiceRow): string | null {
  if (!service.meetingDetails) return null;
  const label = service.mode ? CONSULTATION_MODE_LABELS[service.mode as ConsultationMode] : 'Meeting details';
  return `${label}: ${service.meetingDetails}`;
}

/**
 * Booking notifications and emails (from domain events, never inline). Handlers re-read the booking,
 * so a retry after a later change sends nothing stale. The host is the member, or every admin of
 * the page. Times are written in each recipient's own zone (their saved availability, else their
 * country's).
 */
@Injectable()
export class ServicesEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly mail: MailService,
    private readonly members: MembersService,
    private readonly hosts: ServiceHosts,
  ) {}

  onModuleInit() {
    this.events.on('booking.created', async (e) => {
      const found = await this.load(e.bookingId);
      if (!found || found.b.status !== 'confirmed') return;
      await this.created(found.b, found.s);
    });
    this.events.on('booking.cancelled', async (e) => {
      const found = await this.load(e.bookingId);
      if (!found || found.b.status !== 'cancelled') return;
      await this.cancelled(found.b, found.s, e.actorId);
    });
  }

  private async load(bookingId: string) {
    const [row] = await this.db
      .select({ b: bookings, s: services })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return row ?? null;
  }

  /** The host notice (notification and email) and the booker's confirmation email. */
  private async created(b: BookingRow, service: ServiceRow) {
    const host = hostOf(b);
    const [booker, hostName, hostIds] = await Promise.all([this.members.ref(b.bookerId), this.hosts.hostName(host), this.hosts.hostUserIds(host)]);
    if (!booker) return;
    const meeting = meetingLine(service);
    const note = b.note?.trim();
    for (const userId of hostIds) {
      const tz = await this.hosts.memberTimezone(userId);
      await this.notify.notify({
        userId,
        type: 'booking_received',
        actorId: b.bookerId,
        objectType: 'booking',
        objectId: b.id,
        segments: [
          { text: booker.name, strong: true },
          { text: ' booked ', strong: false },
          { text: service.title, strong: true },
          { text: ' for ', strong: false },
          { text: formatShort(b.startsAt, tz), strong: false, at: b.startsAt.toISOString() },
        ],
        href: bookingHref(b.id),
        icon: 'calendar',
        dedupeKey: `booking_received:${b.id}`,
        email: {
          subject: `New booking: ${service.title}`,
          heading: `${booker.name} booked a consultation`,
          paragraphs: [
            host.type === 'page' ? `${booker.name} booked ${service.title} with ${hostName}.` : `${booker.name} booked ${service.title} with you.`,
            `When: ${formatLocal(b.startsAt, tz)}`,
            ...(meeting ? [meeting] : []),
            ...(note ? [`Their note: ${quote(note, 1000)}`] : []),
            `Add it to your calendar: ${bookingIcsUrl(b.id)}`,
            'Can’t make it? Cancel from your bookings and say why, so they can book another time.',
          ],
          buttonLabel: 'View the booking',
        },
      });
    }
    const [account] = await this.db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, b.bookerId)).limit(1);
    if (!account || ['deleted', 'deletion_pending', 'deactivated'].includes(account.status)) return;
    const tz = await this.hosts.memberTimezone(b.bookerId);
    await this.mail.compose({
      to: account.email,
      userId: b.bookerId,
      template: 'booking.confirmed',
      subject: `Booked: ${service.title} with ${hostName}`,
      heading: 'Your consultation is booked',
      paragraphs: [
        `Your consultation with ${hostName} is confirmed: ${service.title}.`,
        `When: ${formatLocal(b.startsAt, tz)}`,
        ...(meeting ? [meeting] : []),
        ...(note ? [`Your note: ${quote(note, 1000)}`] : []),
        `Add it to your calendar: ${bookingIcsUrl(b.id)}`,
        'Can’t make it? Cancel from your bookings so the time is free for someone else.',
      ],
      button: { label: 'View the booking', url: webUrl(bookingHref(b.id)) },
      transactional: true,
    });
  }

  /** To the other side: the booker if the host cancelled, else the host (every admin of a page). */
  private async cancelled(b: BookingRow, service: ServiceRow, actorId: string) {
    const host = hostOf(b);
    const byHost = b.cancelledBy === 'host';
    const recipients = byHost ? [b.bookerId] : await this.hosts.hostUserIds(host);
    const who = byHost ? await this.hosts.hostName(host) : ((await this.members.ref(b.bookerId))?.name ?? 'The member');
    const reason = b.cancelReason?.trim();
    const removed = !!service.deletedAt && byHost && !reason;
    for (const userId of recipients) {
      const tz = await this.hosts.memberTimezone(userId);
      await this.notify.notify({
        userId,
        type: 'booking_cancelled',
        actorId,
        objectType: 'booking',
        objectId: b.id,
        segments: [
          { text: who, strong: true },
          { text: ' cancelled ', strong: false },
          { text: service.title, strong: true },
          { text: ' on ', strong: false },
          { text: formatShort(b.startsAt, tz), strong: false, at: b.startsAt.toISOString() },
          ...(reason ? [{ text: `: ${quote(reason)}`, strong: false }] : []),
        ],
        href: bookingHref(b.id),
        icon: 'alert',
        dedupeKey: `booking_cancelled:${b.id}`,
        email: {
          subject: `Cancelled: ${service.title}`,
          heading: 'A consultation was cancelled',
          paragraphs: [
            removed
              ? `${who} no longer offers ${service.title}, so your consultation on ${formatLocal(b.startsAt, tz)} was cancelled.`
              : `${who} cancelled ${service.title}, planned for ${formatLocal(b.startsAt, tz)}.`,
            ...(reason ? [`Their reason: ${quote(reason, 500)}`] : []),
            'You don’t need to do anything. If you added it to your calendar, you can remove it.',
          ],
          buttonLabel: 'View the booking',
        },
      });
    }
  }
}
