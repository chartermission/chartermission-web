import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { CursorQuery, GroupPostAction, GroupRole, Ok, Page, PostView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { posts } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { Errors } from '../common/errors.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { PostsService } from '../posts/posts.service.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { tsKey } from '../posts/visibility.js';
import { GroupsService } from './groups.service.js';
import { rankInGroup } from './group-access.js';

const RANK_OWNER = 3;
const rankOf = (role: GroupRole | null) => (role === 'owner' ? 3 : role === 'admin' ? 2 : role === 'moderator' ? 1 : role === 'member' ? 0 : -1);

/** Posts one group can pin at the top of its feed. */
export const GROUP_PIN_LIMIT = 3;

/**
 * What a group's moderators do with its posts: approve or decline waiting ones (groups with post
 * approval on), remove a post from the group, pin and unpin.
 *
 * Pins use posts.pinned_at. Outside groups it only marks pinned platform announcements (kind
 * 'announcement'), which can't be posted in a group, so on a group post it can only mean "pinned in
 * its group": one post belongs to one group, and the home feed only lifts pinned announcements.
 */
@Injectable()
export class GroupPostsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly groupsService: GroupsService,
    private readonly postsService: PostsService,
    private readonly serializer: PostSerializer,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** GET /groups/{slug}/posts/pending (moderators and up): waiting posts, oldest first. */
  async pending(user: AuthUser, idOrSlug: string, q: CursorQuery): Promise<Page<PostView>> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    if (!access.abilities.moderate) throw Errors.forbidden('Only the group’s moderators can review posts');
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    checkCursor(c, { t: 'date', id: 'uuid' });
    const ts = tsKey(posts.createdAt);
    const rows = await this.db
      .select({ id: posts.id, ts })
      .from(posts)
      .where(
        and(
          eq(posts.groupId, row.id),
          eq(posts.status, 'in_review'),
          eq(posts.groupReview, 'pending'),
          isNull(posts.deletedAt),
          c ? sql`(${posts.createdAt}, ${posts.id}) > (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(posts.createdAt, posts.id)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.id }));
    return { items: await this.serializer.posts(page.items.map((r) => r.id), user), nextCursor: page.nextCursor };
  }

  /** POST /groups/{slug}/posts/{postId} */
  async act(user: AuthUser, idOrSlug: string, postId: string, input: GroupPostAction, ip?: string): Promise<Ok> {
    const { row, access } = await this.groupsService.visibleRow(user, idOrSlug);
    if (!access.abilities.moderate) throw Errors.forbidden('Only the group’s moderators can do that');
    const post = await this.postsService.find(postId);
    if (!post || post.deletedAt || post.groupId !== row.id) throw Errors.notFound('That post');
    const waiting = post.status === 'in_review' && post.groupReview === 'pending';
    const note = 'note' in input ? input.note?.trim() || null : null;
    // Moderators remove or decline only posts by people of lower rank: a moderator can't touch an
    // admin's, the owner's or a page or chapter runner's post; an admin can't touch the owner's or a
    // runner's. Staff act through the admin console.
    if ((input.action === 'remove' || input.action === 'decline') && post.authorId !== user.id) {
      const mine = access.abilities.own ? RANK_OWNER : rankOf(access.role);
      if ((await rankInGroup(this.db, row, post.authorId)) >= mine) {
        throw Errors.forbidden(
          input.action === 'remove'
            ? 'You can only remove posts by people with a lower role than yours in this group.'
            : 'You can only decline posts by people with a lower role than yours in this group.',
        );
      }
    }

    switch (input.action) {
      case 'approve':
        if (!waiting || !(await this.postsService.publishGroupApproved(post.id, user.id))) throw Errors.conflict('This post isn’t waiting for approval');
        break;
      case 'decline':
        if (!waiting || !(await this.postsService.declineGroupPost(post.id, user.id, note))) throw Errors.conflict('This post isn’t waiting for approval');
        break;
      case 'remove':
        if (post.authorId === user.id) throw Errors.conflict('This is your own post. Delete it from its menu instead.');
        await this.postsService.removeFromGroup(post, user.id, note);
        break;
      case 'pin': {
        if (post.status !== 'published' || post.moderationState !== 'visible') throw Errors.conflict('Only live posts can be pinned');
        if (post.pinnedAt) return { ok: true };
        await this.db.transaction(async (tx) => {
          // Serialise pins per group so two moderators can't both take the last slot.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`group-pins:${row.id}`}))`);
          const pinned = await tx
            .select({ id: posts.id })
            .from(posts)
            .where(and(eq(posts.groupId, row.id), isNotNull(posts.pinnedAt), isNull(posts.deletedAt)))
            .orderBy(desc(posts.pinnedAt));
          if (pinned.length >= GROUP_PIN_LIMIT) throw Errors.conflict(`A group can pin up to ${GROUP_PIN_LIMIT} posts. Unpin one first.`);
          await tx.update(posts).set({ pinnedAt: new Date() }).where(eq(posts.id, post.id));
        });
        break;
      }
      case 'unpin':
        await this.db.update(posts).set({ pinnedAt: null }).where(eq(posts.id, post.id));
        break;
    }
    await this.audit.record({
      actorId: user.id,
      action: `group.post_${input.action}`,
      targetType: 'post',
      targetId: post.id,
      before: { status: post.status },
      after: { groupId: row.id, ...(note ? { note } : {}) },
      ip,
    });
    if (input.action === 'approve' || input.action === 'decline' || input.action === 'remove') {
      await this.events.emit({ type: 'group.post_reviewed', postId: post.id, groupId: row.id, action: input.action, actorId: user.id, note });
    }
    return { ok: true };
  }
}
