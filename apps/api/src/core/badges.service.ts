import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BadgeTone, ProfileBadge } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { badges, memberBadges } from '../db/schema.js';

/** Admin-awarded profile badges. Disabled badges are never shown. */
@Injectable()
export class BadgesService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Active badges per member, in catalogue order. */
  async forUsers(userIds: Iterable<string>): Promise<Map<string, ProfileBadge[]>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, ProfileBadge[]>(ids.map((id) => [id, []]));
    if (!ids.length) return out;
    const rows = await this.db
      .select({
        userId: memberBadges.userId,
        id: badges.id,
        slug: badges.slug,
        name: badges.name,
        description: badges.description,
        tone: badges.tone,
        icon: badges.icon,
      })
      .from(memberBadges)
      .innerJoin(badges, eq(badges.id, memberBadges.badgeId))
      .where(and(inArray(memberBadges.userId, ids), eq(badges.status, 'active')))
      .orderBy(asc(badges.position), asc(badges.name));
    for (const { userId, ...b } of rows) out.get(userId)!.push({ ...b, tone: b.tone as BadgeTone });
    return out;
  }
}
