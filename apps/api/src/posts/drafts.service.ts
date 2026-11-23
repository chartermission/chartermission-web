import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  CreatePostInput,
  DraftPayload,
  MAX_DRAFTS,
  SCHEDULE_MAX_DAYS,
  SCHEDULE_MIN_MINUTES,
  type DraftStatus,
  type DraftView,
  type DraftsQuery,
  type Page,
  type PostView,
  type SaveDraftInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { files, postDrafts } from '../db/schema.js';
import { AppError, Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthUser, AuthVia } from '../core/auth-context.js';
import { can } from '../core/policy.js';
import { mediaUrl } from '../core/members.service.js';
import { SessionService } from '../core/session.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { AuditService } from '../infra/audit.service.js';
import { PostsService } from './posts.service.js';

export type DraftRow = typeof postDrafts.$inferSelect;

/** Statuses that count towards MAX_DRAFTS and show in the member's lists. */
const OPEN_STATUSES = ['draft', 'scheduled', 'failed', 'held'];

/** Queue "maintenance" job that publishes due scheduled posts, every minute. */
export const PUBLISH_SCHEDULED_JOB = 'publish-scheduled';
const PUBLISH_EVERY_MS = 60_000;
/** Scheduled posts picked up per run. */
const PUBLISH_BATCH = 50;
/** A draft stuck in "publishing" this long (crashed worker) is retried. */
const STUCK_MS = 10 * 60_000;

function draftTs(col: typeof postDrafts.updatedAt): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Message shown to the author when a scheduled post can't go out. */
function failureMessage(err: unknown): string {
  if (err instanceof AppError) {
    const field = err.fields ? Object.values(err.fields)[0] : undefined;
    return field ?? err.message;
  }
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    const first = (err as { issues: { message?: string }[] }).issues[0];
    return first?.message ?? 'The post is incomplete';
  }
  return 'Something went wrong while publishing';
}

/**
 * Composer drafts and scheduled posts. A draft keeps the composer state as-is;
 * a scheduled post must already be a valid post. Publishing (now, or by the
 * minute job when it is due) goes through PostsService.create, so rate limits,
 * restrictions, hashtags, mentions and notifications apply at publish time.
 */
@Injectable()
export class DraftsService implements OnModuleInit {
  private readonly logger = new Logger('Drafts');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posts: PostsService,
    private readonly sessions: SessionService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name) => {
      if (name === PUBLISH_SCHEDULED_JOB) await this.runDue();
    });
    this.queue.every('maintenance', PUBLISH_SCHEDULED_JOB, PUBLISH_EVERY_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${PUBLISH_SCHEDULED_JOB}: ${String(err)}`);
    });
  }

  /** GET /me/drafts?status=draft|scheduled — drafts newest first; scheduled (and failed) soonest first. */
  async list(user: AuthUser, q: DraftsQuery): Promise<Page<DraftView>> {
    // Scheduled posts the Charter Mission team paused ("held") stay in the scheduled list.
    const statuses: string[] = q.status === 'draft' ? ['draft'] : ['scheduled', 'failed', 'publishing', 'held'];
    const base = and(eq(postDrafts.authorId, user.id), inArray(postDrafts.status, statuses));
    if (q.status === 'draft') {
      const ts = draftTs(postDrafts.updatedAt);
      const c = decodeCursor<{ t: string; id: string }>(q.cursor);
      const rows = await this.db
        .select({ row: postDrafts, ts })
        .from(postDrafts)
        .where(and(base, c ? sql`(${postDrafts.updatedAt}, ${postDrafts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
        .orderBy(desc(postDrafts.updatedAt), desc(postDrafts.id))
        .limit(q.limit + 1);
      const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.row.id }));
      return { items: await this.views(page.items.map((i) => i.row)), nextCursor: page.nextCursor };
    }
    const ts = sql<string>`to_char(${postDrafts.scheduledFor} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await this.db
      .select({ row: postDrafts, ts })
      .from(postDrafts)
      .where(and(base, c ? sql`(${postDrafts.scheduledFor}, ${postDrafts.id}) > (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(asc(postDrafts.scheduledFor), asc(postDrafts.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.row.id }));
    return { items: await this.views(page.items.map((i) => i.row)), nextCursor: page.nextCursor };
  }

  async get(user: AuthUser, id: string): Promise<DraftView> {
    const row = await this.own(user, id);
    const [view] = await this.views([row]);
    return view!;
  }

  /** POST /me/drafts — save composer state; with scheduledFor it becomes a scheduled post. */
  async create(user: AuthUser, input: SaveDraftInput, via?: AuthVia): Promise<DraftView> {
    if (!can(user, 'post.create')) throw Errors.forbidden();
    const [counted] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(postDrafts)
      .where(and(eq(postDrafts.authorId, user.id), inArray(postDrafts.status, OPEN_STATUSES)));
    if ((counted?.n ?? 0) >= MAX_DRAFTS) {
      throw Errors.conflict(`You have ${MAX_DRAFTS} drafts and scheduled posts. Publish or delete some first.`);
    }
    const payload = await this.checkPayload(user, input.payload);
    const schedule = input.scheduledFor ? this.checkSchedule(user, payload, input.scheduledFor) : null;
    const source = via?.kind === 'oauth' ? 'claude' : 'web';
    // Content calendar: a post Claude schedules waits for the team's approval when they ask for it.
    const pending = !!schedule && source === 'claude' && (await this.posts.claudeApprovalRequired());
    const [row] = await this.db
      .insert(postDrafts)
      .values({
        authorId: user.id,
        payload,
        status: schedule ? 'scheduled' : 'draft',
        scheduledFor: schedule,
        source,
        contentReview: pending ? 'pending' : null,
      })
      .returning();
    const [view] = await this.views([row!]);
    return view!;
  }

  /** PATCH /me/drafts/{id} — autosave, schedule (scheduledFor), or unschedule (scheduledFor: null). */
  async update(user: AuthUser, id: string, input: SaveDraftInput, via?: AuthVia): Promise<DraftView> {
    const row = await this.own(user, id);
    if (row.status === 'publishing') throw Errors.conflict('This post is being published right now');
    const payload = await this.checkPayload(user, input.payload);
    let scheduledFor = row.scheduledFor;
    if (input.scheduledFor !== undefined) {
      scheduledFor = input.scheduledFor ? this.checkSchedule(user, payload, input.scheduledFor) : null;
    } else if (scheduledFor) {
      // Editing a scheduled post keeps it scheduled, so it must stay a valid post.
      scheduledFor = this.checkSchedule(user, payload, scheduledFor.toISOString(), { allowPast: true });
    }
    const byClaude = via?.kind === 'oauth';
    const source = byClaude ? 'claude' : row.source;
    // A paused post stays paused when its author edits or moves it; only the team releases it. Taking
    // it off the schedule would let it be published straight away, so that waits for the release too.
    if (row.status === 'held' && !scheduledFor) {
      throw Errors.conflict('The Charter Mission team paused this post. You can edit it or delete it, and unschedule it once they release it.');
    }
    const status = scheduledFor ? (row.status === 'held' ? 'held' : 'scheduled') : 'draft';
    const changed = JSON.stringify(payload) !== JSON.stringify(row.payload);
    const contentReview = await this.reviewAfterEdit(row, { scheduled: !!scheduledFor, source, byClaude, changed });
    const [updated] = await this.db
      .update(postDrafts)
      .set({
        payload,
        scheduledFor,
        status,
        lastError: null,
        source,
        contentReview,
        ...(contentReview !== row.contentReview ? { contentReviewBy: null, contentReviewAt: null, contentReviewNote: contentReview === 'declined' ? row.contentReviewNote : null } : {}),
      })
      // Only if nobody (the team, the scheduler) changed its state since it was read.
      .where(and(eq(postDrafts.id, id), eq(postDrafts.authorId, user.id), eq(postDrafts.status, row.status)))
      .returning();
    if (!updated) throw Errors.conflict('This post changed while you were editing it. Reload it and try again.');
    const [view] = await this.views([updated]);
    return view!;
  }

  /**
   * The team's review after an edit. In "approve before publishing" mode a scheduled post written
   * with Claude needs approval: again after Claude changes it, and after a declined one is
   * rescheduled. Unscheduling drops a pending review; a decline stays so the author sees the note.
   * An approval covers the text the team saw: Claude editing the post, or anyone changing its
   * content, drops it (so publishing it later, scheduled or not, is reviewed again).
   */
  private async reviewAfterEdit(
    row: DraftRow,
    next: { scheduled: boolean; source: string; byClaude: boolean; changed: boolean },
  ): Promise<string | null> {
    const stale = row.contentReview === 'approved' && (next.byClaude || next.changed);
    const current = stale ? null : row.contentReview;
    if (!next.scheduled) return current === 'pending' ? null : current;
    const required = next.source === 'claude' && (await this.posts.claudeApprovalRequired());
    if (!required) return current === 'declined' ? null : current;
    if (next.byClaude || current !== 'approved') return 'pending';
    return current;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.own(user, id);
    if (row.status === 'publishing') throw Errors.conflict('This post is being published right now');
    await this.db.delete(postDrafts).where(and(eq(postDrafts.id, id), eq(postDrafts.authorId, user.id)));
  }

  /** POST /me/drafts/{id}/publish — publish now; the draft is removed once the post exists. */
  async publish(user: AuthUser, id: string, via?: AuthVia): Promise<PostView> {
    const row = await this.own(user, id);
    if (row.status === 'publishing') throw Errors.conflict('This post is being published right now');
    if (row.status === 'held') throw Errors.conflict('The Charter Mission team paused this post. It can be published once they release it.');
    const parsed = CreatePostInput.safeParse(row.payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation({ [String(issue?.path[0] ?? 'body')]: issue?.message ?? 'The post is incomplete' }, 'Finish the post before publishing');
    }
    const post = await this.posts.create(user, parsed.data, {
      via,
      // A post published from a draft written with Claude counts as written with Claude.
      source: via?.kind === 'oauth' ? 'claude' : (row.source as 'web' | 'claude'),
      approved: row.contentReview === 'approved' ? { by: row.contentReviewBy, at: row.contentReviewAt, note: row.contentReviewNote } : undefined,
    });
    await this.db.delete(postDrafts).where(eq(postDrafts.id, id));
    await this.recordPublished(row, post.id);
    return post;
  }

  /** Minute job: publish scheduled posts that are due, as their author. */
  async runDue(now = new Date()): Promise<{ published: number; failed: number }> {
    // Recover drafts left in "publishing" by a crashed run.
    await this.db
      .update(postDrafts)
      .set({ status: 'scheduled' })
      .where(and(eq(postDrafts.status, 'publishing'), lte(postDrafts.updatedAt, new Date(now.getTime() - STUCK_MS))));
    // Held posts have status "held", so they are never picked; posts waiting for approval (or declined) are skipped.
    const due = await this.db
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.status, 'scheduled'),
          lte(postDrafts.scheduledFor, now),
          or(isNull(postDrafts.contentReview), eq(postDrafts.contentReview, 'approved')),
        ),
      )
      .orderBy(asc(postDrafts.scheduledFor))
      .limit(PUBLISH_BATCH);
    let published = 0;
    let failed = 0;
    for (const { id } of due) {
      // Claim the row so two workers never publish the same post.
      const [claimed] = await this.db
        .update(postDrafts)
        .set({ status: 'publishing' })
        .where(
          and(
            eq(postDrafts.id, id),
            eq(postDrafts.status, 'scheduled'),
            or(isNull(postDrafts.contentReview), eq(postDrafts.contentReview, 'approved')),
          ),
        )
        .returning();
      if (!claimed) continue;
      try {
        const author = await this.sessions.userById(claimed.authorId);
        if (!author || author.status !== 'active') throw Errors.forbidden('Your account can’t publish posts right now');
        const post = await this.posts.create(author, CreatePostInput.parse(claimed.payload), {
          source: claimed.source as 'web' | 'claude',
          approved:
            claimed.contentReview === 'approved'
              ? { by: claimed.contentReviewBy, at: claimed.contentReviewAt, note: claimed.contentReviewNote }
              : undefined,
        });
        await this.db.delete(postDrafts).where(eq(postDrafts.id, id));
        await this.recordPublished(claimed, post.id);
        // As before for posts that went out, or wait for their files or the chapter team; not for
        // ones that now wait for the Charter Mission team's approval (the author is told then).
        if (post.status !== 'awaiting_approval') {
          await this.events.emit({ type: 'scheduled.published', draftId: id, postId: post.id, authorId: claimed.authorId });
        }
        published++;
      } catch (err) {
        const reason = failureMessage(err);
        await this.db.update(postDrafts).set({ status: 'failed', lastError: reason }).where(eq(postDrafts.id, id));
        await this.events.emit({ type: 'scheduled.failed', draftId: id, authorId: claimed.authorId, reason });
        failed++;
      }
    }
    return { published, failed };
  }

  /**
   * Links a post published from a Claude (or reviewed) draft to that draft in the audit log, so the
   * content calendar can show the draft's review history and Claude activity on the post.
   */
  private async recordPublished(draft: DraftRow, postId: string) {
    if (draft.source !== 'claude' && !draft.contentReview) return;
    await this.audit.record({
      actorId: null,
      action: 'content_calendar.published',
      targetType: 'post',
      targetId: postId,
      before: { draftId: draft.id, scheduledFor: draft.scheduledFor?.toISOString() ?? null },
      after: { postId, source: draft.source },
    });
  }

  private async own(user: AuthUser, id: string): Promise<DraftRow> {
    const [row] = await this.db.select().from(postDrafts).where(eq(postDrafts.id, id)).limit(1);
    if (!row || row.authorId !== user.id) throw Errors.notFound('Draft');
    return row;
  }

  /** Attachments must be the member's own uploads; announcements need the permission. */
  private async checkPayload(user: AuthUser, raw: SaveDraftInput['payload']) {
    const payload = DraftPayload.parse(raw);
    if (payload.kind === 'announcement' && !can(user, 'post.announce')) {
      throw Errors.forbidden('Only the platform team can publish announcements');
    }
    const ids = [...new Set(payload.attachmentIds)];
    if (ids.length) {
      const owned = await this.db
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, ids), eq(files.ownerId, user.id)));
      if (owned.length !== ids.length) throw Errors.validation({ attachmentIds: 'Attachment not found' });
    }
    return payload;
  }

  /** A scheduled post must be complete and due between 5 minutes and 60 days from now. */
  private checkSchedule(user: AuthUser, payload: DraftPayload, when: string, opts: { allowPast?: boolean } = {}): Date {
    const at = new Date(when);
    const now = Date.now();
    if (!opts.allowPast && at.getTime() < now + SCHEDULE_MIN_MINUTES * 60_000) {
      throw Errors.validation({ scheduledFor: `Pick a time at least ${SCHEDULE_MIN_MINUTES} minutes from now` });
    }
    if (at.getTime() > now + SCHEDULE_MAX_DAYS * 24 * 3600_000) {
      throw Errors.validation({ scheduledFor: `Posts can be scheduled up to ${SCHEDULE_MAX_DAYS} days ahead` });
    }
    const parsed = CreatePostInput.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation({ [String(issue?.path[0] ?? 'body')]: issue?.message ?? 'The post is incomplete' }, 'Finish the post before scheduling it');
    }
    if (!can(user, 'post.create')) throw Errors.forbidden();
    return at;
  }

  private async views(rows: DraftRow[]): Promise<DraftView[]> {
    const fileIds = [...new Set(rows.flatMap((r) => DraftPayload.safeParse(r.payload).data?.attachmentIds ?? []))];
    const fileRows = fileIds.length
      ? await this.db
          .select({ id: files.id, purpose: files.purpose, name: files.originalName, scanStatus: files.scanStatus })
          .from(files)
          .where(inArray(files.id, fileIds))
      : [];
    const fileById = new Map(fileRows.map((f) => [f.id, f]));
    return rows.map((r) => {
      const payload = DraftPayload.parse(r.payload);
      const preview =
        payload.article?.title ||
        payload.request?.title ||
        payload.celebration?.headline ||
        payload.body.trim().split('\n')[0]?.slice(0, 140) ||
        payload.poll?.question ||
        'Untitled draft';
      return {
        id: r.id,
        status: (r.status === 'publishing' ? 'scheduled' : r.status) as DraftStatus,
        payload,
        scheduledFor: r.scheduledFor?.toISOString() ?? null,
        lastError: r.lastError,
        preview,
        review: r.contentReview
          ? { state: r.contentReview as 'pending' | 'approved' | 'declined', note: r.contentReview === 'pending' ? null : r.contentReviewNote }
          : null,
        attachments: payload.attachmentIds
          .map((id) => fileById.get(id))
          .filter((f) => !!f)
          .map((f) => ({
            id: f.id,
            url: f.scanStatus === 'clean' ? mediaUrl(f.id) : null,
            kind: f.purpose === 'post_document' ? ('document' as const) : f.purpose === 'post_video' ? ('video' as const) : ('image' as const),
            name: f.name,
          })),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}
