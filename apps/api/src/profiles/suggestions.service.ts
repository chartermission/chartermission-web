import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ProfileField, SuggestedMember } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  chapters,
  connections,
  countries,
  featuredMembers,
  follows,
  interests,
  memberProfiles,
  profileInterests,
  profileSectors,
  profileSkills,
  sectors,
  skills,
  users,
} from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { fieldVisibleToMemberSql } from './visibility.js';

/** featured = members an admin picked to be suggested to new members (featured_members). */
export type SuggestionReason = 'featured' | 'country' | 'sector' | 'skill' | 'interest' | 'chapter';

const JOINS = {
  sector: { join: profileSectors, item: sectors, field: 'sectors', label: (n: string) => `Also works in ${n}` },
  skill: { join: profileSkills, item: skills, field: 'skills', label: (n: string) => `Also skilled in ${n}` },
  interest: { join: profileInterests, item: interests, field: 'interests', label: (n: string) => `Also interested in ${n}` },
} as const;

/**
 * Rule-based member suggestions (CM-DSH-03): shared country, sector, skill, interest or
 * chapter, each labelled with its reason; no opaque models. A reason is only used when the
 * candidate's field is visible to the viewer, so suggestions never reveal hidden fields.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly relations: RelationsService,
    private readonly members: MembersService,
  ) {}

  async suggest(
    userId: string,
    opts: { reasons: SuggestionReason[]; limit: number; excludeConnected: boolean },
  ): Promise<SuggestedMember[]> {
    const found = new Map<string, string>();
    for (const reason of opts.reasons) {
      if (found.size >= opts.limit) break;
      const rows = await this.byReason(userId, reason, opts.limit * 2, opts.excludeConnected);
      for (const r of rows) {
        if (found.size >= opts.limit) break;
        if (!found.has(r.userId)) found.set(r.userId, r.reason);
      }
    }
    const refs = await this.members.refs([...found.keys(), userId]);
    // Official accounts are follow-only, whichever side they are on.
    const viewerIsStaff = !!refs.get(userId)?.staff;
    return [...found]
      .filter(([id]) => refs.has(id))
      .map(([id, reason]) => ({ ...refs.get(id)!, reason, canConnect: !viewerIsStaff && !refs.get(id)!.staff }));
  }

  /** Candidate rules shared by every reason: active, discoverable, not self, not blocked, not followed. */
  private candidate(userId: string, excludeConnected: boolean): SQL {
    return and(
      eq(users.status, 'active'),
      eq(memberProfiles.discoverable, true),
      ne(memberProfiles.userId, userId),
      this.relations.notBlockedSql(userId, memberProfiles.userId),
      sql`not exists (select 1 from ${follows} f where f.follower_id = ${userId} and f.target_type = 'member' and f.target_id = ${memberProfiles.userId}::text)`,
      excludeConnected
        ? sql`not exists (select 1 from ${connections} c where c.status in ('pending', 'accepted') and ((c.requester_id = ${userId} and c.addressee_id = ${memberProfiles.userId}) or (c.addressee_id = ${userId} and c.requester_id = ${memberProfiles.userId})))`
        : undefined,
    )!;
  }

  private async byReason(
    userId: string,
    reason: SuggestionReason,
    limit: number,
    excludeConnected: boolean,
  ): Promise<{ userId: string; reason: string }[]> {
    const base = this.candidate(userId, excludeConnected);
    const visible = (f: ProfileField) => fieldVisibleToMemberSql(f, userId);

    if (reason === 'featured') {
      const rows = await this.db
        .select({ userId: memberProfiles.userId })
        .from(featuredMembers)
        .innerJoin(memberProfiles, eq(memberProfiles.userId, featuredMembers.userId))
        .innerJoin(users, eq(users.id, memberProfiles.userId))
        .where(base)
        .orderBy(asc(featuredMembers.createdAt))
        .limit(limit);
      return rows.map((r) => ({ userId: r.userId, reason: 'Recommended by Charter Mission' }));
    }

    if (reason === 'country') {
      const mine = alias(memberProfiles, 'mine');
      const rows = await this.db
        .select({ userId: memberProfiles.userId, name: countries.name })
        .from(memberProfiles)
        .innerJoin(users, eq(users.id, memberProfiles.userId))
        .innerJoin(mine, and(eq(mine.userId, userId), eq(mine.countryCode, memberProfiles.countryCode)))
        .innerJoin(countries, eq(countries.code, memberProfiles.countryCode))
        .where(and(base, visible('location')))
        .orderBy(desc(users.createdAt))
        .limit(limit);
      return rows.map((r) => ({ userId: r.userId, reason: `Also in ${r.name}` }));
    }

    if (reason === 'chapter') {
      const mine = alias(follows, 'mine');
      const rows = await this.db
        .selectDistinctOn([memberProfiles.userId], { userId: memberProfiles.userId, name: chapters.name })
        .from(follows)
        .innerJoin(
          mine,
          and(
            eq(mine.followerId, userId),
            eq(mine.targetType, 'chapter'),
            eq(mine.targetId, follows.targetId),
          ),
        )
        .innerJoin(memberProfiles, sql`${memberProfiles.userId} = ${follows.followerId}`)
        .innerJoin(users, eq(users.id, memberProfiles.userId))
        .innerJoin(chapters, sql`${chapters.id}::text = ${follows.targetId}`)
        .where(and(eq(follows.targetType, 'chapter'), base))
        .orderBy(memberProfiles.userId)
        .limit(limit);
      return rows.map((r) => ({ userId: r.userId, reason: `Also follows ${r.name}` }));
    }

    const spec = JOINS[reason];
    const mine = alias(spec.join, 'mine');
    const theirs = alias(spec.join, 'theirs');
    const rows = await this.db
      .selectDistinctOn([memberProfiles.userId], { userId: memberProfiles.userId, name: spec.item.name })
      .from(mine)
      .innerJoin(theirs, eq(theirs.itemId, mine.itemId))
      .innerJoin(spec.item, eq(spec.item.id, mine.itemId))
      .innerJoin(memberProfiles, eq(memberProfiles.userId, theirs.userId))
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(and(eq(mine.userId, userId), base, visible(spec.field)))
      .orderBy(memberProfiles.userId)
      .limit(limit);
    return rows.map((r) => ({ userId: r.userId, reason: spec.label(r.name) }));
  }
}
