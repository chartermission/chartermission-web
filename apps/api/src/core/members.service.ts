import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import type { AvatarTone, MemberRef } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { memberProfiles, users } from '../db/schema.js';
import { env } from '../config/env.js';

/** Public URL for a stored file, served by the media endpoint (permission-checked there). */
export function mediaUrl(fileId: string | null | undefined): string | null {
  return fileId ? `${env().API_PUBLIC_URL.replace(/\/$/, '')}/media/${fileId}` : null;
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
      });
    }
    return map;
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
