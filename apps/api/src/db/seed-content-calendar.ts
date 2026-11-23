import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Content calendar demo data (dev seed only): posts three demo members wrote and scheduled with
 * Claude this month: some published, some scheduled in the coming days, one held by the moderator,
 * one post and one scheduled post waiting for approval, with the matching Claude activity rows.
 * Skipped once any post or draft written with Claude exists.
 */

const H = 3600_000;
const D = 24 * H;
const CLIENT = 'Claude';

type DraftSeed = { author: string; body: string; inDays: number; at: number; status?: 'scheduled' | 'held'; review?: 'pending'; type?: 'standard' | 'question' };
type PostSeed = { author: string; body: string; daysAgo: number; status?: 'published' | 'awaiting_approval'; type?: 'standard' | 'question' };

const POSTS: PostSeed[] = [
  { author: 'amara', body: 'Harvest update from Lagos AgriHub: our new cold room in Ikorodu cut tomato losses by a third this month. Thank you to the 300 farmers who trusted us with their crops. #AgriTech #FoodSecurity', daysAgo: 6 },
  { author: 'amara', body: 'Question for exporters: which documents slowed down your last shipment to Accra under AfCFTA? I am collecting the real bottlenecks before our webinar next week.', daysAgo: 2, type: 'question' },
  { author: 'kwame', body: 'PayBridge now settles cedi-to-naira payments for small exporters in under two hours. If you trade between Ghana and Nigeria, I would love your feedback on the beta. #Fintech', daysAgo: 4 },
  { author: 'leila', body: 'A one-page checklist on rules of origin for Moroccan textile exporters selling into West Africa. Share it with anyone preparing their first AfCFTA certificate. #AfCFTA', daysAgo: 0.1, status: 'awaiting_approval' },
];

const DRAFTS: DraftSeed[] = [
  { author: 'kwame', body: 'Tomorrow at 10:00 GMT I am hosting a short session on mobile money interoperability for chapter members. Bring your hardest questions. #Fintech', inDays: 1, at: 10 },
  { author: 'kwame', body: 'Three lessons from a year of cross-border settlement: start with one corridor, publish your fees, and answer support messages in the customer’s language.', inDays: 4, at: 9 },
  { author: 'leila', body: 'Our rules of origin clinic is open to every chapter member next Thursday. Send me your product codes in advance and we will go through them live.', inDays: 3, at: 14, status: 'held' },
  { author: 'amara', body: 'We are hiring two field agronomists in Ogun State. Women in agriculture especially encouraged to apply. Details in the comments. #AgriTech', inDays: 5, at: 8, review: 'pending' },
];

export async function seedContentCalendar(db: Db, ctx: SeedContext) {
  const [existingPost] = await db.select({ id: s.posts.id }).from(s.posts).where(eq(s.posts.source, 'claude')).limit(1);
  const [existingDraft] = await db.select({ id: s.postDrafts.id }).from(s.postDrafts).where(eq(s.postDrafts.source, 'claude')).limit(1);
  if (existingPost || existingDraft) return;
  const id = (k: string) => ctx.ids[k];
  const moderator = id('moderator') ?? id('superAdmin') ?? null;
  if (!id('amara') || !id('kwame') || !id('leila')) return;
  const now = Date.now();

  // These members can connect Claude.
  for (const key of ['amara', 'kwame', 'leila']) {
    await db.insert(s.mcpAccessGrants).values({ userId: id(key)!, grantedBy: id('superAdmin') ?? null }).onConflictDoNothing();
  }

  for (const p of POSTS) {
    const authorId = id(p.author)!;
    const createdAt = new Date(now - p.daysAgo * D);
    const waiting = p.status === 'awaiting_approval';
    const [row] = await db
      .insert(s.posts)
      .values({
        authorId,
        body: p.body,
        type: p.type ?? 'standard',
        visibility: 'public',
        status: waiting ? 'awaiting_approval' : 'published',
        source: 'claude',
        contentReview: waiting ? 'pending' : null,
        createdAt,
      })
      .returning({ id: s.posts.id });
    await db.insert(s.mcpActions).values({ userId: authorId, clientName: CLIENT, action: 'post.create', targetType: 'post', targetId: row!.id, createdAt });
  }

  for (const d of DRAFTS) {
    const authorId = id(d.author)!;
    const when = new Date(now + d.inDays * D);
    when.setUTCHours(d.at, 0, 0, 0);
    const createdAt = new Date(now - 3 * H);
    const [row] = await db
      .insert(s.postDrafts)
      .values({
        authorId,
        payload: { type: d.type ?? 'standard', body: d.body, attachmentIds: [], visibility: 'public', kind: 'standard' },
        status: d.status ?? 'scheduled',
        scheduledFor: when,
        source: 'claude',
        contentReview: d.review ?? null,
        createdAt,
      })
      .returning({ id: s.postDrafts.id });
    await db.insert(s.mcpActions).values({ userId: authorId, clientName: CLIENT, action: 'post.schedule', targetType: 'draft', targetId: row!.id, createdAt });
    if (d.status === 'held') {
      await db.insert(s.auditLog).values({
        actorId: moderator,
        action: 'content_calendar.held',
        targetType: 'draft',
        targetId: row!.id,
        before: { status: 'scheduled', scheduledFor: when.toISOString(), contentReview: null },
        after: { status: 'held', scheduledFor: when.toISOString(), contentReview: null, note: 'Checking the clinic date with the chapter lead first.' },
      });
    }
  }
}
