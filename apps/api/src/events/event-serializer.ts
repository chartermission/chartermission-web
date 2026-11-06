import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type {
  AgendaItem,
  ChapterRef,
  EventCategory,
  EventDetail,
  EventHost,
  EventLocation,
  EventSpeaker,
  EventSummary,
  MemberRef,
  RegistrationStatus,
} from '@chartermission/contracts';
import { JOIN_LINK_LEAD_HOURS } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookmarks, chapters, countries, eventCategories, eventRegistrations, eventSpeakers, events, files } from '../db/schema.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { decrypt } from '../common/crypto.js';
import { canManage, type EventRow, type EventViewer } from './event-access.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Lookups shared by every row in one serialisation pass. */
interface Batch {
  categories: Map<string, EventCategory>;
  chapters: Map<string, ChapterRef>;
  members: Map<string, MemberRef>;
  countryNames: Map<string, string>;
  cleanCovers: Set<string>;
  registrations: Map<string, { status: RegistrationStatus; position: number | null }>;
  saved: Set<string>;
}

export function locationOf(row: EventRow, countryName: (code: string) => string): EventLocation {
  if (row.format === 'online' || !row.venueCity) return { city: null, countryCode: null, label: 'Online', shortLabel: 'Online' };
  const cc = row.countryCode;
  const place = cc ? `${row.venueCity}, ${countryName(cc)}` : row.venueCity;
  if (row.format === 'hybrid') return { city: row.venueCity, countryCode: cc, label: `${place} & online`, shortLabel: `${row.venueCity} & online` };
  return { city: row.venueCity, countryCode: cc, label: place, shortLabel: row.venueCity };
}

/** Registration could be acted on now (see EventSummary.registrationOpen). */
export function registrationOpen(row: EventRow, now = new Date()): boolean {
  if (row.status !== 'published' || row.cancelledAt) return false;
  const closesAt = row.registrationDeadline ?? row.startsAt;
  if (now.getTime() >= closesAt.getTime() || now.getTime() >= row.startsAt.getTime()) return false;
  if (row.registrationMode === 'external') return true;
  return row.capacity === null || row.registeredCount < row.capacity || row.waitlistEnabled;
}

@Injectable()
export class EventSerializer {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
  ) {}

  private async batch(rows: EventRow[], viewer: EventViewer | undefined, extraMemberIds: string[] = []): Promise<Batch> {
    const ids = rows.map((r) => r.id);
    const chapterIds = [...new Set(rows.map((r) => r.hostChapterId).filter((x): x is string => !!x))];
    const memberIds = [...rows.map((r) => r.hostMemberId).filter((x): x is string => !!x), ...extraMemberIds];
    const coverIds = [...new Set(rows.map((r) => r.coverFileId).filter((x): x is string => !!x))];
    const [cats, chs, refs, covers, regs, saved] = await Promise.all([
      this.db.select({ id: eventCategories.id, slug: eventCategories.slug, name: eventCategories.name }).from(eventCategories),
      chapterIds.length
        ? this.db
            .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
            .from(chapters)
            .where(inArray(chapters.id, chapterIds))
        : Promise.resolve([]),
      this.members.refs(memberIds),
      coverIds.length
        ? this.db
            .select({ id: files.id })
            .from(files)
            .where(and(inArray(files.id, coverIds), eq(files.scanStatus, 'clean')))
        : Promise.resolve([]),
      viewer && ids.length ? this.viewerRegistrations(viewer.user.id, ids) : Promise.resolve(new Map()),
      viewer && ids.length
        ? this.db
            .select({ id: bookmarks.targetId })
            .from(bookmarks)
            .where(and(eq(bookmarks.userId, viewer.user.id), eq(bookmarks.targetType, 'event'), inArray(bookmarks.targetId, ids)))
        : Promise.resolve([]),
    ]);
    const codes = [...new Set(rows.map((r) => r.countryCode).filter((x): x is string => !!x))];
    const names = codes.length
      ? await this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, codes))
      : [];
    return {
      categories: new Map(cats.map((c) => [c.id, c])),
      chapters: new Map(chs.map((c) => [c.id, c])),
      members: refs,
      countryNames: new Map(names.map((n) => [n.code, n.name])),
      cleanCovers: new Set(covers.map((c) => c.id)),
      registrations: regs,
      saved: new Set(saved.map((s) => s.id)),
    };
  }

  /** The viewer's rows for these events, with the 1-based waitlist place for waitlisted rows. */
  private async viewerRegistrations(userId: string, eventIds: string[]) {
    const rows = await this.db
      .select({
        eventId: eventRegistrations.eventId,
        status: eventRegistrations.status,
        place: sql<number | null>`case when ${eventRegistrations.status} = 'waitlisted' then (
          select count(*)::int from ${eventRegistrations} w
          where w.event_id = event_registrations.event_id and w.status = 'waitlisted' and w.position <= event_registrations.position
        ) end`,
      })
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.userId, userId), inArray(eventRegistrations.eventId, eventIds)));
    return new Map(rows.map((r) => [r.eventId, { status: r.status as RegistrationStatus, position: r.place }]));
  }

  private host(row: EventRow, b: Batch): EventHost {
    if (row.hostType === 'chapter' && row.hostChapterId) {
      const chapter = b.chapters.get(row.hostChapterId);
      if (chapter) return { type: 'chapter', chapter };
    }
    if (row.hostType === 'organisation' && row.hostOrganisationId) {
      return { type: 'organisation', organisation: { id: row.hostOrganisationId, name: 'Organisation', slug: 'organisation', logoUrl: null } };
    }
    const member = b.members.get(row.hostMemberId ?? row.createdBy) ?? {
      id: row.hostMemberId ?? row.createdBy,
      handle: 'deleted-member',
      name: 'Former member',
      headline: null,
      avatarUrl: null,
      tone: 'tint' as const,
      verified: false,
      staff: false,
    };
    return { type: 'member', member };
  }

  private summary(row: EventRow, viewer: EventViewer | undefined, b: Batch, now: Date): EventSummary {
    const reg = b.registrations.get(row.id);
    const internal = row.registrationMode === 'internal';
    const capacity = internal ? row.capacity : null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      category: row.categoryId ? (b.categories.get(row.categoryId) ?? null) : null,
      format: row.format as EventSummary['format'],
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      timezone: row.timezone,
      location: locationOf(row, (code) => b.countryNames.get(code) ?? code),
      host: this.host(row, b),
      coverUrl: row.coverFileId && b.cleanCovers.has(row.coverFileId) ? mediaUrl(row.coverFileId) : null,
      capacity,
      registeredCount: internal ? row.registeredCount : 0,
      waitlistCount: internal ? row.waitlistCount : 0,
      spotsLeft: capacity === null ? null : Math.max(0, capacity - row.registeredCount),
      registrationMode: row.registrationMode as EventSummary['registrationMode'],
      registrationOpen: registrationOpen(row, now),
      deadline: iso(row.registrationDeadline),
      status: row.status as EventSummary['status'],
      cancelledAt: iso(row.cancelledAt),
      featured: row.featured,
      past: row.endsAt.getTime() < now.getTime(),
      viewer: {
        status: reg?.status ?? null,
        waitlistPosition: reg?.status === 'waitlisted' ? (reg.position ?? null) : null,
        canManage: canManage(row, viewer),
        saved: b.saved.has(row.id),
      },
    };
  }

  async summaries(rows: EventRow[], viewer: EventViewer | undefined, now = new Date()): Promise<EventSummary[]> {
    if (rows.length === 0) return [];
    const b = await this.batch(rows, viewer);
    return rows.map((r) => this.summary(r, viewer, b, now));
  }

  async summaryOf(row: EventRow, viewer: EventViewer | undefined): Promise<EventSummary> {
    return (await this.summaries([row], viewer))[0]!;
  }

  async detail(row: EventRow, viewer: EventViewer | undefined, opts: { related?: boolean } = {}): Promise<EventDetail> {
    const now = new Date();
    const speakerRows = await this.db.select().from(eventSpeakers).where(eq(eventSpeakers.eventId, row.id)).orderBy(asc(eventSpeakers.position));
    const b = await this.batch(
      [row],
      viewer,
      speakerRows.map((s) => s.memberId).filter((x): x is string => !!x),
    );
    const base = this.summary(row, viewer, b, now);
    const manage = base.viewer.canManage;
    const past = base.past;

    const speakers: EventSpeaker[] = speakerRows.map((s) => {
      const member = s.memberId ? (b.members.get(s.memberId) ?? null) : null;
      return {
        name: member?.name ?? s.name,
        title: s.title,
        organisation: s.organisation,
        member,
        avatarUrl: member?.avatarUrl ?? null,
      };
    });
    const agenda: AgendaItem[] = [...row.agenda]
      .sort((a, z) => Date.parse(a.startsAt) - Date.parse(z.startsAt))
      .map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, title: a.title, description: a.description, speakerNames: a.speakerNames }));

    let online: EventDetail['online'] = null;
    if (row.format !== 'in_person' && row.onlinePlatform) {
      let joinUrl: string | null = null;
      let joinAvailableAt: string | null = null;
      const seat = base.viewer.status === 'registered' || base.viewer.status === 'attended';
      const opensAt = row.startsAt.getTime() - JOIN_LINK_LEAD_HOURS * 3_600_000;
      if (!past && row.onlineUrlEnc) {
        if (manage) joinUrl = decrypt(row.onlineUrlEnc);
        else if (seat && !row.cancelledAt && isLive(row.status)) {
          if (now.getTime() >= opensAt) joinUrl = decrypt(row.onlineUrlEnc);
          else joinAvailableAt = new Date(opensAt).toISOString();
        }
      }
      online = { platform: row.onlinePlatform, joinUrl, joinAvailableAt };
    }

    const venue: EventDetail['venue'] =
      row.format !== 'online' && row.venueCity && row.countryCode
        ? { name: row.venueName ?? row.venueCity, address: row.venueAddress, city: row.venueCity, countryCode: row.countryCode, mapUrl: row.venueMapUrl }
        : null;

    const detail: EventDetail = {
      ...base,
      description: row.description,
      speakers,
      agenda,
      venue,
      online,
      externalUrl: row.registrationMode === 'external' && !past ? row.externalUrl : null,
      waitlistEnabled: row.waitlistEnabled,
      cancelReason: row.cancelReason,
      review: manage
        ? { submittedAt: iso(row.submittedAt), reviewedAt: iso(row.reviewedAt), note: row.reviewNote, publishedAt: iso(row.publishedAt) }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    if (opts.related) detail.related = await this.related(row, viewer, now);
    return detail;
  }

  /** Up to 3 upcoming public events in the same category or from the same host. */
  private async related(row: EventRow, viewer: EventViewer | undefined, now: Date): Promise<EventSummary[]> {
    const sameHost =
      row.hostType === 'chapter' && row.hostChapterId
        ? eq(events.hostChapterId, row.hostChapterId)
        : row.hostMemberId
          ? eq(events.hostMemberId, row.hostMemberId)
          : undefined;
    const sameCategory = row.categoryId ? eq(events.categoryId, row.categoryId) : undefined;
    const match = sameHost && sameCategory ? or(sameHost, sameCategory) : (sameHost ?? sameCategory);
    if (!match) return [];
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.status, 'published'), sql`${events.cancelledAt} is null`, gt(events.endsAt, now), ne(events.id, row.id), match))
      .orderBy(asc(events.startsAt))
      .limit(3);
    return this.summaries(rows, viewer, now);
  }
}

function isLive(status: string) {
  return status === 'published' || status === 'archived';
}
