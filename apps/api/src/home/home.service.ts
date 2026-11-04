import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { HOME_VISIT_GAP_MINUTES, NEW_MEMBER_DAYS, type WelcomeSummary } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { memberProfiles, posts, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';
import { listablePostsSql } from '../posts/visibility.js';
import { cardCandidateSql, followsChapterSql, HomeQueries } from './home-queries.js';
import { DAY_MS } from './text.js';

/** Window for the welcome strip's open questions. */
const OPEN_QUESTION_DAYS = 14;
/** Window for the welcome strip's new members and celebrations. */
const WEEK_DAYS = 7;

/** GET /home/welcome: the personal welcome strip at the top of the feed. */
@Injectable()
export class HomeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queries: HomeQueries,
  ) {}

  async welcome(viewer: AuthUser): Promise<WelcomeSummary> {
    const lastVisit = await this.recordVisit(viewer.id);
    const now = Date.now();
    const since = new Date(lastVisit?.getTime() ?? now - DAY_MS).toISOString();
    const weekAgo = new Date(now - WEEK_DAYS * DAY_MS).toISOString();
    const visible = listablePostsSql(viewer.id, { muteHashtags: true });
    const othersPublished: SQL = and(visible, ne(posts.authorId, viewer.id), eq(posts.status, 'published'), eq(posts.moderationState, 'visible'))!;
    const countPosts = async (...conds: SQL[]) => {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(...conds));
      return row?.n ?? 0;
    };

    const [[me], chapters, newPosts, openQuestions, celebrations, [posted]] = await Promise.all([
      this.db
        .select({
          name: memberProfiles.displayName,
          headline: memberProfiles.headline,
          avatarFileId: memberProfiles.avatarFileId,
          joinedAt: users.createdAt,
        })
        .from(users)
        .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(eq(users.id, viewer.id))
        .limit(1),
      this.queries.followedChapters(viewer.id),
      countPosts(othersPublished, sql`${posts.createdAt} > ${since}::timestamptz`),
      countPosts(
        othersPublished,
        eq(posts.type, 'question'),
        isNull(posts.acceptedCommentId),
        sql`${posts.createdAt} > now() - make_interval(days => ${OPEN_QUESTION_DAYS}::int)`,
      ),
      countPosts(
        visible,
        eq(posts.status, 'published'),
        eq(posts.moderationState, 'visible'),
        eq(posts.type, 'celebration'),
        sql`${posts.createdAt} > ${weekAgo}::timestamptz`,
      ),
      this.db
        .select({ x: sql`1` })
        .from(posts)
        .where(and(eq(posts.authorId, viewer.id), isNull(posts.deletedAt)))
        .limit(1),
    ]);
    if (!me) throw Errors.notFound('Profile');
    const chapter = chapters[0] ?? null;

    const [joined] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(
        and(
          cardCandidateSql(viewer.id),
          sql`${users.createdAt} > ${weekAgo}::timestamptz`,
          chapter ? followsChapterSql(chapter.id) : undefined,
        ),
      );

    let nudge: WelcomeSummary['nudge'] = null;
    if (!me.avatarFileId || !me.headline?.trim()) {
      nudge = { kind: 'complete_profile', label: 'Add a photo and headline so people recognise you', href: '/settings/profile' };
    } else if (!posted) {
      nudge = { kind: 'first_post', label: 'Share your first update', href: '/feed?compose=1' };
    } else if (!chapter) {
      nudge = { kind: 'follow_chapter', label: 'Join your chapter', href: '/chapters' };
    } else if (openQuestions > 0) {
      nudge = {
        kind: 'answer_question',
        label: openQuestions === 1 ? 'Help answer 1 open question' : `Help answer ${openQuestions} open questions`,
        href: '/feed?type=question&unanswered=true',
      };
    }

    return {
      firstName: me.name.trim().split(/\s+/)[0] ?? me.name,
      memberSince: me.joinedAt.toISOString(),
      isNewMember: now - me.joinedAt.getTime() < NEW_MEMBER_DAYS * DAY_MS,
      lastVisitAt: lastVisit?.toISOString() ?? null,
      chapter,
      stats: { newPosts, openQuestions, newMembers: joined?.n ?? 0, celebrations },
      nudge,
    };
  }

  /**
   * Records a home visit and returns the previous one. A call more than HOME_VISIT_GAP_MINUTES
   * after the current visit started begins a new visit; calls within the gap change nothing.
   * One UPDATE, so concurrent calls cannot both start a visit.
   */
  private async recordVisit(userId: string): Promise<Date | null> {
    const newVisit = sql`(${memberProfiles.homeSeenAt} is null or ${memberProfiles.homeSeenAt} < now() - make_interval(mins => ${HOME_VISIT_GAP_MINUTES}::int))`;
    const [row] = await this.db
      .update(memberProfiles)
      .set({
        homePrevSeenAt: sql`case when ${newVisit} then ${memberProfiles.homeSeenAt} else ${memberProfiles.homePrevSeenAt} end`,
        homeSeenAt: sql`case when ${newVisit} then now() else ${memberProfiles.homeSeenAt} end`,
        // A visit is not a profile edit.
        updatedAt: sql`${memberProfiles.updatedAt}`,
      })
      .where(eq(memberProfiles.userId, userId))
      .returning({ prev: memberProfiles.homePrevSeenAt });
    return row?.prev ?? null;
  }
}

