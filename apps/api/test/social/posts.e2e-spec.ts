import { and, eq } from 'drizzle-orm';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { block, createPost, postRow } from './social-helpers.js';

describe('Posts, comments, reactions, polls and bookmarks', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('posting rules', () => {
    it('unverified member → 403 EMAIL_NOT_VERIFIED', async () => {
      const m = await createMember(t, { verified: false });
      const res = await m.post('/posts', { body: 'Hello' }).expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      // Unverified members can still read the feed.
      await m.get('/feed').expect(200);
    });

    it('suspended member → 403 ACCOUNT_SUSPENDED', async () => {
      const m = await createMember(t, { status: 'suspended' });
      const res = await m.post('/posts', { body: 'Hello' }).expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('restricted posting → 403 ACCOUNT_RESTRICTED for posts, comments and reactions', async () => {
      const other = await createMember(t);
      const p = await createPost(other, 'Open thread');
      const m = await createMember(t);
      await t.db
        .update(s.users)
        .set({ restrictedPostingUntil: new Date(Date.now() + 3600_000) })
        .where(eq(s.users.id, m.id));
      expect((await m.post('/posts', { body: 'Hello' }).expect(403)).body.error.code).toBe('ACCOUNT_RESTRICTED');
      expect((await m.post(`/posts/${p.id}/comments`, { body: 'Hi' }).expect(403)).body.error.code).toBe('ACCOUNT_RESTRICTED');
      expect((await m.put('/reactions', { targetType: 'post', targetId: p.id }).expect(403)).body.error.code).toBe(
        'ACCOUNT_RESTRICTED',
      );
    });

    it('the 21st post in a day → 429', async () => {
      const m = await createMember(t);
      for (let i = 0; i < 20; i++) await createPost(m, `Post ${i}`);
      const res = await m.post('/posts', { body: 'One too many' }).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('only accounts with post.announce publish announcements, which are pinned', async () => {
      const m = await createMember(t);
      await m.post('/posts', { body: 'Big news', kind: 'announcement' }).expect(403);
      const admin = await createMember(t, { roles: ['platform_admin'] });
      const a = await createPost(admin, 'Applications are open', { kind: 'announcement' });
      expect(a.kind).toBe('announcement');
      expect(a.pinned).toBe(true);
    });

    it('validates body length and requires content', async () => {
      const m = await createMember(t);
      await m.post('/posts', { body: '' }).expect(422);
      await m.post('/posts', { body: 'x'.repeat(3001) }).expect(422);
    });
  });

  describe('hashtags and mentions', () => {
    it('parses hashtags (display form, de-duplicated) and mentions, and notifies the mentioned member', async () => {
      const amara = await createMember(t, { name: 'Amara Okafor', handle: 'amara-okafor' });
      const kwame = await createMember(t, { name: 'Kwame Mensah', handle: 'kwame-mensah' });
      const p = await createPost(amara, 'Back from Kigali #AfCFTA #AgriTech #afcfta — thanks @kwame-mensah and @nobody-here!');
      expect(p.hashtags).toEqual(['AfCFTA', 'AgriTech']);
      expect(p.mentions.map((m: { handle: string }) => m.handle)).toEqual(['kwame-mensah']);
      const [tag] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'afcfta'));
      expect(tag!.display).toBe('AfCFTA');
      expect(tag!.postCount).toBe(1);

      const notes = await kwame.get('/notifications').expect(200);
      const mention = notes.body.items.find((n: { type: string }) => n.type === 'mention');
      expect(mention.segments.map((x: { text: string }) => x.text).join('')).toBe('Amara Okafor mentioned you in a post');
      expect(mention.href).toBe(`/posts/${p.id}`);

      // Editing re-parses hashtags and marks the post edited.
      const edited = await amara.patch(`/posts/${p.id}`, { body: 'Updated: #AgriTech #TradeAfrica' }).expect(200);
      expect(edited.body.hashtags.sort()).toEqual(['AgriTech', 'TradeAfrica']);
      expect(edited.body.editedAt).not.toBeNull();
      const [after] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'afcfta'));
      expect(after!.postCount).toBe(0);
      // Only the author edits.
      await kwame.patch(`/posts/${p.id}`, { body: 'hijack' }).expect(403);
    });

    it('does not record mentions across a block', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      await block(t, b.id, a.id);
      const p = await createPost(a, `Hello @${b.handle}`);
      expect(p.mentions).toEqual([]);
      expect(await count(t.db, s.mentions, eq(s.mentions.sourceId, p.id))).toBe(0);
    });
  });

  describe('visibility', () => {
    it('blocked either way → 404 on the post', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Visible to most');
      await b.get(`/posts/${p.id}`).expect(200);
      await block(t, b.id, a.id);
      await b.get(`/posts/${p.id}`).expect(404);
      await b.put('/reactions', { targetType: 'post', targetId: p.id }).expect(404);
    });

    it('hidden/removed posts: 404 for others, visible to the author with moderationState', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Soon hidden');
      await t.db.update(s.posts).set({ moderationState: 'hidden' }).where(eq(s.posts.id, p.id));
      await b.get(`/posts/${p.id}`).expect(404);
      const own = await a.get(`/posts/${p.id}`).expect(200);
      expect(own.body.moderationState).toBe('hidden');
      const feed = await a.get('/feed?tab=latest').expect(200);
      expect(feed.body.items.find((x: { id: string }) => x.id === p.id)?.moderationState).toBe('hidden');
      const otherFeed = await b.get('/feed?tab=latest').expect(200);
      expect(otherFeed.body.items.some((x: { id: string }) => x.id === p.id)).toBe(false);

      await t.db.update(s.posts).set({ moderationState: 'removed' }).where(eq(s.posts.id, p.id));
      await b.get(`/posts/${p.id}`).expect(404);
      expect((await a.get(`/posts/${p.id}`).expect(200)).body.moderationState).toBe('removed');
      // A visible post carries no moderationState at all.
      const fine = await createPost(a, 'Fine');
      expect('moderationState' in (await b.get(`/posts/${fine.id}`).expect(200)).body).toBe(false);
    });

    it('posts by suspended authors drop out', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Before suspension');
      await t.db
        .update(s.users)
        .set({ suspendedUntil: new Date(Date.now() + 86400_000) })
        .where(eq(s.users.id, a.id));
      await b.get(`/posts/${p.id}`).expect(404);
      const feed = await b.get('/feed?tab=latest').expect(200);
      expect(feed.body.items.some((x: { id: string }) => x.id === p.id)).toBe(false);
    });

    it('posts are public unless the author picks Members; visitors only see public posts', async () => {
      const a = await createMember(t);
      const members = await createPost(a, 'Members only', { visibility: 'members' });
      const pub = await createPost(a, 'Public by default');
      await t.http().get(`/api/v1/posts/${members.id}`).expect(404);
      await t.http().get(`/api/v1/posts/${pub.id}`).expect(200);
    });

    it('author or moderator deletes (soft delete)', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Delete me #Gone');
      await b.delete(`/posts/${p.id}`).expect(403);
      await a.delete(`/posts/${p.id}`).expect(200);
      await a.get(`/posts/${p.id}`).expect(404);
      expect((await postRow(t, p.id)).deletedAt).not.toBeNull();
      const p2 = await createPost(a, 'Moderated');
      const mod = await createMember(t, { roles: ['moderator'] });
      await mod.delete(`/posts/${p2.id}`).expect(200);
      expect(await count(t.db, s.auditLog, and(eq(s.auditLog.action, 'post.delete'), eq(s.auditLog.targetId, p2.id)))).toBe(1);
    });
  });

  describe('reposts', () => {
    it('reposting a repost points at the original and counts once per member', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const c = await createMember(t);
      const original = await createPost(a, 'Original');
      const r1 = await createPost(b, '', { repostOfId: original.id });
      expect(r1.isRepost).toBe(true);
      expect(r1.repostOf.id).toBe(original.id);
      const r2 = await createPost(c, 'Adding my take', { repostOfId: r1.id });
      expect(r2.repostOf.id).toBe(original.id);
      expect((await postRow(t, original.id)).repostCount).toBe(2);
      await b.post('/posts', { body: '', repostOfId: original.id }).expect(409);
      const view = await b.get(`/posts/${original.id}`).expect(200);
      expect(view.body.viewer.reposted).toBe(true);
      const notes = await a.get('/notifications').expect(200);
      const repost = notes.body.items.find((n: { type: string }) => n.type === 'repost');
      expect(repost.actorCount).toBe(2);
      // When the original disappears, the repost shows null.
      await t.db.update(s.posts).set({ moderationState: 'removed' }).where(eq(s.posts.id, original.id));
      expect((await c.get(`/posts/${r1.id}`).expect(200)).body.repostOf).toBeNull();
    });
  });

  describe('comments', () => {
    it('one level of replies: replying to a reply attaches to the top-level comment', async () => {
      const author = await createMember(t);
      const x = await createMember(t);
      const y = await createMember(t);
      const p = await createPost(author, 'Discuss');
      const c1 = (await x.post(`/posts/${p.id}/comments`, { body: 'Top level' }).expect(201)).body;
      expect(c1.parentId).toBeNull();
      const r1 = (await y.post(`/posts/${p.id}/comments`, { body: 'Reply', parentId: c1.id }).expect(201)).body;
      const r2 = (await x.post(`/posts/${p.id}/comments`, { body: 'Reply to reply', parentId: r1.id }).expect(201)).body;
      expect(r1.parentId).toBe(c1.id);
      expect(r2.parentId).toBe(c1.id);
      const list = await author.get(`/posts/${p.id}/comments`).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].counts.replies).toBe(2);
      expect(list.body.items[0].replies.map((r: { id: string }) => r.id)).toEqual([r1.id, r2.id]);
      expect((await postRow(t, p.id)).commentCount).toBe(3);
      const replies = await author.get(`/comments/${c1.id}/replies`).expect(200);
      expect(replies.body.items).toHaveLength(2);

      // Notifications: post author gets comment_on_post; y (replied to) gets reply_to_comment.
      const yNotes = (await y.get('/notifications').expect(200)).body.items;
      expect(yNotes.some((n: { type: string }) => n.type === 'reply_to_comment')).toBe(true);
      const aNotes = (await author.get('/notifications').expect(200)).body.items;
      expect(aNotes.filter((n: { type: string }) => n.type === 'comment_on_post').length).toBeGreaterThanOrEqual(2);
    });

    it('shows inline at most 3 newest replies', async () => {
      const author = await createMember(t);
      const p = await createPost(author, 'Many replies');
      const top = (await author.post(`/posts/${p.id}/comments`, { body: 'Top' }).expect(201)).body;
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await author.post(`/posts/${p.id}/comments`, { body: `r${i}`, parentId: top.id }).expect(201)).body.id);
      const list = await author.get(`/posts/${p.id}/comments`).expect(200);
      expect(list.body.items[0].replies.map((r: { id: string }) => r.id)).toEqual(ids.slice(2));
    });

    it('hidden, removed and deleted comments are placeholders; blocked members’ comments are omitted', async () => {
      const author = await createMember(t);
      const x = await createMember(t);
      const viewer = await createMember(t);
      const blockedOne = await createMember(t);
      const mod = await createMember(t, { roles: ['moderator'] });
      const p = await createPost(author, 'Thread');
      const hidden = (await x.post(`/posts/${p.id}/comments`, { body: 'Rude words' }).expect(201)).body;
      const deleted = (await x.post(`/posts/${p.id}/comments`, { body: 'Changed my mind' }).expect(201)).body;
      await blockedOne.post(`/posts/${p.id}/comments`, { body: 'From someone blocked' }).expect(201);
      await block(t, viewer.id, blockedOne.id);
      await t.db.update(s.comments).set({ moderationState: 'hidden' }).where(eq(s.comments.id, hidden.id));
      await x.delete(`/comments/${deleted.id}`).expect(200);
      expect((await postRow(t, p.id)).commentCount).toBe(2);

      const list = (await viewer.get(`/posts/${p.id}/comments?sort=newest`).expect(200)).body.items;
      expect(list).toHaveLength(2);
      const h = list.find((c: { id: string }) => c.id === hidden.id);
      expect(h).toMatchObject({ state: 'hidden', body: '', author: null });
      const d = list.find((c: { id: string }) => c.id === deleted.id);
      expect(d).toMatchObject({ state: 'deleted', body: '', author: null });
      // The author and moderators still see the content.
      const own = (await x.get(`/posts/${p.id}/comments`).expect(200)).body.items;
      expect(own.find((c: { id: string }) => c.id === hidden.id).body).toBe('Rude words');
      const modView = (await mod.get(`/posts/${p.id}/comments`).expect(200)).body.items;
      expect(modView.find((c: { id: string }) => c.id === hidden.id).author.id).toBe(x.id);
      // Can't reply to a hidden comment; can't comment across a block.
      await viewer.post(`/posts/${p.id}/comments`, { body: 'Reply', parentId: hidden.id }).expect(404);
      const bp = await createPost(blockedOne, 'Mine');
      await viewer.post(`/posts/${bp.id}/comments`, { body: 'Hi' }).expect(404);
    });

    it('edits by the author only', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Post');
      const c = (await b.post(`/posts/${p.id}/comments`, { body: 'First' }).expect(201)).body;
      await a.patch(`/comments/${c.id}`, { body: 'Nope' }).expect(403);
      const edited = await b.patch(`/comments/${c.id}`, { body: 'Edited' }).expect(200);
      expect(edited.body.editedAt).not.toBeNull();
      // Post author is not a moderator: cannot delete others' comments.
      await a.delete(`/comments/${c.id}`).expect(403);
    });
  });

  describe('reactions', () => {
    it('maintains counts and changes kind without double counting', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'React to me');
      let res = await b.put('/reactions', { targetType: 'post', targetId: p.id, kind: 'like' }).expect(200);
      expect(res.body).toMatchObject({ reaction: 'like', reactions: 1, breakdown: { like: 1, insightful: 0, support: 0 } });
      res = await b.put('/reactions', { targetType: 'post', targetId: p.id, kind: 'insightful' }).expect(200);
      expect(res.body).toMatchObject({ reaction: 'insightful', reactions: 1, breakdown: { like: 0, insightful: 1, support: 0 } });
      res = await b.put('/reactions', { targetType: 'post', targetId: p.id, kind: 'insightful' }).expect(200);
      expect(res.body.reactions).toBe(1);
      const view = await b.get(`/posts/${p.id}`).expect(200);
      expect(view.body.viewer.reaction).toBe('insightful');
      expect(view.body.counts.reactions).toBe(1);
      res = await b.delete('/reactions', { targetType: 'post', targetId: p.id }).expect(200);
      expect(res.body).toMatchObject({ reaction: null, reactions: 0, breakdown: { like: 0, insightful: 0, support: 0 } });
      // Only one notification despite the change of kind.
      const notes = (await a.get('/notifications').expect(200)).body.items.filter((n: { type: string }) => n.type === 'reaction');
      expect(notes).toHaveLength(1);
      expect(notes[0].actorCount).toBe(1);
    });

    it('reacts to comments', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p = await createPost(a, 'Post');
      const c = (await a.post(`/posts/${p.id}/comments`, { body: 'Comment' }).expect(201)).body;
      const res = await b.put('/reactions', { targetType: 'comment', targetId: c.id, kind: 'support' }).expect(200);
      expect(res.body).toMatchObject({ reaction: 'support', reactions: 1, breakdown: { like: 0, insightful: 0, support: 1 } });
      const changed = await a.put('/reactions', { targetType: 'comment', targetId: c.id, kind: 'insightful' }).expect(200);
      expect(changed.body).toMatchObject({ reaction: 'insightful', reactions: 2, breakdown: { like: 0, insightful: 1, support: 1 } });
      await b.put('/reactions', { targetType: 'comment', targetId: c.id, kind: 'like' }).expect(200);
      const list = (await b.get(`/posts/${p.id}/comments`).expect(200)).body.items;
      expect(list[0].viewer.reaction).toBe('like');
      expect(list[0].counts.reactions).toBe(2);
      expect(list[0].reactionBreakdown).toEqual({ like: 1, insightful: 1, support: 0 });
      const removed = await b.delete('/reactions', { targetType: 'comment', targetId: c.id }).expect(200);
      expect(removed.body).toMatchObject({ reaction: null, reactions: 1, breakdown: { like: 0, insightful: 1, support: 0 } });
    });

    it('batches reaction notifications: "X and 2 others reacted to your post"', async () => {
      const author = await createMember(t);
      const p = await createPost(author, 'Popular');
      const names = ['Zainab One', 'Yaw Two', 'Xola Three'];
      for (const name of names) {
        const m = await createMember(t, { name });
        await m.put('/reactions', { targetType: 'post', targetId: p.id, kind: 'like' }).expect(200);
      }
      const items = (await author.get('/notifications').expect(200)).body.items.filter((n: { type: string }) => n.type === 'reaction');
      expect(items).toHaveLength(1);
      expect(items[0].actorCount).toBe(3);
      expect(items[0].actors[0].name).toBe('Xola Three');
      expect(items[0].segments.map((x: { text: string }) => x.text).join('')).toBe('Xola Three and 2 others reacted to your post');
      expect((await author.get('/notifications/unread-count').expect(200)).body.unread).toBeGreaterThanOrEqual(1);
      await author.post('/notifications/read', { all: true }).expect(200);
      expect((await author.get('/notifications/unread-count').expect(200)).body.unread).toBe(0);
    });
  });

  describe('polls', () => {
    it('one vote per member; closed polls are 409', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const c = await createMember(t);
      const p = await createPost(a, 'Biggest barrier to diaspora investment?', {
        poll: { question: 'Biggest barrier', options: ['Trust', 'Transfer costs', 'Regulation'], durationHours: 24 },
      });
      expect(p.poll.options).toHaveLength(3);
      const [first, second] = p.poll.options;
      const voted = await b.post(`/posts/${p.id}/poll/vote`, { optionId: first.id }).expect(200);
      expect(voted.body.poll.totalVotes).toBe(1);
      expect(voted.body.poll.myVoteOptionId).toBe(first.id);
      expect(voted.body.poll.options[0].percent).toBe(100);
      await b.post(`/posts/${p.id}/poll/vote`, { optionId: second.id }).expect(409);
      await c.post(`/posts/${p.id}/poll/vote`, { optionId: '00000000-0000-4000-8000-000000000000' }).expect(422);
      await t.db
        .update(s.polls)
        .set({ closesAt: new Date(Date.now() - 1000) })
        .where(eq(s.polls.postId, p.id));
      await c.post(`/posts/${p.id}/poll/vote`, { optionId: second.id }).expect(409);
      const closed = await c.get(`/posts/${p.id}`).expect(200);
      expect(closed.body.poll.closed).toBe(true);
    });

    it('rejects polls with too few options', async () => {
      const a = await createMember(t);
      await a.post('/posts', { body: 'Q', poll: { question: 'Q', options: ['Only one'] } }).expect(422);
    });
  });

  describe('bookmarks', () => {
    it('bookmarks and lists posts', async () => {
      const a = await createMember(t);
      const b = await createMember(t);
      const p1 = await createPost(a, 'Keep this');
      const p2 = await createPost(a, 'And this');
      await b.put('/bookmarks', { targetType: 'post', targetId: p1.id }).expect(200);
      await b.put('/bookmarks', { targetType: 'post', targetId: p2.id }).expect(200);
      await b.put('/bookmarks', { targetType: 'post', targetId: p2.id }).expect(200);
      const list = await b.get('/me/bookmarks?limit=1').expect(200);
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([p2.id]);
      expect(list.body.items[0].viewer.bookmarked).toBe(true);
      const next = await b.get(`/me/bookmarks?limit=1&cursor=${list.body.nextCursor}`).expect(200);
      expect(next.body.items.map((x: { id: string }) => x.id)).toEqual([p1.id]);
      await b.delete('/bookmarks', { targetType: 'post', targetId: p1.id }).expect(200);
      const after = await b.get('/me/bookmarks').expect(200);
      expect(after.body.items.map((x: { id: string }) => x.id)).toEqual([p2.id]);
      // Bookmarked posts that become hidden drop out.
      await t.db.update(s.posts).set({ moderationState: 'hidden' }).where(eq(s.posts.id, p2.id));
      expect((await b.get('/me/bookmarks').expect(200)).body.items).toEqual([]);
    });
  });
});
