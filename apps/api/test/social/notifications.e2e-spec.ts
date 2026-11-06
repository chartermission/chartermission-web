import { and, eq, like } from 'drizzle-orm';
import { NotificationCategory } from '@chartermission/contracts';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { actorPrefix } from '../../src/notifications/notifications.service.js';
import { block, createPost } from './social-helpers.js';

describe('Notifications', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const commentEmails = (to: string) =>
    count(t.db, s.emailOutbox, and(eq(s.emailOutbox.toAddress, to.toLowerCase()), like(s.emailOutbox.template, 'notification.comment_on_post')));

  it('formats batched actor names', () => {
    expect(actorPrefix(['Amina'], 1).map((x) => x.text).join('')).toBe('Amina');
    expect(actorPrefix(['Amina', 'Kwame'], 2).map((x) => x.text).join('')).toBe('Amina and Kwame');
    expect(actorPrefix(['Amina', 'Kwame'], 5).map((x) => x.text).join('')).toBe('Amina and 4 others');
    expect(actorPrefix(['Amina'], 2).map((x) => x.text).join('')).toBe('Amina and 1 other');
  });

  it('returns defaults for every category and channel', async () => {
    const m = await createMember(t);
    const res = await m.get('/me/notification-preferences').expect(200);
    expect(res.body.preferences).toHaveLength(NotificationCategory.options.length * 3);
    expect(res.body.preferences).toContainEqual({ category: 'events', channel: 'email', enabled: true });
    expect(res.body.preferences).toContainEqual({ category: 'comments', channel: 'email', enabled: false });
    expect(res.body.preferences).toContainEqual({ category: 'mentions_replies', channel: 'email', enabled: true });
    await m.put('/me/notification-preferences', { preferences: [{ category: 'security', channel: 'email', enabled: false }] }).expect(422);
  });

  it('email for comments follows the member’s preference', async () => {
    const author = await createMember(t);
    const x = await createMember(t, { name: 'Commenter One' });
    const y = await createMember(t, { name: 'Commenter Two' });
    const p = await createPost(author, 'Tell me what you think');

    // Default: comments email off, in-app on.
    await x.post(`/posts/${p.id}/comments`, { body: 'First' }).expect(201);
    expect(await commentEmails(author.email)).toBe(0);
    expect((await author.get('/notifications').expect(200)).body.items[0].type).toBe('comment_on_post');

    // Turn email on.
    const on = await author.put('/me/notification-preferences', { preferences: [{ category: 'comments', channel: 'email', enabled: true }] }).expect(200);
    expect(on.body.preferences).toContainEqual({ category: 'comments', channel: 'email', enabled: true });
    await y.post(`/posts/${p.id}/comments`, { body: 'Second' }).expect(201);
    expect(await commentEmails(author.email)).toBe(1);

    // Turn it off again: no more emails, in-app still arrives.
    await author.put('/me/notification-preferences', { preferences: [{ category: 'comments', channel: 'email', enabled: false }] }).expect(200);
    const z = await createMember(t);
    await z.post(`/posts/${p.id}/comments`, { body: 'Third' }).expect(201);
    expect(await commentEmails(author.email)).toBe(1);
    expect((await author.get('/notifications').expect(200)).body.items.filter((n: { type: string }) => n.type === 'comment_on_post')).toHaveLength(3);

    // In-app off for comments: nothing new.
    await author.put('/me/notification-preferences', { preferences: [{ category: 'comments', channel: 'in_app', enabled: false }] }).expect(200);
    const w = await createMember(t);
    await w.post(`/posts/${p.id}/comments`, { body: 'Fourth' }).expect(201);
    expect((await author.get('/notifications').expect(200)).body.items.filter((n: { type: string }) => n.type === 'comment_on_post')).toHaveLength(3);
  });

  it('never notifies members about their own actions or across blocks', async () => {
    const author = await createMember(t);
    const blocked = await createMember(t);
    const p = await createPost(author, 'Mine');
    await author.put('/reactions', { targetType: 'post', targetId: p.id }).expect(200);
    await author.post(`/posts/${p.id}/comments`, { body: 'Self comment' }).expect(201);
    expect((await author.get('/notifications').expect(200)).body.items).toHaveLength(0);
    // Reacted before the block: the notification exists; after the block, new ones don't.
    const p2 = await createPost(author, 'Another');
    await block(t, author.id, blocked.id);
    await blocked.put('/reactions', { targetType: 'post', targetId: p2.id }).expect(404);
    expect((await author.get('/notifications').expect(200)).body.items).toHaveLength(0);
  });

  it('filters, pagination and mark as read', async () => {
    const author = await createMember(t, { handle: 'notif-target' });
    const p = await createPost(author, 'Hello');
    for (let i = 0; i < 3; i++) {
      const m = await createMember(t);
      await m.post(`/posts/${p.id}/comments`, { body: `c${i}` }).expect(201);
    }
    const mentioner = await createMember(t, { name: 'Leila Benali' });
    await createPost(mentioner, 'Thanks @notif-target');

    const all = await author.get('/notifications?limit=2').expect(200);
    expect(all.body.items).toHaveLength(2);
    const next = await author.get(`/notifications?limit=2&cursor=${all.body.nextCursor}`).expect(200);
    expect(next.body.items).toHaveLength(2);
    const seen = new Set([...all.body.items, ...next.body.items].map((n: { id: string }) => n.id));
    expect(seen.size).toBe(4);

    const mentions = await author.get('/notifications?filter=mentions').expect(200);
    expect(mentions.body.items).toHaveLength(1);
    expect(mentions.body.items[0].segments[0]).toEqual({ text: 'Leila Benali', strong: true });

    await author.post('/notifications/read', { ids: [mentions.body.items[0].id] }).expect(200);
    expect((await author.get('/notifications/unread-count').expect(200)).body.unread).toBe(3);
    expect((await author.get('/notifications?filter=unread').expect(200)).body.items).toHaveLength(3);
    const res = await author.post('/notifications/read', { all: true }).expect(200);
    expect(res.body.unread).toBe(0);
  });
});
