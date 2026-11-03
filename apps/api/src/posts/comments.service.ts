import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { CommentView, CommentsQuery, CreateCommentInput, CursorQuery, Page, ReactionKind, UpdateCommentInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { comments, posts, reactions } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthUser } from '../core/auth-context.js';
import { can } from '../core/policy.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { EventsService } from '../infra/events.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { AuditService } from '../infra/audit.service.js';
import { assertNotRestricted, PostsService } from './posts.service.js';
import { replaceMentions, resolveMentions } from './mentions.js';
import { isModerator, notBlockedSql, type PostRow } from './visibility.js';

/** Spec 8.2 (proposed): comments per member per day. */
export const COMMENTS_PER_DAY = 100;
/** Replies shown under each top-level comment; more via GET /comments/{id}/replies. */
const INLINE_REPLIES = 3;

type CommentRow = typeof comments.$inferSelect;
type Breakdown = Record<ReactionKind, number>;

/**
 * Per-kind reaction counts for comments. Only the total is cached on the comment row,
 * so the split is read from the reactions table (primary key leads with target type and id).
 */
export async function commentReactionBreakdowns(db: Db, ids: string[]): Promise<Map<string, Breakdown>> {
  const out = new Map<string, Breakdown>();
  if (!ids.length) return out;
  const rows = await db
    .select({ targetId: reactions.targetId, kind: reactions.kind, n: sql<number>`count(*)::int` })
    .from(reactions)
    .where(and(eq(reactions.targetType, 'comment'), inArray(reactions.targetId, ids)))
    .groupBy(reactions.targetId, reactions.kind);
  for (const r of rows) {
    const b = out.get(r.targetId) ?? { like: 0, insightful: 0, support: 0 };
    if (r.kind === 'like' || r.kind === 'insightful' || r.kind === 'support') b[r.kind] = r.n;
    out.set(r.targetId, b);
  }
  return out;
}

function commentTs(col: typeof comments.createdAt): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Comments with one level of replies (CM-FED-03). Hidden, removed and deleted
 * comments stay as placeholders so threads keep their shape; comments from
 * members blocked either way are left out entirely.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly postsService: PostsService,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly events: EventsService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  async list(viewer: AuthUser, postId: string, q: CommentsQuery): Promise<Page<CommentView>> {
    const post = await this.postsService.findVisible(viewer, postId);
    const ts = commentTs(comments.createdAt);
    const conds: SQL[] = [eq(comments.postId, postId), isNull(comments.parentId), notBlockedSql(viewer.id, sql`${comments.authorId}`)];
    let order: SQL[];
    if (q.sort === 'newest') {
      const c = decodeCursor<{ t: string; id: string }>(q.cursor);
      if (c) conds.push(sql`(${comments.createdAt}, ${comments.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
      order = [desc(comments.createdAt), desc(comments.id)];
    } else {
      // "Relevant": most reactions first, then most recent.
      const c = decodeCursor<{ r: number; t: string; id: string }>(q.cursor);
      if (c) {
        conds.push(
          sql`(${comments.reactionCount}, ${comments.createdAt}, ${comments.id}) < (${c.r}::int, ${c.t}::timestamptz, ${c.id}::uuid)`,
        );
      }
      order = [desc(comments.reactionCount), desc(comments.createdAt), desc(comments.id)];
    }
    const rows = await this.db
      .select({ row: comments, ts })
      .from(comments)
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last): Record<string, string | number> =>
      q.sort === 'newest' ? { t: last.ts, id: last.row.id } : { r: last.row.reactionCount, t: last.ts, id: last.row.id },
    );
    const tops = page.items.map((i) => i.row);

    // Up to 3 newest replies per top-level comment, shown oldest first.
    let replies: CommentRow[] = [];
    if (tops.length) {
      const ranked = this.db
        .select({
          id: comments.id,
          rn: sql<number>`row_number() over (partition by ${comments.parentId} order by ${comments.createdAt} desc, ${comments.id} desc)`.as('rn'),
        })
        .from(comments)
        .where(and(inArray(comments.parentId, tops.map((t) => t.id)), notBlockedSql(viewer.id, sql`${comments.authorId}`)))
        .as('ranked');
      const ids = (await this.db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rn, INLINE_REPLIES))).map((r) => r.id);
      if (ids.length) {
        replies = await this.db.select().from(comments).where(inArray(comments.id, ids)).orderBy(asc(comments.createdAt), asc(comments.id));
      }
    }
    const views = await this.serialize([...tops, ...replies], viewer, post);
    const byId = new Map(views.map((v) => [v.id, v]));
    const items = tops.map((t) => {
      const view = byId.get(t.id)!;
      view.replies = replies.filter((r) => r.parentId === t.id).map((r) => byId.get(r.id)!);
      return view;
    });
    return { items, nextCursor: page.nextCursor };
  }

  /** GET /comments/{id}/replies — oldest first. */
  async replies(viewer: AuthUser, commentId: string, q: CursorQuery): Promise<Page<CommentView>> {
    const parent = await this.find(commentId);
    if (!parent || parent.parentId) throw Errors.notFound('Comment');
    if (await this.relations.isBlockedEitherWay(viewer.id, parent.authorId)) throw Errors.notFound('Comment');
    const post = await this.postsService.findVisible(viewer, parent.postId);
    const ts = commentTs(comments.createdAt);
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const rows = await this.db
      .select({ row: comments, ts })
      .from(comments)
      .where(
        and(
          eq(comments.parentId, commentId),
          notBlockedSql(viewer.id, sql`${comments.authorId}`),
          c ? sql`(${comments.createdAt}, ${comments.id}) > (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.row.id }));
    return { items: await this.serialize(page.items.map((i) => i.row), viewer, post), nextCursor: page.nextCursor };
  }

  async create(user: AuthUser, postId: string, input: CreateCommentInput): Promise<CommentView> {
    assertNotRestricted(user);
    if (!can(user, 'comment.create')) throw Errors.forbidden();
    await this.limits.consume(`comments:${user.id}`, COMMENTS_PER_DAY, 24 * 3600);
    const post = await this.postsService.findVisible(user, postId, { interactive: true });

    let repliedTo: CommentRow | null = null;
    let top: CommentRow | null = null;
    if (input.parentId) {
      repliedTo = (await this.find(input.parentId)) ?? null;
      if (!repliedTo || repliedTo.postId !== postId || repliedTo.deletedAt || repliedTo.moderationState !== 'visible') {
        throw Errors.notFound('Comment');
      }
      if (await this.relations.isBlockedEitherWay(user.id, repliedTo.authorId)) throw Errors.notFound('Comment');
      // One level of replies: replying to a reply attaches to its top-level comment.
      top = repliedTo.parentId ? ((await this.find(repliedTo.parentId)) ?? null) : repliedTo;
      if (!top) throw Errors.notFound('Comment');
    }
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);

    const comment = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(comments)
        .values({ postId, parentId: top?.id ?? null, authorId: user.id, body: input.body })
        .returning();
      await tx.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
      if (top) await tx.update(comments).set({ replyCount: sql`${comments.replyCount} + 1` }).where(eq(comments.id, top.id));
      await replaceMentions(tx, 'comment', c!.id, mentionIds);
      return c!;
    });

    await this.events.emit({
      type: 'comment.created',
      commentId: comment.id,
      postId,
      authorId: user.id,
      // The comment the member replied to (its author gets reply_to_comment).
      parentId: repliedTo?.id ?? null,
    });
    if (mentionIds.length) {
      await this.events.emit({ type: 'mention.created', sourceType: 'comment', sourceId: comment.id, postId, authorId: user.id, userIds: mentionIds });
    }
    this.analytics.track('comment_created', user.id, user.countryCode);
    const [view] = await this.serialize([comment], user, post);
    return view!;
  }

  async update(user: AuthUser, id: string, input: UpdateCommentInput): Promise<CommentView> {
    const comment = await this.find(id);
    if (!comment || comment.deletedAt) throw Errors.notFound('Comment');
    if (!can(user, 'comment.edit', { authorId: comment.authorId })) throw Errors.forbidden('Only the author can edit this comment');
    if (comment.moderationState !== 'visible') throw Errors.conflict('This comment can’t be edited');
    assertNotRestricted(user);
    const post = await this.postsService.findVisible(user, comment.postId);
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);
    const { updated, added } = await this.db.transaction(async (tx) => {
      const [u] = await tx.update(comments).set({ body: input.body, editedAt: new Date() }).where(eq(comments.id, id)).returning();
      return { updated: u!, added: await replaceMentions(tx, 'comment', id, mentionIds) };
    });
    if (added.length) {
      await this.events.emit({ type: 'mention.created', sourceType: 'comment', sourceId: id, postId: comment.postId, authorId: user.id, userIds: added });
    }
    const [view] = await this.serialize([updated], user, post);
    return view!;
  }

  /** DELETE /comments/{id}: author or moderator; leaves a "deleted" placeholder. */
  async remove(user: AuthUser, id: string, ip?: string): Promise<void> {
    const comment = await this.find(id);
    if (!comment || comment.deletedAt) throw Errors.notFound('Comment');
    if (!can(user, 'comment.delete', { authorId: comment.authorId })) throw Errors.forbidden('Only the author can delete this comment');
    await this.db.transaction(async (tx) => {
      await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, id));
      await tx
        .update(posts)
        .set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` })
        .where(eq(posts.id, comment.postId));
      if (comment.parentId) {
        await tx
          .update(comments)
          .set({ replyCount: sql`greatest(${comments.replyCount} - 1, 0)` })
          .where(eq(comments.id, comment.parentId));
      }
    });
    if (comment.authorId !== user.id) {
      await this.audit.record({
        actorId: user.id,
        action: 'comment.delete',
        targetType: 'comment',
        targetId: id,
        before: { authorId: comment.authorId, postId: comment.postId },
        ip,
      });
    }
  }

  async find(id: string): Promise<CommentRow | undefined> {
    const [row] = await this.db.select().from(comments).where(eq(comments.id, id)).limit(1);
    return row;
  }

  /** Placeholders show no body or author unless the viewer wrote it or moderates. */
  private async serialize(rows: CommentRow[], viewer: AuthUser, post: PostRow): Promise<CommentView[]> {
    if (!rows.length) return [];
    const mod = isModerator(viewer);
    const reveal = (r: CommentRow) => (!r.deletedAt && r.moderationState === 'visible') || r.authorId === viewer.id || mod;
    const ids = rows.map((r) => r.id);
    const [refs, mine, kinds] = await Promise.all([
      this.members.refs(rows.filter(reveal).map((r) => r.authorId)),
      this.db
        .select({ targetId: reactions.targetId, kind: reactions.kind })
        .from(reactions)
        .where(
          and(
            eq(reactions.userId, viewer.id),
            eq(reactions.targetType, 'comment'),
            inArray(reactions.targetId, ids),
          ),
        ),
      commentReactionBreakdowns(this.db, ids),
    ]);
    const myReaction = new Map(mine.map((m) => [m.targetId, m.kind as ReactionKind]));
    return rows.map((r) => {
      const state: CommentView['state'] = r.deletedAt ? 'deleted' : (r.moderationState as CommentView['state']);
      const show = reveal(r);
      return {
        id: r.id,
        postId: r.postId,
        parentId: r.parentId,
        author: show ? (refs.get(r.authorId) ?? null) : null,
        body: show ? r.body : '',
        state,
        createdAt: r.createdAt.toISOString(),
        editedAt: show ? (r.editedAt?.toISOString() ?? null) : null,
        isPostAuthor: show && r.authorId === post.authorId,
        counts: { reactions: r.reactionCount, replies: r.replyCount },
        reactionBreakdown: kinds.get(r.id) ?? { like: 0, insightful: 0, support: 0 },
        viewer: {
          reaction: myReaction.get(r.id) ?? null,
          canEdit: state === 'visible' && can(viewer, 'comment.edit', { authorId: r.authorId }),
          canDelete: state !== 'deleted' && can(viewer, 'comment.delete', { authorId: r.authorId }),
          canReport: state === 'visible' && r.authorId !== viewer.id && can(viewer, 'report.create'),
        },
        replies: [],
      };
    });
  }
}
