import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DAILY_PROMPT_TAG, MomentsResponse, WelcomeSummary } from '@chartermission/contracts';
import { client, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { promptFor } from '../../src/home/prompts.js';
import {
  addPost,
  block,
  chapterId,
  DAY,
  followChapter,
  freshDb,
  H,
  joinedDaysAgo,
  setProfile,
  sinceMidnight,
  todayUtc,
} from './home-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Home: welcome strip and community moments', () => {
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

  const welcome = async (m: Member) => WelcomeSummary.parse((await m.get('/home/welcome').expect(200)).body);
  const moments = async (m: Member) => MomentsResponse.parse((await m.get('/home/moments').expect(200)).body).moments;
  const moment = async <K extends string>(m: Member, kind: K) => (await moments(m)).find((x) => x.kind === kind) as any;

  /** A member who could be spotlighted: headline and bio, joined long ago. */
  async function seasoned(opts: Parameters<typeof createMember>[1] = {}) {
    const m = await createMember(t, opts);
    await setProfile(t, m.id, { headline: 'Agronomist and founder', bio: 'Helping smallholder farmers reach export buyers.' });
    await joinedDaysAgo(t, m.id, 200);
    return m;
  }

  it('both endpoints need a signed-in member', async () => {
    await client(t).get('/home/welcome').expect(401);
    await client(t).get('/home/moments').expect(401);
  });

  describe('GET /home/welcome', () => {
    it('records visits: null at first, unchanged within the gap, the previous visit after a gap', async () => {
      const m = await createMember(t, { name: 'Ngozi Adeyemi' });
      const first = await welcome(m);
      expect(first).toMatchObject({ firstName: 'Ngozi', isNewMember: true, lastVisitAt: null, chapter: null });
      expect((await welcome(m)).lastVisitAt).toBeNull();

      const [row] = await t.db.select().from(s.memberProfiles).where(eq(s.memberProfiles.userId, m.id));
      expect(row!.homeSeenAt).not.toBeNull();

      // Simulate coming back two hours later.
      const earlier = new Date(Date.now() - 2 * H);
      await setProfile(t, m.id, { homeSeenAt: earlier });
      const [moved] = await t.db.select().from(s.memberProfiles).where(eq(s.memberProfiles.userId, m.id));
      const third = await welcome(m);
      expect(third.lastVisitAt).toBe(earlier.toISOString());
      expect((await welcome(m)).lastVisitAt).toBe(earlier.toISOString());
      const [after] = await t.db.select().from(s.memberProfiles).where(eq(s.memberProfiles.userId, m.id));
      expect(after!.homeSeenAt!.getTime()).toBeGreaterThan(earlier.getTime() + H);
      // A visit is not a profile edit.
      expect(after!.updatedAt.getTime()).toBe(moved!.updatedAt.getTime());
    });

    it('counts posts by others since the last visit (24 hours at first), never own or blocked authors', async () => {
      const viewer = await createMember(t);
      const friend = await createMember(t);
      const blocker = await createMember(t);
      const blocked = await createMember(t);
      await block(t, blocker.id, viewer.id);
      await block(t, viewer.id, blocked.id);
      await addPost(t, friend.id, 'Two hours ago', { ago: 2 * H });
      await addPost(t, friend.id, 'Yesterday morning', { ago: 30 * H });
      await addPost(t, friend.id, 'Hidden by a moderator', { ago: H, moderationState: 'hidden' });
      await addPost(t, viewer.id, 'My own post', { ago: H });
      await addPost(t, blocker.id, 'Blocked me', { ago: H });
      await addPost(t, blocked.id, 'I blocked them', { ago: H });
      expect((await welcome(viewer)).stats.newPosts).toBe(1);

      await setProfile(t, viewer.id, { homeSeenAt: new Date(Date.now() - 3 * H) });
      await addPost(t, friend.id, 'Just now');
      const back = await welcome(viewer);
      expect(back.stats.newPosts).toBe(2);
      await setProfile(t, viewer.id, { homeSeenAt: new Date(Date.now() - 90 * 60_000) });
      expect((await welcome(viewer)).stats.newPosts).toBe(1);
    });

    it('stats: open questions, new members in the chapter, celebrations', async () => {
      const viewer = await createMember(t);
      const asker = await createMember(t);
      await joinedDaysAgo(t, viewer.id, 100);
      await joinedDaysAgo(t, asker.id, 100);
      await addPost(t, asker.id, 'Which payment rail works best for Ghana?', { type: 'question', ago: 3 * DAY });
      await addPost(t, asker.id, 'An old question nobody answered?', { type: 'question', ago: 20 * DAY });
      await addPost(t, viewer.id, 'My own question?', { type: 'question', ago: DAY });
      const answered = await addPost(t, asker.id, 'Answered already?', { type: 'question', ago: DAY });
      await t.db.update(s.posts).set({ acceptedCommentId: randomUUID() }).where(eq(s.posts.id, answered.id));
      await addPost(t, asker.id, 'We closed our seed round', {
        type: 'celebration',
        details: { category: 'funding', headline: 'Seed round closed' },
        ago: 2 * DAY,
      });
      await addPost(t, asker.id, 'Old news', { type: 'celebration', details: { category: 'award', headline: 'Won' }, ago: 9 * DAY });

      const before = await welcome(viewer);
      expect(before.stats).toMatchObject({ openQuestions: 1, celebrations: 1, newMembers: 0 });
      expect(before.isNewMember).toBe(false);

      const newcomer = await createMember(t);
      const elsewhere = await createMember(t);
      await joinedDaysAgo(t, elsewhere.id, 2);
      // Everywhere while the viewer has no chapter…
      expect((await welcome(viewer)).stats.newMembers).toBe(2);
      // …then only in their chapter.
      await followChapter(t, viewer.id, 'lagos');
      await followChapter(t, newcomer.id, 'lagos');
      await followChapter(t, elsewhere.id, 'accra');
      expect((await welcome(viewer)).stats.newMembers).toBe(1);
    });

    it('the main chapter is the first one followed', async () => {
      const m = await createMember(t);
      await followChapter(t, m.id, 'nairobi', new Date(Date.now() - 5 * DAY));
      await followChapter(t, m.id, 'accra', new Date(Date.now() - DAY));
      const w = await welcome(m);
      expect(w.chapter).toMatchObject({ slug: 'nairobi', name: 'Nairobi Chapter', countryCode: 'KE' });
    });

    it('nudges: complete profile, then first post, then chapter, then open questions', async () => {
      const m = await createMember(t);
      const other = await createMember(t);
      expect((await welcome(m)).nudge).toMatchObject({ kind: 'complete_profile', href: '/settings/profile' });
      await setProfile(t, m.id, { headline: 'Climate policy analyst' });
      expect((await welcome(m)).nudge?.kind).toBe('complete_profile');
      await setProfile(t, m.id, { avatarFileId: randomUUID() });
      expect((await welcome(m)).nudge).toMatchObject({ kind: 'first_post', href: '/feed?compose=1' });
      await addPost(t, m.id, 'Hello network');
      expect((await welcome(m)).nudge).toMatchObject({ kind: 'follow_chapter', href: '/chapters' });
      await followChapter(t, m.id, 'nairobi');
      expect((await welcome(m)).nudge).toBeNull();
      await addPost(t, other.id, 'Who has run a county budget tracker?', { type: 'question' });
      expect((await welcome(m)).nudge).toEqual({
        kind: 'answer_question',
        label: 'Help answer 1 open question',
        href: '/feed?type=question&unanswered=true',
      });
      await addPost(t, other.id, 'And who knows carbon finance?', { type: 'question' });
      expect((await welcome(m)).nudge?.label).toBe('Help answer 2 open questions');
    });
  });

  describe('GET /home/moments', () => {
    it('returns the kinds in display order with ids stable for the day', async () => {
      const viewer = await createMember(t);
      const star = await seasoned();
      await createMember(t); // a new member
      await followChapter(t, viewer.id, 'lagos');
      await addPost(t, star.id, 'Lagos chapter meetup on Saturday', { chapterId: await chapterId(t, 'lagos') });
      const list = await moments(viewer);
      expect(list.map((m) => m.kind)).toEqual(['spotlight', 'prompt', 'new_members', 'chapter_highlight']);
      const day = todayUtc();
      expect(list.map((m) => m.id)).toEqual([`spotlight:${day}`, `prompt:${day}`, `new_members:${day}`, `chapter_highlight:${day}`]);
      expect((await moments(viewer)).map((m) => m.id)).toEqual(list.map((m) => m.id));
    });

    describe('spotlight', () => {
      it('features an eligible member with bio, sectors, counts and their latest post', async () => {
        const viewer = await createMember(t);
        const star = await seasoned({ countryCode: 'GH' });
        await setProfile(t, star.id, { bio: `${'Building payment rails between Accra and Lagos. '.repeat(10)}` });
        const [sector] = await t.db.select().from(s.sectors).where(eq(s.sectors.slug, 'finance-and-fintech'));
        await t.db.insert(s.profileSectors).values({ userId: star.id, itemId: sector!.id });
        await t.db.insert(s.follows).values({ followerId: viewer.id, targetType: 'member', targetId: star.id });
        await addPost(t, star.id, 'An older post', { ago: 2 * DAY });
        const latest = await addPost(t, star.id, `## Settlement times\n\n**PayBridge** now settles cedi to naira in under an hour. ${'More detail. '.repeat(20)}`, {
          ago: H,
        });
        await addPost(t, star.id, 'Hidden one', { moderationState: 'removed' });

        const spot = await moment(viewer, 'spotlight');
        expect(spot.member).toMatchObject({
          id: star.id,
          headline: 'Agronomist and founder',
          isFollowing: true,
          countryCode: 'GH',
          sectors: ['Finance & fintech'],
          followers: 1,
          posts: 2,
        });
        expect(spot.member.bio.length).toBeLessThanOrEqual(220);
        expect(spot.member.bio.endsWith('…')).toBe(true);
        expect(spot.recentPost.id).toBe(latest.id);
        expect(spot.recentPost.excerpt.startsWith('Settlement times PayBridge now settles')).toBe(true);
        expect(spot.recentPost.excerpt.length).toBeLessThanOrEqual(160);
      });

      it('is left out when nobody qualifies: no bio, the viewer, blocked, inactive or not discoverable', async () => {
        const viewer = await createMember(t);
        await setProfile(t, viewer.id, { headline: 'Me', bio: 'My own bio' });
        await createMember(t); // no headline or bio
        const blocked = await seasoned();
        await block(t, blocked.id, viewer.id);
        const hidden = await seasoned();
        await setProfile(t, hidden.id, { discoverable: false });
        const suspended = await seasoned();
        await t.db.update(s.users).set({ status: 'suspended' }).where(eq(s.users.id, suspended.id));
        const onboarding = await seasoned();
        await setProfile(t, onboarding.id, { onboardingCompletedAt: null });
        expect(await moment(viewer, 'spotlight')).toBeUndefined();

        const ok = await seasoned();
        expect((await moment(viewer, 'spotlight')).member.id).toBe(ok.id);
        await block(t, viewer.id, ok.id);
        expect(await moment(viewer, 'spotlight')).toBeUndefined();
      });

      it('is the same member all day', async () => {
        const viewer = await createMember(t);
        for (let i = 0; i < 4; i++) await seasoned();
        const a = await moment(viewer, 'spotlight');
        const b = await moment(viewer, 'spotlight');
        expect(b.member.id).toBe(a.member.id);
      });
    });

    describe('prompt', () => {
      it("shows today's prompt with today's answers and whether the viewer answered", async () => {
        const viewer = await createMember(t);
        const a = await createMember(t);
        const b = await createMember(t);
        const blocked = await createMember(t);
        await block(t, viewer.id, blocked.id);
        const early = Math.min(sinceMidnight() / 2, H);
        await addPost(t, a.id, `My answer #${DAILY_PROMPT_TAG}`, { ago: early });
        await addPost(t, b.id, 'Mine too #dailyprompt', { ago: early / 2 });
        await addPost(t, blocked.id, `Blocked answer #${DAILY_PROMPT_TAG}`);
        await addPost(t, a.id, `Yesterday #${DAILY_PROMPT_TAG}`, { ago: sinceMidnight() + H });
        await addPost(t, a.id, 'Not an answer');

        const p = await moment(viewer, 'prompt');
        expect(p).toMatchObject({ prompt: promptFor().text, hashtag: 'DailyPrompt', responses: 2, answered: false });
        expect(p.responders.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);

        await viewer.post('/posts', { body: `Here is mine #${DAILY_PROMPT_TAG}` }).expect(201);
        const after = await moment(viewer, 'prompt');
        expect(after).toMatchObject({ responses: 3, answered: true });
        expect(after.responders[0].id).toBe(viewer.id);
        expect(after.responders).toHaveLength(3);
      });

      it('is left out when the viewer muted the tag', async () => {
        const viewer = await createMember(t);
        await t.db.insert(s.mutes).values({ userId: viewer.id, targetType: 'hashtag', targetId: 'dailyprompt' });
        expect(await moment(viewer, 'prompt')).toBeUndefined();
      });
    });

    describe('new members', () => {
      it("scopes to the viewer's chapter, then their country, then everyone", async () => {
        const viewer = await createMember(t, { countryCode: 'KE' });
        await joinedDaysAgo(t, viewer.id, 300);
        const old = await createMember(t, { countryCode: 'KE' });
        await joinedDaysAgo(t, old.id, 30);
        const kenyan = await createMember(t, { countryCode: 'KE' });
        await joinedDaysAgo(t, kenyan.id, 3);
        const ghanaian = await createMember(t, { countryCode: 'GH' });
        await joinedDaysAgo(t, ghanaian.id, 1);

        // Country first (no chapter yet).
        let nm = await moment(viewer, 'new_members');
        expect(nm.scope).toEqual({ type: 'country', countryCode: 'KE', countryName: 'Kenya' });
        expect(nm.members.map((m: { id: string }) => m.id)).toEqual([kenyan.id]);
        expect(nm.total).toBe(1);
        expect(nm.members[0]).toMatchObject({ isFollowing: false, countryCode: 'KE' });
        expect(nm.members[0].joinedAt).toBeTruthy();

        // A chapter with a new member wins.
        await followChapter(t, viewer.id, 'accra');
        await followChapter(t, ghanaian.id, 'accra');
        nm = await moment(viewer, 'new_members');
        expect(nm.scope).toMatchObject({ type: 'chapter', chapter: { slug: 'accra' } });
        expect(nm.members.map((m: { id: string }) => m.id)).toEqual([ghanaian.id]);

        // A chapter with no new members falls back to the country; no country match falls back to everyone.
        const far = await createMember(t, { countryCode: 'ZA' });
        await joinedDaysAgo(t, far.id, 300);
        await followChapter(t, far.id, 'johannesburg');
        nm = await moment(far, 'new_members');
        expect(nm.scope).toEqual({ type: 'global' });
        expect(nm.members.map((m: { id: string }) => m.id)).toEqual([ghanaian.id, kenyan.id]);
        expect(nm.total).toBe(2);
      });

      it('shows up to 6 newest first with the full total, skipping blocked and unfinished members', async () => {
        const viewer = await createMember(t);
        await joinedDaysAgo(t, viewer.id, 100);
        const joined: Member[] = [];
        for (let i = 0; i < 8; i++) {
          const m = await createMember(t, { countryCode: 'NG' });
          await joinedDaysAgo(t, m.id, 10 - i);
          joined.push(m);
        }
        await block(t, joined[7]!.id, viewer.id);
        await setProfile(t, joined[6]!.id, { onboardingCompletedAt: null });
        await t.db.insert(s.follows).values({ followerId: viewer.id, targetType: 'member', targetId: joined[5]!.id });
        const nm = await moment(viewer, 'new_members');
        expect(nm.total).toBe(6);
        expect(nm.members.map((m: { id: string }) => m.id)).toEqual([5, 4, 3, 2, 1, 0].map((i) => joined[i]!.id));
        expect(nm.members[0].isFollowing).toBe(true);
      });

      it('is left out when nobody joined recently', async () => {
        const viewer = await createMember(t);
        const other = await createMember(t);
        await joinedDaysAgo(t, other.id, 15);
        expect(await moment(viewer, 'new_members')).toBeUndefined();
      });
    });

    describe('chapter highlight', () => {
      it("highlights the viewer's chapter with this week's top post", async () => {
        const viewer = await createMember(t);
        const a = await createMember(t);
        const b = await createMember(t);
        const blocked = await createMember(t);
        await block(t, viewer.id, blocked.id);
        const lagos = await chapterId(t, 'lagos');
        await followChapter(t, viewer.id, 'lagos');
        await followChapter(t, a.id, 'lagos');
        await addPost(t, a.id, 'Weekly meetup notes', { chapterId: lagos, reactions: 3, comments: 1, ago: DAY });
        const top = await addPost(t, b.id, 'We opened a cold storage hub in Ikeja!', { chapterId: lagos, reactions: 9, comments: 4, ago: 2 * DAY });
        await addPost(t, blocked.id, 'Blocked but popular', { chapterId: lagos, reactions: 50 });
        await addPost(t, a.id, 'Too old', { chapterId: lagos, reactions: 99, ago: 8 * DAY });
        await addPost(t, a.id, 'Another chapter', { chapterId: await chapterId(t, 'accra'), reactions: 99 });

        const h = await moment(viewer, 'chapter_highlight');
        expect(h).toMatchObject({
          chapter: { slug: 'lagos' },
          isFollowing: true,
          members: 2,
          postsThisWeek: 2,
          topPost: { id: top.id, excerpt: 'We opened a cold storage hub in Ikeja!', author: { id: b.id }, reactions: 9, comments: 4 },
        });
      });

      it('falls back to the busiest chapter this week, and is left out when there is nothing to show', async () => {
        const viewer = await createMember(t);
        const a = await createMember(t);
        expect(await moment(viewer, 'chapter_highlight')).toBeUndefined();
        await addPost(t, a.id, 'Accra post', { chapterId: await chapterId(t, 'accra') });
        await addPost(t, a.id, 'Nairobi post 1', { chapterId: await chapterId(t, 'nairobi') });
        await addPost(t, a.id, 'Nairobi post 2', { chapterId: await chapterId(t, 'nairobi'), reactions: 2 });
        const h = await moment(viewer, 'chapter_highlight');
        expect(h).toMatchObject({ chapter: { slug: 'nairobi' }, isFollowing: false, members: 0, postsThisWeek: 2 });
        expect(h.topPost.excerpt).toBe('Nairobi post 2');
      });

      it('a followed chapter with no activity still shows its members, with no top post', async () => {
        const viewer = await createMember(t);
        await followChapter(t, viewer.id, 'dakar');
        const h = await moment(viewer, 'chapter_highlight');
        expect(h).toMatchObject({ chapter: { slug: 'dakar' }, isFollowing: true, members: 1, postsThisWeek: 0, topPost: null });
      });
    });
  });
});
