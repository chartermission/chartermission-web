import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { block, createPost, follow, insertPost } from './social-helpers.js';

type Item = { id: string; pinned: boolean };
const ids = (body: { items: Item[] }) => body.items.map((i) => i.id);

describe('Feed and topic pages', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('cursor pagination: 20 per page, no duplicates across pages, in every tab', async () => {
    const viewer = await createMember(t, { countryCode: 'KE' });
    const authors = [await createMember(t, { countryCode: 'KE' }), await createMember(t, { countryCode: 'KE' })];
    await follow(t, viewer.id, 'member', authors[0]!.id);
    await follow(t, viewer.id, 'member', authors[1]!.id);
    const base = Date.now() - 3600_000;
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const p = await insertPost(t, authors[i % 2]!.id, `Post number ${i}`, { countryCode: 'KE', createdAt: new Date(base + i * 60_000) });
      if (i % 5 === 0) await t.db.update(s.posts).set({ reactionCount: i }).where(eq(s.posts.id, p.id));
      created.push(p.id);
    }
    for (const tab of ['latest', 'following', 'for_you']) {
      const page1 = await viewer.get(`/feed?tab=${tab}&country=KE`).expect(200);
      expect(page1.body.items).toHaveLength(20);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await viewer.get(`/feed?tab=${tab}&country=KE&cursor=${encodeURIComponent(page1.body.nextCursor)}`).expect(200);
      expect(page2.body.items).toHaveLength(5);
      expect(page2.body.nextCursor).toBeNull();
      const all = [...ids(page1.body), ...ids(page2.body)];
      expect(new Set(all).size).toBe(25);
      expect(all.sort()).toEqual([...created].sort());
      if (tab !== 'for_you') expect(ids(page1.body)[0]).toBe(created[24]);
    }
    await viewer.get('/feed?cursor=not-a-cursor').expect(400);
  });

  it('connections count as followed: their posts are in Following and rank above official and unrelated posts in For you', async () => {
    const viewer = await createMember(t, { countryCode: 'SC' });
    const connection = await createMember(t);
    const pending = await createMember(t);
    const stranger = await createMember(t);
    const official = await createMember(t);
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, official.id));
    await t.db.insert(s.connections).values({ requesterId: connection.id, addresseeId: viewer.id, status: 'accepted', respondedAt: new Date() });
    await t.db.insert(s.connections).values({ requesterId: viewer.id, addresseeId: pending.id, status: 'pending' });
    const at = new Date(Date.now() - 3600_000);
    const fromStranger = await insertPost(t, stranger.id, 'From a stranger', { countryCode: 'SC', createdAt: at });
    const fromPending = await insertPost(t, pending.id, 'From a pending request', { countryCode: 'SC', createdAt: at });
    const fromOfficial = await insertPost(t, official.id, 'From the official account', { countryCode: 'SC', createdAt: at });
    const fromConnection = await insertPost(t, connection.id, 'From a connection', { countryCode: 'SC', createdAt: at });

    const following = ids((await viewer.get('/feed?tab=following&country=SC').expect(200)).body);
    expect(following).toEqual(expect.arrayContaining([fromConnection.id, fromOfficial.id]));
    expect(following).not.toContain(fromPending.id);
    expect(following).not.toContain(fromStranger.id);

    // Same age and engagement: connection (followed) > official > the rest.
    const forYou = ids((await viewer.get('/feed?tab=for_you&country=SC').expect(200)).body);
    expect(forYou.slice(0, 2)).toEqual([fromConnection.id, fromOfficial.id]);
    expect(forYou).toHaveLength(4);

    const since = encodeURIComponent(new Date(Date.now() - 2 * 3600_000).toISOString());
    const pill = await viewer.get(`/feed/new?tab=following&country=SC&since=${since}`).expect(200);
    expect(pill.body.count).toBe(2);
  });

  it('For you moves posts the member has already seen below ones they have not', async () => {
    const viewer = await createMember(t, { countryCode: 'KM' });
    const [a, b] = [await createMember(t), await createMember(t)];
    const at = new Date(Date.now() - 3600_000);
    const seen = await insertPost(t, a!.id, 'Seen before', { countryCode: 'KM', createdAt: at });
    const fresh = await insertPost(t, b!.id, 'Not seen yet', { countryCode: 'KM', createdAt: at });
    await t.db.update(s.posts).set({ reactionCount: 2 }).where(eq(s.posts.id, seen.id));
    expect(ids((await viewer.get('/feed?tab=for_you&country=KM').expect(200)).body)).toEqual([seen.id, fresh.id]);

    await viewer.post('/posts/views', { postIds: [seen.id] }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(ids((await viewer.get('/feed?tab=for_you&country=KM').expect(200)).body)).toEqual([fresh.id, seen.id]);
    // Latest is unaffected.
    expect(ids((await viewer.get('/feed?tab=latest&country=KM').expect(200)).body)).toHaveLength(2);
  });

  it('For you carries on with older posts, newest first, once the last 7 days run out', async () => {
    const viewer = await createMember(t, { countryCode: 'GQ' });
    const day = 24 * 3600_000;
    const recent: string[] = [];
    const older: string[] = [];
    for (let i = 0; i < 3; i++) {
      const author = await createMember(t);
      recent.push((await insertPost(t, author.id, `Recent ${i}`, { countryCode: 'GQ', createdAt: new Date(Date.now() - (i + 1) * 3600_000) })).id);
    }
    for (let i = 0; i < 4; i++) {
      const author = await createMember(t);
      older.push((await insertPost(t, author.id, `Older ${i}`, { countryCode: 'GQ', createdAt: new Date(Date.now() - (8 + i) * day) })).id);
    }

    // Ranked posts first, then older ones fill the rest of the page.
    const p1 = await viewer.get('/feed?tab=for_you&country=GQ&limit=5').expect(200);
    expect(ids(p1.body).slice(0, 3).sort()).toEqual([...recent].sort());
    expect(ids(p1.body).slice(3)).toEqual(older.slice(0, 2));
    const p2 = await viewer.get(`/feed?tab=for_you&country=GQ&limit=5&cursor=${encodeURIComponent(p1.body.nextCursor)}`).expect(200);
    expect(ids(p2.body)).toEqual(older.slice(2));
    expect(p2.body.nextCursor).toBeNull();

    // Ranked posts fill a page exactly: the next page starts the older posts.
    const q1 = await viewer.get('/feed?tab=for_you&country=GQ&limit=3').expect(200);
    expect(ids(q1.body).sort()).toEqual([...recent].sort());
    expect(q1.body.nextCursor).toBeTruthy();
    const q2 = await viewer.get(`/feed?tab=for_you&country=GQ&limit=3&cursor=${encodeURIComponent(q1.body.nextCursor)}`).expect(200);
    expect(ids(q2.body)).toEqual(older.slice(0, 3));
    const q3 = await viewer.get(`/feed?tab=for_you&country=GQ&limit=3&cursor=${encodeURIComponent(q2.body.nextCursor)}`).expect(200);
    expect(ids(q3.body)).toEqual(older.slice(3));
    expect(q3.body.nextCursor).toBeNull();
  });

  it('For you spreads out a busy author and keeps pagination stable', async () => {
    const viewer = await createMember(t, { countryCode: 'ST' });
    const busy = await createMember(t);
    const at = new Date(Date.now() - 3600_000);
    const busyPosts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await insertPost(t, busy.id, `Busy ${i}`, { countryCode: 'ST', createdAt: at });
      await t.db.update(s.posts).set({ reactionCount: 10 }).where(eq(s.posts.id, p.id));
      busyPosts.push(p.id);
    }
    const others: string[] = [];
    for (let i = 0; i < 2; i++) {
      const author = await createMember(t);
      others.push((await insertPost(t, author.id, `Other ${i}`, { countryCode: 'ST', createdAt: at })).id);
    }

    const page = ids((await viewer.get('/feed?tab=for_you&country=ST').expect(200)).body);
    expect(page).toHaveLength(6);
    expect(busyPosts).toContain(page[0]);
    // The other authors sit between the busy author's top posts instead of below all four.
    const isBusy = page.map((id) => busyPosts.includes(id));
    expect(isBusy.slice(0, 4)).toEqual([true, false, true, false]);

    // Two at a time: every post exactly once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: Item[]; nextCursor: string | null } } = await viewer
        .get(`/feed?tab=for_you&country=ST&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .expect(200);
      seen.push(...ids(res.body));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual([...busyPosts, ...others].sort());
  });

  it('posts from official accounts and official pages reach every member, followed or not', async () => {
    const viewer = await createMember(t);
    const official = await createMember(t);
    const stranger = await createMember(t);
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, official.id));
    const [page] = await t.db
      .insert(s.pages)
      .values({ slug: `official-${Date.now()}`, name: 'Charter Mission', status: 'active', official: true, createdBy: official.id })
      .returning();
    const fromOfficial = await insertPost(t, official.id, 'Platform update from the official account');
    const fromPage = await insertPost(t, official.id, 'News from the official page');
    await t.db.update(s.posts).set({ pageId: page!.id }).where(eq(s.posts.id, fromPage.id));
    const unrelated = await insertPost(t, stranger.id, 'Someone I do not follow');

    const following = ids((await viewer.get('/feed?tab=following').expect(200)).body);
    expect(following).toEqual(expect.arrayContaining([fromOfficial.id, fromPage.id]));
    expect(following).not.toContain(unrelated.id);
    const forYou = ids((await viewer.get('/feed?tab=for_you').expect(200)).body);
    expect(forYou).toEqual(expect.arrayContaining([fromOfficial.id, fromPage.id]));
    const pill = await viewer.get(`/feed/new?tab=following&since=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`).expect(200);
    expect(pill.body.count).toBeGreaterThanOrEqual(2);

  });

  it('following = own posts, followed members, hashtags and chapters, plus announcements', async () => {
    const viewer = await createMember(t, { countryCode: 'GH' });
    const followed = await createMember(t);
    const stranger = await createMember(t);
    const admin = await createMember(t, { roles: ['platform_admin'] });
    const [accra] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'ghana'));
    await follow(t, viewer.id, 'member', followed.id);
    await follow(t, viewer.id, 'hashtag', 'cleancooking');
    await follow(t, viewer.id, 'chapter', accra!.id);

    const own = await createPost(viewer, 'My own');
    const fromFollowed = await createPost(followed, 'From someone I follow');
    const byTag = await createPost(stranger, 'All about #CleanCooking');
    const byChapter = await createPost(stranger, 'Accra meetup', { chapterId: accra!.id });
    const unrelated = await createPost(stranger, 'Unrelated');
    const announcement = await createPost(admin, 'Platform news', { kind: 'announcement' });

    const following = await viewer.get('/feed?tab=following').expect(200);
    const got = ids(following.body);
    for (const p of [own, fromFollowed, byTag, byChapter, announcement]) expect(got).toContain(p.id);
    expect(got).not.toContain(unrelated.id);
    // Pinned announcements come first on the first page of every tab.
    for (const tab of ['following', 'latest', 'for_you']) {
      const first = (await viewer.get(`/feed?tab=${tab}`).expect(200)).body.items[0];
      expect(first.id).toBe(announcement.id);
      expect(first.pinned).toBe(true);
    }

    // Pinned posts count towards the page size and never repeat on later pages.
    const small = await viewer.get('/feed?tab=latest&limit=3').expect(200);
    expect(small.body.items).toHaveLength(3);
    expect(small.body.items[0].id).toBe(announcement.id);
    const more = await viewer.get(`/feed?tab=latest&limit=3&cursor=${encodeURIComponent(small.body.nextCursor)}`).expect(200);
    expect(ids(more.body)).not.toContain(announcement.id);
    expect(ids(more.body).filter((id) => ids(small.body).includes(id))).toEqual([]);

    // Filters: chapter by slug, announcements only. Pinned announcements obey the filters too.
    expect(ids((await viewer.get('/feed?tab=latest&chapter=ghana').expect(200)).body)).toEqual([byChapter.id]);
    expect(ids((await viewer.get('/feed?tab=latest&chapter=nowhere').expect(200)).body)).toEqual([]);
    const ann = await viewer.get('/feed?tab=latest&announcements=true').expect(200);
    expect(ann.body.items.every((p: { kind: string }) => p.kind === 'announcement')).toBe(true);
    const notAnn = await viewer.get('/feed?tab=latest&announcements=false').expect(200);
    expect(ids(notAnn.body)).toContain(unrelated.id);
  });

  it('pinned announcements only lead the page when they match the country, sector and chapter filters', async () => {
    const viewer = await createMember(t, { countryCode: 'NG' });
    const admin = await createMember(t, { roles: ['platform_admin'], countryCode: 'TZ' });
    const [accra] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'ghana'));
    const [sector] = await t.db.select().from(s.sectors).where(eq(s.sectors.slug, 'climate-and-energy'));
    const global = await createPost(admin, 'For everyone', { kind: 'announcement' });
    const forAccra = await createPost(admin, 'Accra chapter news', { kind: 'announcement', chapterId: accra!.id });
    const local = await createPost(admin, 'A regular post');

    const unfiltered = ids((await viewer.get('/feed?tab=latest').expect(200)).body);
    expect(unfiltered.slice(0, 2)).toEqual([forAccra.id, global.id]);

    const tz = ids((await viewer.get('/feed?tab=latest&country=TZ').expect(200)).body);
    expect(tz.slice(0, 3)).toEqual([forAccra.id, global.id, local.id]);
    for (const tab of ['latest', 'following', 'for_you']) {
      const ng = ids((await viewer.get(`/feed?tab=${tab}&country=NG`).expect(200)).body);
      expect(ng).not.toContain(global.id);
      expect(ng).not.toContain(forAccra.id);
    }
    const accraIds = ids((await viewer.get('/feed?tab=latest&chapter=ghana').expect(200)).body);
    expect(accraIds[0]).toBe(forAccra.id);
    expect(accraIds).not.toContain(global.id);
    expect(ids((await viewer.get('/feed?tab=latest&sector=climate-and-energy').expect(200)).body)).not.toContain(global.id);
    await t.db.insert(s.profileSectors).values({ userId: admin.id, itemId: sector!.id });
    expect(ids((await viewer.get('/feed?tab=latest&sector=climate-and-energy').expect(200)).body).slice(0, 2)).toEqual([forAccra.id, global.id]);
    // Clean up so later tests see no extra pinned posts.
    await t.db.update(s.posts).set({ pinnedAt: null }).where(eq(s.posts.authorId, admin.id));
  });

  it('author filter: one member’s posts by id or handle, newest first, paginated', async () => {
    const viewer = await createMember(t);
    const author = await createMember(t, { roles: ['platform_admin'] });
    const other = await createMember(t);
    const base = Date.now() - 3600_000;
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await insertPost(t, author.id, `Author post ${i}`, { createdAt: new Date(base + i * 60_000) })).id);
    await insertPost(t, other.id, 'Someone else');
    // The author's pinned announcement stays in date order instead of jumping to the top.
    const pinned = await createPost(author, 'Pinned news', { kind: 'announcement' });
    const newestFirst = [pinned.id, ...[...created].reverse()];

    const byHandle = await viewer.get(`/feed?author=${author.handle}&limit=5`).expect(200);
    expect(ids(byHandle.body)).toEqual(newestFirst.slice(0, 5));
    const next = await viewer.get(`/feed?author=${author.handle}&limit=5&cursor=${encodeURIComponent(byHandle.body.nextCursor)}`).expect(200);
    expect(ids(next.body)).toEqual(newestFirst.slice(5));
    expect(next.body.nextCursor).toBeNull();
    // By id and case-insensitive handle, whatever the tab.
    expect(ids((await viewer.get(`/feed?author=${author.id}&tab=for_you`).expect(200)).body)).toEqual(newestFirst);
    expect(ids((await viewer.get(`/feed?author=${author.handle.toUpperCase()}`).expect(200)).body)).toEqual(newestFirst);
    // Combined with other filters.
    expect(ids((await viewer.get(`/feed?author=${author.handle}&announcements=true`).expect(200)).body)).toEqual([pinned.id]);
    // Unknown members give an empty page.
    expect((await viewer.get('/feed?author=no-such-member').expect(200)).body).toEqual({ items: [], nextCursor: null });
    expect((await viewer.get('/feed?author=00000000-0000-4000-8000-000000000000').expect(200)).body.items).toEqual([]);

    // Muting the author hides them from feeds but not from their own profile list.
    await viewer.post('/mutes', { targetType: 'member', targetId: author.id }).expect(201);
    expect(ids((await viewer.get('/feed?tab=latest&limit=50').expect(200)).body)).not.toContain(created[6]);
    expect(ids((await viewer.get(`/feed?author=${author.handle}`).expect(200)).body)).toEqual(newestFirst);
    // Blocks either way still apply.
    await block(t, author.id, viewer.id);
    expect((await viewer.get(`/feed?author=${author.handle}`).expect(200)).body.items).toEqual([]);
    await t.db.update(s.posts).set({ pinnedAt: null }).where(eq(s.posts.authorId, author.id));
  });

  it('sector filter uses the author’s profile sectors', async () => {
    const viewer = await createMember(t);
    const energy = await createMember(t);
    const other = await createMember(t);
    const [sector] = await t.db.select().from(s.sectors).where(eq(s.sectors.slug, 'climate-and-energy'));
    await t.db.insert(s.profileSectors).values({ userId: energy.id, itemId: sector!.id });
    const p1 = await createPost(energy, 'Solar mini-grids');
    const p2 = await createPost(other, 'Something else');
    const res = await viewer.get('/feed?tab=latest&sector=climate-and-energy').expect(200);
    expect(ids(res.body)).toContain(p1.id);
    expect(ids(res.body)).not.toContain(p2.id);
  });

  it('blocked members’ posts never appear in any feed tab, topic page or comments (either direction)', async () => {
    const viewer = await createMember(t);
    const blockedByViewer = await createMember(t);
    const blockerOfViewer = await createMember(t);
    const neutral = await createMember(t);
    await follow(t, viewer.id, 'member', blockedByViewer.id);
    await follow(t, viewer.id, 'member', blockerOfViewer.id);
    await follow(t, viewer.id, 'hashtag', 'blocktest');
    const p1 = await createPost(blockedByViewer, 'Hidden from viewer #BlockTest');
    const p2 = await createPost(blockerOfViewer, 'Also hidden #BlockTest');
    const p3 = await createPost(neutral, 'Fine #BlockTest');
    const c1 = await blockedByViewer.post(`/posts/${p3.id}/comments`, { body: 'Comment from blocked' }).expect(201);
    const c2 = await blockerOfViewer.post(`/posts/${p3.id}/comments`, { body: 'Comment from blocker' }).expect(201);
    await blockedByViewer.put('/reactions', { targetType: 'post', targetId: p3.id }).expect(200);
    await block(t, viewer.id, blockedByViewer.id);
    await block(t, blockerOfViewer.id, viewer.id);

    for (const tab of ['latest', 'following', 'for_you']) {
      const got = ids((await viewer.get(`/feed?tab=${tab}`).expect(200)).body);
      expect(got).toContain(p3.id);
      expect(got).not.toContain(p1.id);
      expect(got).not.toContain(p2.id);
    }
    for (const sort of ['top', 'latest']) {
      const got = ids((await viewer.get(`/topics/blocktest/posts?sort=${sort}`).expect(200)).body);
      expect(got).toEqual([p3.id]);
    }
    const comments = ids((await viewer.get(`/posts/${p3.id}/comments`).expect(200)).body);
    expect(comments).not.toContain(c1.body.id);
    expect(comments).not.toContain(c2.body.id);
    // And the reverse: the blocked members don't see the viewer's posts.
    const mine = await createPost(viewer, 'Mine');
    expect(ids((await blockedByViewer.get('/feed?tab=latest').expect(200)).body)).not.toContain(mine.id);
    expect(ids((await blockerOfViewer.get('/feed?tab=latest').expect(200)).body)).not.toContain(mine.id);
  });

  it('muted hashtags and members are excluded from the feed (but the topic page still opens)', async () => {
    const viewer = await createMember(t);
    const author = await createMember(t);
    const noisy = await createMember(t);
    const muted = await createPost(author, 'Too much #MutedTopic');
    const kept = await createPost(author, 'Keep this one');
    const fromNoisy = await createPost(noisy, 'Noise');
    await t.db.insert(s.mutes).values([
      { userId: viewer.id, targetType: 'hashtag', targetId: 'mutedtopic' },
      { userId: viewer.id, targetType: 'member', targetId: noisy.id },
    ]);
    for (const tab of ['latest', 'for_you']) {
      const got = ids((await viewer.get(`/feed?tab=${tab}`).expect(200)).body);
      expect(got).toContain(kept.id);
      expect(got).not.toContain(muted.id);
      expect(got).not.toContain(fromNoisy.id);
    }
    const topic = await viewer.get('/topics/MutedTopic').expect(200);
    expect(topic.body.muted).toBe(true);
    expect(ids((await viewer.get('/topics/mutedtopic/posts?sort=latest').expect(200)).body)).toEqual([muted.id]);
  });

  it('topic page: counts, followers, activity, related tags and sorts', async () => {
    const viewer = await createMember(t);
    const a = await createMember(t);
    const b = await createMember(t);
    await follow(t, viewer.id, 'hashtag', 'agritechx');
    await follow(t, a.id, 'hashtag', 'agritechx');
    const old = await insertPost(t, a.id, 'Old #AgriTechX #ColdChain', { createdAt: new Date(Date.now() - 3 * 86400_000) });
    const p1 = await createPost(a, 'Fresh #AgriTechX #ColdChain #Logistics');
    const p2 = await createPost(b, 'Also #agritechx #ColdChain');
    await t.db.update(s.posts).set({ reactionCount: 10 }).where(eq(s.posts.id, p2.id));

    const topic = await viewer.get('/topics/agritechx').expect(200);
    expect(topic.body).toMatchObject({ tag: 'AgriTechX', posts: 3, followers: 2, following: true, muted: false });
    expect(topic.body.activity7d).toHaveLength(7);
    expect(topic.body.activity7d[6]).toBe(2);
    expect(topic.body.activity7d[3]).toBe(1);
    expect(topic.body.related[0]).toBe('ColdChain');
    expect(topic.body.related).toContain('Logistics');

    expect(ids((await viewer.get('/topics/agritechx/posts?sort=top').expect(200)).body)).toEqual([p2.id, p1.id, old.id]);
    expect(ids((await viewer.get('/topics/agritechx/posts?sort=latest').expect(200)).body)).toEqual([p2.id, p1.id, old.id]);
    expect(ids((await viewer.get('/topics/agritechx/posts?sort=media').expect(200)).body)).toEqual([]);
    const page = await viewer.get('/topics/agritechx/posts?sort=top&limit=2').expect(200);
    const rest = await viewer.get(`/topics/agritechx/posts?sort=top&limit=2&cursor=${page.body.nextCursor}`).expect(200);
    expect([...ids(page.body), ...ids(rest.body)]).toEqual([p2.id, p1.id, old.id]);

    await viewer.get('/topics/doesnotexist').expect(404);
    await viewer.get('/topics/bad-tag!').expect(404);
  });

  it('hashtag suggestions: prefix match, most used first, up to 8', async () => {
    const m = await createMember(t);
    await createPost(m, '#ClimateAction #ClimateFinance #Clim8');
    await createPost(m, '#ClimateAction again');
    const res = await m.get('/hashtags/suggest?q=%23clim').expect(200);
    expect(res.body[0]).toEqual({ tag: 'ClimateAction', posts: 2, trending: false });
    expect(res.body.map((x: { tag: string }) => x.tag)).toEqual(expect.arrayContaining(['ClimateFinance', 'Clim8']));
    expect((await m.get('/hashtags/suggest?q=').expect(200)).body.length).toBeLessThanOrEqual(8);
    await t.http().get('/api/v1/hashtags/suggest?q=cl').expect(401);
  });
});
