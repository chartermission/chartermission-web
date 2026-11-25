import { and, eq, like } from 'drizzle-orm';
import type { NotificationView, OwnProfile, ProfileViewsPage, ProfileViewsSummary } from '@chartermission/contracts';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { block, createPost, follow } from './social-helpers.js';
import { PostMilestonesService } from '../../src/posts/post-milestones.service.js';
import { ProfileViewsService } from '../../src/profiles/profile-views.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const text = (n: NotificationView) => n.segments.map((x) => x.text).join('');

describe('LinkedIn-style notifications: profile views, messages, post performance and network', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  const connect = async (a: Member, b: Member) => {
    const req = await a.post('/connections', { memberId: b.id }).expect(201);
    await b.post(`/connections/${req.body.id}/accept`).expect(200);
  };
  const notes = async (m: Member, filter = 'all'): Promise<NotificationView[]> => (await m.get(`/notifications?filter=${filter}&limit=50`).expect(200)).body.items;
  const ofType = async (m: Member, type: string) => (await notes(m)).filter((n) => n.type === type);
  const rows = (userId: string, type: string) => t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type)));

  describe('who viewed your profile', () => {
    it('records one view per viewer a day, never self-views, blocked pairs or staff in the admin console', async () => {
      const owner = await createMember(t, { name: 'Wanjiru Kamau' });
      const viewer = await createMember(t, { name: 'Amara Okafor' });
      const blocked = await createMember(t, { name: 'Blocked Viewer' });
      const staff = await createMember(t, { roles: ['moderator'], admin: true });
      await block(t, owner.id, blocked.id);

      await viewer.post(`/members/${owner.handle}/views`).expect(200);
      await viewer.post(`/members/${owner.handle}/views`).expect(200);
      await owner.post(`/members/${owner.handle}/views`).expect(200);
      await blocked.post(`/members/${owner.handle}/views`).expect(200);
      await staff.post(`/members/${owner.handle}/views`);
      await viewer.post('/members/no-such-member/views').expect(200);
      expect(await count(t.db, s.profileViews, eq(s.profileViews.profileId, owner.id))).toBe(1);

      const summary = (await owner.get('/me/profile-views/summary').expect(200)).body as ProfileViewsSummary;
      expect(summary).toMatchObject({ total: 1, last7: 1, last30: 1, previous30: 0, canSeeViewers: true, viewing: 'named' });
      expect(summary.daily).toHaveLength(30);
      expect(summary.daily.at(-1)!.views).toBe(1);

      const page = (await owner.get('/me/profile-views').expect(200)).body as ProfileViewsPage;
      expect(page.items).toEqual([expect.objectContaining({ member: expect.objectContaining({ id: viewer.id }), days: 1, connection: false })]);
      expect(page.anonymous).toEqual([]);

      // One notification for the day, naming the viewer; the second view didn't add another.
      const views = await ofType(owner, 'profile_viewed');
      expect(views).toHaveLength(1);
      expect(text(views[0]!)).toBe('Amara Okafor viewed your profile');
      expect(views[0]!.href).toBe('/profile-views');
      expect(views[0]!.icon).toBe('eye');
      // Default: in-app only.
      expect(await count(t.db, s.emailOutbox, like(s.emailOutbox.template, 'notification.profile_viewed'))).toBe(0);
    });

    it('private mode hides the viewer everywhere, and private-mode members see counts but not who', async () => {
      const owner = await createMember(t, { name: 'Leila Benali' });
      const named = await createMember(t, { name: 'Kwame Mensah' });
      const hidden = await createMember(t, { name: 'Secret Viewer' });
      const hidden2 = await createMember(t, { name: 'Second Secret' });
      await hidden.patch('/me/profile', { organisation: 'PayBridge' }).expect(200);
      await hidden2.patch('/me/profile', { organisation: 'PayBridge' }).expect(200);
      for (const m of [hidden, hidden2]) {
        const res = await m.put('/me/privacy', { profileViewing: 'private' }).expect(200);
        expect((res.body as OwnProfile).profileViewing).toBe('private');
      }
      await owner.put('/me/notification-preferences', { preferences: [{ category: 'profile', channel: 'email', enabled: true }] }).expect(200);

      await hidden.post(`/members/${owner.handle}/views`).expect(200);
      // Only a private viewer so far: a count, no name.
      let [note] = await ofType(owner, 'profile_viewed');
      expect(note!.actors).toEqual([]);
      expect(text(note!)).toBe('Someone viewed your profile');
      // The email went out once, without the name.
      const [mail] = await t.db.select().from(s.emailOutbox).where(and(eq(s.emailOutbox.toAddress, owner.email.toLowerCase()), like(s.emailOutbox.template, 'notification.profile_viewed')));
      expect(mail).toBeTruthy();
      expect(JSON.stringify(mail)).not.toContain('Secret Viewer');

      await named.post(`/members/${owner.handle}/views`).expect(200);
      await hidden2.post(`/members/${owner.handle}/views`).expect(200);
      const all = await ofType(owner, 'profile_viewed');
      expect(all).toHaveLength(1);
      note = all[0]!;
      expect(note.actors.map((a) => a.id)).toEqual([named.id]);
      expect(note.actorCount).toBe(3);
      expect(text(note)).toBe('Kwame Mensah and 2 others viewed your profile');
      // Updates don't send more emails.
      expect(await count(t.db, s.emailOutbox, and(eq(s.emailOutbox.toAddress, owner.email.toLowerCase()), like(s.emailOutbox.template, 'notification.profile_viewed')))).toBe(1);
      const stored = await rows(owner.id, 'profile_viewed');
      expect(stored[0]!.actorIds).toEqual([named.id]);

      const page = (await owner.get('/me/profile-views').expect(200)).body as ProfileViewsPage;
      expect(page.items.map((i) => i.member.id)).toEqual([named.id]);
      expect(page.anonymous).toEqual([expect.objectContaining({ kind: 'company', name: 'PayBridge', count: 2 })]);
      expect(JSON.stringify(page)).not.toContain(hidden.id);
      expect(JSON.stringify(page)).not.toContain('Secret');

      // The owner switches to private mode: counts only, no names in the list or the notification.
      await owner.put('/me/privacy', { profileViewing: 'private' }).expect(200);
      const privatePage = (await owner.get('/me/profile-views').expect(200)).body as ProfileViewsPage;
      expect(privatePage.summary).toMatchObject({ total: 3, canSeeViewers: false, viewing: 'private' });
      expect(privatePage.items).toEqual([]);
      expect(privatePage.anonymous).toEqual([]);
      const another = await createMember(t, { name: 'Fourth Viewer' });
      await another.post(`/members/${owner.handle}/views`).expect(200);
      [note] = await ofType(owner, 'profile_viewed');
      expect(note!.actors).toEqual([]);
      expect(text(note!)).toBe('4 people viewed your profile');
    });

    it('anonymous viewers fall back to their chapter, then to "a member"; preferences can turn it off', async () => {
      const owner = await createMember(t, { name: 'Prefs Owner' });
      const inChapter = await createMember(t, { name: 'Chapter Person', countryCode: 'KE' });
      const plain = await createMember(t, { name: 'Plain Person' });
      const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.countryCode, 'KE')).limit(1);
      await follow(t, inChapter.id, 'chapter', chapter!.id);
      for (const m of [inChapter, plain]) await m.put('/me/privacy', { profileViewing: 'private' }).expect(200);
      await owner.put('/me/notification-preferences', { preferences: [{ category: 'profile', channel: 'in_app', enabled: false }] }).expect(200);
      await inChapter.post(`/members/${owner.handle}/views`).expect(200);
      await plain.post(`/members/${owner.handle}/views`).expect(200);
      expect(await ofType(owner, 'profile_viewed')).toHaveLength(0);
      const page = (await owner.get('/me/profile-views').expect(200)).body as ProfileViewsPage;
      expect(page.anonymous).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'chapter', name: chapter!.name, count: 1 }),
          expect.objectContaining({ kind: 'member', name: null, count: 1 }),
        ]),
      );
    });

    it('counts people search appearances and deletes views older than 90 days', async () => {
      const owner = await createMember(t, { name: 'Zainab Searchable' });
      const searcher = await createMember(t);
      await searcher.get('/members?q=Zainab%20Searchable&limit=10').expect(200);
      // Type-ahead pickers don't count.
      await searcher.get('/members?q=Zainab&limit=5').expect(200);
      expect(((await owner.get('/me/profile-views/summary').expect(200)).body as ProfileViewsSummary).searchAppearances).toEqual({ last7: 1, previous7: 0 });

      await t.db.insert(s.profileViews).values({ profileId: owner.id, viewerId: searcher.id, day: '2020-01-01', viewedAt: new Date('2020-01-01') });
      const removed = await t.app.get(ProfileViewsService).cleanup();
      expect(removed.views).toBeGreaterThanOrEqual(1);
      expect(await count(t.db, s.profileViews, eq(s.profileViews.profileId, owner.id))).toBe(0);
    });
  });

  describe('messages', () => {
    it('a reply to your message notifies at once, instead of the daily message notice', async () => {
      const amara = await createMember(t, { name: 'Amara Reply' });
      const kwame = await createMember(t, { name: 'Kwame Reply' });
      await connect(amara, kwame);
      const convo = (await amara.post('/messages/conversations', { memberId: kwame.id }).expect(200)).body as { id: string };
      const first = (await amara.post(`/messages/conversations/${convo.id}/messages`, { body: 'Are you coming to Accra?' }).expect(201)).body as { id: string };
      expect(await ofType(kwame, 'message_received')).toHaveLength(1);

      await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'Yes, see you there', replyToId: first.id }).expect(201);
      const replies = await ofType(amara, 'message_reply');
      expect(replies).toHaveLength(1);
      expect(text(replies[0]!)).toBe('Kwame Reply replied to your message: “Yes, see you there”');
      expect(replies[0]!.href).toMatch(new RegExp(`^/messages/${convo.id}\\?around=`));
      expect(await ofType(amara, 'message_received')).toHaveLength(0);

      // A second reply is its own notification; a plain message is the usual daily notice.
      await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'And bring the deck', replyToId: first.id }).expect(201);
      await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'Plain message' }).expect(201);
      expect(await ofType(amara, 'message_reply')).toHaveLength(2);
      expect(await ofType(amara, 'message_received')).toHaveLength(1);
      // Replying to your own message notifies nobody about a reply.
      const own = (await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'Mine' }).expect(201)).body as { id: string };
      await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'Me again', replyToId: own.id }).expect(201);
      expect(await ofType(kwame, 'message_reply')).toHaveLength(0);

      // Reading the conversation clears its notifications.
      await amara.post(`/messages/conversations/${convo.id}/read`).expect(204);
      expect((await notes(amara, 'messages')).every((n) => n.read)).toBe(true);
    });

    it('reactions to your message are grouped per conversation per day, and muted conversations stay quiet', async () => {
      const owner = await createMember(t, { name: 'Group Owner' });
      const a = await createMember(t, { name: 'Reactor A' });
      const b = await createMember(t, { name: 'Reactor B' });
      await connect(owner, a);
      await connect(owner, b);
      const group = (await owner.post('/messages/groups', { title: 'Accra team', memberIds: [a.id, b.id] }).expect(201)).body as { id: string };
      const msg = (await owner.post(`/messages/conversations/${group.id}/messages`, { body: 'Kick-off on Monday' }).expect(201)).body as { id: string };
      await a.put(`/messages/${msg.id}/reaction`, { emoji: '👍' }).expect(200);
      await a.put(`/messages/${msg.id}/reaction`, { emoji: '🎉' }).expect(200);
      await b.put(`/messages/${msg.id}/reaction`, { emoji: '👍' }).expect(200);
      const reactions = await ofType(owner, 'message_reaction');
      expect(reactions).toHaveLength(1);
      expect(reactions[0]!.actorCount).toBe(2);
      expect(text(reactions[0]!)).toBe('Reactor B and Reactor A reacted to your message');
      // Reacting to your own message is not news.
      await owner.put(`/messages/${msg.id}/reaction`, { emoji: '👍' }).expect(200);
      expect((await ofType(owner, 'message_reaction'))[0]!.actorCount).toBe(2);
      // No email for reactions.
      expect(await count(t.db, s.emailOutbox, like(s.emailOutbox.template, 'notification.message_reaction'))).toBe(0);

      // a mutes the group: their message gets no reaction notice.
      const fromA = (await a.post(`/messages/conversations/${group.id}/messages`, { body: 'Agenda attached' }).expect(201)).body as { id: string };
      await t.db.update(s.conversationMembers).set({ mutedUntil: new Date(Date.now() + 3_600_000) }).where(and(eq(s.conversationMembers.conversationId, group.id), eq(s.conversationMembers.userId, a.id)));
      await owner.put(`/messages/${fromA.id}/reaction`, { emoji: '👍' }).expect(200);
      expect(await ofType(a, 'message_reaction')).toHaveLength(0);
    });
  });

  describe('post performance', () => {
    const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

    it('impressions and reactions milestones are announced once each', async () => {
      const author = await createMember(t, { name: 'Milestone Author' });
      const reader = await createMember(t);
      const p = await createPost(author, 'Ten lessons from building PayBridge across six markets');
      await t.db.insert(s.postViewDays).values({ postId: p.id, day: day(), impressions: 99, viewers: 99 });
      await reader.post('/posts/views', { postIds: [p.id] }).expect(200);
      let milestones = await ofType(author, 'post_milestone');
      expect(milestones).toHaveLength(1);
      expect(text(milestones[0]!)).toBe('Your post is doing well: 100 impressions “Ten lessons from building PayBridge across six markets”');
      expect(milestones[0]!.href).toBe(`/posts/${p.id}/analytics`);
      expect(milestones[0]!.icon).toBe('chart');

      // More views below the next milestone: nothing new.
      const reader2 = await createMember(t);
      await reader2.post('/posts/views', { postIds: [p.id] }).expect(200);
      expect(await ofType(author, 'post_milestone')).toHaveLength(1);

      // Reactions: the 10th reaction reaches the first milestone, once.
      await t.db.update(s.posts).set({ reactionCount: 9 }).where(eq(s.posts.id, p.id));
      await reader.put('/reactions', { targetType: 'post', targetId: p.id }).expect(200);
      await reader2.put('/reactions', { targetType: 'post', targetId: p.id }).expect(200);
      milestones = await ofType(author, 'post_milestone');
      expect(milestones.map(text)).toContain('Your post is doing well: 10 reactions “Ten lessons from building PayBridge across six markets”');
      expect(milestones).toHaveLength(2);
      // Reactions read like LinkedIn.
      const [reacted] = await ofType(author, 'reaction');
      expect(text(reacted!)).toMatch(/ and .* reacted to your post$/);
    });

    it('"doing better than usual" compares with the author’s last posts, once per post', async () => {
      const author = await createMember(t, { name: 'Trending Author' });
      const quiet = await createMember(t, { name: 'New Author' });
      const old = new Date(Date.now() - 10 * 86_400_000);
      for (let i = 0; i < 3; i++) {
        const [earlier] = await t.db.insert(s.posts).values({ authorId: author.id, body: `Earlier ${i}`, createdAt: new Date(old.getTime() + i * 3_600_000) }).returning();
        await t.db.insert(s.postViewDays).values({ postId: earlier!.id, day: old.toISOString().slice(0, 10), impressions: 30, viewers: 30 });
      }
      const hot = await createPost(author, 'Our cooperative just signed its first export deal');
      await t.db.insert(s.postViewDays).values({ postId: hot.id, day: day(), impressions: 75, viewers: 70 });
      // Not enough history: no comparison.
      const fresh = await createPost(quiet, 'My very first post');
      await t.db.insert(s.postViewDays).values({ postId: fresh.id, day: day(), impressions: 500, viewers: 400 });

      const jobs = t.app.get(PostMilestonesService);
      expect(await jobs.trending()).toBe(1);
      expect(await jobs.trending()).toBe(0);
      const [note] = await ofType(author, 'post_trending');
      expect(text(note!)).toBe('Your post is doing better than usual “Our cooperative just signed its first export deal”');
      expect(await ofType(quiet, 'post_trending')).toHaveLength(0);
    });
  });

  describe('network', () => {
    it('follows are grouped per day, and followers milestones are announced once', async () => {
      const target = await createMember(t, { name: 'Popular Member' });
      const fans: Member[] = [];
      for (let i = 0; i < 2; i++) fans.push(await createMember(t, { name: `Fan ${i}` }));
      for (const f of fans) await f.post('/follows', { targetType: 'member', targetId: target.id }).expect(201);
      const follows = await ofType(target, 'follow');
      expect(follows).toHaveLength(1);
      expect(follows[0]!.actorCount).toBe(2);
      expect(text(follows[0]!)).toBe('Fan 1 and Fan 0 started following you');
      expect(follows[0]!.href).toBe(`/${target.handle}`);

      // 7 more followers straight in the table, then the 10th through the API.
      for (let i = 0; i < 7; i++) {
        const m = await createMember(t);
        await follow(t, m.id, 'member', target.id);
      }
      const tenth = await createMember(t);
      await tenth.post('/follows', { targetType: 'member', targetId: target.id }).expect(201);
      const milestones = await ofType(target, 'follower_milestone');
      expect(milestones).toHaveLength(1);
      expect(text(milestones[0]!)).toBe('You reached a milestone: 10 followers');
      await tenth.delete('/follows', { targetType: 'member', targetId: target.id });
      await tenth.post('/follows', { targetType: 'member', targetId: target.id }).expect(201);
      expect(await ofType(target, 'follower_milestone')).toHaveLength(1);
    });

    it('a connection’s first post in 30 days notifies their connections, at most 3 a day each', async () => {
      const reader = await createMember(t, { name: 'Busy Reader' });
      const authors: Member[] = [];
      for (let i = 0; i < 4; i++) {
        const a = await createMember(t, { name: `Rare Poster ${i}` });
        await connect(reader, a);
        authors.push(a);
      }
      await createPost(authors[0]!, 'Back after a long break: what I learned in Kigali');
      const [note] = await ofType(reader, 'connection_post');
      expect(text(note!)).toBe('Rare Poster 0 shared a post: “Back after a long break: what I learned in Kigali”');
      // Their second post isn't news.
      await createPost(authors[0]!, 'And another thought');
      expect(await ofType(reader, 'connection_post')).toHaveLength(1);
      for (const a of authors.slice(1)) await createPost(a, `Hello from ${a.name}`);
      expect(await ofType(reader, 'connection_post')).toHaveLength(3);
      // In-app only.
      expect(await count(t.db, s.emailOutbox, like(s.emailOutbox.template, 'notification.connection_post'))).toBe(0);
    });

    it('commenters hear about new comments on the post (grouped), the author only once', async () => {
      const author = await createMember(t, { name: 'Thread Author' });
      const first = await createMember(t, { name: 'First Commenter' });
      const second = await createMember(t, { name: 'Second Commenter' });
      const third = await createMember(t, { name: 'Third Commenter' });
      const p = await createPost(author, 'What does AfCFTA change for small exporters?');
      await first.post(`/posts/${p.id}/comments`, { body: 'Paperwork, mostly' }).expect(201);
      await second.post(`/posts/${p.id}/comments`, { body: 'Tariffs too' }).expect(201);
      await third.post(`/posts/${p.id}/comments`, { body: 'And logistics' }).expect(201);
      const followed = await ofType(first, 'comment_on_followed_post');
      expect(followed).toHaveLength(1);
      expect(followed[0]!.actorCount).toBe(2);
      expect(text(followed[0]!)).toBe('Third Commenter and Second Commenter also commented on a post you commented on');
      expect(await ofType(second, 'comment_on_followed_post')).toHaveLength(1);
      expect(await ofType(author, 'comment_on_followed_post')).toHaveLength(0);
      expect(await ofType(author, 'comment_on_post')).toHaveLength(3);
      // Blocks are respected.
      await block(t, first.id, author.id);
      await author.post(`/posts/${p.id}/comments`, { body: 'Thanks all' }).expect(201);
      expect((await ofType(first, 'comment_on_followed_post'))[0]!.actorCount).toBe(2);
    });
  });

  it('filters the list: my posts, mentions, messages and network', async () => {
    const me = await createMember(t, { name: 'Filter Owner', handle: 'filter-owner' });
    const other = await createMember(t, { name: 'Filter Friend' });
    const p = await createPost(me, 'Filters');
    await other.put('/reactions', { targetType: 'post', targetId: p.id }).expect(200);
    await createPost(other, 'Hello @filter-owner');
    await other.post('/follows', { targetType: 'member', targetId: me.id }).expect(201);
    await other.post(`/members/${me.handle}/views`).expect(200);
    await connect(me, other);
    const convo = (await other.post('/messages/conversations', { memberId: me.id }).expect(200)).body as { id: string };
    await other.post(`/messages/conversations/${convo.id}/messages`, { body: 'Hi' }).expect(201);

    const types = async (filter: string) => new Set((await notes(me, filter)).map((n) => n.type));
    expect(await types('my_posts')).toEqual(new Set(['reaction']));
    expect(await types('mentions')).toEqual(new Set(['mention']));
    expect(await types('messages')).toEqual(new Set(['message_received']));
    expect(await types('network')).toEqual(new Set(['follow', 'profile_viewed', 'connection_accepted']));
    expect((await types('all')).size).toBe(6);
    await me.get('/notifications?filter=nope').expect(422);
    // Unread badge counts everything, as before.
    expect((await me.get('/notifications/unread-count').expect(200)).body.unread).toBe(6);
  });

  it('new categories have conservative defaults', async () => {
    const m = await createMember(t);
    const prefs = (await m.get('/me/notification-preferences').expect(200)).body.preferences as { category: string; channel: string; enabled: boolean }[];
    for (const category of ['profile', 'post_performance']) {
      expect(prefs).toContainEqual({ category, channel: 'in_app', enabled: true });
      expect(prefs).toContainEqual({ category, channel: 'email', enabled: false });
      expect(prefs).toContainEqual({ category, channel: 'push', enabled: false });
    }
  });
});
