import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  CALENDAR_DAY_PREVIEW,
  type ChapterRef,
  type EventCategory,
  type EventDetail,
  type EventHostOptions,
  type EventsCalendar,
  type EventsCalendarQuery,
  type EventsQuery,
  type EventSummary,
  type MyEventsQuery,
  type Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, eventCategories, eventRegistrations, events, follows, memberProfiles } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { RelationsService } from '../core/relations.service.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { EventAccess, type EventRow, type EventViewer } from './event-access.js';
import { EventSerializer } from './event-serializer.js';
import { escapeLike, formatLocal, PUBLIC_STATUSES, zonedMidnight, dayKey } from './event-util.js';
import { renderIcs } from './ics.js';
import { webUrl } from '../infra/mail-layout.js';

type When = 'upcoming' | 'past' | 'all';
type Cursor = { t: string; id: string };

/** Keyset order and condition for when=upcoming|past|all over (starts_at, id). */
function ordering(when: When, cursor: Cursor | null): { order: SQL[]; after?: SQL } {
  const descending = when === 'past';
  const order = descending ? [desc(events.startsAt), desc(events.id)] : [asc(events.startsAt), asc(events.id)];
  if (!cursor) return { order };
  const after = descending
    ? sql`(${events.startsAt}, ${events.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`
    : sql`(${events.startsAt}, ${events.id}) > (${cursor.t}::timestamptz, ${cursor.id}::uuid)`;
  return { order, after };
}

function whenCondition(when: When, now: Date): SQL | undefined {
  if (when === 'upcoming') return gte(events.endsAt, now);
  if (when === 'past') return lt(events.endsAt, now);
  return undefined;
}

/** Listings, calendar, detail and "my events" (CM-EVT-03). */
@Injectable()
export class EventCatalogService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: EventAccess,
    private readonly serializer: EventSerializer,
    private readonly relations: RelationsService,
  ) {}

  /** Filters shared by GET /events and the calendar. */
  private async filters(q: Omit<EventsQuery, 'when' | 'cursor' | 'limit'>, viewer: EventViewer): Promise<SQL[] | null> {
    const conds: SQL[] = [inArray(events.status, [...PUBLIC_STATUSES])];
    if (q.from) conds.push(sql`${events.endsAt} > ${q.from}::timestamptz`);
    if (q.to) conds.push(sql`${events.startsAt} < ${q.to}::timestamptz`);
    if (q.format) conds.push(eq(events.format, q.format));
    if (q.category) {
      const [cat] = await this.db.select({ id: eventCategories.id }).from(eventCategories).where(eq(eventCategories.slug, q.category.toLowerCase())).limit(1);
      if (!cat) return null;
      conds.push(eq(events.categoryId, cat.id));
    }
    if (q.country) conds.push(eq(events.countryCode, q.country));
    if (q.chapter) {
      if (q.chapter === 'mine') {
        conds.push(
          sql`events.host_chapter_id::text in (select f.target_id from ${follows} f where f.follower_id = ${viewer.user.id} and f.target_type = 'chapter')`,
        );
      } else {
        const [ch] = await this.db
          .select({ id: chapters.id })
          .from(chapters)
          .where(isUuid(q.chapter) ? eq(chapters.id, q.chapter.toLowerCase()) : eq(chapters.slug, q.chapter.toLowerCase()))
          .limit(1);
        if (!ch) return null;
        conds.push(eq(events.hostChapterId, ch.id));
      }
    }
    if (q.host) {
      let hostId: string | undefined;
      if (isUuid(q.host)) hostId = q.host.toLowerCase();
      else {
        const [p] = await this.db
          .select({ id: memberProfiles.userId })
          .from(memberProfiles)
          .where(sql`lower(${memberProfiles.handle}) = ${q.host.toLowerCase()}`)
          .limit(1);
        hostId = p?.id;
      }
      if (!hostId) return null;
      conds.push(and(eq(events.hostType, 'member'), eq(events.hostMemberId, hostId))!);
    }
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(events.title, like), ilike(events.summary, like))!);
    }
    if (q.mine === 'registered') {
      conds.push(
        sql`exists (select 1 from ${eventRegistrations} r where r.event_id = events.id and r.user_id = ${viewer.user.id} and r.status in ('registered','waitlisted','attended'))`,
      );
    } else if (q.mine === 'hosting') {
      conds.push(this.hostingCondition(viewer));
    }
    if (q.featured !== undefined) conds.push(eq(events.featured, q.featured));
    // Hide events hosted by members on either side of a block.
    const blocked = await this.relations.blockedSet(viewer.user.id);
    if (blocked.size) conds.push(sql`(${events.hostMemberId} is null or ${events.hostMemberId} not in (${sql.join([...blocked].map((id) => sql`${id}::uuid`), sql`, `)}))`);
    return conds;
  }

  private hostingCondition(viewer: EventViewer): SQL {
    const parts: SQL[] = [eq(events.createdBy, viewer.user.id), and(eq(events.hostType, 'member'), eq(events.hostMemberId, viewer.user.id))!];
    if (viewer.ledChapters.size) parts.push(and(eq(events.hostType, 'chapter'), inArray(events.hostChapterId, [...viewer.ledChapters]))!);
    return or(...parts)!;
  }

  async list(user: AuthUser, q: EventsQuery): Promise<Page<EventSummary>> {
    const viewer = await this.access.viewer(user);
    const conds = await this.filters(q, viewer);
    if (!conds) return { items: [], nextCursor: null };
    const now = new Date();
    const w = whenCondition(q.when, now);
    if (w) conds.push(w);
    const { order, after } = ordering(q.when, decodeCursor<Cursor>(q.cursor));
    if (after) conds.push(after);
    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.startsAt.toISOString(), id: r.id }));
    return { items: await this.serializer.summaries(page.items, viewer, now), nextCursor: page.nextCursor };
  }

  async calendar(user: AuthUser, q: EventsCalendarQuery): Promise<EventsCalendar> {
    const viewer = await this.access.viewer(user);
    const [y, m] = q.month.split('-').map(Number) as [number, number];
    const start = zonedMidnight(q.tz, y, m, 1);
    const end = m === 12 ? zonedMidnight(q.tz, y + 1, 1, 1) : zonedMidnight(q.tz, y, m + 1, 1);
    const conds = await this.filters(q, viewer);
    if (!conds) return { month: q.month, tz: q.tz, days: [], total: 0 };
    conds.push(gte(events.startsAt, start), lt(events.startsAt, end));
    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conds))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(2000);
    const buckets = new Map<string, EventRow[]>();
    for (const r of rows) {
      const key = dayKey(r.startsAt, q.tz);
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }
    const preview = [...buckets.values()].flatMap((list) => list.slice(0, CALENDAR_DAY_PREVIEW));
    const summaries = new Map((await this.serializer.summaries(preview, viewer)).map((s) => [s.id, s]));
    const days = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({
        date,
        count: list.length,
        events: list.slice(0, CALENDAR_DAY_PREVIEW).map((r) => summaries.get(r.id)!),
      }));
    return { month: q.month, tz: q.tz, days, total: rows.length };
  }

  async categories(): Promise<EventCategory[]> {
    return this.db
      .select({ id: eventCategories.id, slug: eventCategories.slug, name: eventCategories.name })
      .from(eventCategories)
      .orderBy(asc(eventCategories.position), asc(eventCategories.name));
  }

  async hostOptions(user: AuthUser): Promise<EventHostOptions> {
    const canCreate = user.permissions.has('event.create');
    let chapterRows: ChapterRef[] = [];
    if (user.permissions.has('event.manage')) {
      chapterRows = await this.db
        .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
        .from(chapters)
        .where(eq(chapters.status, 'active'))
        .orderBy(asc(chapters.name));
    } else if (canCreate) {
      const led = await this.access.ledChapters(user.id);
      if (led.size) {
        chapterRows = await this.db
          .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
          .from(chapters)
          .where(inArray(chapters.id, [...led]))
          .orderBy(asc(chapters.name));
      }
    }
    return { canHostAsMember: canCreate, chapters: chapterRows, canPublishDirectly: user.permissions.has('event.publish') };
  }

  async detail(user: AuthUser, idOrSlug: string): Promise<EventDetail> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.visible(idOrSlug, viewer);
    return this.serializer.detail(row, viewer, { related: true });
  }

  /** GET /events/:id.ics — public for public events; never contains the online join link. */
  async ics(user: AuthUser | undefined, idOrSlug: string): Promise<{ filename: string; body: string }> {
    const viewer = await this.access.optionalViewer(user);
    const row = await this.access.visible(idOrSlug, viewer);
    const summary = await this.serializer.summaryOf(row, viewer);
    const url = webUrl(`/events/${row.slug}`);
    const venue = row.format !== 'online' && row.venueName ? `${row.venueName}${row.venueAddress ? `, ${row.venueAddress}` : ''}, ` : '';
    const where =
      row.format === 'online'
        ? `Online${row.onlinePlatform ? ` (${row.onlinePlatform})` : ''}`
        : `${venue}${summary.location.label}${row.format === 'hybrid' && row.onlinePlatform ? ` (${row.onlinePlatform})` : ''}`;
    const description = [
      row.cancelledAt ? `CANCELLED: ${row.cancelReason ?? ''}`.trim() : null,
      row.summary,
      `Local time: ${formatLocal(row.startsAt, row.timezone)}`,
      row.format !== 'in_person' ? 'Join details are on the event page for registered members.' : null,
      `Event page: ${url}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const host = new URL(webUrl('/')).hostname;
    const body = renderIcs({
      uid: `event-${row.id}@${host}`,
      title: row.title,
      description,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: row.timezone,
      location: where,
      url,
      cancelled: !!row.cancelledAt,
      sequence: Math.max(0, Math.floor((row.updatedAt.getTime() - row.createdAt.getTime()) / 1000)),
      updatedAt: row.updatedAt,
    });
    return { filename: `${row.slug}.ics`, body };
  }

  async mine(user: AuthUser, q: MyEventsQuery): Promise<Page<EventSummary>> {
    const viewer = await this.access.viewer(user);
    const now = new Date();
    const conds: SQL[] = [];
    if (q.role === 'registered') {
      conds.push(
        inArray(events.status, [...PUBLIC_STATUSES]),
        sql`exists (select 1 from ${eventRegistrations} r where r.event_id = events.id and r.user_id = ${user.id} and r.status in ('registered','waitlisted','attended'))`,
      );
    } else {
      conds.push(this.hostingCondition(viewer));
      if (q.status) conds.push(eq(events.status, q.status));
    }
    const w = whenCondition(q.when, now);
    if (w) conds.push(w);
    const { order, after } = ordering(q.when, decodeCursor<Cursor>(q.cursor));
    if (after) conds.push(after);
    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.startsAt.toISOString(), id: r.id }));
    return { items: await this.serializer.summaries(page.items, viewer, now), nextCursor: page.nextCursor };
  }
}
