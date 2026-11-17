import { and, eq } from 'drizzle-orm';
import type { AdminInboxPage, AdminInboxThread, ConversationView, MessagesPage, MessageView } from '@chartermission/contracts';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Official conversations and the Charter Mission inbox', () => {
  let t: TestApp;
  let official: Member;
  let admin: Member;
  let moderator: Member;
  let amara: Member;
  let kwame: Member;

  const connect = async (a: Member, b: Member) => {
    const req = await a.post('/connections', { memberId: b.id }).expect(201);
    await b.post(`/connections/${req.body.id}/accept`).expect(200);
  };
  const inbox = async (q = '') => (await admin.get(`/admin/inbox${q}`).expect(200)).body as AdminInboxPage;

  beforeAll(async () => {
    t = await createTestApp();
    official = await createMember(t, { name: 'Charter Mission' });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, official.id));
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    moderator = await createMember(t, { name: 'Moe Moderator', roles: ['moderator'], admin: true });
    amara = await createMember(t, { name: 'Amara Okafor', email: 'amara.official@example.test' });
    kwame = await createMember(t, { name: 'Kwame Mensah' });
    await connect(amara, kwame);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('messaging settings: official accounts to choose from, the single one used implicitly, only official accounts accepted', async () => {
    const view = (await admin.get('/admin/settings/messaging').expect(200)).body;
    expect(view).toMatchObject({ senderId: null, sender: { id: official.id }, options: [expect.objectContaining({ id: official.id })] });
    const bad = await admin.put('/admin/settings/messaging', { senderId: amara.id }).expect(422);
    expect(bad.body.error.fields.senderId).toBeTruthy();
    expect((await admin.put('/admin/settings/messaging', { senderId: official.id }).expect(200)).body).toMatchObject({ senderId: official.id, sender: { id: official.id } });
    await moderator.get('/admin/settings/messaging').expect(403);
    await moderator.put('/admin/settings/messaging', { senderId: null }).expect(403);
  });

  it('a member can’t start an official conversation, and direct-chat rules for official accounts are unchanged', async () => {
    const res = await amara.post('/messages/conversations', { memberId: official.id }).expect(403);
    expect(res.body.error.message).toContain('Official Charter Mission accounts');
    await official.post('/messages/conversations', { memberId: kwame.id }).expect(403);
    expect(await count(t.db, s.conversations, eq(s.conversations.kind, 'official'))).toBe(0);
  });

  it('the team writes to a member; the member reads, replies with attachments, organises it; the inbox tracks unread', async () => {
    const started = (await admin.post('/admin/inbox/start', { memberId: amara.id, body: 'Welcome to Charter Mission! See https://example.com/guide' }).expect(200)).body as AdminInboxThread;
    expect(started.member).toMatchObject({ id: amara.id, email: 'amara.official@example.test' });
    expect(started.messages).toEqual([expect.objectContaining({ from: 'team', staff: { id: admin.id, name: 'Ada Admin' }, announcement: null })]);
    const conversationId = started.conversationId;

    // The member sees it like a chat with the official account, with a notification.
    const list = (await amara.get('/messages/conversations').expect(200)).body as ConversationView[];
    const convo = list.find((c) => c.id === conversationId)!;
    expect(convo).toMatchObject({ kind: 'official', status: 'active', title: 'Charter Mission', member: { id: official.id, official: true }, canSend: true, unread: 1, firstContact: false, request: null });
    expect((await amara.get('/messages/unread').expect(200)).body).toMatchObject({ unread: 1 });
    const [note] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, amara.id), eq(s.notifications.type, 'message_received')));
    expect(note).toBeTruthy();
    const page = (await amara.get(`/messages/conversations/${conversationId}/messages`).expect(200)).body as MessagesPage;
    expect(page.items.map((m) => m.senderId)).toEqual([official.id]);

    // The official account's owner never sees these conversations in the member app.
    expect(((await official.get('/messages/conversations').expect(200)).body as ConversationView[]).map((c) => c.id)).not.toContain(conversationId);
    await official.get(`/messages/conversations/${conversationId}/messages`).expect(404);
    await official.post(`/messages/conversations/${conversationId}/messages`, { body: 'hi' }).expect(404);
    expect((await official.get('/messages/unread').expect(200)).body).toMatchObject({ unread: 0 });

    // Starting a chat with the official account now opens this one.
    expect((await amara.post('/messages/conversations', { memberId: official.id }).expect(200)).body).toMatchObject({ id: conversationId, kind: 'official' });

    // Nothing unread for the team yet: they wrote last.
    expect((await inbox()).unreadCount).toBe(0);

    // The member replies, with an attachment. The official account's owner isn't notified.
    const [file] = await t.db
      .insert(s.files)
      .values({ ownerId: amara.id, purpose: 'message_image', mime: 'image/png', declaredMime: 'image/png', originalName: 'id.png', sizeBytes: 1000, storageKey: `uploads/x/id-${amara.id}.png`, scanStatus: 'clean' })
      .returning();
    const reply = (await amara.post(`/messages/conversations/${conversationId}/messages`, { body: 'Thank you! Here is my document.', attachmentIds: [file!.id] }).expect(201)).body as MessageView;
    expect(reply.attachments).toHaveLength(1);
    expect(await count(t.db, s.notifications, eq(s.notifications.userId, official.id))).toBe(0);
    // No meeting invites to Charter Mission.
    await amara
      .post(`/messages/conversations/${conversationId}/messages`, { meeting: { title: 'Chat', startsAt: new Date(Date.now() + 86400_000).toISOString(), durationMinutes: 30 } })
      .expect(403);
    // Nor blocking it.
    await amara.post(`/blocks/${official.id}`).expect(403);

    // Unread in the admin inbox, findable by name, handle or email.
    const unread = await inbox('?filter=unread');
    expect(unread.unreadCount).toBe(1);
    expect(unread.items).toEqual([
      expect.objectContaining({ conversationId, unread: true, member: expect.objectContaining({ id: amara.id }), lastMessage: expect.objectContaining({ fromMember: true }) }),
    ]);
    expect((await admin.get('/admin/inbox/unread-count').expect(200)).body).toEqual({ unread: 1 });
    expect((await inbox('?q=amara.official')).items).toHaveLength(1);
    expect((await inbox('?q=Okafor')).items).toHaveLength(1);
    expect((await inbox('?q=nobody-like-this')).items).toHaveLength(0);

    // Opening the thread marks it read for the whole team.
    const thread = (await admin.get(`/admin/inbox/${conversationId}`).expect(200)).body as AdminInboxThread;
    expect(thread.messages.map((m) => m.from)).toEqual(['team', 'member']);
    expect(thread.messages[1]!.attachments).toEqual([expect.objectContaining({ name: 'id.png', kind: 'image' })]);
    expect((await inbox()).unreadCount).toBe(0);
    expect((await inbox('?filter=unread')).items).toHaveLength(0);

    // The member sees the team has read it.
    const after = (await amara.get(`/messages/conversations/${conversationId}`).expect(200)).body as ConversationView;
    expect(after.seenAt).toBeTruthy();

    // The team answers; the member gets it live-able, notified, unread.
    await amara.post(`/messages/conversations/${conversationId}/read`).expect(204);
    const answer = (await admin.post(`/admin/inbox/${conversationId}/messages`, { body: 'Got it, thanks.' }).expect(201)).body;
    expect(answer).toMatchObject({ from: 'team', staff: { id: admin.id } });
    expect(((await amara.get(`/messages/conversations/${conversationId}`).expect(200)).body as ConversationView).unread).toBe(1);

    // Member organises it like any chat.
    expect((await amara.patch(`/messages/conversations/${conversationId}`, { mute: '8h', archived: true, unread: true }).expect(200)).body).toMatchObject({ muted: true, archived: true, markedUnread: true });
    await amara.patch(`/messages/conversations/${conversationId}`, { mute: 'off', archived: false }).expect(200);

    // A message in it can be reported.
    await amara.post('/reports', { targetType: 'message', targetId: answer.id, reason: 'spam' }).then((r) => expect(r.status).toBeLessThan(300));

    // Audit, without message bodies.
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, conversationId));
    expect(audit.map((a) => a.action).sort()).toEqual(['inbox.replied', 'inbox.started']);
    expect(JSON.stringify(audit)).not.toContain('Got it');
  });

  it('starting again reuses the conversation; replies need a sender', async () => {
    const first = (await admin.post('/admin/inbox/start', { memberId: kwame.id, body: 'Hello Kwame' }).expect(200)).body as AdminInboxThread;
    const again = (await admin.post('/admin/inbox/start', { memberId: kwame.id, body: 'One more thing' }).expect(200)).body as AdminInboxThread;
    expect(again.conversationId).toBe(first.conversationId);
    expect(again.messages).toHaveLength(2);
    await admin.post('/admin/inbox/start', { memberId: official.id, body: 'Hi' }).expect(400);

    // A second official account and no sender chosen: nothing can be sent until one is chosen.
    const other = await createMember(t, { name: 'Charter Mission Ghana' });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, other.id));
    await admin.put('/admin/settings/messaging', { senderId: null }).expect(200);
    const res = await admin.post(`/admin/inbox/${first.conversationId}/messages`, { body: 'Anyone?' }).expect(409);
    expect(res.body.error.message).toBe('Choose the Charter Mission account messages are sent from in Messages settings');
    await admin.post('/admin/inbox/start', { memberId: kwame.id, body: 'x' }).expect(409);
    await admin.put('/admin/settings/messaging', { senderId: official.id }).expect(200);
    await t.db.update(s.users).set({ isOfficial: false }).where(eq(s.users.id, other.id));
  });

  it('only members.message reaches the inbox; members never do', async () => {
    await moderator.get('/admin/inbox').expect(403);
    await moderator.post('/admin/inbox/start', { memberId: kwame.id, body: 'Hi' }).expect(403);
    await amara.get('/admin/inbox').expect(403);
    await admin.get('/admin/inbox/00000000-0000-4000-8000-000000000000').expect(404);
  });
});
