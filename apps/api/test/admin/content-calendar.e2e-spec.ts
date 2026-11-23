import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { s256 } from '../../src/oauth/pkce.js';
import { DraftsService } from '../../src/posts/drafts.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe('Admin: content calendar of posts written with Claude', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let plain: Member;
  let amara: Member;
  let kwame: Member;
  let reader: Member;
  let amaraClaude: ReturnType<typeof bearer>;
  let kwameClaude: ReturnType<typeof bearer>;

  /** A request as Claude: bearer token and the CSRF header the MCP app sends, no cookies. */
  function bearer(token: string) {
    const auth = (r: ReturnType<ReturnType<TestApp['http']>['get']>) => r.set('Authorization', `Bearer ${token}`).set('X-CM-CSRF', '1');
    return {
      get: (url: string) => auth(t.http().get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(t.http().post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object = {}) => auth(t.http().patch(`/api/v1${url}`)).send(body),
    };
  }

  /** Gives the member Claude access, connects a client named "Claude Desktop" and returns its bearer client. */
  async function connectClaude(m: Member) {
    await admin.put(`/admin/members/${m.id}/mcp-access`, { enabled: true }).expect(200);
    const reg = await t.http().post('/api/v1/oauth/register').send({ client_name: 'Claude Desktop', redirect_uris: [REDIRECT] }).expect(201);
    const clientId = reg.body.client_id as string;
    const verifier = randomBytes(32).toString('base64url');
    const res = await m
      .post('/oauth/authorize', {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        state: 'x',
        approve: true,
      })
      .expect(200);
    const code = new URL(res.body.redirectTo as string).searchParams.get('code')!;
    const token = await t
      .http()
      .post('/api/v1/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })
      .expect(200);
    return bearer(token.body.access_token as string);
  }

  const setMode = (approval: 'after' | 'before') => admin.put('/admin/settings/claude-content', { approval }).expect(200);

  /** A scheduled draft written with Claude, straight in the database (keeps Claude's hourly allowance for the tests that need it). */
  async function claudeDraft(authorId: string, body: string, opts: Partial<typeof s.postDrafts.$inferInsert> = {}) {
    const [row] = await t.db
      .insert(s.postDrafts)
      .values({ authorId, payload: { body, type: 'standard', attachmentIds: [], visibility: 'public', kind: 'standard' }, status: 'scheduled', scheduledFor: new Date(inHours(24)), source: 'claude', ...opts })
      .returning();
    return row!;
  }

  async function notificationsFor(userId: string, type: string) {
    return t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type))).orderBy(desc(s.notifications.createdAt));
  }

  async function auditFor(action: string, targetId: string) {
    return t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, action), eq(s.auditLog.targetId, targetId)));
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    plain = await createMember(t, { name: 'Plain Member' });
    amara = await createMember(t, { name: 'Amara Okafor', handle: 'amara-cal' });
    kwame = await createMember(t, { name: 'Kwame Mensah', handle: 'kwame-cal' });
    reader = await createMember(t, { name: 'Ngozi Reader', handle: 'ngozi-cal' });
    amaraClaude = await connectClaude(amara);
    kwameClaude = await connectClaude(kwame);
  });
  afterAll(() => t.close());

  it('tags posts and drafts written through Claude as Claude; the web stays web', async () => {
    const viaClaude = await amaraClaude.post('/posts', { body: 'Written with Claude for the calendar' }).expect(201);
    expect(viaClaude.body.status).toBe('published');
    const viaWeb = await amara.post('/posts', { body: 'Written on the site' }).expect(201);
    const [a] = await t.db.select().from(s.posts).where(eq(s.posts.id, viaClaude.body.id));
    const [b] = await t.db.select().from(s.posts).where(eq(s.posts.id, viaWeb.body.id));
    expect(a).toMatchObject({ source: 'claude', contentReview: null });
    expect(b!.source).toBe('web');

    // A draft Claude saves is Claude's; a post the member then publishes from it is too.
    const draft = await amaraClaude.post('/me/drafts', { payload: { body: 'A Claude draft' } }).expect(201);
    const [d] = await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, draft.body.id));
    expect(d!.source).toBe('claude');
    const fromDraft = await amara.post(`/me/drafts/${draft.body.id}/publish`).expect(200);
    const [p] = await t.db.select().from(s.posts).where(eq(s.posts.id, fromDraft.body.id));
    expect(p!.source).toBe('claude');

    // Editing on the site keeps a web draft web; Claude editing it makes it Claude's.
    const webDraft = await amara.post('/me/drafts', { payload: { body: 'From the site' } }).expect(201);
    await amaraClaude.patch(`/me/drafts/${webDraft.body.id}`, { payload: { body: 'Polished by Claude' } }).expect(200);
    const [w] = await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, webDraft.body.id));
    expect(w!.source).toBe('claude');

    // The calendar lists Claude posts with the client that wrote them; web posts only with source=all (scheduled ones).
    const list = await mod.get('/admin/content-calendar/items?state=published').expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === viaClaude.body.id);
    expect(item).toMatchObject({ kind: 'post', key: `post:${viaClaude.body.id}`, state: 'published', source: 'claude', claudeClient: 'Claude Desktop' });
    expect(item.author.id).toBe(amara.id);
    expect(item.postUrl).toContain(`/posts/${viaClaude.body.id}`);
    expect(list.body.items.some((i: { id: string }) => i.id === viaWeb.body.id)).toBe(false);
  });

  it('only staff with moderation access see the calendar; only settings managers change the mode', async () => {
    await plain.get('/admin/content-calendar/items').expect(403);
    await plain.get('/admin/content-calendar/counts').expect(403);
    await mod.get('/admin/content-calendar/counts').expect(200);
    expect((await mod.get('/admin/settings/claude-content').expect(200)).body).toEqual({ approval: 'after' });
    await mod.put('/admin/settings/claude-content', { approval: 'before' }).expect(403);
    await admin.put('/admin/settings/claude-content', { approval: 'sometimes' }).expect(422);
    await setMode('before');
    const [audit] = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'settings.claude_content.updated'));
    expect(audit).toMatchObject({ actorId: admin.id, before: { approval: 'after' }, after: { approval: 'before' } });
    await setMode('after');
  });

  it('in "approve before publishing" mode a Claude post waits, hidden from others, until approved', async () => {
    await setMode('before');
    // Kwame and Ngozi follow Amara; Ngozi is mentioned.
    await kwame.post('/follows', { targetType: 'member', targetId: amara.id }).expect(201);
    const post = await amaraClaude.post('/posts', { body: 'Big news from the calendar @ngozi-cal #CalendarLaunch' }).expect(201);
    expect(post.body.status).toBe('awaiting_approval');
    expect(post.body.contentReview).toEqual({ state: 'pending', note: null });
    const id = post.body.id as string;

    // Nobody else sees it: not the post, not the feed, not the profile, not the topic. No mention yet.
    await reader.get(`/posts/${id}`).expect(404);
    const feed = await kwame.get('/feed?tab=latest').expect(200);
    expect(feed.body.items.some((p: { id: string }) => p.id === id)).toBe(false);
    const profile = await reader.get(`/feed?author=${amara.handle}`).expect(200);
    expect(profile.body.items.some((p: { id: string }) => p.id === id)).toBe(false);
    const topic = await reader.get('/topics/CalendarLaunch/posts').expect(200);
    expect(topic.body.items.some((p: { id: string }) => p.id === id)).toBe(false);
    expect(await notificationsFor(reader.id, 'mention')).toHaveLength(0);
    // The author sees it, marked as waiting.
    const own = await amara.get(`/posts/${id}`).expect(200);
    expect(own.body).toMatchObject({ status: 'awaiting_approval', contentReview: { state: 'pending' } });

    // The calendar shows it waiting; the sidebar count includes it.
    const counts = await mod.get('/admin/content-calendar/counts').expect(200);
    expect(counts.body.states.awaiting_approval).toBeGreaterThanOrEqual(1);
    expect(counts.body.approval).toBe('before');
    expect((await mod.get('/admin/content-calendar/awaiting-count').expect(200)).body.count).toBeGreaterThanOrEqual(1);
    const detail = await mod.get(`/admin/content-calendar/post/${id}`).expect(200);
    expect(detail.body).toMatchObject({ state: 'awaiting_approval', actions: ['approve', 'decline'], body: 'Big news from the calendar @ngozi-cal #CalendarLaunch' });
    expect(detail.body.claudeActivity[0]).toMatchObject({ action: 'post.create', clientName: 'Claude Desktop' });

    // A plain member can't approve; a moderator can, and it goes live with the usual notices.
    await plain.post(`/admin/content-calendar/post/${id}/actions`, { action: 'approve' }).expect(403);
    const approved = await mod.post(`/admin/content-calendar/post/${id}/actions`, { action: 'approve', note: 'Looks good' }).expect(200);
    expect(approved.body.item).toMatchObject({ state: 'published', review: { state: 'approved', note: 'Looks good' } });
    expect(approved.body.item.review.by.id).toBe(mod.id);
    await reader.get(`/posts/${id}`).expect(200);
    expect(await notificationsFor(reader.id, 'mention')).toHaveLength(1);
    const told = await notificationsFor(amara.id, 'content_review');
    expect((told[0]!.data as { href: string }).href).toBe(`/posts/${id}`);
    expect(JSON.stringify(told[0]!.data)).toContain('approved your post');
    expect(await auditFor('content_calendar.approved', id)).toHaveLength(1);
    // Approving twice is refused.
    await mod.post(`/admin/content-calendar/post/${id}/actions`, { action: 'approve' }).expect(409);
    await setMode('after');
  });

  it('a declined post stays with its author, with the note', async () => {
    await setMode('before');
    const post = await kwameClaude.post('/posts', { body: 'Not quite ready for everyone' }).expect(201);
    await mod.post(`/admin/content-calendar/post/${post.body.id}/actions`, { action: 'decline' }).expect(422);
    const res = await mod.post(`/admin/content-calendar/post/${post.body.id}/actions`, { action: 'decline', note: 'Please remove the phone number' }).expect(200);
    expect(res.body.item).toMatchObject({ state: 'declined', review: { state: 'declined', note: 'Please remove the phone number' } });
    await reader.get(`/posts/${post.body.id}`).expect(404);
    const own = await kwame.get(`/posts/${post.body.id}`).expect(200);
    expect(own.body).toMatchObject({ status: 'declined', contentReview: { state: 'declined', note: 'Please remove the phone number' } });
    const told = await notificationsFor(kwame.id, 'content_review');
    expect(JSON.stringify(told[0]!.data)).toContain('Please remove the phone number');
    const email = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, kwame.email.toLowerCase())).orderBy(desc(s.emailOutbox.createdAt));
    expect(email.some((e) => e.subject === 'Your post wasn’t approved')).toBe(true);
    await setMode('after');
  });

  it('the scheduler skips held drafts and drafts waiting for approval, and publishes them once released or approved', async () => {
    await setMode('before');
    const scheduled = await kwameClaude.post('/me/drafts', { payload: { body: 'Scheduled by Claude' }, scheduledFor: inHours(2) }).expect(201);
    expect(scheduled.body.review).toEqual({ state: 'pending', note: null });
    await setMode('after');
    const held = await claudeDraft(kwame.id, 'Held by the team', { scheduledFor: new Date(inHours(2)) });
    await mod.post(`/admin/content-calendar/draft/${held.id}/actions`, { action: 'hold', note: 'Checking the facts' }).expect(200);

    // The author sees both labels in their scheduled list.
    const list = await kwame.get('/me/drafts?status=scheduled').expect(200);
    expect(list.body.items.find((d: { id: string }) => d.id === held.id)).toMatchObject({ status: 'held' });
    expect(list.body.items.find((d: { id: string }) => d.id === scheduled.body.id)).toMatchObject({ status: 'scheduled', review: { state: 'pending' } });
    // Publishing a held post themselves is refused.
    await kwame.post(`/me/drafts/${held.id}/publish`).expect(409);
    // Editing it keeps it paused.
    await kwame.patch(`/me/drafts/${held.id}`, { payload: { body: 'Held by the team, edited' } }).expect(200);
    expect((await kwame.get(`/me/drafts/${held.id}`).expect(200)).body.status).toBe('held');

    const drafts = t.app.get(DraftsService);
    const later = new Date(Date.now() + 3 * 3600_000);
    await drafts.runDue(later);
    expect((await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, held.id)))[0]!.status).toBe('held');
    expect((await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, scheduled.body.id)))[0]!.status).toBe('scheduled');

    // Approve and release: both publish at the next run (their time has passed), as Claude posts.
    await mod.post(`/admin/content-calendar/draft/${scheduled.body.id}/actions`, { action: 'approve' }).expect(200);
    await mod.post(`/admin/content-calendar/draft/${held.id}/actions`, { action: 'release' }).expect(200);
    const result = await drafts.runDue(later);
    expect(result.published).toBeGreaterThanOrEqual(2);
    const published = await t.db.select().from(s.posts).where(and(eq(s.posts.authorId, kwame.id), eq(s.posts.source, 'claude'), eq(s.posts.status, 'published')));
    expect(published.map((p) => p.body)).toEqual(expect.arrayContaining(['Scheduled by Claude', 'Held by the team, edited']));
    const approvedPost = published.find((p) => p.body === 'Scheduled by Claude')!;
    expect(approvedPost.contentReview).toBe('approved');
    // The calendar links the post to its draft's history and Claude activity.
    const detail = await mod.get(`/admin/content-calendar/post/${approvedPost.id}`).expect(200);
    expect(detail.body.claudeClient).toBe('Claude Desktop');
    expect(detail.body.history.map((h: { action: string }) => h.action)).toContain('content_calendar.approved');
    expect(await auditFor('content_calendar.held', held.id)).toHaveLength(1);
    expect(await auditFor('content_calendar.released', held.id)).toHaveLength(1);
    const told = await notificationsFor(kwame.id, 'content_review');
    expect(told.some((n) => JSON.stringify(n.data).includes('paused your scheduled post'))).toBe(true);
  });

  it('closes the ways round a review: unscheduling a held post, Claude changing an approved one, Claude editing a live post', async () => {
    // A held post can't be taken off the schedule (and then published straight away) by its author or Claude.
    const held = await claudeDraft(amara.id, 'Paused announcement');
    await mod.post(`/admin/content-calendar/draft/${held.id}/actions`, { action: 'hold', note: 'Wait for the date' }).expect(200);
    await amara.patch(`/me/drafts/${held.id}`, { payload: { body: 'Paused announcement' }, scheduledFor: null }).expect(409);
    await amaraClaude.patch(`/me/drafts/${held.id}`, { payload: { body: 'Paused announcement' }, scheduledFor: null }).expect(409);
    await amara.post(`/me/drafts/${held.id}/publish`).expect(409);
    expect((await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, held.id)))[0]!.status).toBe('held');

    await setMode('before');
    // An approval covers the text the team saw: Claude rewriting and unscheduling it drops the approval,
    // so publishing it now waits for the team again.
    const draft = await claudeDraft(amara.id, 'Approved wording', { contentReview: 'pending' });
    await mod.post(`/admin/content-calendar/draft/${draft.id}/actions`, { action: 'approve' }).expect(200);
    const edited = await amaraClaude.patch(`/me/drafts/${draft.id}`, { payload: { body: 'Different wording' }, scheduledFor: null }).expect(200);
    expect(edited.body.review).toBeNull();
    const published = await amaraClaude.post(`/me/drafts/${draft.id}/publish`).expect(200);
    expect(published.body.status).toBe('awaiting_approval');
    await reader.get(`/posts/${published.body.id}`).expect(404);

    // Claude can't rewrite a post that is already live while approval is required; the member still can.
    const live = await amara.post('/posts', { body: 'Live already' }).expect(201);
    await amaraClaude.patch(`/posts/${live.body.id}`, { body: 'Rewritten by Claude' }).expect(409);
    await amara.patch(`/posts/${live.body.id}`, { body: 'Edited by Amara' }).expect(200);
    await setMode('after');
    await amaraClaude.patch(`/posts/${live.body.id}`, { body: 'Edited with Claude' }).expect(200);
  });

  it('reschedules and cancels scheduled posts', async () => {
    const draft = await claudeDraft(amara.id, 'Move me');
    await mod.post(`/admin/content-calendar/draft/${draft.id}/actions`, { action: 'reschedule', scheduledFor: new Date(Date.now() - 60_000).toISOString() }).expect(422);
    const when = inHours(48);
    const moved = await mod.post(`/admin/content-calendar/draft/${draft.id}/actions`, { action: 'reschedule', scheduledFor: when }).expect(200);
    expect(new Date(moved.body.item.scheduledFor).toISOString()).toBe(when);
    const [audit] = await auditFor('content_calendar.rescheduled', draft.id);
    expect(audit).toMatchObject({ actorId: mod.id, after: { scheduledFor: when } });

    await mod.post(`/admin/content-calendar/draft/${draft.id}/actions`, { action: 'cancel' }).expect(422);
    const cancelled = await mod.post(`/admin/content-calendar/draft/${draft.id}/actions`, { action: 'cancel', note: 'This repeats yesterday’s post' }).expect(200);
    expect(cancelled.body.item).toBeNull();
    const [row] = await t.db.select().from(s.postDrafts).where(eq(s.postDrafts.id, draft.id));
    expect(row).toMatchObject({ status: 'draft', scheduledFor: null });
    await mod.get(`/admin/content-calendar/draft/${draft.id}`).expect(404);
    const told = await notificationsFor(amara.id, 'content_review');
    expect((told[0]!.data as { href: string }).href).toBe('/drafts');
    expect(JSON.stringify(told[0]!.data)).toContain('cancelled your scheduled post');
  });

  it('hides and restores a published Claude post through moderation', async () => {
    const post = await kwameClaude.post('/posts', { body: 'A published Claude post to hide' }).expect(201);
    await mod.post(`/admin/content-calendar/post/${post.body.id}/actions`, { action: 'hide', reason: 'Off-topic promotion' }).expect(200);
    await reader.get(`/posts/${post.body.id}`).expect(404);
    const hidden = await mod.get('/admin/hidden').expect(200);
    expect(JSON.stringify(hidden.body)).toContain(post.body.id);
    const detail = await mod.get(`/admin/content-calendar/post/${post.body.id}`).expect(200);
    expect(detail.body).toMatchObject({ moderationState: 'hidden', actions: ['restore'] });
    expect(detail.body.history[0]).toMatchObject({ action: 'moderation.hide', note: 'Off-topic promotion' });
    await mod.post(`/admin/content-calendar/post/${post.body.id}/actions`, { action: 'restore', reason: 'Checked again, it is fine' }).expect(200);
    await reader.get(`/posts/${post.body.id}`).expect(200);
    expect(await notificationsFor(kwame.id, 'moderation_action')).not.toHaveLength(0);
  });

  it('bulk actions report each item; one that can’t change doesn’t stop the rest', async () => {
    const a = await claudeDraft(amara.id, 'Bulk one');
    const b = await claudeDraft(amara.id, 'Bulk two');
    const alreadyHeld = await claudeDraft(amara.id, 'Bulk three', { status: 'held' });
    await plain.post('/admin/content-calendar/bulk', { items: [{ kind: 'draft', id: a.id }], action: 'hold' }).expect(403);
    const res = await mod
      .post('/admin/content-calendar/bulk', {
        items: [
          { kind: 'draft', id: a.id },
          { kind: 'draft', id: b.id },
          { kind: 'draft', id: alreadyHeld.id },
          { kind: 'post', id: '00000000-0000-4000-8000-000000000000' },
        ],
        action: 'hold',
      })
      .expect(200);
    expect(res.body.done).toEqual([`draft:${a.id}`, `draft:${b.id}`]);
    expect(res.body.failed).toEqual([
      { id: `draft:${alreadyHeld.id}`, error: 'This post is already paused' },
      { id: 'post:00000000-0000-4000-8000-000000000000', error: 'That post was not found' },
    ]);
    expect(await auditFor('content_calendar.held', a.id)).toHaveLength(1);
    await mod.post('/admin/content-calendar/bulk', { items: [{ kind: 'draft', id: a.id }], action: 'decline' }).expect(422);
  });

  it('lists by state and date range, searches, and counts per day in a time zone', async () => {
    const soon = await claudeDraft(kwame.id, 'Calendar search target', { scheduledFor: new Date(inHours(30)) });
    const from = new Date().toISOString();
    const to = inHours(24 * 40);
    const range = await mod.get(`/admin/content-calendar/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).expect(200);
    expect(range.body.items.some((i: { id: string }) => i.id === soon.id)).toBe(true);
    await mod.get(`/admin/content-calendar/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(inHours(24 * 70))}`).expect(422);
    await mod.get(`/admin/content-calendar/items?from=${encodeURIComponent(from)}`).expect(422);

    const found = await mod.get('/admin/content-calendar/items?q=search%20target').expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([soon.id]);
    const byAuthor = await mod.get(`/admin/content-calendar/items?q=Kwame&state=scheduled`).expect(200);
    expect(byAuthor.body.items.every((i: { author: { id: string } }) => i.author.id === kwame.id)).toBe(true);

    // A web scheduled post shows only with source=all.
    const web = await amara.post('/me/drafts', { payload: { body: 'Scheduled on the site' }, scheduledFor: inHours(5) }).expect(201);
    const claudeOnly = await mod.get('/admin/content-calendar/items?state=scheduled&limit=200').expect(200);
    expect(claudeOnly.body.items.some((i: { id: string }) => i.id === web.body.id)).toBe(false);
    const all = await mod.get('/admin/content-calendar/items?state=scheduled&source=all&limit=200').expect(200);
    expect(all.body.items.find((i: { id: string }) => i.id === web.body.id)).toMatchObject({ source: 'web', claudeClient: null });

    // Cursor pages don't repeat items.
    const first = await mod.get('/admin/content-calendar/items?state=all&source=all&limit=2').expect(200);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await mod.get(`/admin/content-calendar/items?state=all&source=all&limit=2&cursor=${first.body.nextCursor}`).expect(200);
    const ids = [...first.body.items, ...second.body.items].map((i: { key: string }) => i.key);
    expect(new Set(ids).size).toBe(ids.length);

    const at = new Date(inHours(30));
    const month = at.toISOString().slice(0, 7);
    const counts = await mod.get(`/admin/content-calendar/counts?month=${month}&tz=Africa/Lagos`).expect(200);
    const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    if (lagosDay.startsWith(month)) {
      expect(counts.body.days.find((d: { date: string }) => d.date === lagosDay).states.scheduled).toBeGreaterThanOrEqual(1);
    }
    expect(counts.body).toMatchObject({ month, tz: 'Africa/Lagos' });
    await mod.get('/admin/content-calendar/counts?tz=Mars/Olympus').expect(422);
  });
});
