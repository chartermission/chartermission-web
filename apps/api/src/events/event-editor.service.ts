import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import {
  eventInputIssues,
  type CancelEventInput,
  type CreateEventInput,
  type EventDetail,
  type EventFields,
  type EventHostInput,
  type SubmitForReviewInput,
  type UpdateEventInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { chapters, countries, eventCategories, eventRegistrations, eventRemindersSent, eventSpeakers, events, files } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { Errors } from '../common/errors.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { EventAccess, type EventRow, type EventViewer } from './event-access.js';
import { EventSerializer } from './event-serializer.js';
import { EventMessages } from './event-messages.service.js';
import { RegistrationsService } from './registrations.service.js';
import { slugify } from './event-util.js';

type SpeakerRow = typeof eventSpeakers.$inferSelect;
type Changed = 'time' | 'venue' | 'online';

const EDITABLE = new Set(['draft', 'changes_requested', 'rejected', 'published', 'unpublished']);
const SUBMITTABLE = new Set(['draft', 'changes_requested', 'rejected', 'unpublished']);

function issuesToFields(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[i.path.join('.') || '_'] ??= i.message;
  return fields;
}

/** The stored event as form fields (the shape eventInputIssues checks). */
function fieldsOf(row: EventRow, speakers: SpeakerRow[]): EventFields {
  const host: EventHostInput =
    row.hostType === 'chapter' && row.hostChapterId ? { type: 'chapter', chapterId: row.hostChapterId } : { type: 'member', memberId: row.hostMemberId ?? undefined };
  return {
    title: row.title,
    summary: row.summary,
    description: row.description,
    categoryId: row.categoryId,
    format: row.format as EventFields['format'],
    host,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    venue:
      row.format !== 'online' && row.venueCity && row.countryCode
        ? {
            name: row.venueName ?? row.venueCity,
            address: row.venueAddress ?? undefined,
            city: row.venueCity,
            countryCode: row.countryCode,
            mapUrl: row.venueMapUrl ?? undefined,
          }
        : null,
    online: row.onlinePlatform && row.onlineUrlEnc ? { platform: row.onlinePlatform, url: decrypt(row.onlineUrlEnc) } : null,
    registrationMode: row.registrationMode as EventFields['registrationMode'],
    externalUrl: row.externalUrl,
    capacity: row.capacity,
    waitlistEnabled: row.waitlistEnabled,
    registrationDeadline: row.registrationDeadline?.toISOString() ?? null,
    coverFileId: row.coverFileId,
    speakers: speakers.map((s) => ({
      name: s.name,
      title: s.title ?? undefined,
      organisation: s.organisation ?? undefined,
      memberId: s.memberId ?? undefined,
    })),
    agenda: row.agenda.map((a) => ({
      startsAt: a.startsAt,
      endsAt: a.endsAt ?? undefined,
      title: a.title,
      description: a.description ?? undefined,
      speakerNames: a.speakerNames,
    })),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Create, edit, submit, cancel and delete events (CM-EVT-01/02/05, review lifecycle). */
@Injectable()
export class EventEditorService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: EventAccess,
    private readonly serializer: EventSerializer,
    private readonly messages: EventMessages,
    private readonly registrations: RegistrationsService,
    private readonly analytics: AnalyticsService,
    private readonly members: MembersService,
  ) {}

  /* ---------- Validation helpers ---------- */

  /** Host columns for the chosen host; member hosts other than the creator need event.manage. */
  private async resolveHost(viewer: EventViewer, input: EventHostInput, creatorId: string) {
    if (input.type === 'chapter') {
      const [chapter] = await this.db.select().from(chapters).where(eq(chapters.id, input.chapterId)).limit(1);
      if (!chapter) throw Errors.validation({ 'host.chapterId': 'Choose a chapter' });
      if (!viewer.user.permissions.has('event.manage') && !viewer.ledChapters.has(chapter.id)) {
        throw Errors.forbidden('You can only host events for chapters you lead');
      }
      return { hostType: 'chapter', hostMemberId: null, hostChapterId: chapter.id, hostOrganisationId: null, chapterCountry: chapter.countryCode };
    }
    const memberId = input.memberId ?? creatorId;
    if (memberId !== creatorId && memberId !== viewer.user.id && !viewer.user.permissions.has('event.manage')) {
      throw Errors.forbidden('Only staff can host an event on behalf of another member');
    }
    if (!(await this.members.ref(memberId))) throw Errors.validation({ 'host.memberId': 'Member not found' });
    return { hostType: 'member', hostMemberId: memberId, hostChapterId: null, hostOrganisationId: null, chapterCountry: null as string | null };
  }

  private async checkReferences(viewer: EventViewer, v: EventFields, current?: EventRow) {
    const fields: Record<string, string> = {};
    if (v.venue) {
      const [c] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, v.venue.countryCode)).limit(1);
      if (!c) fields['venue.countryCode'] = 'Choose a country';
    }
    if (v.categoryId && v.categoryId !== current?.categoryId) {
      const [cat] = await this.db.select({ id: eventCategories.id }).from(eventCategories).where(eq(eventCategories.id, v.categoryId)).limit(1);
      if (!cat) fields.categoryId = 'Choose a category';
    }
    if (v.coverFileId && v.coverFileId !== current?.coverFileId) {
      const [f] = await this.db.select().from(files).where(eq(files.id, v.coverFileId)).limit(1);
      const owners = new Set([viewer.user.id, current?.createdBy]);
      if (!f || !owners.has(f.ownerId) || f.purpose !== 'event_cover') fields.coverFileId = 'Upload a cover image first';
      else if (f.scanStatus === 'rejected' || f.scanStatus === 'infected') fields.coverFileId = f.rejectionReason ?? 'This image was rejected';
      else if (f.scanStatus === 'awaiting_upload') fields.coverFileId = 'Finish uploading the image first';
    }
    const speakerMembers = v.speakers.map((s) => s.memberId).filter((x): x is string => !!x);
    if (speakerMembers.length) {
      const refs = await this.members.refs(speakerMembers);
      v.speakers.forEach((s, i) => {
        if (s.memberId && !refs.has(s.memberId)) fields[`speakers.${i}.memberId`] = 'Member not found';
      });
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);
  }

  private columns(v: EventFields) {
    return {
      title: v.title,
      summary: v.summary,
      description: v.description,
      categoryId: v.categoryId,
      format: v.format,
      startsAt: new Date(v.startsAt),
      endsAt: new Date(v.endsAt),
      timezone: v.timezone,
      venueName: v.venue?.name ?? null,
      venueAddress: v.venue?.address ?? null,
      venueCity: v.venue?.city ?? null,
      venueMapUrl: v.venue?.mapUrl ?? null,
      onlinePlatform: v.online?.platform ?? null,
      onlineUrlEnc: v.online ? encrypt(v.online.url) : null,
      registrationMode: v.registrationMode,
      externalUrl: v.registrationMode === 'external' ? v.externalUrl : null,
      capacity: v.registrationMode === 'external' ? null : v.capacity,
      waitlistEnabled: v.waitlistEnabled,
      registrationDeadline: v.registrationDeadline ? new Date(v.registrationDeadline) : null,
      coverFileId: v.coverFileId,
      agenda: v.agenda.map((a) => ({
        startsAt: new Date(a.startsAt).toISOString(),
        endsAt: a.endsAt ? new Date(a.endsAt).toISOString() : null,
        title: a.title,
        description: a.description ?? null,
        speakerNames: a.speakerNames,
      })),
    };
  }

  private async writeSpeakers(tx: Tx, eventId: string, speakers: EventFields['speakers']) {
    await tx.delete(eventSpeakers).where(eq(eventSpeakers.eventId, eventId));
    if (speakers.length) {
      await tx.insert(eventSpeakers).values(
        speakers.map((s, position) => ({
          eventId,
          position,
          name: s.name,
          title: s.title ?? null,
          organisation: s.organisation ?? null,
          memberId: s.memberId ?? null,
        })),
      );
    }
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    const taken = new Set(
      (await this.db.select({ slug: events.slug }).from(events).where(like(events.slug, `${base}%`))).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  private async speakersOf(eventId: string) {
    return this.db.select().from(eventSpeakers).where(eq(eventSpeakers.eventId, eventId)).orderBy(asc(eventSpeakers.position));
  }

  private async reload(id: string): Promise<EventRow> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id)).limit(1);
    if (!row) throw Errors.notFound('Event');
    return row;
  }

  /* ---------- Endpoints ---------- */

  async create(user: AuthUser, input: CreateEventInput): Promise<EventDetail> {
    if (!user.permissions.has('event.create')) throw Errors.forbidden('You don’t have permission to create events');
    const viewer = await this.access.viewer(user);
    const host = await this.resolveHost(viewer, input.host, user.id);
    await this.checkReferences(viewer, input);
    const slug = await this.uniqueSlug(input.title);
    const { chapterCountry, ...hostCols } = host;
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(events)
        .values({
          ...this.columns(input),
          ...hostCols,
          slug,
          status: 'draft',
          countryCode: input.venue?.countryCode ?? chapterCountry,
          createdBy: user.id,
        })
        .returning({ id: events.id });
      await this.writeSpeakers(tx, row!.id, input.speakers);
      return row!.id;
    });
    return this.serializer.detail(await this.reload(id), viewer);
  }

  async update(user: AuthUser, id: string, input: UpdateEventInput): Promise<EventDetail> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    const now = Date.now();
    if (row.status === 'pending_review') throw Errors.conflict('This event is being reviewed. Wait for the outcome before editing.');
    if (!EDITABLE.has(row.status)) throw Errors.conflict('This event can no longer be edited');
    if (row.cancelledAt) throw Errors.conflict('This event was cancelled and can no longer be edited');
    if (row.endsAt.getTime() < now) throw Errors.conflict('This event has ended and can no longer be edited');

    const before = fieldsOf(row, await this.speakersOf(row.id));
    const merged: EventFields = { ...before, ...input } as EventFields;
    const issues = eventInputIssues(merged);
    if (issues.length) throw Errors.validation(issuesToFields(issues));

    const live = row.status === 'published';
    const fields: Record<string, string> = {};
    const hostChanged = input.host !== undefined && !same(normaliseHost(before.host, row.createdBy), normaliseHost(merged.host, row.createdBy));
    if (hostChanged && row.publishedAt) fields.host = 'The host can’t change after the event was published';
    if (live) {
      if (merged.startsAt !== before.startsAt && Date.parse(merged.startsAt) <= now) fields.startsAt = 'Choose a start time in the future';
      const seats = row.registeredCount;
      if (merged.registrationMode !== before.registrationMode && (seats > 0 || row.waitlistCount > 0)) {
        fields.registrationMode = 'Members have registered, so the registration type can’t change';
      }
      if (merged.capacity !== null && merged.registrationMode === 'internal' && merged.capacity < seats) {
        fields.capacity = `${seats} members already hold a seat; capacity can’t be lower`;
      }
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);
    await this.checkReferences(viewer, merged, row);
    const host = hostChanged ? await this.resolveHost(viewer, merged.host, row.createdBy) : null;

    const changed: Changed[] = [];
    if (merged.startsAt !== before.startsAt || merged.endsAt !== before.endsAt) {
      if (Date.parse(merged.startsAt) !== Date.parse(before.startsAt) || Date.parse(merged.endsAt) !== Date.parse(before.endsAt)) changed.push('time');
    }
    if (!same(merged.venue, before.venue)) changed.push('venue');
    if (!same(merged.online, before.online)) changed.push('online');

    const cols = this.columns(merged);
    // Keep the stored ciphertext when the link did not change.
    if (!changed.includes('online')) cols.onlineUrlEnc = row.onlineUrlEnc;
    const promoted = await this.db.transaction(async (tx) => {
      await tx.select({ id: events.id }).from(events).where(eq(events.id, row.id)).for('update');
      const { chapterCountry, ...hostCols } = host ?? { chapterCountry: undefined };
      const countryCode =
        merged.venue?.countryCode ??
        (host ? chapterCountry : merged.host.type === 'chapter' ? await this.chapterCountry(merged.host.chapterId) : null) ??
        null;
      await tx
        .update(events)
        .set({ ...cols, ...hostCols, countryCode })
        .where(eq(events.id, row.id));
      if (input.speakers !== undefined) await this.writeSpeakers(tx, row.id, merged.speakers);
      // A new start time means the reminders go out again for the new time.
      if (changed.includes('time')) await tx.delete(eventRemindersSent).where(eq(eventRemindersSent.eventId, row.id));
      return live && merged.registrationMode === 'internal' ? this.registrations.promote(tx, row.id) : [];
    });
    if (live && changed.length) await this.messages.emit({ type: 'evt.updated', eventId: row.id, changed });
    for (const userId of promoted) await this.messages.emit({ type: 'evt.promoted', eventId: row.id, userId });
    return this.serializer.detail(await this.reload(row.id), viewer);
  }

  private async chapterCountry(chapterId: string) {
    const [c] = await this.db.select({ cc: chapters.countryCode }).from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    return c?.cc ?? null;
  }

  async submit(user: AuthUser, id: string, input: SubmitForReviewInput): Promise<EventDetail> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    if (!SUBMITTABLE.has(row.status)) {
      throw Errors.conflict(row.status === 'pending_review' ? 'This event is already waiting for review' : 'This event can’t be submitted');
    }
    if (row.cancelledAt) throw Errors.conflict('This event was cancelled');
    const issues = eventInputIssues(fieldsOf(row, await this.speakersOf(row.id)));
    const fields = issuesToFields(issues);
    if (row.startsAt.getTime() <= Date.now()) fields.startsAt ??= 'Choose a start time in the future';
    if (Object.keys(fields).length) throw Errors.validation(fields);

    const direct = user.permissions.has('event.publish');
    const now = new Date();
    const [updated] = await this.db
      .update(events)
      .set(
        direct
          ? { status: 'published', submittedAt: now, submitNote: input.note ?? null, publishedAt: row.publishedAt ?? now }
          : { status: 'pending_review', submittedAt: now, submitNote: input.note ?? null },
      )
      .where(and(eq(events.id, row.id), eq(events.status, row.status)))
      .returning();
    if (!updated) throw Errors.conflict('This event changed while you were submitting it. Reload and try again.');
    if (direct) this.analytics.track('event_published', user.id, user.countryCode, row.id);
    return this.serializer.detail(updated, viewer);
  }

  async cancel(user: AuthUser, id: string, input: CancelEventInput): Promise<EventDetail> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    if (row.status !== 'published') throw Errors.conflict('Only published events can be cancelled');
    if (row.cancelledAt) throw Errors.conflict('This event is already cancelled');
    if (row.endsAt.getTime() <= Date.now()) throw Errors.conflict('This event has already ended');
    const [updated] = await this.db
      .update(events)
      .set({ cancelledAt: new Date(), cancelReason: input.reason, cancelledBy: user.id, featured: false })
      .where(and(eq(events.id, row.id), sql`${events.cancelledAt} is null`))
      .returning();
    if (!updated) throw Errors.conflict('This event is already cancelled');
    await this.messages.emit({ type: 'evt.cancelled', eventId: row.id });
    this.analytics.track('event_cancelled', user.id, user.countryCode, row.id);
    return this.serializer.detail(updated, viewer);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const viewer = await this.access.viewer(user);
    const row = await this.access.managed(id, viewer);
    const deletable = row.status === 'draft' || (row.status === 'rejected' && !row.publishedAt);
    if (!deletable) throw Errors.conflict('Only drafts can be deleted. Cancel the event instead.');
    const regs = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, row.id), inArray(eventRegistrations.status, ['registered', 'waitlisted', 'attended'])));
    if ((regs[0]?.n ?? 0) > 0) throw Errors.conflict('Members have registered for this event. Cancel it instead.');
    await this.db.delete(events).where(and(eq(events.id, row.id), eq(events.status, row.status)));
  }
}

function normaliseHost(h: EventHostInput, creatorId: string) {
  return h.type === 'chapter' ? { type: 'chapter', id: h.chapterId } : { type: 'member', id: h.memberId ?? creatorId };
}
