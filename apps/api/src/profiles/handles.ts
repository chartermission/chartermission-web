import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { handleHistory, memberProfiles } from '../db/schema.js';

/**
 * Usernames nobody can take. A profile lives at chartermission.com/{username}, so every first
 * path segment the site uses, or may come to use, is kept back, along with names that would pass
 * for the platform itself. When a new top-level page is added to the web app, add its name here.
 */
export const RESERVED_HANDLES = new Set([
  // Pages of the web app today
  'ambassadors', 'analytics', 'appeals', 'articles', 'bookmarks', 'chapters', 'drafts', 'events', 'exams', 'feed', 'initiatives',
  'learning', 'members', 'network', 'nominate', 'notifications', 'onboarding', 'opportunities', 'pages', 'posts', 'search',
  'settings', 'stories', 'topics', 'check-email', 'forgot-password', 'guidelines', 'policies', 'privacy', 'reset-password',
  'sign-in', 'signin', 'signup', 'terms', 'verify-email', 'brand', 'api', 'sso',
  // Likely future pages and technical paths
  'about', 'account', 'accounts', 'app', 'apps', 'assets', 'auth', 'billing', 'blog', 'careers', 'cdn', 'chat', 'community',
  'contact', 'courses', 'dashboard', 'discover', 'docs', 'donate', 'download', 'email', 'explore', 'faq', 'favicon', 'files',
  'fonts', 'forum', 'groups', 'home', 'images', 'img', 'inbox', 'index', 'invite', 'jobs', 'join', 'legal', 'login', 'logout',
  'mail', 'manifest', 'media', 'messages', 'mobile', 'new', 'news', 'partners', 'people', 'press', 'pricing', 'profile',
  'public', 'register', 'robots', 'rss', 'security', 'shop', 'sitemap', 'static', 'status', 'store', 'team', 'uploads',
  'user', 'users', 'verify', 'www',
  // Names that would pass for the platform or its people
  'me', 'admin', 'administrator', 'suggestions', 'support', 'help', 'moderator', 'moderators', 'staff', 'system', 'root',
  'null', 'undefined', 'charter-mission', 'chartermission', 'charter-center', 'chartercenter', 'official', 'deleted-member',
]);

const MAX = 30;

/** A member can change their username once in this many days. */
export const HANDLE_CHANGE_DAYS = 30;
/** A username someone gave up stays reserved for them (and keeps redirecting) this long. */
export const HANDLE_HOLD_DAYS = 180;

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
    const old = await db
      .select({ handle: handleHistory.handle })
      .from(handleHistory)
      .where(sql`lower(${handleHistory.handle}) like ${`${prefix.replace(/[\\%_]/g, '\\$&')}%`}`);
    const taken = new Set([...rows, ...old].map((r) => r.handle.toLowerCase()));
    for (let n = 1; n < 10_000; n++) {
      const candidate = withSuffix(base, n);
      if (!taken.has(candidate) && !RESERVED_HANDLES.has(candidate)) return candidate;
    }
    return withSuffix(base, Date.now() % 1_000_000);
  }
}
