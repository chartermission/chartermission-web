import { randomUUID } from 'node:crypto';
import { ArticlesHub, RelatedArticles } from '@chartermission/contracts';
import { client, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { addArticle, addPost, block, DAY, freshDb, H } from './home-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;
type Item = { id: string; type: string; article: { title: string } | null };

describe('Articles: list, hub and related', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await freshDb(t);
  });

  /** Follow nextCursor to the end; returns every id in order. */
  async function allPages(m: Member, query: string) {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { body: { items: Item[]; nextCursor: string | null } } = await m.get(`/articles?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).expect(200);
      for (const item of res.body.items) {
        expect(item.type).toBe('article');
        ids.push(item.id);
      }
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    return { ids, pages };
  }

  it('needs a signed-in member and validates the query', async () => {
    await client(t).get('/articles').expect(401);
    await client(t).get('/articles/hub').expect(401);
    const m = await createMember(t);
    await m.get('/articles?sort=oldest').expect(422);
    await m.get('/articles?tag=not-a-tag!').expect(422);
    await m.get('/articles?limit=31').expect(422);
    await m.get('/articles?cursor=garbage').expect(400);
  });

  it('latest: newest first with keyset pages; only visible articles', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const blocked = await createMember(t);
    await block(t, blocked.id, viewer.id);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await addArticle(t, a.id, `Article ${i}`, { ago: (i + 1) * DAY }));
    await addPost(t, a.id, 'A standard post', { ago: H });
    await addArticle(t, blocked.id, 'From a blocked member', { ago: H });
    await addPost(t, a.id, `${'Removed article body. '.repeat(10)}`, { type: 'article', details: { title: 'Removed' }, moderationState: 'removed' });

    const { ids, pages } = await allPages(viewer, 'limit=2');
    expect(ids).toEqual(made.map((p) => p.id));
    expect(pages).toBe(3);
    const first = await viewer.get('/articles').expect(200);
    expect(first.body.items[0].article.title).toBe('Article 0');
    expect(first.body.nextCursor).toBeNull();
  });

  it('popular: last 30 days by reactions + 2 × comments, stable across pages', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const low = await addArticle(t, a.id, 'Low', { ago: DAY, reactions: 1 });
    const top = await addArticle(t, a.id, 'Top', { ago: 10 * DAY, reactions: 5, comments: 5 });
    const mid = await addArticle(t, a.id, 'Mid', { ago: 5 * DAY, reactions: 6 });
    const tieNew = await addArticle(t, a.id, 'Tie newer', { ago: 2 * DAY, reactions: 2 });
    const tieOld = await addArticle(t, a.id, 'Tie older', { ago: 3 * DAY, comments: 1 });
    await addArticle(t, a.id, 'Too old', { ago: 40 * DAY, reactions: 100 });

    const { ids } = await allPages(viewer, 'sort=popular&limit=2');
    expect(ids).toEqual([top.id, mid.id, tieNew.id, tieOld.id, low.id]);
    const latest = await allPages(viewer, 'sort=latest&limit=10');
    expect(latest.ids).toHaveLength(6);
  });

  it('filters by hashtag, case-insensitively', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const agri = await addArticle(t, a.id, 'Cold chains', { tags: ['AgriTech'], ago: DAY });
    const both = await addArticle(t, a.id, 'Farm finance', { tags: ['Fintech', 'agritech'], ago: 2 * DAY });
    await addArticle(t, a.id, 'Payments', { tags: ['Fintech'] });
    await addPost(t, a.id, 'Standard post #AgriTech');

    const res = await viewer.get('/articles?tag=AGRITECH').expect(200);
    expect(res.body.items.map((p: Item) => p.id)).toEqual([agri.id, both.id]);
    const popular = await viewer.get('/articles?tag=agritech&sort=popular').expect(200);
    expect(popular.body.items).toHaveLength(2);
    expect((await viewer.get('/articles?tag=climate').expect(200)).body.items).toEqual([]);
  });

  it('hub: featured, popular this week, topics, authors and total', async () => {
    const viewer = await createMember(t);
    const leila = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });
    const kwame = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    await t.db.insert(s.follows).values({ followerId: viewer.id, targetType: 'member', targetId: kwame.id });

    const empty = ArticlesHub.parse((await viewer.get('/articles/hub').expect(200)).body);
    expect(empty).toEqual({ featured: null, popular: [], topics: [], authors: [], total: 0 });

    const featured = await addArticle(t, leila.id, 'Rules of origin', { tags: ['AfCFTA', 'TradeAfrica'], ago: 12 * DAY, reactions: 20, comments: 3 });
    const week1 = await addArticle(t, kwame.id, 'Settlement rails', { tags: ['Fintech'], ago: 2 * DAY, reactions: 4 });
    const week2 = await addArticle(t, kwame.id, 'Mobile money', { tags: ['Fintech', 'AfCFTA'], ago: 3 * DAY, reactions: 1, comments: 2 });
    const week3 = await addArticle(t, leila.id, 'Tariff schedules', { tags: ['AfCFTA'], ago: DAY });
    await addArticle(t, kwame.id, 'Old one', { tags: ['Fintech'], ago: 60 * DAY, reactions: 500 });

    const hub = ArticlesHub.parse((await viewer.get('/articles/hub').expect(200)).body);
    expect(hub.featured?.id).toBe(featured.id);
    expect(hub.popular.map((p) => p.id)).toEqual([week2.id, week1.id, week3.id]);
    expect(hub.topics).toEqual([
      { tag: 'AfCFTA', articles: 3 },
      // FinTech is a seeded featured topic, so its display form comes from the seed.
      { tag: 'FinTech', articles: 3 },
      { tag: 'TradeAfrica', articles: 1 },
    ]);
    expect(hub.authors.map((a) => [a.member.id, a.articles])).toEqual([
      [kwame.id, 3],
      [leila.id, 2],
    ]);
    expect(hub.authors[0]!.member).toMatchObject({ isFollowing: true, countryCode: 'GH', name: 'Kwame Mensah' });
    expect(hub.total).toBe(5);

    // With nothing in the last 30 days the latest article is featured.
    const quiet = await createMember(t);
    await block(t, quiet.id, leila.id);
    await block(t, quiet.id, kwame.id);
    const lone = await createMember(t);
    const old = await addArticle(t, lone.id, 'An older piece', { ago: 45 * DAY });
    await addArticle(t, lone.id, 'An even older piece', { ago: 50 * DAY, reactions: 3 });
    const quietHub = ArticlesHub.parse((await quiet.get('/articles/hub').expect(200)).body);
    expect(quietHub.featured?.id).toBe(old.id);
    expect(quietHub.popular).toEqual([]);
    expect(quietHub.total).toBe(2);
  });

  it('related: more by the author and articles sharing a hashtag, then the latest', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const b = await createMember(t);
    const article = await addArticle(t, a.id, 'Cold chains', { tags: ['AgriTech', 'Logistics'], ago: DAY });
    const byA1 = await addArticle(t, a.id, 'Soil testing', { tags: ['AgriTech'], ago: 2 * DAY });
    const byA2 = await addArticle(t, a.id, 'Farm credit', { ago: 3 * DAY });
    const bothTags = await addArticle(t, b.id, 'Ports and produce', { tags: ['agritech', 'logistics'], ago: 20 * DAY });
    const oneTag = await addArticle(t, b.id, 'Trucks', { tags: ['Logistics'], ago: 4 * DAY });
    const unrelated = await addArticle(t, b.id, 'Payments', { tags: ['Fintech'], ago: 5 * DAY });
    await addArticle(t, b.id, 'Older unrelated', { tags: ['Fintech'], ago: 6 * DAY });

    const rel = RelatedArticles.parse((await viewer.get(`/articles/${article.id}/related`).expect(200)).body);
    expect(rel.moreByAuthor.map((p) => p.id)).toEqual([byA1.id, byA2.id]);
    expect(rel.related.map((p) => p.id)).toEqual([bothTags.id, oneTag.id, unrelated.id]);
  });

  it('related: 404 unless the id is a visible article', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const standard = await addPost(t, a.id, 'Just a post');
    const removed = await addPost(t, a.id, `${'Body. '.repeat(30)}`, { type: 'article', details: { title: 'Removed' }, moderationState: 'removed' });
    const blockedArticle = await addArticle(t, a.id, 'Blocked author');
    const res = await viewer.get(`/articles/${standard.id}/related`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await viewer.get(`/articles/${removed.id}/related`).expect(404);
    await viewer.get(`/articles/${randomUUID()}/related`).expect(404);
    await viewer.get('/articles/not-a-uuid/related').expect(404);
    await viewer.get(`/articles/${blockedArticle.id}/related`).expect(200);
    await block(t, viewer.id, a.id);
    await viewer.get(`/articles/${blockedArticle.id}/related`).expect(404);
  });
});
