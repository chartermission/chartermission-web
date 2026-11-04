import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { DraftsService } from '../../src/posts/drafts.service.js';
import { createPost, uploadBytes } from './social-helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const LONG = 'Cross-border trade under AfCFTA depends on rules of origin. '.repeat(6).trim();

describe('Post types, drafts and scheduling', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('questions', () => {
    it('only the asker marks a top-level answer; it leads the comments and drives the unanswered filter', async () => {
      const asker = await createMember(t);
      const helper = await createMember(t);
      const other = await createMember(t);
      const q = await createPost(asker, 'How do I register a co-op in Ghana?', { type: 'question' });
      expect(q.type).toBe('question');
      expect(q.question).toEqual({ acceptedCommentId: null, answered: false });

      const first = (await other.post(`/posts/${q.id}/comments`, { body: 'Try the Registrar General.' })).body;
      const best = (await helper.post(`/posts/${q.id}/comments`, { body: 'Start at the Department of Co-operatives.' })).body;
      const reply = (await other.post(`/posts/${q.id}/comments`, { body: 'Agreed', parentId: best.id })).body;
      await other.put('/reactions', { targetType: 'comment', targetId: first.id, kind: 'like' }).expect(200);

      const unanswered = await other.get('/feed?tab=latest&type=question&unanswered=true').expect(200);
      expect(unanswered.body.items.map((p: { id: string }) => p.id)).toContain(q.id);

      await helper.put(`/posts/${q.id}/accepted-answer`, { commentId: best.id }).expect(403);
      await asker.put(`/posts/${q.id}/accepted-answer`, { commentId: reply.id }).expect(422);
      const accepted = await asker.put(`/posts/${q.id}/accepted-answer`, { commentId: best.id }).expect(200);
      expect(accepted.body.question).toEqual({ acceptedCommentId: best.id, answered: true });

      // The accepted answer leads even though another answer has more reactions.
      const list = await other.get(`/posts/${q.id}/comments`).expect(200);
      expect(list.body.items[0].id).toBe(best.id);
      expect(list.body.items[0].isAcceptedAnswer).toBe(true);
      expect(list.body.items.filter((c: { id: string }) => c.id === best.id)).toHaveLength(1);

      const note = await t.db.select().from(s.notifications).where(eq(s.notifications.userId, helper.id));
      expect(note.map((n) => n.type)).toContain('answer_accepted');

      const after = await other.get('/feed?tab=latest&type=question&unanswered=true').expect(200);
      expect(after.body.items.map((p: { id: string }) => p.id)).not.toContain(q.id);

      // Deleting the accepted answer makes the question unanswered again.
      await helper.delete(`/comments/${best.id}`).expect(200);
      const reloaded = await other.get(`/posts/${q.id}`).expect(200);
      expect(reloaded.body.question.answered).toBe(false);
    });

    it('questions need a real question and cannot carry polls', async () => {
      const m = await createMember(t);
      await m.post('/posts', { type: 'question', body: 'Why?' }).expect(422);
      await m
        .post('/posts', { type: 'question', body: 'Which payment rail works best?', poll: { question: 'Rail', options: ['A', 'B'] } })
        .expect(422);
    });
  });

  describe('celebrations', () => {
    it('stores the milestone and validates details against the type', async () => {
      const m = await createMember(t);
      const post = await createPost(m, 'Grateful to the whole team.', {
        type: 'celebration',
        celebration: { category: 'funding', headline: 'Closed our seed round', organisation: 'GreenGrid Africa' },
      });
      expect(post.celebration).toEqual({ category: 'funding', headline: 'Closed our seed round', organisation: 'GreenGrid Africa' });
      await m.post('/posts', { type: 'celebration', body: 'Hello' }).expect(422);
      await m.post('/posts', { body: 'Hello', celebration: { category: 'award', headline: 'Won' } }).expect(422);
      const edited = await m
        .patch(`/posts/${post.id}`, { body: 'Grateful.', celebration: { category: 'funding', headline: 'Closed our $2M seed round' } })
        .expect(200);
      expect(edited.body.celebration.headline).toBe('Closed our $2M seed round');
      await m.patch(`/posts/${post.id}`, { body: 'x', article: { title: 'Not an article' } }).expect(422);
    });
  });

  describe('requests ("Looking for…")', () => {
    it('members offer help once, the author sees offers, and closed requests take no more', async () => {
      const author = await createMember(t);
      const helper = await createMember(t);
      const stranger = await createMember(t);
      const post = await createPost(author, 'We need someone who has built cold-chain logistics before.', {
        type: 'request',
        request: { category: 'cofounder', title: 'Technical co-founder for a cold-chain startup', skills: ['IoT', 'Logistics'], remote: true },
      });
      expect(post.request).toMatchObject({ category: 'cofounder', skills: ['IoT', 'Logistics'], closed: false, helpOffers: 0, viewerOffered: false });

      await author.put(`/posts/${post.id}/help`, { note: 'me' }).expect(422);
      const offered = await helper.put(`/posts/${post.id}/help`, { note: 'I built the cold chain at Twiga.' }).expect(200);
      expect(offered.body.request).toMatchObject({ helpOffers: 1, viewerOffered: true });
      await helper.put(`/posts/${post.id}/help`, { note: 'Updated note' }).expect(200);

      await stranger.get(`/posts/${post.id}/help`).expect(403);
      const offers = await author.get(`/posts/${post.id}/help`).expect(200);
      expect(offers.body).toHaveLength(1);
      expect(offers.body[0]).toMatchObject({ member: { id: helper.id }, note: 'Updated note' });
      const notes = await t.db.select().from(s.notifications).where(eq(s.notifications.userId, author.id));
      expect(notes.filter((n) => n.type === 'help_offered')).toHaveLength(1);

      await helper.put(`/posts/${post.id}/closed`, { closed: true }).expect(403);
      const closed = await author.put(`/posts/${post.id}/closed`, { closed: true }).expect(200);
      expect(closed.body.request.closed).toBe(true);
      await stranger.put(`/posts/${post.id}/help`, {}).expect(409);
      const withdrawn = await helper.delete(`/posts/${post.id}/help`).expect(200);
      expect(withdrawn.body.request).toMatchObject({ helpOffers: 0, viewerOffered: false });
    });

    it('a past closesOn closes the request', async () => {
      const author = await createMember(t);
      const post = await createPost(author, 'Volunteers for a weekend clinic.', {
        type: 'request',
        request: { category: 'volunteers', title: 'Volunteers for a weekend clinic', closesOn: '2020-01-01' },
      });
      expect(post.request.closed).toBe(true);
    });
  });

  describe('articles', () => {
    it('take a title, a long body and one cover image with alt text', async () => {
      const m = await createMember(t);
      await m.post('/posts', { type: 'article', body: LONG }).expect(422);
      await m.post('/posts', { type: 'article', body: 'Too short', article: { title: 'A short article' } }).expect(422);
      const cover = await uploadBytes(t, m, { purpose: 'post_image', fileName: 'cover.png', mime: 'image/png', data: PNG });
      await m.post(`/uploads/${cover}/complete`).expect(200);
      const post = await createPost(m, LONG, {
        type: 'article',
        article: { title: 'What rules of origin mean for textile exporters', subtitle: 'A practical guide' },
        attachmentIds: [cover],
        altTexts: { [cover]: 'Bales of cotton at the port of Tema' },
      });
      expect(post.article).toMatchObject({
        title: 'What rules of origin mean for textile exporters',
        subtitle: 'A practical guide',
        readingMinutes: 1,
        coverAlt: 'Bales of cotton at the port of Tema',
      });
      expect(post.article.coverUrl).toContain(cover);
      expect(post.attachments[0].alt).toBe('Bales of cotton at the port of Tema');
      const edited = await m.patch(`/posts/${post.id}`, { body: LONG, altTexts: { [cover]: 'Cotton bales' } }).expect(200);
      expect(edited.body.attachments[0].alt).toBe('Cotton bales');
    });

    it('allow bodies past the normal limit but no polls or quotes', async () => {
      const m = await createMember(t);
      await m.post('/posts', { body: 'x'.repeat(3001) }).expect(422);
      const long = await createPost(m, 'x'.repeat(5000), { type: 'article', article: { title: 'A very long read' } });
      expect(long.article.readingMinutes).toBe(1);
      await m
        .post('/posts', { type: 'article', body: LONG, article: { title: 'With a poll' }, poll: { question: 'Q', options: ['A', 'B'] } })
        .expect(422);
    });
  });

  describe('drafts and scheduled posts', () => {
    it('saves incomplete drafts, lists them, and publishes them through normal post creation', async () => {
      const m = await createMember(t);
      const draft = await m.post('/me/drafts', { payload: { type: 'article', body: 'Notes so far', article: { title: '' } } }).expect(201);
      expect(draft.body).toMatchObject({ status: 'draft', scheduledFor: null, preview: 'Notes so far' });
      const saved = await m.patch(`/me/drafts/${draft.body.id}`, { payload: { body: 'Ready to share #DraftTopic' } }).expect(200);
      expect(saved.body.payload.body).toBe('Ready to share #DraftTopic');
      const list = await m.get('/me/drafts').expect(200);
      expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([draft.body.id]);

      // Hashtags count only once the post is live.
      const [before] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'drafttopic'));
      expect(before).toBeUndefined();
      const post = await m.post(`/me/drafts/${draft.body.id}/publish`).expect(200);
      expect(post.body.hashtags).toEqual(['DraftTopic']);
      await m.get(`/me/drafts/${draft.body.id}`).expect(404);

      const other = await createMember(t);
      await other.get(`/me/drafts/${saved.body.id}`).expect(404);
      const empty = (await m.post('/me/drafts', { payload: { body: '' } }).expect(201)).body;
      await m.post(`/me/drafts/${empty.id}/publish`).expect(422);
    });

    it('schedules only complete posts in the allowed window, and the minute job publishes them', async () => {
      const m = await createMember(t);
      const soon = new Date(Date.now() + 60_000).toISOString();
      const later = new Date(Date.now() + 3600_000).toISOString();
      await m.post('/me/drafts', { payload: { body: '' }, scheduledFor: later }).expect(422);
      await m.post('/me/drafts', { payload: { body: 'Hello' }, scheduledFor: soon }).expect(422);
      await m.post('/me/drafts', { payload: { body: 'Hello' }, scheduledFor: new Date(Date.now() + 90 * 86400_000).toISOString() }).expect(422);
      const scheduled = await m.post('/me/drafts', { payload: { body: 'Scheduled hello' }, scheduledFor: later }).expect(201);
      expect(scheduled.body.status).toBe('scheduled');
      const list = await m.get('/me/drafts?status=scheduled').expect(200);
      expect(list.body.items).toHaveLength(1);

      const drafts = t.app.get(DraftsService);
      expect(await drafts.runDue(new Date())).toEqual({ published: 0, failed: 0 });
      const result = await drafts.runDue(new Date(Date.now() + 2 * 3600_000));
      expect(result.published).toBeGreaterThanOrEqual(1);
      const feed = await m.get('/feed?tab=latest').expect(200);
      expect(feed.body.items.map((p: { body: string }) => p.body)).toContain('Scheduled hello');
      const notes = await t.db.select().from(s.notifications).where(eq(s.notifications.userId, m.id));
      expect(notes.map((n) => n.type)).toContain('scheduled_post_published');
    });

    it('a scheduled post that can no longer be published is marked failed with a reason', async () => {
      const m = await createMember(t);
      const later = new Date(Date.now() + 3600_000).toISOString();
      const scheduled = await m.post('/me/drafts', { payload: { body: 'Will fail' }, scheduledFor: later }).expect(201);
      await t.db
        .update(s.users)
        .set({ restrictedPostingUntil: new Date(Date.now() + 86400_000) })
        .where(eq(s.users.id, m.id));
      await t.app.get(DraftsService).runDue(new Date(Date.now() + 2 * 3600_000));
      const view = await m.get(`/me/drafts/${scheduled.body.id}`).expect(200);
      expect(view.body.status).toBe('failed');
      expect(view.body.lastError).toMatch(/posting/);
      // Unscheduling turns it back into an editable draft.
      const back = await m.patch(`/me/drafts/${scheduled.body.id}`, { payload: { body: 'Will fail' }, scheduledFor: null }).expect(200);
      expect(back.body).toMatchObject({ status: 'draft', lastError: null });
    });
  });

  describe('feed helpers', () => {
    it('counts posts newer than a time for the new-posts pill, excluding the viewer’s own', async () => {
      const viewer = await createMember(t);
      const author = await createMember(t);
      const since = new Date().toISOString();
      await createPost(viewer, 'Mine does not count');
      await createPost(author, 'Fresh post one');
      await createPost(author, 'Fresh post two');
      const res = await viewer.get(`/feed/new?tab=latest&since=${encodeURIComponent(since)}`).expect(200);
      expect(res.body.count).toBe(2);
      expect(res.body.authors.map((a: { id: string }) => a.id)).toEqual([author.id]);
      const none = await viewer.get(`/feed/new?tab=latest&since=${encodeURIComponent(new Date().toISOString())}`).expect(200);
      expect(none.body).toEqual({ count: 0, authors: [] });
    });

    it('lists topics for the explore page: popular, new and followed', async () => {
      const m = await createMember(t);
      await createPost(m, 'Talking about #ExploreAlpha and #ExploreBeta');
      await m.post('/follows', { targetType: 'hashtag', targetId: 'explorebeta' }).expect(201);
      const popular = await m.get('/topics?sort=popular&q=explore').expect(200);
      expect(popular.body.items.map((x: { tag: string }) => x.tag)).toEqual(['ExploreBeta', 'ExploreAlpha']);
      expect(popular.body.items[0]).toMatchObject({ following: true, posts: 1, posts7d: 1 });
      const followed = await m.get('/topics?sort=followed').expect(200);
      expect(followed.body.items.map((x: { tag: string }) => x.tag)).toContain('ExploreBeta');
      expect(followed.body.items.map((x: { tag: string }) => x.tag)).not.toContain('ExploreAlpha');
    });
  });
});
