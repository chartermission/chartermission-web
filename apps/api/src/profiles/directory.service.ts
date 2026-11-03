import { Injectable } from '@nestjs/common';
import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { DirectoryMember, DirectoryQuery, Page } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { countries, memberProfiles, profileSectors, profileSkills, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { RelationshipService } from './relationship.service.js';
import { TaxonomyService } from './taxonomy.service.js';
import { fieldVisibleToMemberSql } from './visibility.js';

const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');

/**
 * Member directory (CM-NET-01/02). Only discoverable, active members. Every filter on a
 * visibility-controlled field is ANDed with that field's visibility for the viewer, inside
 * the query, so hidden values never produce a match (spec 4.3 acceptance, 4.14 rules).
 */
@Injectable()
export class DirectoryService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly relations: RelationsService,
    private readonly relationships: RelationshipService,
    private readonly members: MembersService,
    private readonly taxonomy: TaxonomyService,
    private readonly limits: RateLimitService,
  ) {}

  async search(ctx: AuthContext, query: DirectoryQuery): Promise<Page<DirectoryMember>> {
    const viewerId = ctx.user.id;
    await this.limits.consume(`directory:${viewerId}`, 60, 60);

    const conditions: (SQL | undefined)[] = [
      eq(users.status, 'active'),
      eq(memberProfiles.discoverable, true),
      ne(memberProfiles.userId, viewerId),
      this.relations.notBlockedSql(viewerId, memberProfiles.userId),
    ];

    const q = query.q?.trim();
    let score: SQL | undefined;
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const orgVisible = fieldVisibleToMemberSql('organisation', viewerId);
      // Name and headline are always visible to members; organisation only when its visibility allows.
      conditions.push(sql`(
        ${q} <% ${memberProfiles.displayName}
        or ${memberProfiles.displayName} % ${q}
        or ${memberProfiles.displayName} ilike ${like}
        or ${memberProfiles.headline} ilike ${like}
        or (${memberProfiles.organisation} ilike ${like} and ${orgVisible})
      )`);
      score = sql`round(greatest(
        word_similarity(${q}, ${memberProfiles.displayName}),
        similarity(${memberProfiles.displayName}, ${q}),
        case when ${memberProfiles.displayName} ilike ${like} then 0.9 else 0 end,
        case when ${memberProfiles.headline} ilike ${like} then 0.5 else 0 end,
        case when ${memberProfiles.organisation} ilike ${like} and ${orgVisible} then 0.4 else 0 end
      )::numeric, 4)`;
    }
    if (query.country) {
      conditions.push(
        and(eq(memberProfiles.countryCode, query.country.toUpperCase()), fieldVisibleToMemberSql('location', viewerId)),
      );
    }
    for (const [kind, value, join] of [
      ['sectors', query.sector, profileSectors],
      ['skills', query.skill, profileSkills],
    ] as const) {
      if (!value) continue;
      const id = await this.taxonomy.resolve(kind, value);
      if (!id) return { items: [], nextCursor: null };
      conditions.push(
        sql`exists (select 1 from ${join} j where j.user_id = ${memberProfiles.userId} and j.item_id = ${id})`,
        fieldVisibleToMemberSql(kind, viewerId),
      );
    }

    const sort = query.sort === 'relevance' && !score ? 'recent' : query.sort;
    const cursor = decodeCursor<{ k: string; id: string }>(query.cursor);
    let sortKey: SQL;
    let order: SQL;
    if (sort === 'relevance') {
      sortKey = sql`${score!}::text`;
      order = sql`${score!} desc, ${memberProfiles.userId} asc`;
      if (cursor) conditions.push(sql`(${score!} < ${cursor.k}::numeric or (${score!} = ${cursor.k}::numeric and ${memberProfiles.userId} > ${cursor.id}::uuid))`);
    } else if (sort === 'name') {
      sortKey = sql`lower(${memberProfiles.displayName})`;
      order = sql`lower(${memberProfiles.displayName}) asc, ${memberProfiles.userId} asc`;
      if (cursor) conditions.push(sql`(lower(${memberProfiles.displayName}), ${memberProfiles.userId}) > (${cursor.k}, ${cursor.id}::uuid)`);
    } else {
      sortKey = sql`${users.createdAt}::text`;
      order = sql`${users.createdAt} desc, ${memberProfiles.userId} desc`;
      if (cursor) conditions.push(sql`(${users.createdAt}, ${memberProfiles.userId}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`);
    }

    const rows = await this.db
      .select({
        userId: memberProfiles.userId,
        sortKey: sql<string>`${sortKey}`,
        city: memberProfiles.city,
        countryName: countries.name,
        locationVisible: sql<boolean>`${fieldVisibleToMemberSql('location', viewerId)}`,
      })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .leftJoin(countries, eq(countries.code, memberProfiles.countryCode))
      .where(and(...conditions))
      .orderBy(order)
      .limit(query.limit + 1);
    const page = paginate(rows, query.limit, (r) => ({ k: r.sortKey, id: r.userId }));
    const ids = page.items.map((r) => r.userId);
    const [refs, rels, mutual] = await Promise.all([
      this.members.refs(ids),
      this.relationships.many(viewerId, ids),
      this.relationships.mutualCounts(viewerId, ids),
    ]);
    const items: DirectoryMember[] = [];
    for (const r of page.items) {
      const ref = refs.get(r.userId);
      if (!ref) continue;
      const location = r.locationVisible ? [r.city, r.countryName].filter(Boolean).join(', ') || null : null;
      items.push({ ...ref, location, mutualConnections: mutual.get(r.userId) ?? 0, relationship: rels.get(r.userId)! });
    }
    return { items, nextCursor: page.nextCursor };
  }
}
