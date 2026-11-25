import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Demo data for the deeper notifications (development seed only, never the production bootstrap): profile views of
 * Owais and Amara over the last weeks (named viewers and one in private mode), search appearances, and the
 * notifications that go with them (who viewed your profile, a post milestone, a followers milestone).
 */

const DAY = 86_400_000;
const dayOf = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const at = (daysAgo: number, hours = 0) => new Date(Date.now() - daysAgo * DAY - hours * 3_600_000);

/** Who viewed whose profile, and when (days ago). */
const VIEWS: { profile: string; viewer: string; days: number[]; private?: { kind: 'company' | 'chapter' | 'member'; name: string | null } }[] = [
  { profile: 'owais', viewer: 'amara', days: [0, 3, 12] },
  { profile: 'owais', viewer: 'kwame', days: [0, 20] },
  { profile: 'owais', viewer: 'wanjiru', days: [1] },
  { profile: 'owais', viewer: 'leila', days: [5, 41] },
  { profile: 'owais', viewer: 'thabo', days: [0], private: { kind: 'company', name: 'PayBridge' } },
  { profile: 'owais', viewer: 'fatou', days: [9], private: { kind: 'chapter', name: 'Senegal Chapter' } },
  { profile: 'amara', viewer: 'kwame', days: [0, 2] },
  { profile: 'amara', viewer: 'owais', days: [1] },
  { profile: 'amara', viewer: 'zainab', days: [4] },
];

export async function seedNotificationDepth(db: Db, ctx: SeedContext) {
  const id = (key: string) => ctx.ids[key];
  for (const v of VIEWS) {
    const profileId = id(v.profile);
    const viewerId = id(v.viewer);
    if (!profileId || !viewerId) continue;
    for (const d of v.days) {
      await db
        .insert(s.profileViews)
        .values({ profileId, viewerId, day: dayOf(d), viewedAt: at(d, 2), private: !!v.private, anonKind: v.private?.kind ?? null, anonName: v.private?.name ?? null })
        .onConflictDoNothing();
    }
  }
  for (const key of ['owais', 'amara']) {
    const userId = id(key);
    if (!userId) continue;
    for (let d = 0; d < 14; d++) {
      await db.insert(s.searchAppearances).values({ userId, day: dayOf(d), count: (d * 7 + key.length) % 9 }).onConflictDoNothing();
    }
  }

  const owais = id('owais');
  if (!owais) return;
  // Seeded once: a second run of the seed adds no more notifications.
  const [done] = await db
    .select({ id: s.notifications.id })
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, owais), eq(s.notifications.dedupeKey, 'follower_milestone:10')))
    .limit(1);
  if (done) return;
  const today = dayOf(0);
  await db
    .insert(s.notifications)
    .values({
      userId: owais,
      type: 'profile_viewed',
      category: 'profile',
      actorIds: [id('amara'), id('kwame')].filter((x): x is string => !!x),
      actorCount: 3,
      objectType: 'member',
      objectId: owais,
      data: { segments: [{ text: ' viewed your profile', strong: false }], href: '/profile-views', icon: 'eye' },
      dedupeKey: `profile_viewed:${today}`,
    });
  const [post] = await db
    .select({ id: s.posts.id, body: s.posts.body })
    .from(s.posts)
    .where(and(eq(s.posts.authorId, owais), isNull(s.posts.repostOfId), isNull(s.posts.deletedAt)))
    .orderBy(desc(s.posts.createdAt))
    .limit(1);
  if (post) {
    await db.insert(s.milestonesReached).values({ subjectType: 'post', subjectId: post.id, metric: 'impressions', threshold: 100 }).onConflictDoNothing();
    const excerpt = post.body.replace(/\s+/g, ' ').trim().slice(0, 79);
    await db.insert(s.notifications).values({
      userId: owais,
      type: 'post_milestone',
      category: 'post_performance',
      objectType: 'post',
      objectId: post.id,
      data: {
        segments: [
          { text: 'Your post is doing well: ', strong: false },
          { text: '100', strong: true },
          { text: ' impressions', strong: false },
          ...(excerpt ? [{ text: ` “${excerpt}”`, strong: false }] : []),
        ],
        href: `/posts/${post.id}/analytics`,
        icon: 'chart',
      },
      dedupeKey: `post_milestone:${post.id}:impressions:100`,
      createdAt: at(0, 5),
      updatedAt: at(0, 5),
    });
  }
  await db.insert(s.milestonesReached).values({ subjectType: 'member', subjectId: owais, metric: 'followers', threshold: 10 }).onConflictDoNothing();
  await db.insert(s.notifications).values({
    userId: owais,
    type: 'follower_milestone',
    category: 'follows',
    objectType: 'member',
    objectId: owais,
    data: {
      segments: [
        { text: 'You reached a milestone: ', strong: false },
        { text: '10', strong: true },
        { text: ' followers', strong: false },
      ],
      href: '/owais-iqbal',
      icon: 'users',
    },
    dedupeKey: 'follower_milestone:10',
    createdAt: at(1, 3),
    updatedAt: at(1, 3),
  });
}
