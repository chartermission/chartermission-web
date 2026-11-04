import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { ChapterRef, MomentMember } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, follows, memberProfiles, users } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { notBlockedSql } from '../posts/visibility.js';
import { fieldVisibleToMemberSql } from '../profiles/visibility.js';

/**
 * Members who may appear on home cards (spotlight, new members, welcome stats): active,
 * not suspended, onboarding complete, discoverable, not the viewer, not blocked either way.
 * Needs `users` joined to `member_profiles`.
 */
export function cardCandidateSql(viewerId: string): SQL {
  return and(
    eq(users.status, 'active'),
    sql`(${users.suspendedUntil} is null or ${users.suspendedUntil} <= now())`,
    isNotNull(memberProfiles.onboardingCompletedAt),
    eq(memberProfiles.discoverable, true),
    ne(memberProfiles.userId, viewerId),
    notBlockedSql(viewerId, sql`${memberProfiles.userId}`),
  )!;
}

/** The member follows the chapter (follows.target_id holds the chapter id as text). */
export function followsChapterSql(chapterId: string): SQL {
  return sql`exists (select 1 from ${follows} cf where cf.follower_id = "member_profiles"."user_id" and cf.target_type = 'chapter' and cf.target_id = ${chapterId})`;
}

/** Lookups shared by the welcome strip, moment cards and the articles hub. */
@Injectable()
export class HomeQueries {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
  ) {}

  /** Chapters the viewer follows, earliest follow first (the first is their main chapter). */
  async followedChapters(viewerId: string): Promise<ChapterRef[]> {
    return this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(follows)
      .innerJoin(chapters, sql`${chapters.id}::text = ${follows.targetId}`)
      .where(and(eq(follows.followerId, viewerId), eq(follows.targetType, 'chapter')))
      .orderBy(asc(follows.createdAt), asc(chapters.slug));
  }

  /** MomentMember cards (MemberRef + follow state + country when the location is visible), in one batch. */
  async momentMembers(viewerId: string, ids: string[]): Promise<Map<string, MomentMember>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, MomentMember>();
    if (!unique.length) return out;
    const [refs, profiles, followed] = await Promise.all([
      this.members.refs(unique),
      this.db
        .select({
          userId: memberProfiles.userId,
          countryCode: memberProfiles.countryCode,
          locationVisible: sql<boolean>`${fieldVisibleToMemberSql('location', viewerId)}`,
        })
        .from(memberProfiles)
        .where(inArray(memberProfiles.userId, unique)),
      this.db
        .select({ id: follows.targetId })
        .from(follows)
        .where(and(eq(follows.followerId, viewerId), eq(follows.targetType, 'member'), inArray(follows.targetId, unique))),
    ]);
    const following = new Set(followed.map((f) => f.id));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    for (const id of unique) {
      const ref = refs.get(id);
      if (!ref) continue;
      const p = profileMap.get(id);
      out.set(id, { ...ref, isFollowing: following.has(id), countryCode: p?.locationVisible ? (p.countryCode ?? null) : null });
    }
    return out;
  }
}
