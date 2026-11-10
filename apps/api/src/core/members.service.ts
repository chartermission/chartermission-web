import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AvatarTone, MemberBadge, MemberRef } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { ambassadorLeads, chapters, countries, memberProfiles, roles, userRoles, users } from '../db/schema.js';
import { env } from '../config/env.js';

/** Public URL for a stored file, served by the media endpoint (permission-checked there). */
/**
 * Media links are root-relative (/api/v1/media/{id}): the web and admin apps both proxy /api/v1, so
 * each serves media from its own origin with its own session cookie. An absolute link on the web
 * domain would not carry the admin session, and media is only served to signed-in viewers.
 */
export function mediaUrl(fileId: string | null | undefined): string | null {
  return fileId ? `${new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '')}/media/${fileId}` : null;
}

/** The still frame of a processed video, or null. */
export function posterUrl(file: { id: string; posterKey: string | null }): string | null {
  return file.posterKey ? `${mediaUrl(file.id)}/poster` : null;
}

const TONES: AvatarTone[] = ['accent', 'success', 'info', 'warning', 'tint'];
/** Stable avatar tone per member when they have no photo. */
export function toneFor(userId: string): AvatarTone {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

/**
 * Builds MemberRef (the compact person shape) for any set of user ids, in one query.
 * Every module uses this so names, avatars and badges look the same everywhere.
 */
@Injectable()
export class MembersService {
  constructor(@InjectDb() private readonly db: Db) {}

  async refs(ids: Iterable<string>): Promise<Map<string, MemberRef>> {
    const unique = [...new Set(ids)].filter(Boolean);
    const map = new Map<string, MemberRef>();
    if (unique.length === 0) return map;
    const rows = await this.db
      .select({
        id: users.id,
        isStaff: users.isStaff,
        verifiedAt: users.verifiedAt,
        status: users.status,
        handle: memberProfiles.handle,
        name: memberProfiles.displayName,
        headline: memberProfiles.headline,
        avatarFileId: memberProfiles.avatarFileId,
        tone: memberProfiles.avatarTone,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(inArray(users.id, unique));
    const badges = await this.badges(rows.filter((r) => r.status !== 'deleted' && r.status !== 'deletion_pending').map((r) => r.id));
    for (const r of rows) {
      const gone = r.status === 'deleted' || r.status === 'deletion_pending';
      map.set(r.id, {
        id: r.id,
        handle: gone ? 'deleted-member' : r.handle,
        name: gone ? 'Former member' : r.name,
        headline: gone ? null : r.headline,
        avatarUrl: gone ? null : mediaUrl(r.avatarFileId),
        tone: (r.tone as AvatarTone) ?? toneFor(r.id),
        verified: !gone && (!!r.verifiedAt || r.isStaff),
        staff: r.isStaff,
        badge: gone ? null : (badges.get(r.id) ?? null),
      });
    }
    return map;
  }

  /**
   * Ambassador badges for these members: a live "ambassador" role (scoped to a chapter or a
   * country) is a serving Ambassador, Founding when their certified lead says so; a lead whose
   * term ended is an Alumni Ambassador. Two small indexed queries per call.
   */
  async badges(ids: string[]): Promise<Map<string, MemberBadge>> {
    const out = new Map<string, MemberBadge>();
    if (!ids.length) return out;
    const [roleRows, leadRows] = await Promise.all([
      this.db
        .select({ userId: userRoles.userId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(inArray(userRoles.userId, ids), eq(roles.key, 'ambassador'), isNull(userRoles.revokedAt))),
      this.db
        .select({ userId: ambassadorLeads.userId, stage: ambassadorLeads.stage, founding: ambassadorLeads.founding, countryCode: ambassadorLeads.countryCode })
        .from(ambassadorLeads)
        .where(and(inArray(ambassadorLeads.userId, ids), inArray(ambassadorLeads.stage, ['ambassador', 'alumni']))),
    ]);
    if (!roleRows.length && !leadRows.length) return out;
    const chapterIds = roleRows.filter((r) => r.scopeType === 'chapter' && r.scopeId).map((r) => r.scopeId!);
    const codes = [...roleRows.filter((r) => r.scopeType === 'country' && r.scopeId).map((r) => r.scopeId!), ...leadRows.map((l) => l.countryCode)];
    const [chapterRows, countryRows] = await Promise.all([
      chapterIds.length ? this.db.select({ id: chapters.id, name: chapters.name }).from(chapters).where(inArray(sql`${chapters.id}::text`, chapterIds)) : [],
      codes.length ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, [...new Set(codes)])) : [],
    ]);
    const chapterName = new Map(chapterRows.map((c) => [c.id, c.name]));
    const countryName = new Map(countryRows.map((c) => [c.code, c.name]));
    for (const r of roleRows) {
      const lead = leadRows.find((l) => l.userId === r.userId && l.stage === 'ambassador');
      const place = r.scopeType === 'chapter' ? chapterName.get(r.scopeId ?? '') : countryName.get(r.scopeId ?? '');
      const founding = !!lead?.founding;
      out.set(r.userId, {
        kind: founding ? 'founding_ambassador' : 'ambassador',
        label: founding ? 'Founding Ambassador' : 'Ambassador',
        place: place ?? (lead ? (countryName.get(lead.countryCode) ?? lead.countryCode) : 'Charter Mission'),
      });
    }
    for (const l of leadRows) {
      if (l.stage !== 'alumni' || !l.userId || out.has(l.userId)) continue;
      out.set(l.userId, { kind: 'alumni_ambassador', label: 'Alumni Ambassador', place: countryName.get(l.countryCode) ?? l.countryCode });
    }
    return out;
  }

  async ref(id: string): Promise<MemberRef | null> {
    return (await this.refs([id])).get(id) ?? null;
  }

  /** Resolve @handles to user ids (case-insensitive), skipping unknown handles. */
  async idsForHandles(handles: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (handles.length === 0) return map;
    const lower = [...new Set(handles.map((h) => h.toLowerCase()))];
    const rows = await this.db
      .select({ userId: memberProfiles.userId, handle: memberProfiles.handle })
      .from(memberProfiles)
      .where(inArray(sql`lower(${memberProfiles.handle})`, lower));
    for (const r of rows) map.set(r.handle.toLowerCase(), r.userId);
    return map;
  }
}
