import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BulkResult, GroupDetail, GroupSummary, HashtagSuggestion, Page, PostView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits } from '../auth/support.js';
import { createPost } from '../social/social-helpers.js';
import { SettingsService } from '../../src/infra/settings.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

/*
 * Groups: who keeps access when they leave or are banned, who runs page and chapter groups, rank rules
 * for moderators, counts, private activity and the smaller rules decided after review.
 */
describe('Groups: access rules after review', () => {
  let t: TestApp;
  let owner: Member;
  let ada: Member;
  let bola: Member;
  let outsider: Member;
  let staff: Member;
  let staffConsole: Member;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await createMember(t, { name: 'Rhoda Owner' });
    ada = await createMember(t, { name: 'Ada Rules' });
    bola = await createMember(t, { name: 'Bola Rules' });
    outsider = await createMember(t, { name: 'Otis Outside' });
    staff = await createMember(t, { name: 'Sam Staff', roles: ['moderator'] });
    staffConsole = await createMember(t, { name: 'Sam Console', roles: ['moderator'], admin: true });
    await t.app.get(SettingsService).set('groups', { whoCanCreate: 'everyone', maxOwnedPerMember: 20 }, null);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  let n = 0;
  async function makeGroup(by: Member, extra: Record<string, unknown> = {}, members: Member[] = []) {
    n += 1;
    const res = await by.post('/groups', { name: `Rules Group ${n}`, visibility: 'public', ...extra });
    if (res.status !== 201) throw new Error(`group create failed: ${res.status} ${JSON.stringify(res.body)}`);
    const g = res.body as GroupDetail;
    for (const m of members) await join(g, m, by);
    return g;
  }
  async function join(g: GroupDetail, m: Member, approver: Member = owner) {
    await m.post(`/groups/${g.slug}/join`, { answer: 'Hello' }).expect(200);
    if (g.visibility === 'private') await approver.post(`/groups/${g.slug}/members/${m.id}`, { action: 'approve' }).expect(200);
  }
  const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id);
  const feed = async (m: Member, q: string) => ids((await m.get(`/feed?${q}`).expect(200)).body as Page<PostView>);
  const groupRow = async (id: string) => (await t.db.select().from(s.groups).where(eq(s.groups.id, id)))[0]!;

  describe('1. leaving, removal and bans end access to a private group', () => {
    for (const how of ['leave', 'remove', 'ban'] as const) {
      it(`after ${how}: the author's own post opens alone, read-only; lists never show the group's posts`, async () => {
        const m = await createMember(t, { name: `Former ${how}` });
        const g = await makeGroup(owner, { visibility: 'private' }, [m]);
        const tag = `former${randomBytes(3).toString('hex')}`;
        const mine = await createPost(m, `Mine #${tag}`, { groupId: g.id, poll: { question: 'Which?', options: ['A', 'B'], durationHours: 24 } });
        const theirs = await createPost(owner, `Theirs #${tag}`, { groupId: g.id });
        await owner.post(`/posts/${mine.id}/comments`, { body: 'Members-only reply' }).expect(201);
        await owner.put('/reactions', { targetType: 'post', targetId: mine.id, kind: 'like' }).expect(200);
        await m.put('/bookmarks', { targetType: 'post', targetId: theirs.id }).expect(200);
        await m.put('/bookmarks', { targetType: 'post', targetId: mine.id }).expect(200);

        if (how === 'leave') await m.post(`/groups/${g.slug}/leave`).expect(200);
        else await owner.post(`/groups/${g.slug}/members/${m.id}`, { action: how }).expect(200);

        // Their own post: the post alone, with no sign of the conversation.
        const view = (await m.get(`/posts/${mine.id}`).expect(200)).body as PostView;
        expect(view.counts).toEqual({ reactions: 0, comments: 0, reposts: 0 });
        expect(view.reactionBreakdown).toEqual({ like: 0, insightful: 0, support: 0 });
        await m.get(`/posts/${mine.id}/comments`).expect(403);
        await m.get(`/posts/${mine.id}/reactions`).expect(403);
        await m.get(`/posts/${mine.id}/commenters`).expect(403);
        await m.get(`/posts/${mine.id}/reposts`).expect(403);
        await m.post(`/posts/${mine.id}/comments`, { body: 'Still here' }).expect(403);
        await m.put('/reactions', { targetType: 'post', targetId: mine.id, kind: 'like' }).expect(403);
        await m.post(`/posts/${mine.id}/poll/vote`, { optionId: view.poll!.options[0]!.id }).expect(403);
        await m.post('/posts', { body: '', repostOfId: mine.id }).expect(403);
        await m.patch(`/posts/${mine.id}`, { body: 'Edited after leaving' }).expect(403);
        // Everyone else's posts there: gone.
        await m.get(`/posts/${theirs.id}`).expect(404);

        // Lists: home feed, profile, topics and bookmarks never show the group's posts.
        expect(await feed(m, 'tab=latest')).not.toContain(mine.id);
        expect(await feed(m, `author=${m.handle}`)).not.toContain(mine.id);
        expect(ids((await m.get(`/topics/${tag}/posts?sort=latest`).expect(200)).body)).toEqual([]);
        expect(ids((await m.get('/me/bookmarks').expect(200)).body)).toEqual([]);

        // And they can still delete it.
        await m.delete(`/posts/${mine.id}`).expect(200);
        expect((await groupRow(g.id)).postCount).toBe(1);
      });
    }
  });

  describe('2 and 3. page and chapter groups', () => {
    it('the creator joins as an admin, not an owner; the page’s admins own it; ownership can’t be handed over', async () => {
      const [page] = await t.db.insert(s.pages).values({ slug: `rules-page-${randomBytes(3).toString('hex')}`, name: 'Rules Page', category: 'company', status: 'active', createdBy: owner.id }).returning();
      await t.db.insert(s.pageAdmins).values([
        { pageId: page!.id, userId: owner.id, role: 'owner' },
        { pageId: page!.id, userId: bola.id, role: 'admin' },
      ]);
      const g = await makeGroup(owner, { ownerType: 'page', pageId: page!.id, visibility: 'private' });
      expect(g.membership).toMatchObject({ status: 'active', role: 'admin', viaOwner: true });
      expect(g.abilities).toMatchObject({ own: true, manage: true });
      expect(g.admins.map((a) => [a.member.id, a.role])).toEqual([[owner.id, 'admin']]);
      const [row] = await t.db.select().from(s.groupMembers).where(eq(s.groupMembers.groupId, g.id));
      expect(row!.role).toBe('admin');
      await join(g, ada);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'transfer_ownership' }).expect(422);

      // People running it through the page can't be removed or banned inside the group.
      await bola.post(`/groups/${g.slug}/join`).expect(409);
      const removed = await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'ban' }).expect(403);
      expect(removed.body.error.message).toBe('They run this group through Rules Page. Remove them from the page’s admins instead.');
      await owner.post(`/groups/${g.slug}/members/${owner.id}`, { action: 'remove' }).expect(403);

      // Defence in depth: a ban row wins even over running it through the page.
      const post = await createPost(ada, 'For members', { groupId: g.id });
      await bola.get(`/posts/${post.id}`).expect(200);
      await t.db.insert(s.groupMembers).values({ groupId: g.id, userId: bola.id, role: 'member', status: 'banned' });
      const asBanned = (await bola.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(asBanned.membership).toMatchObject({ status: 'banned', role: null, viaOwner: false });
      expect(asBanned.abilities).toMatchObject({ seeContent: false, manage: false, own: false });
      await bola.get(`/posts/${post.id}`).expect(404);
      await bola.get(`/feed?group=${g.slug}`).expect(403);
      expect(await feed(bola, 'tab=latest')).not.toContain(post.id);
      expect(((await bola.get('/groups?scope=mine').expect(200)).body as Page<GroupSummary>).items.map((i) => i.id)).not.toContain(g.id);
    });

    it('chapter groups: the chapter team can’t be removed inside the group', async () => {
      const lead = await createMember(t, { name: 'Lead Rules' });
      const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'ghana'));
      const [role] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'chapter_lead'));
      await t.db.insert(s.userRoles).values({ userId: lead.id, roleId: role!.id, scopeType: 'chapter', scopeId: chapter!.id });
      const g = await makeGroup(lead, { ownerType: 'chapter', chapterId: chapter!.id });
      expect(g.membership.role).toBe('admin');
      const helper = await createMember(t, { name: 'Ambassador Rules' });
      const [amb] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'ambassador'));
      await t.db.insert(s.userRoles).values({ userId: helper.id, roleId: amb!.id, scopeType: 'chapter', scopeId: chapter!.id });
      // Also a member of the group (joined before they were on the team): still not removable here.
      await t.db.insert(s.groupMembers).values({ groupId: g.id, userId: helper.id, role: 'member', status: 'active', joinedAt: new Date() });
      const res = await lead.post(`/groups/${g.slug}/members/${helper.id}`, { action: 'remove' }).expect(403);
      expect(res.body.error.message).toBe(`They run this group through ${chapter!.name}. Remove them from the chapter team instead.`);
      const ban = await lead.post(`/groups/${g.slug}/members/${helper.id}`, { action: 'ban' }).expect(403);
      expect(ban.body.error.message).toContain('Remove them from the chapter team instead.');
    });
  });

  describe('4. bans in public groups', () => {
    it('banned people read public posts and their conversation but take no part', async () => {
      const g = await makeGroup(owner, {}, [ada]);
      const post = await createPost(ada, 'Open discussion', { groupId: g.id, poll: { question: 'Yes?', options: ['Yes', 'No'], durationHours: 24 } });
      await join(g, bola);
      await owner.post(`/groups/${g.slug}/members/${bola.id}`, { action: 'ban' }).expect(200);
      const view = (await bola.get(`/posts/${post.id}`).expect(200)).body as PostView;
      await bola.get(`/posts/${post.id}/comments`).expect(200);
      expect((await bola.post(`/posts/${post.id}/comments`, { body: 'Let me back' }).expect(403)).body.error.message).toContain('banned');
      await bola.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'like' }).expect(403);
      await bola.post(`/posts/${post.id}/poll/vote`, { optionId: view.poll!.options[0]!.id }).expect(403);
      await bola.post('/posts', { body: '', repostOfId: post.id }).expect(403);
      await bola.post('/posts', { body: 'Sneaking in', groupId: g.id }).expect(403);
      // Others still take part.
      await outsider.post(`/posts/${post.id}/comments`, { body: 'Hello' }).expect(201);
    });
  });

  describe('5. hashtags used only in private groups', () => {
    it('are never suggested and have no topic page, unless featured; empty tags otherwise still open', async () => {
      const g = await makeGroup(owner, { visibility: 'private' });
      const tag = `hushtag${randomBytes(3).toString('hex')}`;
      await createPost(owner, `Quiet #${tag}`, { groupId: g.id });
      const suggest = (await outsider.get(`/hashtags/suggest?q=${tag}`).expect(200)).body as HashtagSuggestion[];
      expect(suggest).toEqual([]);
      await outsider.get(`/topics/${tag}`).expect(404);
      await t.db.update(s.hashtags).set({ featured: true }).where(eq(s.hashtags.tag, tag));
      await outsider.get(`/topics/${tag}`).expect(200);
      expect(((await outsider.get(`/hashtags/suggest?q=${tag}`).expect(200)).body as HashtagSuggestion[]).map((x) => x.tag.toLowerCase())).toEqual([tag]);
      // A tag nobody posts with any more is still a (quiet) topic page.
      const empty = `emptytag${randomBytes(3).toString('hex')}`;
      await t.db.insert(s.hashtags).values({ tag: empty, display: empty, postCount: 0 });
      await outsider.get(`/topics/${empty}`).expect(200);
    });
  });

  describe('6. lists follow the group’s visibility', () => {
    it('a post stored as members-only in a private group still stays in the group', async () => {
      const g = await makeGroup(owner, { visibility: 'private' }, [ada]);
      const [row] = await t.db.insert(s.posts).values({ authorId: ada.id, body: 'Written in the race', groupId: g.id, visibility: 'members' }).returning();
      await outsider.get(`/posts/${row!.id}`).expect(404);
      expect(await feed(outsider, `author=${ada.handle}`)).not.toContain(row!.id);
      expect(await feed(owner, `author=${ada.handle}`)).toContain(row!.id);
    });
  });

  describe('7. moderators act on posts by people of lower rank only', () => {
    it('moderators can’t remove an admin’s or the owner’s post; admins can’t remove the owner’s', async () => {
      const mod = await createMember(t, { name: 'Mo Moderator' });
      const adm = await createMember(t, { name: 'Al Admin' });
      const g = await makeGroup(owner, {}, [mod, adm, ada]);
      await owner.post(`/groups/${g.slug}/members/${mod.id}`, { action: 'set_role', role: 'moderator' }).expect(200);
      await owner.post(`/groups/${g.slug}/members/${adm.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      const byAdmin = await createPost(adm, 'Admin post', { groupId: g.id });
      const byOwner = await createPost(owner, 'Owner post', { groupId: g.id });
      const byMember = await createPost(ada, 'Member post', { groupId: g.id });
      const refused = await mod.post(`/groups/${g.slug}/posts/${byAdmin.id}`, { action: 'remove' }).expect(403);
      expect(refused.body.error.message).toContain('lower role');
      await mod.post(`/groups/${g.slug}/posts/${byOwner.id}`, { action: 'remove' }).expect(403);
      await adm.post(`/groups/${g.slug}/posts/${byOwner.id}`, { action: 'remove' }).expect(403);
      await mod.post(`/groups/${g.slug}/posts/${byMember.id}`, { action: 'remove' }).expect(200);
      await owner.post(`/groups/${g.slug}/posts/${byAdmin.id}`, { action: 'remove' }).expect(200);
    });
  });

  describe('8. counts', () => {
    it('deleting a post recounts its hashtags; staff hiding and restoring resync the group', async () => {
      const priv = await makeGroup(owner, { visibility: 'private' });
      const pub = await makeGroup(owner);
      const tag = `counted${randomBytes(3).toString('hex')}`;
      await createPost(owner, `Public #${tag}`);
      const hidden = await createPost(owner, `Private #${tag}`, { groupId: priv.id });
      const count = async () => (await t.db.select({ n: s.hashtags.postCount }).from(s.hashtags).where(eq(s.hashtags.tag, tag)))[0]!.n;
      expect(await count()).toBe(1);
      await owner.delete(`/posts/${hidden.id}`).expect(200);
      expect(await count()).toBe(1);

      const post = await createPost(owner, 'Staff will hide this', { groupId: pub.id });
      expect((await groupRow(pub.id)).postCount).toBe(1);
      await staffConsole.post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'hide', reason: 'Breaks the rules here' }).expect(201);
      const afterHide = await groupRow(pub.id);
      expect(afterHide.postCount).toBe(0);
      expect(afterHide.lastPostAt).toBeNull();
      await staffConsole.post('/admin/moderation-actions', { targetType: 'post', targetId: post.id, action: 'restore', reason: 'Fine after all' }).expect(201);
      expect((await groupRow(pub.id)).postCount).toBe(1);
    });
  });

  describe('9. private activity', () => {
    it('post counts and activity are null for outsiders; activity sorts page by position, not by time or score', async () => {
      const g = await makeGroup(owner, { visibility: 'private' });
      await createPost(owner, 'Activity', { groupId: g.id });
      const asOutsider = (await outsider.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(asOutsider.postCount).toBeNull();
      expect(asOutsider.postsThisWeek).toBeNull();
      expect(((await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail).postCount).toBe(1);

      for (const q of ['sort=active', 'scope=suggested']) {
        const first = (await outsider.get(`/groups?${q}&limit=1`).expect(200)).body as Page<GroupSummary>;
        expect(first.nextCursor).not.toBeNull();
        expect(Object.keys(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')))).toEqual(['o']);
        const next = (await outsider.get(`/groups?${q}&limit=1&cursor=${first.nextCursor}`).expect(200)).body as Page<GroupSummary>;
        expect(next.items[0]?.id).not.toBe(first.items[0]!.id);
      }
    });
  });

  describe('10 and 11. suspended groups and staff', () => {
    it('a suspended group’s posts are for staff only; its page still opens for its admins', async () => {
      const g = await makeGroup(owner, { visibility: 'private' }, [ada]);
      const post = await createPost(owner, 'Before the suspension', { groupId: g.id });
      // Staff read a private group's feed on the member site.
      expect(await feed(staff, `group=${g.slug}`)).toEqual([post.id]);
      await t.db.update(s.groups).set({ status: 'suspended', statusNote: 'Looking into it' }).where(eq(s.groups.id, g.id));
      await owner.get(`/posts/${post.id}`).expect(404);
      await ada.get(`/posts/${post.id}`).expect(404);
      await staff.get(`/posts/${post.id}`).expect(200);
      const page = (await owner.get(`/groups/${g.slug}`).expect(200)).body as GroupDetail;
      expect(page.statusNote).toBe('Looking into it');
      expect(page.abilities.seeContent).toBe(false);
      await owner.get(`/feed?group=${g.slug}`).expect(403);
      expect(await feed(staff, `group=${g.slug}`)).toEqual([post.id]);
      await t.db.update(s.groups).set({ status: 'active', statusNote: null }).where(eq(s.groups.id, g.id));
    });
  });

  describe('12. smaller rules', () => {
    it('a repost inside a private group doesn’t tell the original’s author or raise its repost count', async () => {
      const g = await makeGroup(owner, { visibility: 'private' }, [ada]);
      const original = await createPost(outsider, 'Worth sharing');
      await createPost(ada, 'Look at this', { groupId: g.id, repostOfId: original.id });
      expect(await notificationsFor(t, outsider.id, 'repost')).toHaveLength(0);
      const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, original.id));
      expect(row!.repostCount).toBe(0);
      await createPost(bola, '', { repostOfId: original.id });
      expect((await t.db.select().from(s.posts).where(eq(s.posts.id, original.id)))[0]!.repostCount).toBe(1);
    });

    it('only the owner makes a private group public', async () => {
      const g = await makeGroup(owner, { visibility: 'private' }, [ada]);
      await owner.post(`/groups/${g.slug}/members/${ada.id}`, { action: 'set_role', role: 'admin' }).expect(200);
      const res = await ada.patch(`/groups/${g.slug}`, { visibility: 'public' }).expect(403);
      expect(res.body.error.message).toBe('Only the group’s owner can make this private group public.');
      await ada.patch(`/groups/${g.slug}`, { tagline: 'Admins still edit' }).expect(200);
      expect((await owner.patch(`/groups/${g.slug}`, { visibility: 'public' }).expect(200)).body.visibility).toBe('public');
      await ada.patch(`/groups/${g.slug}`, { visibility: 'private' }).expect(200);
    });

    it('invitations: no details for non-moderators; a turned-down invitation can’t be sent again for 7 days', async () => {
      const g = await makeGroup(owner, {}, [ada]);
      const banned = await createMember(t, { name: 'Banned Invitee' });
      const asking = await createMember(t, { name: 'Declining Invitee' });
      await owner.post(`/groups/${g.slug}/members/${banned.id}`, { action: 'ban' }).expect(200);
      const byMember = (await ada.post(`/groups/${g.slug}/invitations`, { memberIds: [banned.id] }).expect(200)).body as BulkResult;
      expect(byMember.failed).toEqual([{ id: banned.id, error: 'Can’t be invited' }]);
      const byOwner = (await owner.post(`/groups/${g.slug}/invitations`, { memberIds: [banned.id] }).expect(200)).body as BulkResult;
      expect(byOwner.failed[0]!.error).toBe('Banned from this group');

      expect(((await owner.post(`/groups/${g.slug}/invitations`, { memberIds: [asking.id] }).expect(200)).body as BulkResult).done).toEqual([asking.id]);
      await asking.post(`/groups/${g.slug}/leave`).expect(200);
      const again = (await owner.post(`/groups/${g.slug}/invitations`, { memberIds: [asking.id] }).expect(200)).body as BulkResult;
      expect(again.failed[0]!.error).toContain('7 days');
      const again2 = (await ada.post(`/groups/${g.slug}/invitations`, { memberIds: [asking.id] }).expect(200)).body as BulkResult;
      expect(again2.failed).toEqual([{ id: asking.id, error: 'Can’t be invited' }]);
      // They can still join a public group themselves.
      await asking.post(`/groups/${g.slug}/join`).expect(200);
    });
  });
});
