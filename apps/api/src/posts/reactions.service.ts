import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BookmarkInput, CursorQuery, Page, PostView, ReactionInput, ReactionKind, ReactionState } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { bookmarks, comments, courses, events, opportunities, posts, reactions } from '../db/schema.js';
import { visibleCourseSql } from '../learning/course-views.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthUser } from '../core/auth-context.js';
import { can } from '../core/policy.js';
import { RelationsService } from '../core/relations.service.js';
import { EventsService } from '../infra/events.service.js';
import { assertNotRestricted, PostsService } from './posts.service.js';
import { commentReactionBreakdowns } from './comments.service.js';
import { PostSerializer } from './post-serializer.js';
import { listablePostsSql } from './visibility.js';

const KIND_COLUMN = {
  like: posts.likeCount,
  insightful: posts.insightfulCount,
  support: posts.supportCount,
} as const;

/**
 * Reactions (fixed set: like, insightful, support; counts cached on the target,
 * spec 4.5 rule) and bookmarks (CM-FED-03).
 */
@Injectable()
export class ReactionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly postsService: PostsService,
    private readonly serializer: PostSerializer,
    private readonly relations: RelationsService,
    private readonly events: EventsService,
  ) {}

  /** PUT /reactions: set or change the viewer's reaction. Counts change in the same transaction. */
  async set(user: AuthUser, input: ReactionInput): Promise<ReactionState> {
    assertNotRestricted(user);
    if (!can(user, 'reaction.create')) throw Errors.forbidden();
    await this.assertReactable(user, input.targetType, input.targetId);
    const kind = input.kind;
    const created = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(reactions)
        .values({ targetType: input.targetType, targetId: input.targetId, userId: user.id, kind })
        .onConflictDoNothing()
        .returning({ kind: reactions.kind });
      if (inserted) {
        await this.adjust(tx, input.targetType, input.targetId, kind, +1);
        return true;
      }
      const [existing] = await tx
        .select({ kind: reactions.kind })
        .from(reactions)
        .where(this.key(input.targetType, input.targetId, user.id))
        .for('update');
      if (existing && existing.kind !== kind) {
        await tx.update(reactions).set({ kind }).where(this.key(input.targetType, input.targetId, user.id));
        await this.adjust(tx, input.targetType, input.targetId, existing.kind as ReactionKind, -1, false);
        await this.adjust(tx, input.targetType, input.targetId, kind, +1, false);
      }
      return false;
    });
    // Notify on new reactions only, not on a change of kind.
    if (created) {
      await this.events.emit({ type: 'reaction.created', targetType: input.targetType, targetId: input.targetId, userId: user.id, kind });
    }
    return this.state(user.id, input.targetType, input.targetId);
  }

  /** DELETE /reactions: remove the viewer's reaction (kind ignored). */
  async remove(user: AuthUser, input: ReactionInput): Promise<ReactionState> {
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(reactions)
        .where(this.key(input.targetType, input.targetId, user.id))
        .returning({ kind: reactions.kind });
      if (deleted) await this.adjust(tx, input.targetType, input.targetId, deleted.kind as ReactionKind, -1);
    });
    return this.state(user.id, input.targetType, input.targetId);
  }

  /** PUT /bookmarks — posts, events, courses and opportunities; the target must be visible to the viewer. */
  async bookmark(user: AuthUser, input: BookmarkInput): Promise<void> {
    await this.assertBookmarkable(user, input);
    await this.db.insert(bookmarks).values({ userId: user.id, targetType: input.targetType, targetId: input.targetId }).onConflictDoNothing();
  }

  async unbookmark(user: AuthUser, input: BookmarkInput): Promise<void> {
    await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.targetType, input.targetType), eq(bookmarks.targetId, input.targetId)));
  }

  /** GET /me/bookmarks — newest bookmark first; posts the viewer can no longer see drop out. */
  async listBookmarks(user: AuthUser, q: CursorQuery): Promise<Page<PostView>> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = sql<string>`to_char(${bookmarks.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({ id: posts.id, ts })
      .from(bookmarks)
      .innerJoin(posts, eq(posts.id, bookmarks.targetId))
      .where(
        and(
          eq(bookmarks.userId, user.id),
          eq(bookmarks.targetType, 'post'),
          listablePostsSql(user.id),
          c ? sql`(${bookmarks.createdAt}, ${bookmarks.targetId}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.targetId))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.id }));
    return { items: await this.serializer.posts(page.items.map((r) => r.id), user), nextCursor: page.nextCursor };
  }

  private async assertBookmarkable(user: AuthUser, input: BookmarkInput) {
    switch (input.targetType) {
      case 'post':
        await this.postsService.findVisible(user, input.targetId);
        return;
      case 'event': {
        // Published (or archived past) events are public to members; drafts, reviews and unpublished are not.
        const [row] = await this.db
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.id, input.targetId), inArray(events.status, ['published', 'archived'])))
          .limit(1);
        if (!row) throw Errors.notFound('Event');
        return;
      }
      case 'course': {
        const [row] = await this.db
          .select({ id: courses.id })
          .from(courses)
          .where(and(eq(courses.id, input.targetId), visibleCourseSql))
          .limit(1);
        if (!row) throw Errors.notFound('Course');
        return;
      }
      case 'opportunity': {
        const [row] = await this.db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(and(eq(opportunities.id, input.targetId), eq(opportunities.moderationState, 'visible'), isNull(opportunities.deletedAt)))
          .limit(1);
        if (!row) throw Errors.notFound('Opportunity');
        return;
      }
    }
  }

  private key(targetType: string, targetId: string, userId: string) {
    return and(eq(reactions.targetType, targetType), eq(reactions.targetId, targetId), eq(reactions.userId, userId));
  }

  /** Posts and comments must be visible, interactive and not across a block. */
  private async assertReactable(user: AuthUser, targetType: 'post' | 'comment', targetId: string) {
    if (targetType === 'post') {
      await this.postsService.findVisible(user, targetId, { interactive: true });
      return;
    }
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, targetId)).limit(1);
    if (!comment || comment.deletedAt || comment.moderationState !== 'visible') throw Errors.notFound('Comment');
    if (await this.relations.isBlockedEitherWay(user.id, comment.authorId)) throw Errors.notFound('Comment');
    await this.postsService.findVisible(user, comment.postId, { interactive: true });
  }

  private async adjust(tx: Tx, targetType: 'post' | 'comment', targetId: string, kind: ReactionKind, delta: number, total = true) {
    if (targetType === 'comment') {
      if (total) {
        await tx
          .update(comments)
          .set({ reactionCount: sql`greatest(${comments.reactionCount} + ${delta}, 0)` })
          .where(eq(comments.id, targetId));
      }
      return;
    }
    const col = KIND_COLUMN[kind];
    await tx
      .update(posts)
      .set({
        [kindKey(kind)]: sql`greatest(${col} + ${delta}, 0)`,
        ...(total ? { reactionCount: sql`greatest(${posts.reactionCount} + ${delta}, 0)` } : {}),
      })
      .where(eq(posts.id, targetId));
  }

  private async state(userId: string, targetType: 'post' | 'comment', targetId: string): Promise<ReactionState> {
    const [mine] = await this.db.select({ kind: reactions.kind }).from(reactions).where(this.key(targetType, targetId, userId));
    if (targetType === 'post') {
      const [p] = await this.db.select().from(posts).where(eq(posts.id, targetId));
      return {
        targetType,
        targetId,
        reaction: (mine?.kind as ReactionKind) ?? null,
        reactions: p?.reactionCount ?? 0,
        breakdown: { like: p?.likeCount ?? 0, insightful: p?.insightfulCount ?? 0, support: p?.supportCount ?? 0 },
      };
    }
    const [[c], kinds] = await Promise.all([
      this.db.select({ n: comments.reactionCount }).from(comments).where(eq(comments.id, targetId)),
      commentReactionBreakdowns(this.db, [targetId]),
    ]);
    return {
      targetType,
      targetId,
      reaction: (mine?.kind as ReactionKind) ?? null,
      reactions: c?.n ?? 0,
      breakdown: kinds.get(targetId) ?? { like: 0, insightful: 0, support: 0 },
    };
  }
}

function kindKey(kind: ReactionKind): 'likeCount' | 'insightfulCount' | 'supportCount' {
  return kind === 'like' ? 'likeCount' : kind === 'insightful' ? 'insightfulCount' : 'supportCount';
}
