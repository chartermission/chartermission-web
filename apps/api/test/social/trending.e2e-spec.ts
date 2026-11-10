import { and, desc, eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { TrendingService } from '../../src/topics/trending.service.js';
import { QueueService } from '../../src/infra/queue.service.js';
import { follow, insertPost, setTrendingRules } from './social-helpers.js';

type Entry = { tag: string; posts: number; authors: number; velocityPct: number; status: string };

describe('Trending', () => {
  let t: TestApp;
  let trending: TrendingService;

  async function latest(scopeType = 'global', scopeId = '', window = '24h'): Promise<Entry[]> {
    const [row] = await t.db
      .select()
      .from(s.trendingSnapshots)
      .where(and(eq(s.trendingSnapshots.scopeType, scopeType), eq(s.trendingSnapshots.scopeId, scopeId), eq(s.trendingSnapshots.window, window)))
      .orderBy(desc(s.trendingSnapshots.computedAt))
      .limit(1);
    return row!.entries;
  }

  async function override(tag: string, action: 'pin' | 'suppress', actorId: string, extra: Partial<typeof s.trendingOverrides.$inferInsert> = {}) {
    const [h] = await t.db
      .insert(s.hashtags)
      .values({ tag: tag.toLowerCase(), display: tag })
      .onConflictDoUpdate({ target: s.hashtags.tag, set: { display: tag } })
      .returning();
    await t.db.insert(s.trendingOverrides).values({ hashtagId: h!.id, action, reason: 'Test override', actorId, ...extra });
  }

  beforeAll(async () => {
    t = await createTestApp();
    trending = t.app.get(TrendingService);
    await setTrendingRules(t, { minDistinctAuthors: 3, maxPostsPerAuthorPerHour: 2, baselineDays: 14, recomputeMinutes: 5 });
  });
  afterAll(async () => {
    await t.close();
  });

  it('applies the distinct-author threshold, the per-author hourly cap and velocity against the baseline', async () => {
    const authors = await Promise.all([1, 2, 3, 4].map((i) => createMember(t, { name: `Author ${i}`, countryCode: i < 3 ? 'NG' : 'KE' })));
    const now = Date.now();
    // #AfCFTA: 4 distinct authors in the last 24h → trending.
    for (const a of authors) await insertPost(t, a.id, 'Corridor news #AfCFTA', { createdAt: new Date(now - 3600_000), countryCode: 'NG' });
    // Baseline for #AfCFTA: 14 posts spread over the previous 14 days → baseline 1/day.
    for (let d = 2; d <= 15; d++) {
      await insertPost(t, authors[d % 4]!.id, 'Older #AfCFTA', { createdAt: new Date(now - d * 86400_000 + 3600_000), countryCode: 'NG' });
    }
    // #SpamTag: one author, 6 posts in one hour → capped at 2; only 2 authors → below threshold.
    const hour = new Date(now - 2 * 3600_000);
    for (let i = 0; i < 6; i++) await insertPost(t, authors[0]!.id, 'Buy now #SpamTag', { createdAt: new Date(hour.getTime() + i * 1000) });
    await insertPost(t, authors[1]!.id, 'Me too #SpamTag', { createdAt: hour });
    // #Flood: 3 authors, but one floods → still counted at most 2 per hour.
    for (let i = 0; i < 5; i++) await insertPost(t, authors[2]!.id, '#Flood', { createdAt: new Date(hour.getTime() + i * 1000) });
    await insertPost(t, authors[0]!.id, '#Flood', { createdAt: hour });
    await insertPost(t, authors[3]!.id, '#Flood', { createdAt: hour });
    // Hidden and deleted posts never count.
    const hidden = await insertPost(t, authors[3]!.id, '#Ghost', { createdAt: hour });
    await t.db.update(s.posts).set({ moderationState: 'hidden' }).where(eq(s.posts.id, hidden.id));

    await trending.run();
    const entries = await latest();
    const afcfta = entries.find((e) => e.tag === 'afcfta')!;
    expect(afcfta).toMatchObject({ posts: 4, authors: 4, status: 'trending', velocityPct: 300 });
    const spam = entries.find((e) => e.tag === 'spamtag')!;
    expect(spam).toMatchObject({ posts: 3, authors: 2, status: 'below_threshold' });
    const flood = entries.find((e) => e.tag === 'flood')!;
    expect(flood).toMatchObject({ posts: 4, authors: 3, status: 'trending', velocityPct: 400 });
    expect(entries.find((e) => e.tag === 'ghost')).toBeUndefined();
    // Ranked by velocity: #Flood (no baseline: (4 − 0) / max(0, 1) = +400%) before #AfCFTA (+300%).
    expect(entries.filter((e) => e.status === 'trending').map((e) => e.tag)).toEqual(['flood', 'afcfta']);

    // Country scope and the 7-day window exist too.
    const ng = await latest('country', 'NG');
    expect(ng.find((e) => e.tag === 'afcfta')?.status).toBe('trending');
    const week = await latest('global', '', '7d');
    expect(week.find((e) => e.tag === 'afcfta')).toBeDefined();

    const res = await t.http().get('/api/v1/trending').expect(200);
    expect(res.body.items.map((i: { tag: string }) => i.tag)).toEqual(['Flood', 'AfCFTA']);
    expect(res.body.items[1]).toMatchObject({ rank: 2, context: 'Trending in Africa', posts: 4, authors: 4, velocityPct: 300, pinned: false });
    const country = await t.http().get('/api/v1/trending?scope=country&scopeId=ng').expect(200);
    expect(country.body.items[0].context).toBe('Trending in Nigeria');
    await t.http().get('/api/v1/trending?scope=country').expect(422);
  });

  it('suppress and pin overrides; GET /trending never returns suppressed tags', async () => {
    const admin = await createMember(t, { roles: ['moderator'] });
    await override('AfCFTA', 'suppress', admin.id);
    await override('CharterFellows', 'pin', admin.id);
    // An expired override no longer applies.
    await override('Flood', 'suppress', admin.id, { expiresAt: new Date(Date.now() - 1000) });
    // The moderation team triggers recomputation through the queue.
    await t.app.get(QueueService).add('trending', 'compute', {});

    const entries = await latest();
    expect(entries.find((e) => e.tag === 'afcfta')?.status).toBe('suppressed');
    expect(entries[0]).toMatchObject({ tag: 'charterfellows', status: 'pinned' });
    expect(entries.find((e) => e.tag === 'flood')?.status).toBe('trending');

    const res = await t.http().get('/api/v1/trending?limit=10').expect(200);
    const tags = res.body.items.map((i: { tag: string }) => i.tag);
    expect(tags).toEqual(['CharterFellows', 'Flood']);
    expect(res.body.items[0].pinned).toBe(true);
    expect(tags).not.toContain('AfCFTA');
    expect(tags).not.toContain('SpamTag');
    // Global overrides apply in every scope.
    const ng = await t.http().get('/api/v1/trending?scope=country&scopeId=NG&limit=10').expect(200);
    expect(ng.body.items.map((i: { tag: string }) => i.tag)).not.toContain('AfCFTA');

    // Scoped overrides apply only in their scope (chapter given by slug).
    await override('LagosMeetup', 'pin', admin.id, { scopeType: 'chapter', scopeId: 'nigeria' });
    await trending.run();
    const lagos = await t.http().get('/api/v1/trending?scope=chapter&scopeId=nigeria').expect(200);
    expect(lagos.body.items.map((i: { tag: string; pinned: boolean }) => [i.tag, i.pinned])).toEqual([
      ['CharterFellows', true],
      ['LagosMeetup', true],
    ]);
    expect(lagos.body.items[0].context).toBe('Trending in Nigeria Chapter');
    expect((await t.http().get('/api/v1/trending?limit=10').expect(200)).body.items.map((i: { tag: string }) => i.tag)).not.toContain(
      'LagosMeetup',
    );

    // Suggestions and topic pages reflect it.
    const m = await createMember(t);
    expect((await m.get('/hashtags/suggest?q=afc').expect(200)).body[0]).toMatchObject({ tag: 'AfCFTA', trending: false });
    const topic = await m.get('/topics/flood').expect(200);
    expect(topic.body.trending).toEqual({ rank: 2, scopeLabel: 'Africa' });
    expect((await m.get('/topics/afcfta').expect(200)).body).toMatchObject({ trending: null, velocityPct: null });
  });

  it('keeps only the latest 20 snapshots per scope and window', async () => {
    for (let i = 0; i < 21; i++) await trending.run(new Date(Date.now() + i * 1000));
    const rows = await t.db
      .select()
      .from(s.trendingSnapshots)
      .where(and(eq(s.trendingSnapshots.scopeType, 'global'), eq(s.trendingSnapshots.window, '24h')));
    expect(rows).toHaveLength(20);
  });

  it('notifies followers when a followed tag enters the global top 5 (once per day)', async () => {
    await t.db.delete(s.trendingSnapshots);
    await t.db.delete(s.trendingOverrides);
    const fan = await createMember(t);
    await follow(t, fan.id, 'hashtag', 'newwave');
    const authors = await Promise.all([1, 2, 3].map(() => createMember(t)));
    for (const a of authors) await insertPost(t, a.id, 'Riding the #NewWave', { createdAt: new Date(Date.now() - 600_000) });
    await trending.run();
    let notes = (await fan.get('/notifications').expect(200)).body.items;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'trending_followed_topic', href: '/topics/newwave', icon: 'trending' });
    expect(notes[0].segments.map((x: { text: string }) => x.text).join('')).toBe('#NewWave is trending in Africa');
    // Re-entering later the same day does not notify again.
    await t.db.delete(s.trendingSnapshots);
    await trending.run();
    notes = (await fan.get('/notifications').expect(200)).body.items;
    expect(notes).toHaveLength(1);
  });
});
