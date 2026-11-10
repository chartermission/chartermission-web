import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  DAILY_PROMPT_TAG,
  NEW_MEMBER_DAYS,
  type ChapterHighlightMoment,
  type ChapterRef,
  type Moment,
  type MomentsResponse,
  type NewMembersMoment,
  type PromptMoment,
  type SpotlightMoment,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, countries, follows, memberProfiles, mutes, posts, profileSectors, sectors, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { listablePostsSql } from '../posts/visibility.js';
import { fieldVisibleToMemberSql } from '../profiles/visibility.js';
import { cardCandidateSql, followsChapterSql, HomeQueries } from './home-queries.js';
import { promptFor } from './prompts.js';
import { DAY_MS, excerpt, startOfUtcDay, utcDay, utcDayNumber } from './text.js';

const NEW_MEMBERS_SHOWN = 6;
const PROMPT_RESPONDERS = 3;
const BIO_MAX = 220;
const EXCERPT_MAX = 160;
const WEEK_DAYS = 7;

/** Posts the viewer may see that are published and visible to everyone (no own drafts or hidden posts). */
function shownPostsSql(viewerId: string): SQL {
  return and(listablePostsSql(viewerId, { muteHashtags: true }), eq(posts.status, 'published'), eq(posts.moderationState, 'visible'))!;
}

/** The post carries the hashtag (outer posts row written out in full; see TopicsService.list). */
function hasTagSql(tag: string): SQL {
  return sql`exists (select 1 from post_hashtags dph join hashtags dh on dh.id = dph.hashtag_id where dph.post_id = "posts"."id" and dh.tag = ${tag.toLowerCase()})`;
}

/** The viewer has not muted the member in member_profiles. */
function notMutedMemberSql(viewerId: string): SQL {
  return sql`not exists (select 1 from ${mutes} mm where mm.user_id = ${viewerId} and mm.target_type = 'member' and mm.target_id = "member_profiles"."user_id"::text)`;
}

/** Short plain-text summary of a post: an article's title, otherwise the start of the body. */
function postExcerpt(p: { type: string; body: string; details: Record<string, unknown> | null }): string {
  const title = p.type === 'article' && typeof p.details?.title === 'string' ? p.details.title : null;
  return title ? excerpt(title, EXCERPT_MAX) : excerpt(p.body, EXCERPT_MAX);
}

/**
 * GET /home/moments: community cards woven into the home feed. Each kind is left out when
 * there is nothing to show; ids are stable for the UTC day so dismissals can be remembered.
 */
@Injectable()
export class MomentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly queries: HomeQueries,
  ) {}

  async moments(viewer: AuthUser): Promise<MomentsResponse> {
    const now = new Date();
    const followed = await this.queries.followedChapters(viewer.id);
    const results = await Promise.all([
      this.spotlight(viewer, now),
      this.prompt(viewer, now),
      this.newMembers(viewer, now, followed[0] ?? null),
      this.chapterHighlight(viewer, now, followed),
    ]);
    return { moments: results.filter((m): m is Moment => !!m) };
  }

  /** One member a day, picked by a hash of their id and the date so everyone sees the same person. */
  private async spotlight(viewer: AuthUser, now: Date): Promise<SpotlightMoment | null> {
    const day = utcDay(now);
    const [pick] = await this.db
      .select({
        userId: memberProfiles.userId,
        bio: memberProfiles.bio,
        sectorsVisible: sql<boolean>`${fieldVisibleToMemberSql('sectors', viewer.id)}`,
      })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(
        and(
          cardCandidateSql(viewer.id),
          eq(users.isStaff, false),
          sql`btrim(coalesce(${memberProfiles.headline}, '')) <> ''`,
          sql`btrim(coalesce(${memberProfiles.bio}, '')) <> ''`,
          fieldVisibleToMemberSql('bio', viewer.id),
          notMutedMemberSql(viewer.id),
        ),
      )
      .orderBy(sql`md5(${memberProfiles.userId}::text || ${day})`)
      .limit(1);
    if (!pick) return null;
    const id = pick.userId;
    const [cards, sectorRows, [followers], [postCount], [recent]] = await Promise.all([
      this.queries.momentMembers(viewer.id, [id]),
      pick.sectorsVisible
        ? this.db
            .select({ name: sectors.name })
            .from(profileSectors)
            .innerJoin(sectors, eq(sectors.id, profileSectors.itemId))
            .where(eq(profileSectors.userId, id))
            .orderBy(asc(sectors.position), asc(sectors.name))
        : Promise.resolve([] as { name: string }[]),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(follows)
        .where(and(eq(follows.targetType, 'member'), eq(follows.targetId, id))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(eq(posts.authorId, id), isNull(posts.pageId), isNull(posts.deletedAt), eq(posts.moderationState, 'visible'), eq(posts.status, 'published'))),
      this.db
        .select({ id: posts.id, type: posts.type, body: posts.body, details: posts.details })
        .from(posts)
        .where(and(shownPostsSql(viewer.id), eq(posts.authorId, id), isNull(posts.pageId), isNull(posts.repostOfId), sql`btrim(${posts.body}) <> ''`))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(1),
    ]);
    const card = cards.get(id);
    if (!card) return null;
    return {
      kind: 'spotlight',
      id: `spotlight:${day}`,
      member: {
        ...card,
        bio: pick.bio ? excerpt(pick.bio, BIO_MAX) : null,
        sectors: sectorRows.map((r) => r.name),
        followers: followers?.n ?? 0,
        posts: postCount?.n ?? 0,
      },
      recentPost: recent ? { id: recent.id, excerpt: postExcerpt(recent) } : null,
    };
  }

  /** Today's prompt, with today's answers (posts carrying #DailyPrompt). Left out when the viewer muted the tag. */
  private async prompt(viewer: AuthUser, now: Date): Promise<PromptMoment | null> {
    const tag = DAILY_PROMPT_TAG.toLowerCase();
    const today = startOfUtcDay(now).toISOString();
    const todays = and(hasTagSql(tag), sql`${posts.createdAt} >= ${today}::timestamptz`)!;
    const answers = and(shownPostsSql(viewer.id), todays)!;
    const [[muted], [counted], recent, [mine]] = await Promise.all([
      this.db
        .select({ x: sql`1` })
        .from(mutes)
        .where(and(eq(mutes.userId, viewer.id), eq(mutes.targetType, 'hashtag'), eq(mutes.targetId, tag)))
        .limit(1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(answers),
      this.db
        .select({ authorId: posts.authorId, last: sql<string>`max(${posts.createdAt})` })
        .from(posts)
        .where(answers)
        .groupBy(posts.authorId)
        .orderBy(sql`max(${posts.createdAt}) desc`, asc(posts.authorId))
        .limit(PROMPT_RESPONDERS),
      this.db
        .select({ x: sql`1` })
        .from(posts)
        .where(and(eq(posts.authorId, viewer.id), isNull(posts.deletedAt), todays))
        .limit(1),
    ]);
    if (muted) return null;
    const refs = await this.members.refs(recent.map((r) => r.authorId));
    const prompt = promptFor(now);
    return {
      kind: 'prompt',
      id: `prompt:${utcDay(now)}`,
      prompt: prompt.text,
      hashtag: DAILY_PROMPT_TAG,
      responses: counted?.n ?? 0,
      responders: recent.map((r) => refs.get(r.authorId)).filter((r) => !!r),
      answered: !!mine,
    };
  }

  /** Recent joiners: from the viewer's main chapter if any joined, else their country, else everyone. */
  private async newMembers(viewer: AuthUser, now: Date, chapter: ChapterRef | null): Promise<NewMembersMoment | null> {
    const cutoff = new Date(now.getTime() - NEW_MEMBER_DAYS * DAY_MS).toISOString();
    const base = and(cardCandidateSql(viewer.id), notMutedMemberSql(viewer.id), sql`${users.createdAt} > ${cutoff}::timestamptz`)!;
    const find = async (scope: SQL | undefined) => {
      const where = and(base, scope);
      const [[counted], rows] = await Promise.all([
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(memberProfiles)
          .innerJoin(users, eq(users.id, memberProfiles.userId))
          .where(where),
        this.db
          .select({ userId: memberProfiles.userId, joinedAt: users.createdAt })
          .from(memberProfiles)
          .innerJoin(users, eq(users.id, memberProfiles.userId))
          .where(where)
          .orderBy(desc(users.createdAt), asc(memberProfiles.userId))
          .limit(NEW_MEMBERS_SHOWN),
      ]);
      return { total: counted?.n ?? 0, rows };
    };

    let scope: NewMembersMoment['scope'] = { type: 'global' };
    let found: Awaited<ReturnType<typeof find>> | null = null;
    if (chapter) {
      const inChapter = await find(followsChapterSql(chapter.id));
      if (inChapter.total > 0) {
        scope = { type: 'chapter', chapter };
        found = inChapter;
      }
    }
    if (!found && viewer.countryCode) {
      const code = viewer.countryCode;
      const [country] = await this.db.select({ name: countries.name }).from(countries).where(eq(countries.code, code)).limit(1);
      if (country) {
        const inCountry = await find(and(eq(memberProfiles.countryCode, code), fieldVisibleToMemberSql('location', viewer.id)));
        if (inCountry.total > 0) {
          scope = { type: 'country', countryCode: code, countryName: country.name };
          found = inCountry;
        }
      }
    }
    found ??= await find(undefined);
    if (!found.total) return null;

    const cards = await this.queries.momentMembers(
      viewer.id,
      found.rows.map((r) => r.userId),
    );
    const members = found.rows
      .map((r) => {
        const card = cards.get(r.userId);
        return card ? { ...card, joinedAt: r.joinedAt.toISOString() } : null;
      })
      .filter((m) => !!m);
    return { kind: 'new_members', id: `new_members:${utcDay(now)}`, scope, members, total: found.total };
  }

  /** One of the viewer's chapters (rotating daily), or the busiest chapter this week when they follow none. */
  private async chapterHighlight(viewer: AuthUser, now: Date, followed: ChapterRef[]): Promise<ChapterHighlightMoment | null> {
    const weekAgo = new Date(now.getTime() - WEEK_DAYS * DAY_MS).toISOString();
    const thisWeek = and(shownPostsSql(viewer.id), sql`${posts.createdAt} > ${weekAgo}::timestamptz`)!;

    let chapter: ChapterRef | null = followed.length ? followed[utcDayNumber(now) % followed.length]! : null;
    if (!chapter) {
      const [busiest] = await this.db
        .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
        .from(posts)
        .innerJoin(chapters, eq(chapters.id, posts.chapterId))
        .where(and(thisWeek, eq(chapters.status, 'active')))
        .groupBy(chapters.id)
        .orderBy(sql`count(*) desc`, asc(chapters.slug))
        .limit(1);
      chapter = busiest ?? null;
    }
    if (!chapter) return null;

    const inChapter = and(thisWeek, eq(posts.chapterId, chapter.id))!;
    const [[members], [weekly], [top]] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(follows)
        .where(and(eq(follows.targetType, 'chapter'), eq(follows.targetId, chapter.id))),
      this.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(inChapter),
      this.db
        .select({
          id: posts.id,
          authorId: posts.authorId,
          type: posts.type,
          body: posts.body,
          details: posts.details,
          reactions: posts.reactionCount,
          comments: posts.commentCount,
        })
        .from(posts)
        .where(and(inChapter, isNull(posts.repostOfId)))
        .orderBy(desc(posts.reactionCount), desc(posts.commentCount), desc(posts.createdAt), desc(posts.id))
        .limit(1),
    ]);
    const memberCount = members?.n ?? 0;
    const postsThisWeek = weekly?.n ?? 0;
    if (!memberCount && !postsThisWeek) return null;
    const author = top ? await this.members.ref(top.authorId) : null;
    return {
      kind: 'chapter_highlight',
      id: `chapter_highlight:${utcDay(now)}`,
      chapter,
      isFollowing: followed.some((c) => c.id === chapter.id),
      members: memberCount,
      postsThisWeek,
      topPost:
        top && author
          ? { id: top.id, excerpt: postExcerpt(top), author, reactions: top.reactions, comments: top.comments }
          : null,
    };
  }
}
