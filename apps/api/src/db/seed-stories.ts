import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';
import { storeDemoImage } from './seed-content.js';

/*
 * Stories and highlights demo data. Live stories (under 24 hours old) fill the feed strip for members
 * who follow or are connected to their authors (Owais follows Amara, Kwame, Wanjiru and Leila);
 * older ones sit in highlights on Amara's and Kwame's profiles, and one is only in Amara's archive.
 * Skipped if any story already exists (use db:reset to start over).
 */

const H = 3600_000;
const D = 24 * H;

type SeedStory = {
  who: string;
  caption: string;
  ago: number;
  colors: [string, string];
  /** Members who have already viewed it. */
  views?: string[];
  highlight?: string;
};

const STORIES: SeedStory[] = [
  { who: 'amara', caption: 'Cold room number three is live in Ikorodu', ago: 3 * H, colors: ['#1f6f50', '#8fd1a5'], views: ['owais', 'kwame', 'tunde'] },
  { who: 'amara', caption: 'Farmers queueing for the first pickup', ago: 1 * H, colors: ['#2d5a27', '#c9e4a4'] },
  { who: 'kwame', caption: 'PayBridge team offsite in Accra', ago: 5 * H, colors: ['#244c8f', '#8fb4e8'], views: ['owais'] },
  { who: 'wanjiru', caption: 'Hackathon venue check in Westlands', ago: 8 * H, colors: ['#7a4b12', '#e8b75e'] },
  { who: 'wanjiru', caption: 'Still looking for 3 mentors for 28 November', ago: 7 * H, colors: ['#8a3b12', '#f2a65a'] },
  { who: 'leila', caption: 'Rules of origin checklist, step one', ago: 12 * H, colors: ['#3b2d7a', '#a99be8'] },
  { who: 'fatou', caption: 'Office hours tomorrow, 10:00 Dakar time', ago: 2 * H, colors: ['#5b2d7a', '#d29be8'] },
  { who: 'kofi', caption: 'Mini-grid site visit in Ashanti', ago: 4 * H, colors: ['#5a4a12', '#e8d25e'] },
  // Expired: kept by highlights.
  { who: 'amara', caption: 'October meetup: 120 founders in Yaba', ago: 12 * D, colors: ['#1f6f50', '#5fb38a'], highlight: 'Lagos meetups' },
  { who: 'amara', caption: 'Panel on cold-chain financing', ago: 15 * D, colors: ['#17503a', '#7cc49c'], highlight: 'Lagos meetups' },
  { who: 'amara', caption: 'Thank you, volunteers', ago: 18 * D, colors: ['#0f3d2c', '#6aa98a'], highlight: 'Lagos meetups' },
  { who: 'kwame', caption: 'PayBridge goes live in Côte d’Ivoire', ago: 9 * D, colors: ['#1d3c73', '#7fa6e0'], highlight: 'PayBridge launch' },
  { who: 'kwame', caption: 'First cross-border settlement: 6 minutes', ago: 10 * D, colors: ['#152d57', '#6f95d1'], highlight: 'PayBridge launch' },
  // Expired, in Amara's archive only (for building a new highlight).
  { who: 'amara', caption: 'Packing day for the Accra trade fair', ago: 4 * D, colors: ['#2a6d4f', '#a3d9b9'] },
];

export async function seedStories(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.stories.id }).from(s.stories).limit(1);
  if (existing) return;
  const now = Date.now();
  const highlightIds = new Map<string, string>();
  const highlightCount = new Map<string, number>();

  for (const st of [...STORIES].sort((a, b) => b.ago - a.ago)) {
    const authorId = ctx.ids[st.who];
    if (!authorId) continue;
    const fileId = await storeDemoImage(db, authorId, 'story_image', st.caption, { width: 1080, height: 1920, colors: st.colors });
    if (!fileId) continue;
    const createdAt = new Date(now - st.ago);
    const viewers = (st.views ?? []).map((k) => ctx.ids[k]).filter((x): x is string => !!x);
    const [story] = await db
      .insert(s.stories)
      .values({ authorId, fileId, caption: st.caption, expiresAt: new Date(createdAt.getTime() + D), viewCount: viewers.length, createdAt, updatedAt: createdAt })
      .returning({ id: s.stories.id });
    if (viewers.length) {
      await db
        .insert(s.storyViews)
        .values(viewers.map((viewerId, i) => ({ storyId: story!.id, viewerId, viewedAt: new Date(createdAt.getTime() + (i + 1) * 10 * 60_000) })))
        .onConflictDoNothing();
    }
    if (st.highlight) {
      const key = `${st.who}:${st.highlight}`;
      let highlightId = highlightIds.get(key);
      if (!highlightId) {
        const [{ n }] = (await db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.storyHighlights)
          .where(eq(s.storyHighlights.ownerId, authorId))) as [{ n: number }];
        const [h] = await db
          .insert(s.storyHighlights)
          .values({ ownerId: authorId, title: st.highlight, position: n, createdAt, updatedAt: createdAt })
          .returning({ id: s.storyHighlights.id });
        highlightId = h!.id;
        highlightIds.set(key, highlightId);
      }
      const position = highlightCount.get(key) ?? 0;
      highlightCount.set(key, position + 1);
      await db.insert(s.storyHighlightItems).values({ highlightId, storyId: story!.id, position, createdAt });
    }
  }
}
