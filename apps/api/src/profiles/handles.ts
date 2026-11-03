import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { memberProfiles } from '../db/schema.js';

/** Handles that would collide with routes or impersonate the platform. */
export const RESERVED_HANDLES = new Set([
  'me',
  'admin',
  'administrator',
  'api',
  'suggestions',
  'settings',
  'support',
  'help',
  'moderator',
  'staff',
  'system',
  'root',
  'null',
  'undefined',
  'charter-mission',
  'chartermission',
  'official',
  'deleted-member',
]);

const MAX = 30;

/** "Amara Okafor" → "amara-okafor" (ASCII, 3–30 chars, matches UpdateProfileInput.handle). */
export function slugifyName(name: string): string {
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/g, '');
  if (base.length < 3) base = base ? `${base}-member` : 'member';
  return base;
}

function withSuffix(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
}

/** Unique handle derived from the display name: amara-okafor, amara-okafor-2, ... */
@Injectable()
export class HandleService {
  constructor(@InjectDb() private readonly db: Db) {}

  async derive(name: string, tx?: Tx): Promise<string> {
    const base = slugifyName(name);
    const db = tx ?? this.db;
    const prefix = base.slice(0, MAX - 4).replace(/-+$/g, '');
    const rows = await db
      .select({ handle: memberProfiles.handle })
      .from(memberProfiles)
      .where(sql`lower(${memberProfiles.handle}) like ${`${prefix.replace(/[\\%_]/g, '\\$&')}%`}`);
    const taken = new Set(rows.map((r) => r.handle.toLowerCase()));
    for (let n = 1; n < 10_000; n++) {
      const candidate = withSuffix(base, n);
      if (!taken.has(candidate) && !RESERVED_HANDLES.has(candidate)) return candidate;
    }
    return withSuffix(base, Date.now() % 1_000_000);
  }
}
