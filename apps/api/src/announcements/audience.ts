import { sql, type SQL } from 'drizzle-orm';
import type { AnnouncementAudience } from '@chartermission/contracts';
import { examAttempts, follows, memberProfiles, notificationPreferences, profileSectors, roles, userRoles, users } from '../db/schema.js';

/**
 * Who a bulk message reaches, as a WHERE clause over `users` joined with `member_profiles` (use AUDIENCE_FROM).
 * Always: active or email-unconfirmed accounts that aren't suspended and aren't official accounts. Each filter
 * narrows it further; lists match any of their values.
 */
export function audienceWhere(a: AnnouncementAudience): SQL {
  const parts: SQL[] = [
    sql`${users.status} in ('active','unverified')`,
    sql`${users.isOfficial} = false`,
    sql`(${users.suspendedUntil} is null or ${users.suspendedUntil} < now())`,
  ];
  if (a.countries?.length) parts.push(sql`${memberProfiles.countryCode} in ${a.countries}`);
  if (a.chapterIds?.length) {
    // Members of a chapter are the people who joined (follow) it.
    parts.push(
      sql`exists (select 1 from ${follows} where ${follows.followerId} = ${users.id} and ${follows.targetType} = 'chapter' and ${follows.targetId} in ${a.chapterIds})`,
    );
  }
  if (a.sectorIds?.length) {
    parts.push(sql`exists (select 1 from ${profileSectors} where ${profileSectors.userId} = ${users.id} and ${profileSectors.itemId}::text in ${a.sectorIds})`);
  }
  // "Verified" is the verified tick (admin-verified members; staff show it too), as on MemberRef.
  if (a.verified === 'verified') parts.push(sql`(${users.verifiedAt} is not null or ${users.isStaff})`);
  if (a.verified === 'unverified') parts.push(sql`(${users.verifiedAt} is null and not ${users.isStaff})`);
  if (a.joinedFrom) parts.push(sql`${users.createdAt} >= (${a.joinedFrom}::date)::timestamp at time zone 'UTC'`);
  if (a.joinedTo) parts.push(sql`${users.createdAt} < (${a.joinedTo}::date + 1)::timestamp at time zone 'UTC'`);
  if (a.passedExamIds?.length) {
    parts.push(
      sql`exists (select 1 from ${examAttempts} where ${examAttempts.userId} = ${users.id} and ${examAttempts.passed} and not ${examAttempts.preview} and ${examAttempts.examId} in ${a.passedExamIds})`,
    );
  }
  // Members who never picked a language follow their browser; they count as English.
  if (a.locales?.length) parts.push(sql`coalesce(${users.locale}, 'en') in ${a.locales}`);
  if (a.ambassadorsOnly) {
    parts.push(
      sql`exists (select 1 from ${userRoles} join ${roles} on ${roles.id} = ${userRoles.roleId} where ${userRoles.userId} = ${users.id} and ${roles.key} = 'ambassador' and ${userRoles.revokedAt} is null)`,
    );
  }
  return sql.join(parts, sql` and `);
}

export const AUDIENCE_FROM = sql`${users} join ${memberProfiles} on ${memberProfiles.userId} = ${users.id}`;

/** The member turned announcement emails off (on by default). */
export const optedOutSql = sql`exists (select 1 from ${notificationPreferences} where ${notificationPreferences.userId} = ${users.id} and ${notificationPreferences.category} = 'announcements' and ${notificationPreferences.channel} = 'email' and ${notificationPreferences.enabled} = false)`;

/** Bulk email only goes to confirmed addresses. */
export const emailConfirmedSql = sql`${users.emailVerifiedAt} is not null`;
