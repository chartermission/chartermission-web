import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  DraftPayload,
  SCHEDULE_MAX_DAYS,
  type BulkResult,
  type ChapterRef,
  type ContentCalendarAction,
  type ContentCalendarActionResult,
  type ContentCalendarActionInput,
  type ContentCalendarBulkInput,
  type ContentCalendarCounts,
  type ContentCalendarCountsQuery,
  type ContentCalendarDetail,
  type ContentCalendarHistoryEntry,
  type ContentCalendarItem,
  type ContentCalendarKind,
  type ContentCalendarPage,
  type ContentCalendarQuery,
  type ContentCalendarState,
  type ContentReviewInfo,
  type MemberRef,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { auditLog, chapters, files, mcpActions, pollOptions, polls, postAttachments, postDrafts, posts } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { runEach } from '../common/bulk.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { PostsService } from '../posts/posts.service.js';
import { ModerationActionsService } from '../moderation/actions.service.js';

type DraftRow = typeof postDrafts.$inferSelect;
type PostRow = typeof posts.$inferSelect;
type Ref = { kind: ContentCalendarKind; id: string };

/** Most items one calendar request returns (a busy month view). */
const RANGE_LIMIT = 1000;

const FALLBACK_AUTHOR = (id: string): MemberRef => ({
  id,
  handle: 'deleted-member',
  name: 'Former member',
  headline: null,
  avatarUrl: null,
  tone: 'tint',
  verified: false,
  staff: false,
  official: false,
});

const clip = (text: string, max = 140) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Short text for lists: article, request or celebration title, else the start of the body. */
function excerptOf(type: string, body: string, details: Record<string, unknown> | null | undefined, pollQuestion?: string | null): string {
  const title = type === 'article' || type === 'request' ? str(details?.title) : type === 'celebration' ? str(details?.headline) : null;
  return clip(title ?? (body.trim() || pollQuestion || 'Untitled post'));
}

/** State as the calendar shows it (SQL, over the unioned item rows). */
const DRAFT_STATE = sql`case when d.status = 'held' then 'held' when d.status = 'failed' then 'failed' when d.content_review = 'pending' then 'awaiting_approval' when d.content_review = 'declined' then 'declined' else 'scheduled' end`;

/** Past tense for audit actions and events. */
const DONE: Record<ContentCalendarAction, string> = {
  hold: 'held',
  release: 'released',
  reschedule: 'rescheduled',
  cancel: 'cancelled',
  approve: 'approved',
  decline: 'declined',
  hide: 'hidden',
  restore: 'restored',
};

/**
 * Content calendar (admin console): posts members write and schedule with Claude, and optionally
 * every scheduled post on the platform. Lists them by date, and lets moderators hold, release,
 * reschedule, cancel, approve or decline scheduled posts and approve, decline, hide or restore
 * posts. Every action is audited and the author is told.
 */
@Injectable()
export class ContentCalendarService {
  private readonly logger = new Logger('ContentCalendar');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
    private readonly postsService: PostsService,
    private readonly moderation: ModerationActionsService,
  ) {}

  /* ------------------------------ Reading ------------------------------ */

  /** Every calendar item as one row set: scheduled, held, failed and declined drafts, and Claude posts. */
  private itemsSql(source: 'claude' | 'all'): SQL {
    const draftSource = source === 'claude' ? sql`and d.source = 'claude'` : sql``;
    return sql`(
      select 'draft'::text as kind, d.id, d.author_id, d.source, ${DRAFT_STATE} as state,
        case when d.payload->>'pageId' ~* '^[0-9a-f-]{36}$' then (d.payload->>'pageId')::uuid end as page_id,
        case when d.payload->>'chapterId' ~* '^[0-9a-f-]{36}$' then (d.payload->>'chapterId')::uuid end as chapter_id,
        coalesce(d.payload->>'body', '') as body,
        coalesce(d.scheduled_for, d.content_review_at, d.updated_at) as at
      from ${postDrafts} d
      where (d.status in ('scheduled', 'publishing', 'held', 'failed') or (d.status = 'draft' and d.content_review = 'declined')) ${draftSource}
      union all
      select 'post'::text, p.id, p.author_id, p.source, p.status, p.page_id, p.chapter_id, p.body, p.created_at
      from ${posts} p
      where p.deleted_at is null and p.source = 'claude' and p.status in ('published', 'awaiting_approval', 'declined')
    ) i`;
  }

  private filters(q: { q?: string; author?: string; chapter?: string; page?: string }): SQL[] {
    const conds: SQL[] = [];
    if (q.author) conds.push(sql`i.author_id = ${q.author}::uuid`);
    if (q.chapter) conds.push(sql`i.chapter_id = ${q.chapter}::uuid`);
    if (q.page) conds.push(sql`i.page_id = ${q.page}::uuid`);
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(
        sql`(i.body ilike ${like} or exists (select 1 from member_profiles mp where mp.user_id = i.author_id and (mp.display_name ilike ${like} or mp.handle ilike ${like})))`,
      );
    }
    return conds;
  }

  private where(conds: SQL[]): SQL {
    return conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  }

  /** GET /admin/content-calendar/items */
  async list(q: ContentCalendarQuery): Promise<ContentCalendarPage> {
    const conds = this.filters(q);
    if (q.state !== 'all') conds.push(sql`i.state = ${q.state}`);
    if (q.from && q.to) conds.push(sql`i.at >= ${q.from}::timestamptz and i.at < ${q.to}::timestamptz`);
    // Upcoming work reads soonest first; what already happened reads newest first.
    const ascending = !!q.from || ['scheduled', 'held', 'awaiting_approval', 'failed'].includes(q.state);
    const c = decodeCursor<{ t: string; k: string; id: string }>(q.cursor);
    checkCursor(c, { t: 'date', k: 'text', id: 'uuid' });
    if (c) {
      conds.push(
        ascending
          ? sql`(i.at, i.kind, i.id) > (${c.t}::timestamptz, ${c.k}, ${c.id}::uuid)`
          : sql`(i.at, i.kind, i.id) < (${c.t}::timestamptz, ${c.k}, ${c.id}::uuid)`,
      );
    }
    const limit = q.from ? RANGE_LIMIT : q.limit;
    const dir = ascending ? sql`asc` : sql`desc`;
    const { rows } = await this.db.execute<{ kind: ContentCalendarKind; id: string; t: string }>(sql`
      select i.kind, i.id, to_char(i.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t
      from ${this.itemsSql(q.source)}
      ${this.where(conds)}
      order by i.at ${dir}, i.kind ${dir}, i.id ${dir}
      limit ${limit + 1}`);
    const page = paginate(rows, limit, (last) => ({ t: last.t, k: last.kind, id: last.id }));
    return { items: await this.hydrate(page.items), nextCursor: q.from ? null : page.nextCursor };
  }

  /** GET /admin/content-calendar/counts — totals per state, and per day of a month in a time zone. */
  async counts(q: ContentCalendarCountsQuery): Promise<ContentCalendarCounts> {
    const tz = validZone(q.tz);
    const month = q.month ?? monthIn(tz);
    const conds = this.filters(q);
    const items = this.itemsSql(q.source);
    const [totals, days, setting] = await Promise.all([
      this.db.execute<{ state: ContentCalendarState; n: number }>(sql`
        select i.state, count(*)::int as n from ${items} ${this.where(conds)} group by i.state`),
      this.db.execute<{ day: string; state: ContentCalendarState; n: number }>(sql`
        select to_char(i.at at time zone ${tz}, 'YYYY-MM-DD') as day, i.state, count(*)::int as n
        from ${items}
        ${this.where([
          ...conds,
          sql`i.at >= (${`${month}-01`}::date::timestamp at time zone ${tz})`,
          sql`i.at < ((${`${month}-01`}::date + interval '1 month')::timestamp at time zone ${tz})`,
        ])}
        group by 1, 2 order by 1`),
      this.settings.get('claude_content'),
    ]);
    const states = { all: 0, scheduled: 0, held: 0, awaiting_approval: 0, published: 0, declined: 0, failed: 0 } as ContentCalendarCounts['states'];
    for (const r of totals.rows) {
      states[r.state] = r.n;
      states.all += r.n;
    }
    const byDay = new Map<string, ContentCalendarCounts['days'][number]>();
    for (const r of days.rows) {
      const day = byDay.get(r.day) ?? { date: r.day, total: 0, states: {} };
      day.states[r.state] = r.n;
      day.total += r.n;
      byDay.set(r.day, day);
    }
    return { states, month, tz, days: [...byDay.values()], approval: setting.approval };
  }

  /** How many items wait for approval (the console's sidebar badge). */
  async awaitingApproval(): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from ${this.itemsSql('all')} where i.state = 'awaiting_approval'`);
    return rows[0]?.n ?? 0;
  }

  /** GET /admin/content-calendar/{kind}/{id} */
  async detail(kind: ContentCalendarKind, id: string): Promise<ContentCalendarDetail> {
    const [item] = await this.hydrate([{ kind, id }]);
    if (!item) throw Errors.notFound(kind === 'draft' ? 'That scheduled post' : 'That post');
    const targets: Ref[] = [{ kind, id }];
    if (kind === 'post') {
      const draftId = (await this.draftIdsFor([id])).get(id);
      if (draftId) targets.push({ kind: 'draft', id: draftId });
    }
    const targetSql = sql.join(
      targets.map((t) => sql`(${t.kind}, ${t.id})`),
      sql`, `,
    );
    const [history, activity, full] = await Promise.all([
      this.db
        .select()
        .from(auditLog)
        .where(
          and(
            sql`(${auditLog.targetType}, ${auditLog.targetId}) in (${targetSql})`,
            sql`(${auditLog.action} like 'content_calendar.%' or ${auditLog.action} like 'moderation.%')`,
          ),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(50),
      this.db
        .select()
        .from(mcpActions)
        .where(sql`(${mcpActions.targetType}, ${mcpActions.targetId}) in (${targetSql})`)
        .orderBy(desc(mcpActions.createdAt))
        .limit(50),
      kind === 'draft' ? this.draftDetails(id) : this.postDetails(id),
    ]);
    const actors = await this.members.refs(history.map((h) => h.actorId).filter((x): x is string => !!x));
    const entries: ContentCalendarHistoryEntry[] = history.map((h) => {
      const after = (h.after ?? {}) as Record<string, unknown>;
      return {
        id: String(h.id),
        action: h.action,
        actor: (h.actorId && actors.get(h.actorId)) || null,
        at: h.createdAt.toISOString(),
        note: str(after.note) ?? str(after.reason),
        scheduledFor: h.action === 'content_calendar.rescheduled' ? str(after.scheduledFor) : null,
      };
    });
    return {
      ...item,
      ...full,
      claudeActivity: activity.map((a) => ({ id: a.id, action: a.action, clientName: a.clientName, at: a.createdAt.toISOString() })),
      history: entries,
      actions: this.actionsFor(item),
    };
  }

  /** The actions that make sense for an item now. */
  private actionsFor(item: ContentCalendarItem): ContentCalendarAction[] {
    if (item.kind === 'draft') {
      switch (item.state) {
        case 'scheduled':
          return ['hold', 'reschedule', 'cancel'];
        case 'held':
          return item.review?.state === 'pending' ? ['release', 'approve', 'decline', 'reschedule', 'cancel'] : ['release', 'reschedule', 'cancel'];
        case 'awaiting_approval':
          return ['approve', 'decline', 'hold', 'reschedule', 'cancel'];
        case 'failed':
          return ['reschedule', 'cancel'];
        default:
          return [];
      }
    }
    if (item.state === 'awaiting_approval') return ['approve', 'decline'];
    if (item.state === 'published') return item.moderationState === 'visible' ? ['hide'] : ['restore'];
    return [];
  }

  /** Items in the order given, built from their rows. */
  private async hydrate(refs: { kind: ContentCalendarKind; id: string }[]): Promise<ContentCalendarItem[]> {
    const draftIds = refs.filter((r) => r.kind === 'draft').map((r) => r.id);
    const postIds = refs.filter((r) => r.kind === 'post').map((r) => r.id);
    const [draftRows, postRows] = await Promise.all([
      draftIds.length ? this.db.select().from(postDrafts).where(inArray(postDrafts.id, draftIds)) : Promise.resolve([] as DraftRow[]),
      postIds.length ? this.db.select().from(posts).where(inArray(posts.id, postIds)) : Promise.resolve([] as PostRow[]),
    ]);
    // A plain draft (never scheduled, or cancelled back to the author's drafts) isn't on the calendar.
    const visibleDrafts = draftRows.filter((d) => d.status !== 'draft' || d.contentReview === 'declined');
    const payloads = new Map(visibleDrafts.map((d) => [d.id, DraftPayload.safeParse(d.payload).data]));
    const draftFileIds = [...new Set([...payloads.values()].flatMap((p) => p?.attachmentIds ?? []))];
    const livePosts = postRows.filter((p) => !p.deletedAt);
    const [draftFiles, postFiles, pollRows, draftLinks] = await Promise.all([
      draftFileIds.length
        ? this.db.select({ id: files.id, purpose: files.purpose, scanStatus: files.scanStatus }).from(files).where(inArray(files.id, draftFileIds))
        : Promise.resolve([]),
      livePosts.length
        ? this.db
            .select({ postId: postAttachments.postId, fileId: postAttachments.fileId, kind: postAttachments.kind, scanStatus: files.scanStatus })
            .from(postAttachments)
            .innerJoin(files, eq(files.id, postAttachments.fileId))
            .where(inArray(postAttachments.postId, livePosts.map((p) => p.id)))
            .orderBy(asc(postAttachments.position))
        : Promise.resolve([]),
      livePosts.length
        ? this.db.select({ postId: polls.postId, question: polls.question }).from(polls).where(inArray(polls.postId, livePosts.map((p) => p.id)))
        : Promise.resolve([]),
      this.draftIdsFor(livePosts.map((p) => p.id)),
    ]);
    const fileById = new Map(draftFiles.map((f) => [f.id, f]));
    const filesByPost = new Map<string, typeof postFiles>();
    for (const f of postFiles) filesByPost.set(f.postId, [...(filesByPost.get(f.postId) ?? []), f]);
    const pollByPost = new Map(pollRows.map((p) => [p.postId, p.question]));

    const authorIds = [...visibleDrafts.map((d) => d.authorId), ...livePosts.map((p) => p.authorId)];
    const reviewerIds = [...visibleDrafts, ...livePosts].map((r) => r.contentReviewBy).filter((x): x is string => !!x);
    const pageIds = [...visibleDrafts.map((d) => payloads.get(d.id)?.pageId), ...livePosts.map((p) => p.pageId)].filter((x): x is string => !!x);
    const chapterIds = [...visibleDrafts.map((d) => payloads.get(d.id)?.chapterId), ...livePosts.map((p) => p.chapterId)].filter((x): x is string => !!x);
    const [people, pageMap, chapterMap, clients] = await Promise.all([
      this.members.refs([...authorIds, ...reviewerIds]),
      this.pageRefs.refs(pageIds),
      this.chapterRefs(chapterIds),
      this.claudeClients([
        ...visibleDrafts.map((d) => ({ kind: 'draft' as const, id: d.id })),
        ...livePosts.map((p) => ({ kind: 'post' as const, id: p.id })),
        ...[...draftLinks.values()].map((id) => ({ kind: 'draft' as const, id })),
      ]),
    ]);
    const review = (r: DraftRow | PostRow): ContentReviewInfo | null =>
      r.contentReview
        ? {
            state: r.contentReview as ContentReviewInfo['state'],
            by: (r.contentReviewBy && people.get(r.contentReviewBy)) || null,
            at: r.contentReviewAt?.toISOString() ?? null,
            note: r.contentReviewNote,
          }
        : null;

    const out = new Map<string, ContentCalendarItem>();
    for (const d of visibleDrafts) {
      const p = payloads.get(d.id);
      const ids = p?.attachmentIds ?? [];
      const firstImage = ids.map((id) => fileById.get(id)).find((f) => f?.purpose === 'post_image' && f.scanStatus === 'clean');
      const state = draftState(d);
      const at = d.scheduledFor ?? d.contentReviewAt ?? d.updatedAt;
      out.set(`draft:${d.id}`, {
        kind: 'draft',
        id: d.id,
        key: `draft:${d.id}`,
        author: people.get(d.authorId) ?? FALLBACK_AUTHOR(d.authorId),
        page: p?.pageId && pageMap.get(p.pageId) ? PageRefsService.toRef(pageMap.get(p.pageId)!) : null,
        chapter: (p?.chapterId && chapterMap.get(p.chapterId)) || null,
        excerpt: p ? excerptOf(p.type, p.body, (p.article ?? p.request ?? p.celebration) as Record<string, unknown> | undefined, p.poll?.question) : 'Untitled post',
        type: p?.type ?? 'standard',
        media: { count: ids.length, thumbnailUrl: firstImage ? mediaUrl(firstImage.id) : null },
        visibility: p?.visibility ?? 'public',
        state,
        moderationState: null,
        source: d.source as 'web' | 'claude',
        claudeClient: clients.get(`draft:${d.id}`) ?? null,
        scheduledFor: d.scheduledFor?.toISOString() ?? null,
        publishedAt: null,
        createdAt: d.createdAt.toISOString(),
        at: at.toISOString(),
        review: review(d),
        lastError: d.status === 'failed' ? d.lastError : null,
        postUrl: null,
      });
    }
    for (const p of livePosts) {
      const attached = filesByPost.get(p.id) ?? [];
      const firstImage = attached.find((f) => f.kind === 'image' && f.scanStatus === 'clean');
      const state: ContentCalendarState = p.status === 'awaiting_approval' ? 'awaiting_approval' : p.status === 'declined' ? 'declined' : 'published';
      const fromDraft = draftLinks.get(p.id);
      out.set(`post:${p.id}`, {
        kind: 'post',
        id: p.id,
        key: `post:${p.id}`,
        author: people.get(p.authorId) ?? FALLBACK_AUTHOR(p.authorId),
        page: p.pageId && pageMap.get(p.pageId) ? PageRefsService.toRef(pageMap.get(p.pageId)!) : null,
        chapter: (p.chapterId && chapterMap.get(p.chapterId)) || null,
        excerpt: excerptOf(p.type, p.body, p.details, pollByPost.get(p.id)),
        type: p.type as ContentCalendarItem['type'],
        media: { count: attached.length, thumbnailUrl: firstImage ? mediaUrl(firstImage.fileId) : null },
        visibility: p.visibility as 'members' | 'public',
        state,
        moderationState: p.moderationState as ContentCalendarItem['moderationState'],
        source: p.source as 'web' | 'claude',
        claudeClient: clients.get(`post:${p.id}`) ?? (fromDraft ? clients.get(`draft:${fromDraft}`) : undefined) ?? null,
        scheduledFor: null,
        publishedAt: p.status === 'published' ? p.createdAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        at: p.createdAt.toISOString(),
        review: review(p),
        lastError: null,
        postUrl: p.status === 'published' ? webUrl(`/posts/${p.id}`) : null,
      });
    }
    return refs.map((r) => out.get(`${r.kind}:${r.id}`)).filter((x): x is ContentCalendarItem => !!x);
  }

  private async chapterRefs(ids: string[]): Promise<Map<string, ChapterRef>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(chapters)
      .where(inArray(chapters.id, unique));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The Claude client that last acted on each item ("draft:{id}" / "post:{id}"). */
  private async claudeClients(refs: Ref[]): Promise<Map<string, string>> {
    if (!refs.length) return new Map();
    const rows = await this.db
      .select({ targetType: mcpActions.targetType, targetId: mcpActions.targetId, clientName: mcpActions.clientName })
      .from(mcpActions)
      .where(sql`(${mcpActions.targetType}, ${mcpActions.targetId}) in (${sql.join(refs.map((r) => sql`(${r.kind}, ${r.id})`), sql`, `)})`)
      .orderBy(asc(mcpActions.createdAt));
    // Oldest first, so the newest client wins.
    return new Map(rows.map((r) => [`${r.targetType}:${r.targetId}`, r.clientName]));
  }

  /** For posts published from a scheduled post: the draft they came from (from the audit log). */
  private async draftIdsFor(postIds: string[]): Promise<Map<string, string>> {
    if (!postIds.length) return new Map();
    const rows = await this.db
      .select({ targetId: auditLog.targetId, before: auditLog.before })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'content_calendar.published'), eq(auditLog.targetType, 'post'), inArray(auditLog.targetId, postIds)));
    const map = new Map<string, string>();
    for (const r of rows) {
      const draftId = str((r.before as Record<string, unknown> | null)?.draftId);
      if (r.targetId && draftId) map.set(r.targetId, draftId);
    }
    return map;
  }

  private async draftDetails(id: string) {
    const [row] = await this.db.select().from(postDrafts).where(eq(postDrafts.id, id)).limit(1);
    const p = DraftPayload.safeParse(row?.payload).data;
    const ids = p?.attachmentIds ?? [];
    const fileRows = ids.length
      ? await this.db
          .select({ id: files.id, purpose: files.purpose, name: files.originalName, scanStatus: files.scanStatus })
          .from(files)
          .where(inArray(files.id, ids))
      : [];
    const byId = new Map(fileRows.map((f) => [f.id, f]));
    return {
      body: p?.body ?? '',
      attachments: ids
        .map((fid) => byId.get(fid))
        .filter((f) => !!f)
        .map((f) => ({
          id: f.id,
          kind: f.purpose === 'post_document' ? ('document' as const) : f.purpose === 'post_video' ? ('video' as const) : ('image' as const),
          url: f.scanStatus === 'clean' ? mediaUrl(f.id) : null,
          name: f.name,
          alt: p?.altTexts?.[f.id] ?? null,
        })),
      poll: p?.poll
        ? { question: p.poll.question, options: p.poll.options.map((label) => ({ label, votes: null })), durationHours: p.poll.durationHours, closesAt: null, totalVotes: null }
        : null,
      article: p?.type === 'article' ? { title: p.article?.title ?? null, subtitle: p.article?.subtitle ?? null } : null,
      celebration:
        p?.type === 'celebration'
          ? { category: p.celebration?.category ?? null, headline: p.celebration?.headline ?? null, organisation: p.celebration?.organisation ?? null }
          : null,
      request:
        p?.type === 'request'
          ? {
              title: p.request?.title ?? null,
              category: p.request?.category ?? null,
              location: p.request?.location ?? null,
              remote: p.request?.remote ?? null,
              skills: p.request?.skills ?? [],
            }
          : null,
      linkPreview: null,
      linkUrl: p?.linkUrl ?? null,
    };
  }

  private async postDetails(id: string) {
    const [row] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    const [attached, [poll]] = await Promise.all([
      this.db
        .select({ id: files.id, kind: postAttachments.kind, alt: postAttachments.alt, name: files.originalName, scanStatus: files.scanStatus })
        .from(postAttachments)
        .innerJoin(files, eq(files.id, postAttachments.fileId))
        .where(eq(postAttachments.postId, id))
        .orderBy(asc(postAttachments.position)),
      this.db.select().from(polls).where(eq(polls.postId, id)).limit(1),
    ]);
    const options = poll
      ? await this.db.select().from(pollOptions).where(eq(pollOptions.pollId, poll.id)).orderBy(asc(pollOptions.position))
      : [];
    const d = (row?.details ?? {}) as Record<string, unknown>;
    return {
      body: row?.body ?? '',
      attachments: attached.map((a) => ({
        id: a.id,
        kind: a.kind as 'image' | 'document' | 'video',
        url: a.scanStatus === 'clean' ? mediaUrl(a.id) : null,
        name: a.name,
        alt: a.alt,
      })),
      poll: poll
        ? {
            question: poll.question,
            options: options.map((o) => ({ label: o.label, votes: o.voteCount })),
            durationHours: null,
            closesAt: poll.closesAt.toISOString(),
            totalVotes: poll.totalVotes,
          }
        : null,
      article: row?.type === 'article' ? { title: str(d.title), subtitle: str(d.subtitle) } : null,
      celebration: row?.type === 'celebration' ? { category: str(d.category), headline: str(d.headline), organisation: str(d.organisation) } : null,
      request:
        row?.type === 'request'
          ? {
              title: str(d.title),
              category: str(d.category),
              location: str(d.location),
              remote: typeof d.remote === 'boolean' ? d.remote : null,
              skills: Array.isArray(d.skills) ? d.skills.filter((x): x is string => typeof x === 'string') : [],
            }
          : null,
      linkPreview: row?.linkPreview ?? null,
      linkUrl: row?.linkUrl ?? null,
    };
  }

  /* ------------------------------ Actions ------------------------------ */

  /** POST /admin/content-calendar/{kind}/{id}/actions */
  async act(ctx: AuthContext, kind: ContentCalendarKind, id: string, input: ContentCalendarActionInput, ip?: string): Promise<ContentCalendarActionResult> {
    await this.apply(ctx, kind, id, input, ip);
    // A cancelled post went back to the author's drafts, so it is no longer on the calendar.
    if (kind === 'draft' && input.action === 'cancel') return { item: null };
    return { item: await this.detail(kind, id) };
  }

  /** POST /admin/content-calendar/bulk — one item at a time; ids are `${kind}:${id}`. */
  async bulk(ctx: AuthContext, input: ContentCalendarBulkInput, ip?: string): Promise<BulkResult> {
    const action = this.bulkAction(input);
    return runEach(
      input.items.map((i) => `${i.kind}:${i.id}`),
      (key) => {
        const [kind, id] = key.split(':') as [ContentCalendarKind, string];
        return this.apply(ctx, kind, id, action, ip);
      },
      this.logger,
    );
  }

  private bulkAction(input: ContentCalendarBulkInput): ContentCalendarActionInput {
    switch (input.action) {
      case 'decline':
      case 'cancel':
        return { action: input.action, note: input.note ?? '' };
      case 'reschedule':
        return { action: 'reschedule', scheduledFor: input.scheduledFor!, note: input.note };
      default:
        return { action: input.action, note: input.note };
    }
  }

  private async apply(ctx: AuthContext, kind: ContentCalendarKind, id: string, input: ContentCalendarActionInput, ip?: string): Promise<void> {
    if (kind === 'draft') return this.applyToDraft(ctx, id, input, ip);
    return this.applyToPost(ctx, id, input, ip);
  }

  private async applyToDraft(ctx: AuthContext, id: string, input: ContentCalendarActionInput, ip?: string): Promise<void> {
    const [row] = await this.db.select().from(postDrafts).where(eq(postDrafts.id, id)).limit(1);
    if (!row || row.status === 'draft' && row.contentReview !== 'declined') throw Errors.notFound('That scheduled post');
    if (row.status === 'publishing') throw Errors.conflict('This post is being published right now');
    const now = new Date();
    const note = 'note' in input ? input.note?.trim() || null : null;
    let change: Partial<DraftRow>;
    let from: string[];
    switch (input.action) {
      case 'hold':
        if (row.status === 'held') throw Errors.conflict('This post is already paused');
        if (row.status !== 'scheduled') throw Errors.conflict('Only scheduled posts can be paused');
        change = { status: 'held' };
        from = ['scheduled'];
        break;
      case 'release':
        if (row.status !== 'held') throw Errors.conflict('This post isn’t paused');
        change = { status: 'scheduled' };
        from = ['held'];
        break;
      case 'reschedule': {
        if (!['scheduled', 'held', 'failed'].includes(row.status)) throw Errors.conflict('Only scheduled posts can be rescheduled');
        const at = new Date(input.scheduledFor);
        if (at.getTime() <= now.getTime() + 60_000) throw Errors.validation({ scheduledFor: 'Pick a time in the future' });
        if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 24 * 3600_000) {
          throw Errors.validation({ scheduledFor: `Posts can be scheduled up to ${SCHEDULE_MAX_DAYS} days ahead` });
        }
        change = { scheduledFor: at, ...(row.status === 'failed' ? { status: 'scheduled', lastError: null } : {}) };
        from = [row.status];
        break;
      }
      case 'cancel':
        if (!['scheduled', 'held', 'failed'].includes(row.status)) throw Errors.conflict('Only scheduled posts can be cancelled');
        // Back to the author's drafts with no approval kept: publishing it later is reviewed again.
        change = {
          status: 'draft',
          scheduledFor: null,
          lastError: null,
          ...(row.contentReview === 'pending' || row.contentReview === 'approved' ? { contentReview: null, contentReviewBy: null, contentReviewAt: null } : {}),
        };
        from = [row.status];
        break;
      case 'approve':
        if (row.contentReview !== 'pending' || !['scheduled', 'held'].includes(row.status)) throw Errors.conflict('This post isn’t waiting for approval');
        change = { contentReview: 'approved', contentReviewBy: ctx.user.id, contentReviewAt: now, contentReviewNote: note };
        from = [row.status];
        break;
      case 'decline':
        if (row.contentReview !== 'pending' || !['scheduled', 'held'].includes(row.status)) throw Errors.conflict('This post isn’t waiting for approval');
        change = { status: 'draft', scheduledFor: null, contentReview: 'declined', contentReviewBy: ctx.user.id, contentReviewAt: now, contentReviewNote: note };
        from = [row.status];
        break;
      default:
        throw Errors.conflict('Scheduled posts aren’t live yet, so they can’t be hidden or restored');
    }
    const [updated] = await this.db
      .update(postDrafts)
      .set(change)
      .where(and(eq(postDrafts.id, id), inArray(postDrafts.status, from)))
      .returning();
    if (!updated) throw Errors.conflict('Someone else has just changed this post. Refresh to see where it stands.');
    await this.audit.record({
      actorId: ctx.user.id,
      action: `content_calendar.${DONE[input.action]}`,
      targetType: 'draft',
      targetId: id,
      before: snapshotDraft(row),
      after: { ...snapshotDraft(updated), note },
      ip,
    });
    const payload = DraftPayload.safeParse(row.payload).data;
    await this.events.emit({
      type: 'content.reviewed',
      kind: 'draft',
      id,
      authorId: row.authorId,
      action: input.action,
      actorId: ctx.user.id,
      note,
      scheduledFor: updated.scheduledFor?.toISOString() ?? null,
      preview: payload ? excerptOf(payload.type, payload.body, (payload.article ?? payload.request ?? payload.celebration) as Record<string, unknown> | undefined, payload.poll?.question) : 'your post',
      postStatus: null,
    });
  }

  private async applyToPost(ctx: AuthContext, id: string, input: ContentCalendarActionInput, ip?: string): Promise<void> {
    const [row] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!row || row.deletedAt) throw Errors.notFound('That post');
    if (input.action === 'hide' || input.action === 'restore') {
      // The moderation code hides and restores it: it shows in Hidden content, the author is told and can appeal.
      if (input.action === 'hide' && row.status !== 'published') throw Errors.conflict('Only published posts can be hidden');
      await this.moderation.act(ctx, { type: 'post', id }, { action: input.action, reason: input.reason }, { ip });
      return;
    }
    const note = 'note' in input ? input.note?.trim() || null : null;
    let status: string;
    if (input.action === 'approve') {
      if (row.status !== 'awaiting_approval') throw Errors.conflict('This post isn’t waiting for approval');
      const next = await this.postsService.approveContent(id, ctx.user.id, note);
      if (!next) throw Errors.conflict('Someone else has just changed this post. Refresh to see where it stands.');
      status = next;
    } else if (input.action === 'decline') {
      if (row.status !== 'awaiting_approval') throw Errors.conflict('This post isn’t waiting for approval');
      if (!(await this.postsService.declineContent(id, ctx.user.id, note ?? ''))) {
        throw Errors.conflict('Someone else has just changed this post. Refresh to see where it stands.');
      }
      status = 'declined';
    } else {
      throw Errors.conflict('This post is already published. Hide it instead.');
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: `content_calendar.${DONE[input.action]}`,
      targetType: 'post',
      targetId: id,
      before: { status: row.status, contentReview: row.contentReview },
      after: { status, contentReview: input.action === 'approve' ? 'approved' : 'declined', note },
      ip,
    });
    await this.events.emit({
      type: 'content.reviewed',
      kind: 'post',
      id,
      authorId: row.authorId,
      action: input.action,
      actorId: ctx.user.id,
      note,
      scheduledFor: null,
      preview: excerptOf(row.type, row.body, row.details),
      postStatus: status,
    });
  }
}

function draftState(d: DraftRow): ContentCalendarState {
  if (d.status === 'held') return 'held';
  if (d.status === 'failed') return 'failed';
  if (d.contentReview === 'pending') return 'awaiting_approval';
  if (d.contentReview === 'declined') return 'declined';
  return 'scheduled';
}

function snapshotDraft(d: DraftRow) {
  return { status: d.status, scheduledFor: d.scheduledFor?.toISOString() ?? null, contentReview: d.contentReview };
}

/** An IANA time zone the database also knows, or 422. */
function validZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw Errors.validation({ tz: 'Choose a valid time zone' });
  }
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) throw Errors.validation({ tz: 'Choose a valid time zone' });
  return tz;
}

/** This month (YYYY-MM) in a time zone. */
function monthIn(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
