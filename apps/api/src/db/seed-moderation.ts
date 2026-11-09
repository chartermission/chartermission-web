import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';
import { storeDemoImage } from './seed-content.js';

/*
 * Moderation demo data: a spam account ("Easy Profits Hub") with a reported post, comment, story and
 * profile, so the Moderator's queue has work in it. Priorities follow the app's rules: scam and
 * harassment are high, spam and impersonation medium. Skipped if any report already exists.
 */

const H = 3600_000;

export async function seedModeration(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.contentReports.id }).from(s.contentReports).limit(1);
  if (existing) return;
  const id = (k: string) => ctx.ids[k];
  const spammer = id('spammer');
  if (!spammer || !id('kwame') || !id('leila') || !id('amara') || !id('wanjiru') || !id('owais')) return;
  const now = Date.now();
  const at = (ago: number) => new Date(now - ago);

  const [scamPost] = await db
    .insert(s.posts)
    .values({
      authorId: spammer,
      body: 'Make $500 a day from home with our crypto signals!!! Guaranteed returns, no risk. Send 50 USDT to join the VIP group, link in bio. #AfricanTech #Investing',
      countryCode: 'NG',
      createdAt: at(5 * H),
    })
    .returning({ id: s.posts.id });

  const [amaraPost] = await db
    .select({ id: s.posts.id })
    .from(s.posts)
    .where(eq(s.posts.authorId, id('amara')!))
    .limit(1);
  let rudeComment: string | null = null;
  if (amaraPost) {
    const [c] = await db
      .insert(s.comments)
      .values({
        postId: amaraPost.id,
        authorId: spammer,
        body: 'Nobody cares about your farmers. Stop wasting everyone’s time and join my VIP group instead.',
        createdAt: at(4 * H),
      })
      .returning({ id: s.comments.id });
    rudeComment = c!.id;
    await db.update(s.posts).set({ commentCount: (await db.$count(s.comments, eq(s.comments.postId, amaraPost.id))) }).where(eq(s.posts.id, amaraPost.id));
  }

  let scamStory: string | null = null;
  const fileId = await storeDemoImage(db, spammer, 'story_image', 'DM me for guaranteed returns', { width: 1080, height: 1920, colors: ['#7a1f1f', '#e85e5e'] });
  if (fileId) {
    const createdAt = at(2 * H);
    const [st] = await db
      .insert(s.stories)
      .values({ authorId: spammer, fileId, caption: 'DM me for guaranteed returns. Limited slots!', createdAt, expiresAt: new Date(createdAt.getTime() + 24 * H) })
      .returning({ id: s.stories.id });
    scamStory = st!.id;
  }

  const reports: (typeof s.contentReports.$inferInsert)[] = [
    { reporterId: id('kwame')!, targetType: 'post', targetId: scamPost!.id, targetUserId: spammer, reasonCode: 'scam', detail: 'Asking people to send crypto for "guaranteed returns".', priority: 'high', createdAt: at(4 * H) },
    { reporterId: id('leila')!, targetType: 'post', targetId: scamPost!.id, targetUserId: spammer, reasonCode: 'spam', priority: 'high', createdAt: at(3 * H) },
    { reporterId: id('owais')!, targetType: 'member', targetId: spammer, targetUserId: spammer, reasonCode: 'impersonation', detail: 'Uses a fake “Charter Mission partner” claim in DMs.', priority: 'medium', createdAt: at(1 * H) },
  ];
  if (rudeComment) {
    reports.push({ reporterId: id('amara')!, targetType: 'comment', targetId: rudeComment, targetUserId: spammer, reasonCode: 'harassment', priority: 'high', createdAt: at(3 * H) });
  }
  if (scamStory) {
    reports.push({ reporterId: id('wanjiru')!, targetType: 'story', targetId: scamStory, targetUserId: spammer, reasonCode: 'scam', priority: 'high', createdAt: at(90 * 60_000) });
  }
  await db.insert(s.contentReports).values(reports);
}
