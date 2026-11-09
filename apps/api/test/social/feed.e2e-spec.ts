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
    expect(ids((await viewer.get('/feed?tab=latest&chapter=accra').expect(200)).body)).toEqual([byChapter.id]);
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
    const accraIds = ids((await viewer.get('/feed?tab=latest&chapter=accra').expect(200)).body);
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
