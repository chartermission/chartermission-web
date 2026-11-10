import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PeoplePage, PeopleQuery, PersonEntry } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { blocks, comments, connections, follows, pages, posts, reactions, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { RelationsService } from '../core/relations.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { PostsService } from '../posts/posts.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { RelationshipService } from '../profiles/relationship.service.js';

type Row = { userId: string; at: Date; cursorAt: string; reaction?: string | null };
type Cursor = { c: string; i: string };

/**
 * The members behind a count: who reacted to, commented on or reposted a post, and a member's
 * connections, followers and following. Every list is newest first, leaves out accounts that are
 * closed and anyone blocked either way, and carries the viewer's relationship to each person so
 * the list can offer Connect and Follow.
 */
@Injectable()
export class PeopleService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly relationships: RelationshipService,
    private readonly postsService: PostsService,
    private readonly profiles: ProfilesService,
    private readonly pageRefs: PageRefsService,
  ) {}

  /** GET /posts/{id}/reactions and GET /comments/{id}/reactions */
  async reactions(ctx: AuthContext, targetType: 'post' | 'comment', targetId: string, q: PeopleQuery): Promise<PeoplePage> {
    await this.assertVisible(ctx, targetType, targetId);
    const scope = and(eq(reactions.targetType, targetType), eq(reactions.targetId, targetId), this.listable(ctx.user.id, reactions.userId));
    const cursor = decodeCursor<Cursor>(q.cursor);
    const [rows, counts] = await Promise.all([
      this.db
        .select({ userId: reactions.userId, at: reactions.createdAt, cursorAt: sql<string>`${reactions.createdAt}::text`, reaction: reactions.kind })
        .from(reactions)
        .where(and(scope, q.kind ? eq(reactions.kind, q.kind) : undefined, this.after(cursor, reactions.createdAt, reactions.userId)))
        .orderBy(desc(reactions.createdAt), desc(reactions.userId))
        .limit(q.limit + 1),
      this.db
        .select({ kind: reactions.kind, n: sql<number>`count(*)::int` })
        .from(reactions)
        .where(scope)
        .groupBy(reactions.kind),
    ]);
    const byReaction = { like: 0, insightful: 0, support: 0 };
    for (const c of counts) if (c.kind in byReaction) byReaction[c.kind as keyof typeof byReaction] = c.n;
    const total = byReaction.like + byReaction.insightful + byReaction.support;
    return { ...(await this.page(ctx, rows, q.limit)), total, byReaction };
  }

  /** GET /posts/{id}/commenters — each member once, by their latest comment. */
  async commenters(ctx: AuthContext, postId: string, q: PeopleQuery): Promise<PeoplePage> {
    await this.postsService.findVisible(ctx.user, postId);
    return this.latestPerMember(
      ctx,
      q,
      sql`select c.author_id as user_id, max(c.created_at) as at from ${comments} c
          where c.post_id = ${postId} and c.deleted_at is null and c.moderation_state = 'visible' and ${this.listable(ctx.user.id, sql`c.author_id`)}
          group by c.author_id`,
    );
  }

  /** GET /posts/{id}/reposts — members who reposted it. Reposts made as a page never name the admin. */
  async reposters(ctx: AuthContext, postId: string, q: PeopleQuery): Promise<PeoplePage> {
    await this.postsService.findVisible(ctx.user, postId);
    return this.latestPerMember(
      ctx,
      q,
      sql`select p.author_id as user_id, max(p.created_at) as at from ${posts} p
          where p.repost_of_id = ${postId} and p.deleted_at is null and p.page_id is null and p.status = 'published'
            and p.moderation_state = 'visible' and ${this.listable(ctx.user.id, sql`p.author_id`)}
          group by p.author_id`,
    );
  }

  /** One row per member (their latest activity), newest first. `inner` yields (user_id, at). */
  private async latestPerMember(ctx: AuthContext, q: PeopleQuery, inner: SQL): Promise<PeoplePage> {
    const cursor = decodeCursor<Cursor>(q.cursor);
    const [page, count] = await Promise.all([
      this.db.execute<{ userId: string; at: Date; cursorAt: string }>(sql`
        select t.user_id as "userId", t.at as "at", t.at::text as "cursorAt" from (${inner}) t
        where ${cursor ? sql`(t.at, t.user_id) < (${cursor.c}::timestamptz, ${cursor.i}::uuid)` : sql`true`}
        order by t.at desc, t.user_id desc
        limit ${q.limit + 1}`),
      this.db.execute<{ n: number }>(sql`select count(*)::int as n from (${inner}) t`),
    ]);
    return { ...(await this.page(ctx, page.rows, q.limit)), total: count.rows[0]?.n ?? 0 };
  }

  /** GET /members/{handle}/followers */
  async followers(ctx: AuthContext, handle: string, q: PeopleQuery): Promise<PeoplePage> {
    const owner = await this.profiles.networkOwner(handle, ctx);
    return this.followersOf(ctx, 'member', owner.userId, q);
  }

  /** GET /pages/{slug}/followers — for the people who run the page. */
  async pageFollowers(ctx: AuthContext, slug: string, q: PeopleQuery): Promise<PeoplePage> {
    const [page] = await this.db.select({ id: pages.id }).from(pages).where(eq(sql`lower(${pages.slug})`, slug.toLowerCase())).limit(1);
    if (!page) throw Errors.notFound('Page');
    const manages = ctx.user.permissions.has('pages.manage') || !!(await this.pageRefs.role(ctx.user.id, page.id));
    if (!manages) throw Errors.forbidden('Only the people who run this page can see who follows it');
    return this.followersOf(ctx, 'page', page.id, q);
  }

  private async followersOf(ctx: AuthContext, targetType: 'member' | 'page', targetId: string, q: PeopleQuery): Promise<PeoplePage> {
    const scope = and(eq(follows.targetType, targetType), eq(follows.targetId, targetId), this.listable(ctx.user.id, follows.followerId));
    const cursor = decodeCursor<Cursor>(q.cursor);
    const [rows, [count]] = await Promise.all([
      this.db
        .select({ userId: follows.followerId, at: follows.createdAt, cursorAt: sql<string>`${follows.createdAt}::text` })
        .from(follows)
        .where(and(scope, this.after(cursor, follows.createdAt, follows.followerId)))
        .orderBy(desc(follows.createdAt), desc(follows.followerId))
        .limit(q.limit + 1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(follows).where(scope),
    ]);
    return { ...(await this.page(ctx, rows, q.limit)), total: count?.n ?? 0 };
  }

  /** GET /members/{handle}/following — the members they follow (topics, chapters and pages are not listed). */
  async following(ctx: AuthContext, handle: string, q: PeopleQuery): Promise<PeoplePage> {
    const owner = await this.profiles.networkOwner(handle, ctx);
    const target = sql<string>`${follows.targetId}::uuid`;
    const scope = and(eq(follows.followerId, owner.userId), eq(follows.targetType, 'member'), this.listable(ctx.user.id, target));
    const cursor = decodeCursor<Cursor>(q.cursor);
    const [rows, [count]] = await Promise.all([
      this.db
        .select({ userId: target, at: follows.createdAt, cursorAt: sql<string>`${follows.createdAt}::text` })
        .from(follows)
        .where(and(scope, this.after(cursor, follows.createdAt, target)))
        .orderBy(desc(follows.createdAt), desc(target))
        .limit(q.limit + 1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(follows).where(scope),
    ]);
    return { ...(await this.page(ctx, rows, q.limit)), total: count?.n ?? 0 };
  }

  /** GET /members/{handle}/connections */
  async connectionsOf(ctx: AuthContext, handle: string, q: PeopleQuery): Promise<PeoplePage> {
    const owner = await this.profiles.networkOwner(handle, ctx);
    const other = sql<string>`case when ${connections.requesterId} = ${owner.userId} then ${connections.addresseeId} else ${connections.requesterId} end`;
    const since = sql<Date>`coalesce(${connections.respondedAt}, ${connections.createdAt})`;
    const scope = and(
      eq(connections.status, 'accepted'),
      or(eq(connections.requesterId, owner.userId), eq(connections.addresseeId, owner.userId)),
      this.listable(ctx.user.id, other),
    );
    const cursor = decodeCursor<Cursor>(q.cursor);
    const [rows, [count]] = await Promise.all([
      this.db
        .select({ userId: other, at: since, cursorAt: sql<string>`${since}::text` })
        .from(connections)
        .where(and(scope, this.after(cursor, since, other)))
        .orderBy(desc(since), desc(other))
        .limit(q.limit + 1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(connections).where(scope),
    ]);
    return { ...(await this.page(ctx, rows, q.limit)), total: count?.n ?? 0 };
  }

  private async assertVisible(ctx: AuthContext, targetType: 'post' | 'comment', targetId: string) {
    if (targetType === 'post') {
      await this.postsService.findVisible(ctx.user, targetId);
      return;
    }
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, targetId)).limit(1);
    if (!comment || comment.deletedAt || comment.moderationState !== 'visible') throw Errors.notFound('Comment');
    if (await this.relations.isBlockedEitherWay(ctx.user.id, comment.authorId)) throw Errors.notFound('Comment');
    await this.postsService.findVisible(ctx.user, comment.postId);
  }

  /** SQL: the person may appear in a list shown to this viewer (open account, no block either way). */
  private listable(viewerId: string, userCol: SQL | AnyColumn): SQL {
    return sql`exists (select 1 from ${users} lu where lu.id = ${userCol} and lu.status in ('active','unverified'))
      and not exists (select 1 from ${blocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${userCol}) or (b.blocked_id = ${viewerId} and b.blocker_id = ${userCol}))`;
  }

  private after(cursor: Cursor | null, at: unknown, id: unknown): SQL | undefined {
    return cursor ? sql`(${at}, ${id}) < (${cursor.c}::timestamptz, ${cursor.i}::uuid)` : undefined;
  }

  private async page(ctx: AuthContext, rows: Row[], limit: number): Promise<{ items: PersonEntry[]; nextCursor: string | null }> {
    const page = paginate(rows, limit, (r) => ({ c: r.cursorAt, i: r.userId }));
    const ids = page.items.map((r) => r.userId);
    const [refs, rels, mutual] = await Promise.all([
      this.members.refs(ids),
      this.relationships.many(ctx.user.id, ids),
      this.relationships.mutualCounts(ctx.user.id, ids),
    ]);
    const items: PersonEntry[] = [];
    for (const r of page.items) {
      const ref = refs.get(r.userId);
      const relationship = rels.get(r.userId);
      if (!ref || !relationship) continue;
      items.push({
        ...ref,
        location: null,
        mutualConnections: mutual.get(r.userId) ?? 0,
        relationship,
        reaction: (r.reaction as PersonEntry['reaction']) ?? null,
        at: new Date(r.at).toISOString(),
      });
    }
    return { items, nextCursor: page.nextCursor };
  }
}
