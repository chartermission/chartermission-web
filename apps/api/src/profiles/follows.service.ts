import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ChapterRef, FollowInput, FollowsQuery, FollowView, Page } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { blocks, chapters, follows, hashtags } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { EventsService } from '../infra/events.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { ProfilesService } from './profiles.service.js';
import { TaxonomyService } from './taxonomy.service.js';

const HIDDEN_STATUSES = new Set(['deactivated', 'deletion_pending', 'deleted']);
const HASHTAG = /^[A-Za-z0-9_]{2,50}$/;

/** Hashtag follow/mute key: without "#", lower-cased. Returns the display form too. */
export function normaliseHashtag(raw: string): { tag: string; display: string } {
  const display = raw.trim().replace(/^#/, '');
  if (!HASHTAG.test(display)) throw Errors.validation({ targetId: 'Use 2–50 letters, numbers or underscores' });
  return { tag: display.toLowerCase(), display };
}

type Resolved = { targetType: FollowInput['targetType']; targetId: string; display?: string };

/** Follow and unfollow members, hashtags and chapters without mutual consent (CM-NET-04, CM-FED-05). */
@Injectable()
export class FollowsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly profiles: ProfilesService,
    private readonly relations: RelationsService,
    private readonly taxonomy: TaxonomyService,
    private readonly members: MembersService,
    private readonly events: EventsService,
  ) {}

  /** Resolves and checks the target. Members: id or handle; blocked or hidden → 404; self → 400. */
  private async resolve(userId: string, input: FollowInput, forFollow: boolean): Promise<Resolved> {
    if (input.targetType === 'hashtag') {
      const { tag, display } = normaliseHashtag(input.targetId);
      return { targetType: 'hashtag', targetId: tag, display };
    }
    if (input.targetType === 'chapter') {
      const [id] = await this.taxonomy.validChapters([input.targetId], 'targetId').catch(() => {
        throw Errors.notFound('Chapter');
      });
      return { targetType: 'chapter', targetId: id! };
    }
    const row = await this.profiles.findRow(input.targetId);
    if (!row) throw Errors.notFound('Member');
    if (row.userId === userId) throw Errors.badRequest('You can’t follow yourself');
    if (forFollow) {
      if (HIDDEN_STATUSES.has(row.status)) throw Errors.notFound('Member');
      if (await this.relations.isBlockedEitherWay(userId, row.userId)) throw Errors.notFound('Member');
    }
    return { targetType: 'member', targetId: row.userId };
  }

  /** POST /follows. Returns true when a new follow was created. */
  async follow(userId: string, input: FollowInput): Promise<boolean> {
    const target = await this.resolve(userId, input, true);
    const created = await this.db.transaction(async (tx) => {
      if (target.targetType === 'hashtag') {
        await tx.insert(hashtags).values({ tag: target.targetId, display: target.display! }).onConflictDoNothing();
      }
      const rows = await tx
        .insert(follows)
        .values({ followerId: userId, targetType: target.targetType, targetId: target.targetId })
        .onConflictDoNothing()
        .returning({ targetId: follows.targetId });
      if (rows.length > 0 && target.targetType === 'hashtag') {
        await tx
          .update(hashtags)
          .set({ followerCount: sql`${hashtags.followerCount} + 1` })
          .where(eq(hashtags.tag, target.targetId));
      }
      return rows.length > 0;
    });
    if (created) {
      await this.events.emit({ type: 'follow.created', followerId: userId, targetType: target.targetType, targetId: target.targetId });
    }
    return created;
  }

  /** DELETE /follows */
  async unfollow(userId: string, input: FollowInput): Promise<void> {
    let target: Resolved;
    if (input.targetType === 'hashtag') target = { targetType: 'hashtag', targetId: normaliseHashtag(input.targetId).tag };
    else if (input.targetType === 'member') target = await this.resolve(userId, input, false);
    else {
      const [chapter] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .where(sql`${chapters.id}::text = ${input.targetId} or ${chapters.slug} = ${input.targetId}`)
        .limit(1);
      target = { targetType: 'chapter', targetId: chapter?.id ?? input.targetId };
    }
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(follows)
        .where(
          and(eq(follows.followerId, userId), eq(follows.targetType, target.targetType), eq(follows.targetId, target.targetId)),
        )
        .returning({ targetId: follows.targetId });
      if (rows.length > 0 && target.targetType === 'hashtag') {
        await tx
          .update(hashtags)
          .set({ followerCount: sql`greatest(${hashtags.followerCount} - 1, 0)` })
          .where(eq(hashtags.tag, target.targetId));
      }
    });
  }

  async followedIds(userId: string, type: FollowInput['targetType']): Promise<string[]> {
    const rows = await this.db
      .select({ targetId: follows.targetId })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.targetType, type)))
      .orderBy(desc(follows.createdAt));
    return rows.map((r) => r.targetId);
  }

  /** GET /me/follows?type= */
  async list(userId: string, query: FollowsQuery): Promise<Page<FollowView>> {
    const cursor = decodeCursor<{ c: string; t: string; i: string }>(query.cursor);
    const rows = await this.db
      .select({
        targetType: follows.targetType,
        targetId: follows.targetId,
        createdAt: follows.createdAt,
        cursorAt: sql<string>`${follows.createdAt}::text`,
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, userId),
          query.type ? eq(follows.targetType, query.type) : inArray(follows.targetType, ['member', 'hashtag', 'chapter']),
          cursor
            ? sql`(${follows.createdAt}, ${follows.targetType}, ${follows.targetId}) < (${cursor.c}::timestamptz, ${cursor.t}, ${cursor.i})`
            : undefined,
          // Text comparison: target_id holds hashtags and chapter ids too, so it is never cast to uuid.
          sql`not exists (select 1 from ${blocks} b where ${follows.targetType} = 'member' and (
            (b.blocker_id = ${userId} and b.blocked_id::text = ${follows.targetId})
            or (b.blocked_id = ${userId} and b.blocker_id::text = ${follows.targetId})))`,
        ),
      )
      .orderBy(desc(follows.createdAt), desc(follows.targetType), desc(follows.targetId))
      .limit(query.limit + 1);
    const page = paginate(rows, query.limit, (r) => ({ c: r.cursorAt, t: r.targetType, i: r.targetId }));

    const memberIds = page.items.filter((r) => r.targetType === 'member').map((r) => r.targetId);
    const chapterIds = page.items.filter((r) => r.targetType === 'chapter').map((r) => r.targetId);
    const tags = page.items.filter((r) => r.targetType === 'hashtag').map((r) => r.targetId);
    const [refs, chapterRows, tagRows] = await Promise.all([
      this.members.refs(memberIds),
      chapterIds.length
        ? this.db
            .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
            .from(chapters)
            .where(inArray(sql`${chapters.id}::text`, chapterIds))
        : Promise.resolve([] as ChapterRef[]),
      tags.length
        ? this.db.select({ tag: hashtags.tag, display: hashtags.display }).from(hashtags).where(inArray(hashtags.tag, tags))
        : Promise.resolve([] as { tag: string; display: string }[]),
    ]);
    const chapterMap = new Map(chapterRows.map((c) => [c.id, c]));
    const tagMap = new Map(tagRows.map((t) => [t.tag, t]));
    const items: FollowView[] = page.items.map((r) => {
      const view: FollowView = {
        targetType: r.targetType as FollowView['targetType'],
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
      };
      if (r.targetType === 'member' && refs.get(r.targetId)) view.member = refs.get(r.targetId);
      if (r.targetType === 'chapter' && chapterMap.get(r.targetId)) view.chapter = chapterMap.get(r.targetId);
      if (r.targetType === 'hashtag') view.hashtag = tagMap.get(r.targetId) ?? { tag: r.targetId, display: r.targetId };
      return view;
    });
    return { items, nextCursor: page.nextCursor };
  }
}
