import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNotNull, lte, or, type SQL } from 'drizzle-orm';
import type { AdminEventRow, AdminEventsQuery, FeatureEventInput, Page, ReviewDecisionInput, UnpublishEventInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { EventAccess, type EventRow } from './event-access.js';
import { EventSerializer } from './event-serializer.js';
import { EventMessages } from './event-messages.service.js';
import { escapeLike } from './event-util.js';

const NEXT_STATUS = { approve: 'published', request_changes: 'changes_requested', reject: 'rejected' } as const;

/** Admin Events section: review queue, decisions, unpublish and featuring (all audited). */
@Injectable()
export class AdminEventsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: EventAccess,
    private readonly serializer: EventSerializer,
    private readonly messages: EventMessages,
    private readonly members: MembersService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async rows(user: AuthUser, rows: EventRow[]): Promise<AdminEventRow[]> {
    const viewer = await this.access.viewer(user);
    const summaries = await this.serializer.summaries(rows, viewer);
    const refs = await this.members.refs(rows.flatMap((r) => [r.createdBy, ...(r.reviewedBy ? [r.reviewedBy] : [])]));
    return rows.map((r, i) => ({
      ...summaries[i]!,
      createdBy: refs.get(r.createdBy) ?? {
        id: r.createdBy,
        handle: 'deleted-member',
        name: 'Former member',
        headline: null,
        avatarUrl: null,
        tone: 'tint',
        verified: false,
        staff: false,
      },
      submittedAt: r.submittedAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: r.reviewedBy ? (refs.get(r.reviewedBy) ?? null) : null,
      reviewNote: r.reviewNote,
      submitNote: r.submitNote,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async row(user: AuthUser, row: EventRow): Promise<AdminEventRow> {
    return (await this.rows(user, [row]))[0]!;
  }

  async list(user: AuthUser, q: AdminEventsQuery): Promise<Page<AdminEventRow>> {
    const conds: SQL[] = [];
    const queue = q.status === 'queue';
    if (queue) conds.push(eq(events.status, 'pending_review'));
    else if (q.status === 'cancelled') conds.push(isNotNull(events.cancelledAt));
    else if (q.status !== 'all') conds.push(eq(events.status, q.status));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(events.title, like), ilike(events.summary, like), ilike(events.slug, like))!);
    }
    const ageCol = queue ? events.submittedAt : events.createdAt;
    if (q.olderThanHours) conds.push(lte(ageCol, new Date(Date.now() - q.olderThanHours * 3_600_000)));
    const order =
      q.sort === 'starts_soon'
        ? [asc(events.startsAt), asc(events.id)]
        : q.sort === 'newest'
          ? [desc(ageCol), desc(events.id)]
          : [asc(ageCol), asc(events.id)];
    const offset = decodeCursor<{ o: number }>(q.cursor)?.o ?? 0;
    const rows = await this.db
      .select()
      .from(events)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const more = rows.length > q.limit;
    return {
      items: await this.rows(user, rows.slice(0, q.limit)),
      nextCursor: more ? encodeCursor({ o: offset + q.limit }) : null,
    };
  }

  private async find(id: string): Promise<EventRow> {
    if (!isUuid(id)) throw Errors.notFound('Event');
    const [row] = await this.db.select().from(events).where(eq(events.id, id.toLowerCase())).limit(1);
    if (!row) throw Errors.notFound('Event');
    return row;
  }

  async review(user: AuthUser, id: string, input: ReviewDecisionInput, ip?: string): Promise<AdminEventRow> {
    const row = await this.find(id);
    if (row.status !== 'pending_review') throw Errors.conflict('Only events waiting for review can be decided');
    const now = new Date();
    const status = NEXT_STATUS[input.decision];
    const note = input.note || null;
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(events)
        .set({
          status,
          reviewedAt: now,
          reviewedBy: user.id,
          reviewNote: note,
          ...(input.decision === 'approve' ? { publishedAt: row.publishedAt ?? now } : {}),
        })
        .where(and(eq(events.id, row.id), eq(events.status, 'pending_review')))
        .returning();
      if (!u) throw Errors.conflict('Someone else decided this event first');
      await this.audit.record(
        {
          actorId: user.id,
          action: `event.review.${input.decision}`,
          targetType: 'event',
          targetId: row.id,
          before: { status: row.status },
          after: { status, note },
          ip,
        },
        tx,
      );
      return u;
    });
    if (input.decision === 'approve') this.analytics.track('event_published', row.createdBy, null, row.id);
    await this.messages.emit({ type: 'evt.reviewed', eventId: row.id, decision: input.decision, note: input.note });
    return this.row(user, updated);
  }

  async unpublish(user: AuthUser, id: string, input: UnpublishEventInput, ip?: string): Promise<AdminEventRow> {
    const row = await this.find(id);
    if (row.status !== 'published') throw Errors.conflict('Only published events can be unpublished');
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(events)
        .set({ status: 'unpublished', reviewNote: input.reason, reviewedAt: new Date(), reviewedBy: user.id, featured: false })
        .where(and(eq(events.id, row.id), eq(events.status, 'published')))
        .returning();
      if (!u) throw Errors.conflict('This event changed. Reload and try again.');
      await this.audit.record(
        { actorId: user.id, action: 'event.unpublish', targetType: 'event', targetId: row.id, before: { status: row.status }, after: { status: 'unpublished', reason: input.reason }, ip },
        tx,
      );
      return u;
    });
    return this.row(user, updated);
  }

  async feature(user: AuthUser, id: string, input: FeatureEventInput, ip?: string): Promise<AdminEventRow> {
    const row = await this.find(id);
    if (input.featured && (row.status !== 'published' || row.cancelledAt || row.endsAt.getTime() < Date.now())) {
      throw Errors.conflict('Only upcoming published events can be featured');
    }
    if (row.featured === input.featured) return this.row(user, row);
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(events)
        .set({ featured: input.featured, featuredAt: input.featured ? new Date() : null })
        .where(eq(events.id, row.id))
        .returning();
      await this.audit.record(
        { actorId: user.id, action: input.featured ? 'event.feature' : 'event.unfeature', targetType: 'event', targetId: row.id, before: { featured: row.featured }, after: { featured: input.featured }, ip },
        tx,
      );
      return u!;
    });
    return this.row(user, updated);
  }
}
