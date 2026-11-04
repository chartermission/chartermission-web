import { eq } from 'drizzle-orm';
import { resetDatabase, seedReference } from '../../src/db/seed.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { attachHashtags } from '../../src/posts/hashtags.js';
import { parseHashtags } from '../../src/posts/text-parse.js';
import { s, type TestApp } from '../helpers.js';

export const H = 3600_000;
export const DAY = 24 * H;

/** Empty the database between tests: home cards count everything in the network. */
export async function freshDb(t: TestApp) {
  await resetDatabase(t.db);
  await seedReference(t.db);
  t.app.get(SettingsService).clearCache();
}

/** Update a member's profile row (headline, bio, avatar, visit times …). */
export async function setProfile(t: TestApp, userId: string, set: Partial<typeof s.memberProfiles.$inferInsert>) {
  await t.db.update(s.memberProfiles).set(set).where(eq(s.memberProfiles.userId, userId));
}

/** Move a member's join date into the past. */
export async function joinedDaysAgo(t: TestApp, userId: string, days: number) {
  await t.db
    .update(s.users)
    .set({ createdAt: new Date(Date.now() - days * DAY) })
    .where(eq(s.users.id, userId));
}

export async function chapterId(t: TestApp, slug: string) {
  const [row] = await t.db.select({ id: s.chapters.id }).from(s.chapters).where(eq(s.chapters.slug, slug));
  return row!.id;
}

export async function followChapter(t: TestApp, userId: string, slug: string, createdAt = new Date()) {
  await t.db.insert(s.follows).values({ followerId: userId, targetType: 'chapter', targetId: await chapterId(t, slug), createdAt });
}

/** Insert a post directly (any type, time, chapter and counts). */
export async function addPost(
  t: TestApp,
  authorId: string,
  body: string,
  opts: {
    type?: 'standard' | 'question' | 'celebration' | 'request' | 'article';
    details?: Record<string, unknown>;
    ago?: number;
    chapterId?: string | null;
    reactions?: number;
    comments?: number;
    moderationState?: 'visible' | 'hidden' | 'removed';
  } = {},
) {
  const [p] = await t.db
    .insert(s.posts)
    .values({
      authorId,
      body,
      type: opts.type ?? 'standard',
      details: opts.details ?? null,
      chapterId: opts.chapterId ?? null,
      reactionCount: opts.reactions ?? 0,
      likeCount: opts.reactions ?? 0,
      commentCount: opts.comments ?? 0,
      moderationState: opts.moderationState ?? 'visible',
      createdAt: new Date(Date.now() - (opts.ago ?? 0)),
    })
    .returning();
  await attachHashtags(t.db, p!.id, parseHashtags(body));
  return p!;
}

export const ARTICLE_BODY = 'Rules of origin decide whether a product qualifies for AfCFTA preferences. '.repeat(8).trim();

export function addArticle(
  t: TestApp,
  authorId: string,
  title: string,
  opts: { tags?: string[]; ago?: number; reactions?: number; comments?: number } = {},
) {
  const tags = (opts.tags ?? []).map((tag) => `#${tag}`).join(' ');
  return addPost(t, authorId, `${ARTICLE_BODY}\n\n${tags}`, {
    type: 'article',
    // ArticleDetails needs a title of 5+ characters.
    details: { title: title.length < 5 ? `${title} article` : title },
    ago: opts.ago,
    reactions: opts.reactions,
    comments: opts.comments,
  });
}

export async function block(t: TestApp, blockerId: string, blockedId: string) {
  await t.db.insert(s.blocks).values({ blockerId, blockedId });
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Milliseconds since midnight UTC, to place posts "earlier today" safely. */
export function sinceMidnight() {
  const now = new Date();
  return now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

