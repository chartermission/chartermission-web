import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { EVENT_REMINDER_OFFSETS } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';
import { QueueService } from '../infra/queue.service.js';
import { NotifyService } from '../core/notify.service.js';
import { ARCHIVE_AFTER_MS, formatLeadTime, formatLocal } from './event-util.js';

/** Maintenance job: event reminders (CM-EVT-07) and archiving of ended events. */
export const EVENT_REMINDERS_JOB = 'event-reminders';
const EVERY_MS = 5 * 60_000;
/** Reminders claimed per offset per run; the next run picks up the rest. */
const BATCH = 1000;

@Injectable()
export class EventRemindersService implements OnModuleInit {
  private readonly logger = new Logger('EventReminders');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name) => {
      if (name === EVENT_REMINDERS_JOB) await this.run();
    });
    this.queue.every('maintenance', EVENT_REMINDERS_JOB, EVERY_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${EVENT_REMINDERS_JOB}: ${String(err)}`);
    });
  }

  async run(now = new Date()) {
    const sent = await this.sendReminders(now);
    const archived = await this.archiveEnded(now);
    return { sent, archived };
  }

  /**
   * For each offset (24 h, 1 h): registered members of published, not-cancelled events starting
   * within the window. Each (event, member, offset) is claimed with INSERT … ON CONFLICT DO NOTHING
   * in event_reminders_sent before anything is sent, so overlapping runs never send twice.
   * The 24 h reminder is skipped once the 1 h window has begun (only the 1 h one goes out).
   */
  async sendReminders(now = new Date()): Promise<number> {
    const smallest = Math.min(...EVENT_REMINDER_OFFSETS);
    let total = 0;
    for (const offset of EVENT_REMINDER_OFFSETS) {
      const windowEnd = new Date(now.getTime() + offset * 60_000);
      const lowerBound = offset === smallest ? now : new Date(now.getTime() + smallest * 60_000);
      const claimed = await this.db.execute<{ event_id: string; user_id: string }>(sql`
        insert into event_reminders_sent (event_id, user_id, offset_minutes)
        select r.event_id, r.user_id, ${offset}::int
        from event_registrations r
        join events e on e.id = r.event_id
        where r.status = 'registered'
          and e.status = 'published'
          and e.cancelled_at is null
          and e.starts_at > ${lowerBound.toISOString()}::timestamptz
          and e.starts_at <= ${windowEnd.toISOString()}::timestamptz
          and not exists (
            select 1 from event_reminders_sent x
            where x.event_id = r.event_id and x.user_id = r.user_id and x.offset_minutes = ${offset}::int
          )
        order by e.starts_at
        limit ${BATCH}
        on conflict do nothing
        returning event_id, user_id`);
      if (claimed.rows.length === 0) continue;
      const ids = [...new Set(claimed.rows.map((r) => r.event_id))];
      const rows = await this.db.select().from(events).where(inArray(events.id, ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const { event_id, user_id } of claimed.rows) {
        const ev = byId.get(event_id);
        if (!ev) continue;
        const lead = formatLeadTime(ev.startsAt.getTime() - now.getTime());
        const online = ev.format !== 'in_person';
        try {
          await this.notify.notify({
            userId: user_id,
            type: 'event_reminder',
            objectType: 'event',
            objectId: ev.id,
            segments: [
              { text: ev.title, strong: true },
              { text: ` starts in ${lead}`, strong: false },
            ],
            href: `/events/${ev.slug}`,
            icon: 'clock',
            dedupeKey: `event_reminder:${ev.id}:${offset}`,
            email: {
              subject: `Starts in ${lead}: ${ev.title}`,
              heading: `${ev.title} starts in ${lead}`,
              paragraphs: [
                `When: ${formatLocal(ev.startsAt, ev.timezone)}`,
                // Reminders fall inside the join-link window (JOIN_LINK_LEAD_HOURS before start).
                ...(online ? ['The join link is on the event page.'] : []),
                'Can’t make it? Cancel from the event page so someone on the waitlist can take your seat.',
              ],
              buttonLabel: 'View the event',
            },
          });
          total++;
        } catch (err) {
          this.logger.warn(`Reminder for ${ev.id}/${user_id} failed: ${String(err)}`);
        }
      }
    }
    return total;
  }

  /** Published events that ended more than a week ago move to "archived" (still public, under Past). */
  async archiveEnded(now = new Date()): Promise<number> {
    const rows = await this.db
      .update(events)
      .set({ status: 'archived', featured: false })
      .where(and(eq(events.status, 'published'), lt(events.endsAt, new Date(now.getTime() - ARCHIVE_AFTER_MS))))
      .returning({ id: events.id });
    return rows.length;
  }
}
