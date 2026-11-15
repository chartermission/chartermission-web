import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { BOOKING_REMINDER_OFFSETS } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookings, services } from '../db/schema.js';
import { QueueService } from '../infra/queue.service.js';
import { NotifyService } from '../core/notify.service.js';
import { MembersService } from '../core/members.service.js';
import { hostOf, ServiceHosts } from './service-hosts.service.js';
import { bookingHref, bookingIcsUrl } from './bookings.service.js';
import { meetingLine } from './services.events.js';
import { formatLeadTime, formatLocal, formatShort } from './time.js';

/** Maintenance job: reminders before consultations, to both sides. */
export const BOOKING_REMINDERS_JOB = 'booking-reminders';
const EVERY_MS = 5 * 60_000;
/** Reminders claimed per offset per run; the next run picks up the rest. */
const BATCH = 1000;

@Injectable()
export class BookingRemindersService implements OnModuleInit {
  private readonly logger = new Logger('BookingReminders');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
    private readonly hosts: ServiceHosts,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name) => {
      if (name === BOOKING_REMINDERS_JOB) await this.run();
    });
    this.queue.every('maintenance', BOOKING_REMINDERS_JOB, EVERY_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${BOOKING_REMINDERS_JOB}: ${String(err)}`);
    });
  }

  /**
   * For each offset (24 h, 1 h): confirmed bookings starting within the window, to the booker and
   * the host (the member, or every admin of the page). Each (booking, member, offset) is claimed with
   * INSERT … ON CONFLICT DO NOTHING in booking_reminders_sent before anything is sent, so overlapping
   * runs never send twice. The 24 h reminder is skipped once the 1 h window has begun.
   */
  async run(now = new Date()): Promise<number> {
    const smallest = Math.min(...BOOKING_REMINDER_OFFSETS);
    let total = 0;
    for (const offset of BOOKING_REMINDER_OFFSETS) {
      const windowEnd = new Date(now.getTime() + offset * 60_000);
      const lowerBound = offset === smallest ? now : new Date(now.getTime() + smallest * 60_000);
      const claimed = await this.db.execute<{ booking_id: string; user_id: string }>(sql`
        insert into booking_reminders_sent (booking_id, user_id, offset_minutes)
        select b.id, p.user_id, ${offset}::int
        from bookings b
        join services s on s.id = b.service_id
        cross join lateral (
          select b.booker_id as user_id
          union select b.host_user_id where b.host_user_id is not null
          union select pa.user_id from page_admins pa where pa.page_id = b.host_page_id
        ) p
        where b.status = 'confirmed'
          and s.deleted_at is null
          and b.starts_at > ${lowerBound.toISOString()}::timestamptz
          and b.starts_at <= ${windowEnd.toISOString()}::timestamptz
          and not exists (
            select 1 from booking_reminders_sent x
            where x.booking_id = b.id and x.user_id = p.user_id and x.offset_minutes = ${offset}::int
          )
        order by b.starts_at
        limit ${BATCH}
        on conflict do nothing
        returning booking_id, user_id`);
      if (claimed.rows.length === 0) continue;
      const ids = [...new Set(claimed.rows.map((r) => r.booking_id))];
      const rows = await this.db
        .select({ b: bookings, s: services })
        .from(bookings)
        .innerJoin(services, eq(services.id, bookings.serviceId))
        .where(inArray(bookings.id, ids));
      const byId = new Map(rows.map((r) => [r.b.id, r]));
      const bookers = await this.members.refs(rows.map((r) => r.b.bookerId));
      for (const { booking_id, user_id } of claimed.rows) {
        const found = byId.get(booking_id);
        if (!found) continue;
        const { b, s } = found;
        const asBooker = user_id === b.bookerId;
        const other = asBooker ? await this.hosts.hostName(hostOf(b)) : (bookers.get(b.bookerId)?.name ?? 'a member');
        const lead = formatLeadTime(b.startsAt.getTime() - now.getTime());
        const tz = await this.hosts.memberTimezone(user_id);
        const meeting = meetingLine(s);
        try {
          await this.notify.notify({
            userId: user_id,
            type: 'booking_reminder',
            objectType: 'booking',
            objectId: b.id,
            segments: [
              { text: s.title, strong: true },
              { text: ' with ', strong: false },
              { text: other, strong: true },
              { text: ' is coming up: ', strong: false },
              { text: formatShort(b.startsAt, tz), strong: false, at: b.startsAt.toISOString() },
            ],
            href: bookingHref(b.id),
            icon: 'clock',
            dedupeKey: `booking_reminder:${b.id}:${offset}`,
            email: {
              subject: `Starts in ${lead}: ${s.title}`,
              heading: `Your consultation starts in ${lead}`,
              paragraphs: [
                `Your consultation: ${s.title} with ${other}.`,
                `When: ${formatLocal(b.startsAt, tz)}`,
                ...(meeting ? [meeting] : []),
                `Add it to your calendar: ${bookingIcsUrl(b.id)}`,
                'Can’t make it? Cancel from your bookings so the other side knows.',
              ],
              buttonLabel: 'View the booking',
            },
          });
          total++;
        } catch (err) {
          this.logger.warn(`Reminder for booking ${b.id}/${user_id} failed: ${String(err)}`);
        }
      }
    }
    return total;
  }
}
