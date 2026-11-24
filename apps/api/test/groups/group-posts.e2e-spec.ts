import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GroupDetail, MomentsResponse, Page, PostView, PromptMoment, WelcomeSummary } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits } from '../auth/support.js';
import { createPost, setTrendingRules } from '../social/social-helpers.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { computeTrending } from '../../src/topics/trending.js';
import { DraftsService } from '../../src/posts/drafts.service.js';
import { MediaService } from '../../src/media/media.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/*
 * Posts in groups: a private group's posts never reach people outside it, on any surface; group posts
 * reach the home feed of members only; approval, removal and pins; archived, suspended and deleted groups.
 */
describe('Groups: posts and where they show', () => {
  let t: TestApp;
  let owner: Member;
  let insider: Member;
  let outsider: Member;
  let moderator: Member;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await createMember(t, { name: 'Gina Owner' });
    insider = await createMember(t, { name: 'Ian Insider' });
    outsider = await createMember(t, { name: 'Olu Outsider' });
    moderator = await createMember(t, { name: 'Staff Moderator', roles: ['moderator'] });
    await t.app.get(SettingsService).set('groups', { whoCanCreate: 'everyone', maxOwnedPerMember: 20 }, null);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  let n = 0;
  async function makeGroup(extra: Record<string, unknown> = {}, members: Member[] = [insider]) {
    n += 1;
    const res = await owner.post('/groups', { name: `Post Group ${n}`, visibility: 'public', ...extra });
    if (res.status !== 201) throw new Error(`group create failed: ${res.status} ${JSON.stringify(res.body)}`);
    const g = res.body as GroupDetail;
    for (const m of members) {
      await m.post(`/groups/${g.slug}/join`, { answer: 'Hello' }).expect(200);
      if (g.visibility === 'private') await owner.post(`/groups/${g.slug}/members/${m.id}`, { action: 'approve' }).expect(200);
    }
    return g;
  }

  const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id);
  const feed = async (m: Member, q: string) => ids((await m.get(`/feed?${q}`).expect(200)).body as Page<PostView>);
  const groupRow = async (id: string) => (await t.db.select().from(s.groups).where(eq(s.groups.id, id)))[0]!;

  describe('a private group’s post', () => {
    let g: GroupDetail;
    let post: PostView;
    let tag: string;

    beforeAll(async () => {
      g = await makeGroup({ visibility: 'private' });
      tag = `secretplans${randomBytes(3).toString('hex')}`;
      post = (await createPost(insider, `Our next move #${tag} #DailyPrompt @${outsider.handle}`, { groupId: g.id, visibility: 'public' })) as unknown as PostView;
    });

    it('is stored for members only, whatever visibility was asked, and named with its group', async () => {
      expect(post.group).toMatchObject({ id: g.id, slug: g.slug, visibility: 'private' });
      const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
      expect(row).toMatchObject({ visibility: 'group', groupId: g.id, status: 'published' });
      expect((await groupRow(g.id)).postCount).toBe(1);
    });

    it('opens for members and staff, never for others or visitors', async () => {
      await owner.get(`/posts/${post.id}`).expect(200);
      await moderator.get(`/posts/${post.id}`).expect(200);
      await outsider.get(`/posts/${post.id}`).expect(404);
      await t.http().get(`/api/v1/posts/${post.id}`).expect(404);
      await outsider.get(`/posts/${post.id}/comments`).expect(404);
      await outsider.get(`/posts/${post.id}/reactions`).expect(404);
      await outsider.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'like' }).expect(404);
      await outsider.post(`/posts/${post.id}/comments`, { body: 'Let me in' }).expect(404);
      await outsider.put('/bookmarks', { targetType: 'post', targetId: post.id }).expect(404);
      await owner.post(`/posts/${post.id}/comments`, { body: 'Good plan' }).expect(201);
      expect((await insider.get(`/posts/${post.id}/comments`).expect(200)).body.items).toHaveLength(1);
    });

    it('stays out of every feed, profile, topic and card for non-members', async () => {
      for (const tab of ['for_you', 'following', 'latest']) {
        expect(await feed(outsider, `tab=${tab}`), tab).not.toContain(post.id);
        expect(await feed(owner, `tab=${tab}`), tab).toContain(post.id);
      }
      expect(await feed(outsider, `author=${insider.handle}`)).not.toContain(post.id);
      expect(await feed(owner, `author=${insider.handle}`)).toContain(post.id);
      expect(ids((await outsider.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([]);
      expect(ids((await owner.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([post.id]);
      // A tag used only in private groups: no topic page, for anyone.
      await outsider.get(`/topics/${tag}`).expect(404);
      await owner.get(`/topics/${tag}`).expect(404);
      const topics = (await outsider.get(`/topics?q=${tag}`).expect(200)).body.items as { tag: string; posts7d: number }[];
      expect(topics.every((x) => x.posts7d === 0)).toBe(true);
      // A tag used only in private groups has no posts to count, so it isn't listed on /topics at all.
      expect(topics.map((x) => x.tag)).not.toContain(tag);
      const [counted] = await t.db.select({ n: s.hashtags.postCount }).from(s.hashtags).where(eq(s.hashtags.tag, tag));
      expect(counted!.n).toBe(0);

      // Home cards: today's prompt answers and the welcome strip's new posts.
      const prompt = (m: Member) => m.get('/home/moments').expect(200).then((r) => (r.body as MomentsResponse).moments.find((x) => x.kind === 'prompt') as PromptMoment | undefined);
      expect((await prompt(outsider))?.responses ?? 0).toBe(0);
      expect((await prompt(owner))?.responses).toBe(1);
      const welcome = (await outsider.get('/home/welcome').expect(200)).body as WelcomeSummary;
      expect(welcome.stats.newPostId).not.toBe(post.id);

      // Bookmarks: a member who bookmarked it loses it on leaving.
      const leaver = await createMember(t, { name: 'Leaving Member' });
      await leaver.post(`/groups/${g.slug}/join`, { answer: 'Hi' }).expect(200);
      await owner.post(`/groups/${g.slug}/members/${leaver.id}`, { action: 'approve' }).expect(200);
      await leaver.put('/bookmarks', { targetType: 'post', targetId: post.id }).expect(200);
      expect(ids((await leaver.get('/me/bookmarks').expect(200)).body)).toEqual([post.id]);
      await leaver.post(`/groups/${g.slug}/leave`).expect(200);
      expect(ids((await leaver.get('/me/bookmarks').expect(200)).body)).toEqual([]);
      await leaver.get(`/posts/${post.id}`).expect(404);
    });

    it('never trends, and gets no link preview or share card', async () => {
      await setTrendingRules(t, { minDistinctAuthors: 2, maxPostsPerAuthorPerHour: 5, baselineDays: 14, recomputeMinutes: 5 });
      const trendTag = `hush${randomBytes(3).toString('hex')}`;
      await createPost(insider, `Quiet #${trendTag}`, { groupId: g.id });
      await createPost(owner, `Very quiet #${trendTag}`, { groupId: g.id });
      await computeTrending(t.db);
      const trending = (await outsider.get('/trending?window=24h&limit=20').expect(200)).body.items as { tag: string }[];
      expect(trending.map((x) => x.tag.toLowerCase())).not.toContain(trendTag);

      await t.http().get(`/api/v1/public/preview?path=${encodeURIComponent(`/posts/${post.id}`)}`).expect(404);
      // The group itself is listed, so its link shows its name.
      const preview = await t.http().get(`/api/v1/public/preview?path=${encodeURIComponent(`/groups/${g.slug}`)}`).expect(200);
      expect(preview.body.title).toContain(g.name);
    });

    it('can’t be reposted; a repost of a group’s post shows as unavailable once the group goes private', async () => {
      await insider.post('/posts', { body: '', repostOfId: post.id }).expect(422);
      const pub = await makeGroup();
      const original = await createPost(insider, 'Open for now', { groupId: pub.id, visibility: 'public' });
      const repost = await createPost(outsider, 'Worth reading', { repostOfId: original.id });
      expect(((await outsider.get(`/posts/${repost.id}`).expect(200)).body as PostView).repostOf?.id).toBe(original.id);
      await owner.patch(`/groups/${pub.slug}`, { visibility: 'private' }).expect(200);
      const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, original.id));
      expect(row!.visibility).toBe('group');
      expect(((await outsider.get(`/posts/${repost.id}`).expect(200)).body as PostView).repostOf).toBeNull();
      expect(((await insider.get(`/posts/${repost.id}`).expect(200)).body as PostView).repostOf?.id).toBe(original.id);
      expect(await feed(outsider, `author=${outsider.handle}`)).toContain(repost.id);
      // And back: members-only posts, visible to members of the platform again.
      await owner.patch(`/groups/${pub.slug}`, { visibility: 'public' }).expect(200);
      const [back] = await t.db.select().from(s.posts).where(eq(s.posts.id, original.id));
      expect(back!.visibility).toBe('members');
      await outsider.get(`/posts/${original.id}`).expect(200);
    });

    it('tells only members about mentions, and keeps its media from non-members', async () => {
      expect(await notificationsFor(t, outsider.id, 'mention')).toHaveLength(0);
      const mentioned = await createPost(owner, `Thanks @${insider.handle}`, { groupId: g.id });
      expect((await notificationsFor(t, insider.id, 'mention')).some((x) => x.objectId === mentioned.id)).toBe(true);

      const storageKey = `uploads/post_image/${randomBytes(6).toString('hex')}`;
      await t.app.get(MediaService).storage.write(storageKey, Buffer.from('not really a png'), 'image/png');
      const [file] = await t.db
        .insert(s.files)
        .values({ ownerId: insider.id, purpose: 'post_image', storageKey, declaredMime: 'image/png', mime: 'image/png', sizeBytes: 16, scanStatus: 'clean', attachedAt: new Date() })
        .returning();
      await t.db.insert(s.postAttachments).values({ postId: post.id, fileId: file!.id, kind: 'image', position: 0 });
      await outsider.get(`/media/${file!.id}`).expect(404);
      await t.http().get(`/api/v1/media/${file!.id}`).expect(401);
      expect([200, 302]).toContain((await owner.get(`/media/${file!.id}`)).status);
    });
  });

  describe('public groups and the home feed', () => {
    it('reach the home feed of members only, but show on profiles, topics and the group to anyone', async () => {
      const g = await makeGroup();
      const tag = `opengroup${randomBytes(3).toString('hex')}`;
      const post = await createPost(insider, `Hello all #${tag}`, { groupId: g.id, visibility: 'public' });
      for (const tab of ['for_you', 'following', 'latest']) {
        expect(await feed(outsider, `tab=${tab}`), tab).not.toContain(post.id);
        expect(await feed(owner, `tab=${tab}`), tab).toContain(post.id);
      }
      expect(await feed(outsider, `author=${insider.handle}`)).toContain(post.id);
      expect(ids((await outsider.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([post.id]);
      expect(await feed(outsider, `group=${g.slug}`)).toEqual([post.id]);
      await outsider.get(`/posts/${post.id}`).expect(200);
      await outsider.post(`/posts/${post.id}/comments`, { body: 'Nice' }).expect(201);
      // Visitors see a public group's public posts.
      expect(ids((await t.http().get(`/api/v1/feed?group=${g.slug}`).expect(200)).body)).toEqual([post.id]);
      await t.http().get(`/api/v1/posts/${post.id}`).expect(200);
      await t.http().get(`/api/v1/public/preview?path=${encodeURIComponent(`/posts/${post.id}`)}`).expect(200);
    });

    it('lets only members post (and only moderators in admins-only groups), and not as a page or in a chapter', async () => {
      const g = await makeGroup({ postPermission: 'admins' });
      await outsider.post('/posts', { body: 'Hi', groupId: g.id }).expect(403);
      expect((await insider.post('/posts', { body: 'Hi', groupId: g.id }).expect(403)).body.error.message).toContain('admins and moderators');
      await createPost(owner, 'Admins only here', { groupId: g.id });
      const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'ghana'));
      await owner.post('/posts', { body: 'Both', groupId: g.id, chapterId: chapter!.id }).expect(422);
      await owner.post('/posts', { body: 'Loud', groupId: g.id, kind: 'announcement' }).expect(422);
    });

    it('group feed: pinned first, newest next; pins are capped', async () => {
      const g = await makeGroup();
      const a = await createPost(insider, 'First', { groupId: g.id });
      const b = await createPost(insider, 'Second', { groupId: g.id });
      const c = await createPost(insider, 'Third', { groupId: g.id });
      expect(await feed(insider, `group=${g.slug}`)).toEqual([c.id, b.id, a.id]);
      await insider.post(`/groups/${g.slug}/posts/${a.id}`, { action: 'pin' }).expect(403);
      await owner.post(`/groups/${g.slug}/posts/${a.id}`, { action: 'pin' }).expect(200);
      expect(await feed(insider, `group=${g.slug}`)).toEqual([a.id, c.id, b.id]);
      expect(((await insider.get(`/posts/${a.id}`).expect(200)).body as PostView).pinned).toBe(true);
      const page1 = (await insider.get(`/feed?group=${g.slug}&limit=2`).expect(200)).body as Page<PostView>;
      const page2 = (await insider.get(`/feed?group=${g.slug}&limit=2&cursor=${page1.nextCursor}`).expect(200)).body as Page<PostView>;
      expect([...ids(page1), ...ids(page2)]).toEqual([a.id, c.id, b.id]);
      await owner.post(`/groups/${g.slug}/posts/${b.id}`, { action: 'pin' }).expect(200);
      await owner.post(`/groups/${g.slug}/posts/${c.id}`, { action: 'pin' }).expect(200);
      const d = await createPost(insider, 'Fourth', { groupId: g.id });
      await owner.post(`/groups/${g.slug}/posts/${d.id}`, { action: 'pin' }).expect(409);
      await owner.post(`/groups/${g.slug}/posts/${a.id}`, { action: 'unpin' }).expect(200);
      expect((await feed(insider, `group=${g.slug}`))[3]).toBe(a.id);
    });
  });

  describe('approval, removal and the group’s state', () => {
    it('members’ posts wait for a moderator; the author sees where it stands; approve, decline and remove', async () => {
      const g = await makeGroup({ postApproval: true });
      const waiting = await createPost(insider, `Please approve @${outsider.handle}`, { groupId: g.id });
      expect(waiting.status).toBe('in_review');
      expect(waiting.groupReview).toEqual({ state: 'pending', note: null });
      // Moderators (owner) post straight away.
      expect((await createPost(owner, 'No wait for me', { groupId: g.id })).status).toBe('published');
      await outsider.get(`/posts/${waiting.id}`).expect(404);
      expect(await feed(owner, `group=${g.slug}`)).not.toContain(waiting.id);
      expect(await feed(insider, `group=${g.slug}`)).toContain(waiting.id);
      const second = await createPost(insider, 'Another one', { groupId: g.id });

      const pendingNotes = await notificationsFor(t, owner.id, 'group_post_pending');
      expect(pendingNotes).toHaveLength(1);
      expect(((await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).pending).toEqual({ requests: 0, posts: 2 });
      await insider.get(`/groups/${g.slug}/posts/pending`).expect(403);
      const queue = (await owner.get(`/groups/${g.slug}/posts/pending`).expect(200)).body as Page<PostView>;
      expect(ids(queue)).toEqual([waiting.id, second.id]);
      expect(queue.items[0]!.groupReview?.state).toBe('pending');
      expect((await groupRow(g.id)).postCount).toBe(1);
      expect(await notificationsFor(t, outsider.id, 'mention')).toHaveLength(0);

      await owner.post(`/groups/${g.slug}/posts/${waiting.id}`, { action: 'approve' }).expect(200);
      await owner.post(`/groups/${g.slug}/posts/${waiting.id}`, { action: 'approve' }).expect(409);
      await outsider.get(`/posts/${waiting.id}`).expect(200);
      expect((await groupRow(g.id)).postCount).toBe(2);
      expect((await notificationsFor(t, insider.id, 'group_post_review'))[0]?.data).toMatchObject({ icon: 'check' });
      // Approval publishes like a new post: the mention is sent now.
      expect(await notificationsFor(t, outsider.id, 'mention')).toHaveLength(1);

      await owner.post(`/groups/${g.slug}/posts/${second.id}`, { action: 'decline', note: 'Off topic' }).expect(200);
      const declined = (await insider.get(`/posts/${second.id}`).expect(200)).body as PostView;
      expect(declined).toMatchObject({ status: 'declined', groupReview: { state: 'declined', note: 'Off topic' } });
      expect(((await owner.get(`/posts/${waiting.id}`).expect(200)).body as PostView).groupReview?.state).toBe('approved');

      await owner.post(`/groups/${g.slug}/posts/${waiting.id}`, { action: 'remove', note: 'Spam link' }).expect(200);
      await insider.get(`/posts/${waiting.id}`).expect(404);
      const [removed] = await t.db.select().from(s.posts).where(eq(s.posts.id, waiting.id));
      expect(removed!.deletedAt).not.toBeNull();
      expect(removed!.groupReviewNote).toBe('Spam link');
      expect((await groupRow(g.id)).postCount).toBe(1);
      const reviewNotes = await notificationsFor(t, insider.id, 'group_post_review');
      expect(reviewNotes.map((x) => (x.data as { icon: string }).icon).sort()).toEqual(['alert', 'alert', 'check']);
      const audit = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'group.post_remove'), eq(s.auditLog.targetId, waiting.id)));
      expect(audit).toHaveLength(1);
    });

    it('archived groups are read-only: no new posts, comments or reactions', async () => {
      const g = await makeGroup();
      const post = await createPost(insider, 'Before archiving', { groupId: g.id });
      await owner.patch(`/groups/${g.slug}`, { archived: true }).expect(200);
      await insider.get(`/posts/${post.id}`).expect(200);
      expect(await feed(outsider, `group=${g.slug}`)).toEqual([post.id]);
      await insider.post(`/posts/${post.id}/comments`, { body: 'Too late' }).expect(409);
      await insider.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'like' }).expect(409);
      await insider.post('/posts', { body: 'New', groupId: g.id }).expect(403);
    });

    it('suspended groups hide everything but the group page for its admins; deleted groups’ posts disappear', async () => {
      const g = await makeGroup();
      const tag = `vanish${randomBytes(3).toString('hex')}`;
      const post = await createPost(insider, `Here today #${tag}`, { groupId: g.id, visibility: 'public' });
      await t.db.update(s.groups).set({ status: 'suspended', statusNote: 'Under review' }).where(eq(s.groups.id, g.id));
      await insider.get(`/posts/${post.id}`).expect(404);
      await outsider.get(`/posts/${post.id}`).expect(404);
      await t.http().get(`/api/v1/posts/${post.id}`).expect(404);
      await insider.get(`/feed?group=${g.slug}`).expect(404);
      await insider.get(`/groups/${g.slug}`).expect(404);
      expect(((await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).statusNote).toBe('Under review');
      expect(await feed(outsider, `author=${insider.handle}`)).not.toContain(post.id);
      expect(await feed(insider, 'tab=latest')).not.toContain(post.id);
      expect(ids((await outsider.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([]);
      await t.http().get(`/api/v1/public/preview?path=${encodeURIComponent(`/posts/${post.id}`)}`).expect(404);
      await insider.post('/posts', { body: 'Hello?', groupId: g.id }).expect(403);

      await t.db.update(s.groups).set({ status: 'active', statusNote: null }).where(eq(s.groups.id, g.id));
      await outsider.get(`/posts/${post.id}`).expect(200);
      await owner.delete(`/groups/${g.slug}`).expect(200);
      await outsider.get(`/posts/${post.id}`).expect(404);
      await insider.get(`/posts/${post.id}`).expect(404);
      expect(await feed(outsider, `author=${insider.handle}`)).not.toContain(post.id);
      expect(ids((await outsider.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([]);
      const [kept] = await t.db.select().from(s.posts).where(eq(s.posts.id, post.id));
      expect(kept!.deletedAt).toBeNull();
    });

    it('a scheduled group post is checked again when it publishes', async () => {
      const g = await makeGroup();
      const later = new Date(Date.now() + 10 * 60_000).toISOString();
      const draft = await insider.post('/me/drafts', { payload: { body: 'Scheduled for the group', groupId: g.id }, scheduledFor: later }).expect(201);
      await outsider.post('/me/drafts', { payload: { body: 'Not my group', groupId: g.id } }).expect(403);
      await insider.post(`/groups/${g.slug}/leave`).expect(200);
      const result = await t.app.get(DraftsService).runDue(new Date(Date.now() + 20 * 60_000));
      expect(result.failed).toBeGreaterThanOrEqual(1);
      const [row] = await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, draft.body.id));
      expect(row).toMatchObject({ status: 'failed', lastError: 'Join this group to post in it' });
    });
  });
});
