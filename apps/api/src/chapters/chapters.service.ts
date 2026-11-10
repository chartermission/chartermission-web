import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import {
  CHAPTER_PIN_LIMIT,
  chapterTeamLabel,
  type ChapterDetail,
  type ChapterMembersQuery,
  type ChapterSummary,
  type ChapterTeamMember,
  type ChapterTeamRole,
  type MemberRef,
  type Page,
  type PinChapterPostInput,
  type UpdateChapterInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapterPins, chapters, countries, events, follows, posts, roles, userRoles, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { EventAccess } from '../events/event-access.js';

type ChapterRow = {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  status: string;
  about: string | null;
  hashtag: string | null;
  photoUrl: string | null;
  photoCredit: string | null;
  photoCreditUrl: string | null;
  countryName: string;
  region: string;
  imageFileId: string | null;
  coverFileId: string | null;
};

/** Accounts that no longer appear in member lists. */
const GONE = ['deleted', 'deletion_pending', 'deactivated'];

/**
 * Chapter pages: the chapter list, a chapter's page (team, pinned posts, counts), its members
 * (followers) and the Ambassador tools (pin up to three posts, edit About).
 */
@Injectable()
export class ChaptersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly serializer: PostSerializer,
    private readonly access: EventAccess,
    private readonly audit: AuditService,
  ) {}

  /** GET /chapters — active chapters, A to Z. */
  async list(user: AuthUser): Promise<ChapterSummary[]> {
    const rows = await this.rows(eq(chapters.status, 'active'));
    const [counts, following] = await Promise.all([this.followerCounts(rows.map((r) => r.id)), this.followingSet(user.id)]);
    return rows
      .map((r) => this.summary(r, counts.get(r.id) ?? 0, following.has(r.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  /** GET /chapters/{slug} */
  async detail(user: AuthUser, slugOrId: string): Promise<ChapterDetail> {
    const chapter = await this.load(slugOrId);
    const canManage = await this.canManage(user, chapter.id);
    const [followerCounts, following, team, pinned, recentMembers, nearby, postCount, eventCount, led] = await Promise.all([
      this.followerCounts([chapter.id]),
      this.followingSet(user.id),
      this.team(chapter.id),
      this.pinnedPosts(user, chapter.id),
      this.recentMembers(chapter.id, 8),
      this.rows(and(eq(chapters.status, 'active'), eq(countries.region, chapter.region), ne(chapters.id, chapter.id))!),
      this.db
        .select({ n: count() })
        .from(posts)
        .where(and(eq(posts.chapterId, chapter.id), eq(posts.status, 'published'), eq(posts.moderationState, 'visible'), isNull(posts.deletedAt))),
      this.db
        .select({ n: count() })
        .from(events)
        .where(and(eq(events.hostChapterId, chapter.id), eq(events.status, 'published'), gt(events.endsAt, new Date()))),
      this.access.ledChapters(user.id),
    ]);
    const followers = followerCounts.get(chapter.id) ?? 0;
    return {
      ...this.summary(chapter, followers, following.has(chapter.id)),
      team,
      pinned,
      recentMembers,
      nearby: nearby
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
        .slice(0, 8)
        .map((r) => ({ id: r.id, slug: r.slug, name: r.name, countryCode: r.countryCode })),
      counts: { followers, posts: postCount[0]?.n ?? 0, upcomingEvents: eventCount[0]?.n ?? 0 },
      viewer: {
        following: following.has(chapter.id),
        canManage,
        canHostAsChapter: led.has(chapter.id) || user.permissions.has('event.manage'),
      },
    };
  }

  /** GET /chapters/{slug}/members — followers, newest first. */
  async membersPage(slugOrId: string, q: ChapterMembersQuery): Promise<Page<MemberRef>> {
    const chapter = await this.load(slugOrId);
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = sql<string>`to_char(${follows.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({ id: users.id, t: ts })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(
        and(
          eq(follows.targetType, 'chapter'),
          eq(follows.targetId, chapter.id),
          notInArray(users.status, GONE),
          c ? sql`(${follows.createdAt}, ${follows.followerId}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(follows.createdAt), desc(follows.followerId))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.id }));
    const refs = await this.members.refs(page.items.map((r) => r.id));
    return { items: page.items.map((r) => refs.get(r.id)).filter((m): m is MemberRef => !!m), nextCursor: page.nextCursor };
  }

  /** PATCH /chapters/{slug} — the About text. */
  async update(user: AuthUser, slugOrId: string, input: UpdateChapterInput, ip?: string): Promise<ChapterDetail> {
    const chapter = await this.load(slugOrId);
    if (!(await this.canManage(user, chapter.id))) throw Errors.forbidden('Only this chapter’s Ambassadors can edit its page');
    await this.db.update(chapters).set({ about: input.about || null }).where(eq(chapters.id, chapter.id));
    await this.audit.record({ actorId: user.id, action: 'chapter.update', targetType: 'chapter', targetId: chapter.id, before: { about: chapter.about }, after: { about: input.about || null }, ip });
    return this.detail(user, chapter.id);
  }

  /** POST /chapters/{slug}/pins — pin a post shared in this chapter (at most three). */
  async pin(user: AuthUser, slugOrId: string, input: PinChapterPostInput, ip?: string): Promise<ChapterDetail> {
    const chapter = await this.load(slugOrId);
    if (!(await this.canManage(user, chapter.id))) throw Errors.forbidden('Only this chapter’s Ambassadors can pin posts');
    const [post] = await this.db.select().from(posts).where(eq(posts.id, input.postId)).limit(1);
    if (!post || post.deletedAt || post.status !== 'published' || post.moderationState !== 'visible') throw Errors.notFound('That post');
    if (post.chapterId !== chapter.id) throw Errors.conflict(`Only posts shared in ${chapter.name} can be pinned to it`);

    await this.db.transaction(async (tx) => {
      // Serialise pins per chapter so two Ambassadors can't both take the third slot.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chapter-pins:${chapter.id}`}))`);
      const existing = await tx.select({ postId: chapterPins.postId }).from(chapterPins).where(eq(chapterPins.chapterId, chapter.id));
      if (existing.some((p) => p.postId === post.id)) return;
      if (existing.length >= CHAPTER_PIN_LIMIT)
        throw Errors.conflict(`A chapter can pin up to ${CHAPTER_PIN_LIMIT} posts. Unpin one first.`);
      await tx.insert(chapterPins).values({ chapterId: chapter.id, postId: post.id, pinnedBy: user.id });
    });
    await this.audit.record({ actorId: user.id, action: 'chapter.pin', targetType: 'post', targetId: post.id, after: { chapterId: chapter.id }, ip });
    return this.detail(user, chapter.id);
  }

  /** DELETE /chapters/{slug}/pins/{postId} */
  async unpin(user: AuthUser, slugOrId: string, postId: string, ip?: string): Promise<ChapterDetail> {
    const chapter = await this.load(slugOrId);
    if (!(await this.canManage(user, chapter.id))) throw Errors.forbidden('Only this chapter’s Ambassadors can unpin posts');
    await this.db.delete(chapterPins).where(and(eq(chapterPins.chapterId, chapter.id), eq(chapterPins.postId, postId)));
    await this.audit.record({ actorId: user.id, action: 'chapter.unpin', targetType: 'post', targetId: postId, after: { chapterId: chapter.id }, ip });
    return this.detail(user, chapter.id);
  }

  /** Ambassadors and Chapter Leads of the chapter, or staff with chapter.manage. */
  async canManage(user: AuthUser, chapterId: string): Promise<boolean> {
    if (user.permissions.has('chapter.manage')) return true;
    return (await this.access.ledChapters(user.id)).has(chapterId);
  }

  /* ----------------------------- Helpers ----------------------------- */

  private async rows(where: ReturnType<typeof and>): Promise<ChapterRow[]> {
    return this.db
      .select({
        id: chapters.id,
        slug: chapters.slug,
        name: chapters.name,
        countryCode: chapters.countryCode,
        status: chapters.status,
        about: chapters.about,
        hashtag: chapters.hashtag,
        countryName: countries.name,
        region: countries.region,
        imageFileId: chapters.imageFileId,
        coverFileId: chapters.coverFileId,
        photoUrl: chapters.photoUrl,
        photoCredit: chapters.photoCredit,
        photoCreditUrl: chapters.photoCreditUrl,
      })
      .from(chapters)
      .innerJoin(countries, eq(countries.code, chapters.countryCode))
      .where(where);
  }

  private async load(slugOrId: string): Promise<ChapterRow> {
    const key = slugOrId.toLowerCase();
    const [row] = await this.rows(
      and(isUuid(key) ? eq(chapters.id, key) : eq(chapters.slug, key), inArray(chapters.status, ['active', 'dormant'])),
    );
    if (!row) throw Errors.notFound('That chapter');
    return row;
  }

  private summary(r: ChapterRow, followers: number, following: boolean): ChapterSummary {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      countryCode: r.countryCode,
      countryName: r.countryName,
      region: r.region,
      imageUrl: mediaUrl(r.imageFileId),
      coverUrl: mediaUrl(r.coverFileId),
      about: r.about,
      hashtag: r.hashtag,
      photo: r.photoUrl ? { url: r.photoUrl, credit: r.photoCredit, creditUrl: r.photoCreditUrl } : null,
      followers,
      viewer: { following },
    };
  }

  private async followerCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: follows.targetId, n: count() })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(and(eq(follows.targetType, 'chapter'), inArray(follows.targetId, ids), notInArray(users.status, GONE)))
      .groupBy(follows.targetId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private async followingSet(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: follows.targetId })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.targetType, 'chapter')));
    return new Set(rows.map((r) => r.id));
  }

  private async team(chapterId: string): Promise<ChapterTeamMember[]> {
    const rows = await this.db
      .select({ userId: userRoles.userId, key: roles.key, grantedAt: userRoles.grantedAt })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          inArray(roles.key, ['ambassador', 'chapter_lead']),
          eq(userRoles.scopeType, 'chapter'),
          eq(userRoles.scopeId, chapterId),
          isNull(userRoles.revokedAt),
          notInArray(users.status, GONE),
        ),
      )
      .orderBy(userRoles.grantedAt);
    const ids = [...new Set(rows.map((r) => r.userId))];
    const refs = await this.members.refs(ids);
    const rank: Record<ChapterTeamRole, number> = { founding_ambassador: 0, ambassador: 1, chapter_lead: 2 };
    const out = new Map<string, ChapterTeamMember>();
    for (const r of rows) {
      const member = refs.get(r.userId);
      if (!member) continue;
      const role: ChapterTeamRole =
        r.key === 'chapter_lead' ? 'chapter_lead' : member.badge?.kind === 'founding_ambassador' ? 'founding_ambassador' : 'ambassador';
      const current = out.get(r.userId);
      if (!current || rank[role] < rank[current.role]) out.set(r.userId, { member, role, label: chapterTeamLabel(role) });
    }
    return [...out.values()].sort((a, b) => rank[a.role] - rank[b.role]);
  }

  private async pinnedPosts(user: AuthUser, chapterId: string) {
    const pins = await this.db
      .select({ postId: chapterPins.postId })
      .from(chapterPins)
      .innerJoin(posts, eq(posts.id, chapterPins.postId))
      .where(and(eq(chapterPins.chapterId, chapterId), isNull(posts.deletedAt), eq(posts.status, 'published'), eq(posts.moderationState, 'visible')))
      .orderBy(desc(chapterPins.createdAt));
    const ids = pins.map((p) => p.postId);
    const views = await this.serializer.posts(ids, user);
    const byId = new Map(views.map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => !!v);
  }

  private async recentMembers(chapterId: string, limit: number): Promise<MemberRef[]> {
    const rows = await this.db
      .select({ id: follows.followerId })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(and(eq(follows.targetType, 'chapter'), eq(follows.targetId, chapterId), notInArray(users.status, GONE)))
      .orderBy(desc(follows.createdAt))
      .limit(limit);
    const refs = await this.members.refs(rows.map((r) => r.id));
    return rows.map((r) => refs.get(r.id)).filter((m): m is MemberRef => !!m);
  }
}
