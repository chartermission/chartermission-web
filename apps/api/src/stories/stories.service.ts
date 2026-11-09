import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  HIGHLIGHTS_MAX,
  STORIES_PER_DAY,
  STORY_ARCHIVE_DAYS,
  STORY_TTL_HOURS,
  type AddToHighlightInput,
  type CreateHighlightInput,
  type CreateStoryInput,
  type HighlightView,
  type MemberRef,
  type StoryTray,
  type StoryTrayItem,
  type StoryView,
  type StoryViewer,
  type UpdateHighlightInput,
} from '@chartermission/contracts';
import type { z } from 'zod';
import type {
  CreateHighlightInput as CreateHighlightSchema,
  CreateStoryInput as CreateStorySchema,
  UpdateHighlightInput as UpdateHighlightSchema,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  chapters,
  connections,
  files,
  follows,
  memberProfiles,
  mutes,
  roles,
  stories,
  storyHighlightItems,
  storyHighlights,
  storyViews,
  userRoles,
  users,
} from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { can } from '../core/policy.js';
import { MembersService, mediaUrl, posterUrl } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { MediaService } from '../media/media.service.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import { authorActiveSql, authorIsActive, isModerator, notBlockedSql } from '../posts/visibility.js';
import { isUuid } from '../moderation/util.js';

type StoryRow = typeof stories.$inferSelect;
type HighlightRow = typeof storyHighlights.$inferSelect;
type CreateStory = z.output<typeof CreateStorySchema>;
type CreateHighlight = z.output<typeof CreateHighlightSchema>;
type UpdateHighlight = z.output<typeof UpdateHighlightSchema>;

const PURGE_JOB = 'stories-purge';
const PURGE_EVERY_MS = 60 * 60_000;
/** Stories a member deleted are purged after a day; hidden or removed ones are kept for appeals. */
const DELETED_GRACE_MS = 24 * 3600_000;
const MODERATED_KEEP_DAYS = 180;
const TRAY_MAX_AUTHORS = 60;
const DAY_MS = 24 * 3600_000;

/**
 * Stories (24-hour photos and short videos in the feed strip) and highlights (named collections on a
 * profile). The strip shows the viewer's connections, the members they follow and the Ambassadors of
 * chapters they follow. Expired stories stay in the author's archive for 30 days, or for as long as a
 * highlight keeps them; an hourly job purges the rest with their media.
 */
@Injectable()
export class StoriesService implements OnModuleInit {
  private readonly log = new Logger('Stories');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly queue: QueueService,
    private readonly media: MediaService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name) => {
      if (name === PURGE_JOB) await this.purge();
    });
    this.queue.every('maintenance', PURGE_JOB, PURGE_EVERY_MS).catch((err: unknown) => this.log.warn(`Could not schedule ${PURGE_JOB}: ${String(err)}`));
  }

  /* ----------------------------- Stories ----------------------------- */

  /** POST /stories */
  async create(user: AuthUser, rawInput: CreateStoryInput): Promise<StoryView> {
    const input = rawInput as CreateStory;
    assertNotRestricted(user);
    if (!can(user, 'post.create')) throw Errors.forbidden();
    const [file] = await this.db.select().from(files).where(eq(files.id, input.fileId)).limit(1);
    if (!file || file.ownerId !== user.id) throw Errors.validation({ fileId: 'Upload a photo or video first' });
    if (file.purpose !== 'story_image' && file.purpose !== 'story_video') throw Errors.validation({ fileId: 'This file can’t be used for a story' });
    if (file.attachedAt) throw Errors.validation({ fileId: 'This file is already used' });
    if (file.scanStatus === 'rejected' || file.scanStatus === 'infected') {
      throw Errors.validation({ fileId: file.rejectionReason ?? 'This file was rejected' });
    }
    if (file.scanStatus !== 'clean') throw Errors.validation({ fileId: 'Wait for the upload to finish processing' });
    await this.limits.consume(`stories:${user.id}`, STORIES_PER_DAY, 24 * 3600);

    const now = new Date();
    const story = await this.db.transaction(async (tx) => {
      const claimed = await tx
        .update(files)
        .set({ attachedAt: now })
        .where(and(eq(files.id, file.id), isNull(files.attachedAt)))
        .returning({ id: files.id });
      if (!claimed.length) throw Errors.conflict('This file is already used');
      const [row] = await tx
        .insert(stories)
        .values({ authorId: user.id, fileId: file.id, caption: input.caption ?? null, expiresAt: new Date(now.getTime() + STORY_TTL_HOURS * 3600_000) })
        .returning();
      return row!;
    });
    return (await this.views([story], user))[0]!;
  }

  /** GET /stories/tray */
  async tray(viewer: AuthUser): Promise<StoryTray> {
    const now = new Date();
    const live = and(isNull(stories.deletedAt), gt(stories.expiresAt, now));
    const mine = await this.db
      .select()
      .from(stories)
      .where(and(live, eq(stories.authorId, viewer.id), ne(stories.moderationState, 'removed')))
      .orderBy(asc(stories.createdAt));
    const others = await this.db
      .select()
      .from(stories)
      .where(
        and(
          live,
          eq(stories.moderationState, 'visible'),
          ne(stories.authorId, viewer.id),
          this.audienceSql(viewer.id),
          authorActiveSql(sql`${stories.authorId}`),
          notBlockedSql(viewer.id, sql`${stories.authorId}`),
          sql`not exists (select 1 from ${mutes} sm where sm.user_id = ${viewer.id} and sm.target_type = 'member' and sm.target_id = ${stories.authorId}::text)`,
        ),
      )
      .orderBy(desc(stories.createdAt))
      .limit(TRAY_MAX_AUTHORS * 10);
    // Newest first for the limit, then oldest first within each member's set.
    others.reverse();

    const views = await this.views([...mine, ...others], viewer);
    const byAuthor = new Map<string, StoryView[]>();
    for (const v of views) byAuthor.set(v.author.id, [...(byAuthor.get(v.author.id) ?? []), v]);
    const item = (list: StoryView[]): StoryTrayItem => ({
      author: list[0]!.author,
      stories: list,
      hasUnseen: list.some((s) => !s.viewer.seen),
      latestAt: list[list.length - 1]!.createdAt,
    });
    const mineList = byAuthor.get(viewer.id);
    byAuthor.delete(viewer.id);
    const items = [...byAuthor.values()]
      .map(item)
      .sort((a, b) => Number(b.hasUnseen) - Number(a.hasUnseen) || b.latestAt.localeCompare(a.latestAt))
      .slice(0, TRAY_MAX_AUTHORS);
    return { mine: mineList?.length ? item(mineList) : null, items };
  }

  /** GET /stories/archive: the viewer's own stories from the last 30 days, newest first. */
  async archive(viewer: AuthUser): Promise<StoryView[]> {
    const rows = await this.db
      .select()
      .from(stories)
      .where(
        and(
          eq(stories.authorId, viewer.id),
          isNull(stories.deletedAt),
          ne(stories.moderationState, 'removed'),
          gt(stories.createdAt, new Date(Date.now() - STORY_ARCHIVE_DAYS * DAY_MS)),
        ),
      )
      .orderBy(desc(stories.createdAt))
      .limit(200);
    return this.views(rows, viewer);
  }

  /** GET /stories/:id */
  async get(viewer: AuthUser, id: string): Promise<StoryView> {
    const story = await this.viewable(viewer, id);
    return (await this.views([story], viewer))[0]!;
  }

  /** POST /stories/:id/view — counted once per viewer; the author's own views don't count. */
  async markViewed(viewer: AuthUser, id: string): Promise<void> {
    const story = await this.viewable(viewer, id);
    if (story.authorId === viewer.id) return;
    const inserted = await this.db
      .insert(storyViews)
      .values({ storyId: story.id, viewerId: viewer.id })
      .onConflictDoNothing()
      .returning({ id: storyViews.storyId });
    if (inserted.length) {
      await this.db
        .update(stories)
        .set({ viewCount: sql`${stories.viewCount} + 1` })
        .where(eq(stories.id, story.id));
    }
  }

  /** GET /stories/:id/viewers — author only. */
  async viewers(viewer: AuthUser, id: string): Promise<StoryViewer[]> {
    const story = await this.own(viewer, id);
    const rows = await this.db
      .select()
      .from(storyViews)
      .where(eq(storyViews.storyId, story.id))
      .orderBy(desc(storyViews.viewedAt))
      .limit(500);
    const blocked = await this.relations.blockedSet(viewer.id);
    const refs = await this.members.refs(rows.map((r) => r.viewerId));
    return rows
      .filter((r) => !blocked.has(r.viewerId) && refs.has(r.viewerId))
      .map((r) => ({ member: refs.get(r.viewerId)!, viewedAt: r.viewedAt.toISOString() }));
  }

  /** DELETE /stories/:id — the author; also drops it from highlights (empty highlights go too). */
  async remove(viewer: AuthUser, id: string): Promise<void> {
    const story = await this.own(viewer, id);
    await this.db.transaction(async (tx) => {
      await tx.update(stories).set({ deletedAt: new Date() }).where(eq(stories.id, story.id));
      const links = await tx.delete(storyHighlightItems).where(eq(storyHighlightItems.storyId, story.id)).returning();
      for (const { highlightId } of links) {
        const [left] = await tx.select({ id: storyHighlightItems.storyId }).from(storyHighlightItems).where(eq(storyHighlightItems.highlightId, highlightId)).limit(1);
        if (!left) await tx.delete(storyHighlights).where(eq(storyHighlights.id, highlightId));
      }
    });
  }

  /* ----------------------------- Highlights ----------------------------- */

  /** GET /highlights?member= */
  async highlights(viewer: AuthUser, member: string): Promise<HighlightView[]> {
    const [profile] = await this.db
      .select({ userId: memberProfiles.userId, status: users.status, suspendedUntil: users.suspendedUntil })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(isUuid(member) ? eq(memberProfiles.userId, member) : sql`lower(${memberProfiles.handle}) = ${member.replace(/^@/, '').toLowerCase()}`)
      .limit(1);
    if (!profile) throw Errors.notFound('That member');
    const own = profile.userId === viewer.id;
    if (!own) {
      if (await this.relations.isBlockedEitherWay(viewer.id, profile.userId)) throw Errors.notFound('That member');
      if (!authorIsActive(profile) && !isModerator(viewer)) return [];
    }
    const rows = await this.db
      .select()
      .from(storyHighlights)
      .where(eq(storyHighlights.ownerId, profile.userId))
      .orderBy(asc(storyHighlights.position), asc(storyHighlights.createdAt));
    return (await this.highlightViews(rows, viewer)).filter((h) => own || h.stories.length > 0);
  }

  /** POST /highlights */
  async createHighlight(viewer: AuthUser, rawInput: CreateHighlightInput): Promise<HighlightView> {
    const input = rawInput as CreateHighlight;
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(storyHighlights)
      .where(eq(storyHighlights.ownerId, viewer.id))) as [{ n: number }];
    if (n >= HIGHLIGHTS_MAX) throw Errors.conflict(`You can have up to ${HIGHLIGHTS_MAX} highlights. Delete one to add another.`);
    const ids = await this.ownStoryIds(viewer, input.storyIds);
    const row = await this.db.transaction(async (tx) => {
      const [h] = await tx.insert(storyHighlights).values({ ownerId: viewer.id, title: input.title, position: n }).returning();
      await tx.insert(storyHighlightItems).values(ids.map((storyId, position) => ({ highlightId: h!.id, storyId, position })));
      return h!;
    });
    return (await this.highlightViews([row], viewer))[0]!;
  }

  /** PATCH /highlights/:id */
  async updateHighlight(viewer: AuthUser, id: string, rawInput: UpdateHighlightInput): Promise<HighlightView> {
    const input = rawInput as UpdateHighlight;
    const highlight = await this.ownHighlight(viewer, id);
    const ids = input.storyIds ? await this.ownStoryIds(viewer, input.storyIds) : null;
    await this.db.transaction(async (tx) => {
      await tx
        .update(storyHighlights)
        .set({ ...(input.title ? { title: input.title } : {}), updatedAt: new Date() })
        .where(eq(storyHighlights.id, highlight.id));
      if (ids) {
        await tx.delete(storyHighlightItems).where(eq(storyHighlightItems.highlightId, highlight.id));
        await tx.insert(storyHighlightItems).values(ids.map((storyId, position) => ({ highlightId: highlight.id, storyId, position })));
      }
    });
    return this.oneHighlight(viewer, highlight.id);
  }

  /** POST /highlights/:id/stories */
  async addToHighlight(viewer: AuthUser, id: string, input: AddToHighlightInput): Promise<HighlightView> {
    const highlight = await this.ownHighlight(viewer, id);
    const [storyId] = await this.ownStoryIds(viewer, [input.storyId]);
    const [{ max }] = (await this.db
      .select({ max: sql<number>`coalesce(max(${storyHighlightItems.position}), -1)::int` })
      .from(storyHighlightItems)
      .where(eq(storyHighlightItems.highlightId, highlight.id))) as [{ max: number }];
    await this.db.insert(storyHighlightItems).values({ highlightId: highlight.id, storyId: storyId!, position: max + 1 }).onConflictDoNothing();
    await this.db.update(storyHighlights).set({ updatedAt: new Date() }).where(eq(storyHighlights.id, highlight.id));
    return this.oneHighlight(viewer, highlight.id);
  }

  /** DELETE /highlights/:id/stories/:storyId */
  async removeFromHighlight(viewer: AuthUser, id: string, storyId: string): Promise<HighlightView> {
    const highlight = await this.ownHighlight(viewer, id);
    const items = await this.db.select({ storyId: storyHighlightItems.storyId }).from(storyHighlightItems).where(eq(storyHighlightItems.highlightId, highlight.id));
    if (!items.some((i) => i.storyId === storyId)) throw Errors.notFound('That story');
    if (items.length === 1) throw Errors.conflict('A highlight needs at least one story. Delete the highlight instead.');
    await this.db.delete(storyHighlightItems).where(and(eq(storyHighlightItems.highlightId, highlight.id), eq(storyHighlightItems.storyId, storyId)));
    return this.oneHighlight(viewer, highlight.id);
  }

  /** DELETE /highlights/:id — the stories stay in the archive (until it expires). */
  async deleteHighlight(viewer: AuthUser, id: string): Promise<void> {
    const highlight = await this.ownHighlight(viewer, id);
    await this.db.delete(storyHighlights).where(eq(storyHighlights.id, highlight.id));
  }

  /* ----------------------------- Purge job ----------------------------- */

  /**
   * Hourly: removes stories (and their media) that nothing needs any more: deleted by the author over a
   * day ago; expired over 30 days ago and in no highlight; hidden or removed by moderators over 180 days ago.
   */
  async purge(now = new Date()): Promise<number> {
    const inHighlight = sql`exists (select 1 from ${storyHighlightItems} hi where hi.story_id = ${stories.id})`;
    const archiveCutoff = new Date(now.getTime() - (STORY_TTL_HOURS * 3600_000 + STORY_ARCHIVE_DAYS * DAY_MS));
    const rows = await this.db
      .select({ id: stories.id, fileId: stories.fileId })
      .from(stories)
      .where(
        or(
          lt(stories.deletedAt, new Date(now.getTime() - DELETED_GRACE_MS)),
          and(isNull(stories.deletedAt), eq(stories.moderationState, 'visible'), lt(stories.expiresAt, archiveCutoff), sql`not ${inHighlight}`),
          and(ne(stories.moderationState, 'visible'), lt(stories.createdAt, new Date(now.getTime() - MODERATED_KEEP_DAYS * DAY_MS))),
        ),
      )
      .limit(500);
    if (!rows.length) return 0;
    const fileRows = await this.db
      .select({ id: files.id, key: files.storageKey, posterKey: files.posterKey })
      .from(files)
      .where(inArray(files.id, rows.map((r) => r.fileId)));
    for (const f of fileRows) {
      await this.media.storage.remove(f.key).catch(() => undefined);
      if (f.posterKey) await this.media.storage.remove(f.posterKey).catch(() => undefined);
    }
    // Deleting the file rows cascades to the stories, their views and highlight items.
    await this.db.delete(files).where(inArray(files.id, fileRows.map((f) => f.id)));
    await this.db.delete(stories).where(inArray(stories.id, rows.map((r) => r.id)));
    return rows.length;
  }

  /* ----------------------------- Helpers ----------------------------- */

  /**
   * Whose stories reach the viewer's strip: accepted connections, members they follow, and the
   * Ambassador of any chapter they follow.
   */
  private audienceSql(viewerId: string): SQL {
    return sql`(
      exists (select 1 from ${connections} sc where sc.status = 'accepted'
              and ((sc.requester_id = ${viewerId} and sc.addressee_id = ${stories.authorId})
                or (sc.addressee_id = ${viewerId} and sc.requester_id = ${stories.authorId})))
      or exists (select 1 from ${follows} sf where sf.follower_id = ${viewerId} and sf.target_type = 'member' and sf.target_id = ${stories.authorId}::text)
      or exists (select 1 from ${userRoles} sur
                 join ${roles} sr on sr.id = sur.role_id and sr.key = 'ambassador'
                 join ${chapters} sch on sch.id::text = sur.scope_id
                 join ${follows} sff on sff.follower_id = ${viewerId} and sff.target_type = 'chapter'
                   and (sff.target_id = sch.id::text or sff.target_id = sch.slug)
                 where sur.user_id = ${stories.authorId} and sur.scope_type = 'chapter' and sur.revoked_at is null)
    )`;
  }

  /**
   * Who may open a story: the author and moderators always; others while it is visible, its author is
   * active and not blocked, and either it is live and they are in its audience, or it is in a highlight.
   */
  private async viewable(viewer: AuthUser, id: string): Promise<StoryRow> {
    if (!isUuid(id)) throw Errors.notFound('That story');
    const [story] = await this.db.select().from(stories).where(eq(stories.id, id)).limit(1);
    if (!story || story.deletedAt) throw Errors.notFound('That story');
    if (story.authorId === viewer.id || isModerator(viewer)) return story;
    if (story.moderationState !== 'visible') throw Errors.notFound('That story');
    const [author] = await this.db.select({ status: users.status, suspendedUntil: users.suspendedUntil }).from(users).where(eq(users.id, story.authorId)).limit(1);
    if (!authorIsActive(author)) throw Errors.notFound('That story');
    if (await this.relations.isBlockedEitherWay(viewer.id, story.authorId)) throw Errors.notFound('That story');
    const [highlighted] = await this.db.select({ id: storyHighlightItems.storyId }).from(storyHighlightItems).where(eq(storyHighlightItems.storyId, story.id)).limit(1);
    if (highlighted) return story;
    if (story.expiresAt <= new Date()) throw Errors.notFound('That story');
    const [inAudience] = await this.db.select({ id: stories.id }).from(stories).where(and(eq(stories.id, story.id), this.audienceSql(viewer.id))).limit(1);
    if (!inAudience) throw Errors.notFound('That story');
    return story;
  }

  private async own(viewer: AuthUser, id: string): Promise<StoryRow> {
    if (!isUuid(id)) throw Errors.notFound('That story');
    const [story] = await this.db.select().from(stories).where(eq(stories.id, id)).limit(1);
    if (!story || story.deletedAt) throw Errors.notFound('That story');
    if (story.authorId !== viewer.id) throw Errors.forbidden('Only the author can do that');
    return story;
  }

  private async ownHighlight(viewer: AuthUser, id: string): Promise<HighlightRow> {
    if (!isUuid(id)) throw Errors.notFound('That highlight');
    const [h] = await this.db.select().from(storyHighlights).where(eq(storyHighlights.id, id)).limit(1);
    if (!h) throw Errors.notFound('That highlight');
    if (h.ownerId !== viewer.id) throw Errors.forbidden('Only the owner can change this highlight');
    return h;
  }

  /** The viewer's own stories among the ids, in the order given, or a 422 naming the problem. */
  private async ownStoryIds(viewer: AuthUser, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const rows = await this.db
      .select({ id: stories.id, authorId: stories.authorId, deletedAt: stories.deletedAt, state: stories.moderationState })
      .from(stories)
      .where(inArray(stories.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const r = byId.get(id);
      if (!r || r.authorId !== viewer.id || r.deletedAt || r.state === 'removed') {
        throw Errors.validation({ storyIds: 'Choose stories from your own archive' });
      }
    }
    return unique;
  }

  private async oneHighlight(viewer: AuthUser, id: string): Promise<HighlightView> {
    const [h] = await this.db.select().from(storyHighlights).where(eq(storyHighlights.id, id)).limit(1);
    return (await this.highlightViews([h!], viewer))[0]!;
  }

  private async highlightViews(rows: HighlightRow[], viewer: AuthUser): Promise<HighlightView[]> {
    if (!rows.length) return [];
    const items = await this.db
      .select({ highlightId: storyHighlightItems.highlightId, story: stories })
      .from(storyHighlightItems)
      .innerJoin(stories, eq(stories.id, storyHighlightItems.storyId))
      .where(and(inArray(storyHighlightItems.highlightId, rows.map((r) => r.id)), isNull(stories.deletedAt)))
      .orderBy(asc(storyHighlightItems.position));
    const mod = isModerator(viewer);
    const visible = items.filter((i) => i.story.moderationState === 'visible' || i.story.authorId === viewer.id || mod);
    const views = await this.views(visible.map((i) => i.story), viewer);
    const byId = new Map(views.map((v) => [v.id, v]));
    return rows.map((h) => {
      const list = visible.filter((i) => i.highlightId === h.id).map((i) => byId.get(i.story.id)!).filter(Boolean);
      const first = list[0];
      return {
        id: h.id,
        title: h.title,
        coverUrl: first ? (first.media.posterUrl ?? first.media.url) : null,
        stories: list,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      };
    });
  }

  private async views(rows: StoryRow[], viewer: AuthUser): Promise<StoryView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const ownIds = rows.filter((r) => r.authorId === viewer.id).map((r) => r.id);
    const [refs, fileRows, seenRows, highlightRows] = await Promise.all([
      this.members.refs(rows.map((r) => r.authorId)),
      this.db.select().from(files).where(inArray(files.id, rows.map((r) => r.fileId))),
      this.db.select({ id: storyViews.storyId }).from(storyViews).where(and(eq(storyViews.viewerId, viewer.id), inArray(storyViews.storyId, ids))),
      ownIds.length
        ? this.db
            .select({ storyId: storyHighlightItems.storyId, highlightId: storyHighlightItems.highlightId })
            .from(storyHighlightItems)
            .where(inArray(storyHighlightItems.storyId, ownIds))
        : Promise.resolve([] as { storyId: string; highlightId: string }[]),
    ]);
    const fileById = new Map(fileRows.map((f) => [f.id, f]));
    const seen = new Set(seenRows.map((s) => s.id));
    const mod = isModerator(viewer);
    const now = Date.now();
    const out: StoryView[] = [];
    for (const r of rows) {
      const author = refs.get(r.authorId);
      const file = fileById.get(r.fileId);
      if (!author || !file) continue;
      const own = r.authorId === viewer.id;
      const video = file.purpose === 'story_video';
      out.push({
        id: r.id,
        author: author as MemberRef,
        media: {
          kind: video ? 'video' : 'image',
          url: mediaUrl(file.id)!,
          posterUrl: video ? posterUrl(file) : null,
          width: file.width,
          height: file.height,
          durationSeconds: file.durationMs !== null ? file.durationMs / 1000 : null,
        },
        caption: r.caption,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        expired: r.expiresAt.getTime() <= now,
        viewer: { seen: own || seen.has(r.id), own, canDelete: own, canReport: !own },
        viewCount: own ? r.viewCount : null,
        highlightIds: own ? highlightRows.filter((h) => h.storyId === r.id).map((h) => h.highlightId) : null,
        ...((own || mod) && r.moderationState !== 'visible' ? { moderationState: r.moderationState as StoryView['moderationState'] } : {}),
      });
    }
    return out;
  }
}
