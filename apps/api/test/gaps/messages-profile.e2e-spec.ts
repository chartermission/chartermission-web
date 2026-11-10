import { eq } from 'drizzle-orm';
import type { ConversationView, MemberProfile, MessagesPage, OwnProfile } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { REASON } from '../moderation/fixtures.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Private messages, and the profile’s intro video, résumé and links', () => {
  let t: TestApp;
  let amara: Member;
  let kwame: Member;
  let leila: Member;

  const connect = async (a: Member, b: Member) => {
    const req = await a.post('/connections', { memberId: b.id }).expect(201);
    await b.post(`/connections/${req.body.id}/accept`).expect(200);
  };
  /** A file row as the upload pipeline leaves it once checked (the pipeline itself is covered by the media tests). */
  const cleanFile = async (ownerId: string, purpose: string, mime: string, name: string) => {
    const [row] = await t.db
      .insert(s.files)
      .values({ ownerId, purpose, mime, declaredMime: mime, originalName: name, sizeBytes: 12_345, storageKey: `uploads/${purpose}/${name}-${ownerId}`, scanStatus: 'clean', durationMs: purpose === 'profile_video' ? 42_000 : null })
      .returning();
    return row!.id;
  };

  beforeAll(async () => {
    t = await createTestApp();
    amara = await createMember(t, { name: 'Amara Okafor' });
    kwame = await createMember(t, { name: 'Kwame Mensah' });
    leila = await createMember(t, { name: 'Leila Benali' });
    await connect(amara, kwame);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('connected members exchange messages; others cannot start a conversation or read one', async () => {
    await amara.post('/messages/conversations', { memberId: leila.id }).expect(403);
    await amara.post('/messages/conversations', { memberId: amara.id }).expect(400);
    const convo = (await amara.post('/messages/conversations', { memberId: kwame.id }).expect(200)).body as ConversationView;
    expect(convo).toMatchObject({ member: { id: kwame.id }, lastMessage: null, unread: 0, canSend: true });
    // The same conversation whichever of the two opens it; empty ones aren't listed.
    expect((await kwame.post('/messages/conversations', { memberId: amara.id }).expect(200)).body.id).toBe(convo.id);
    expect((await kwame.get('/messages/conversations').expect(200)).body).toEqual([]);

    await amara.post(`/messages/conversations/${convo.id}/messages`, { body: '   ' }).expect(422);
    const first = await amara.post(`/messages/conversations/${convo.id}/messages`, { body: 'Hello Kwame 👋' }).expect(201);
    await amara.post(`/messages/conversations/${convo.id}/messages`, { body: 'Are you coming to the Accra meetup?' }).expect(201);
    expect((await kwame.get('/messages/unread').expect(200)).body).toEqual({ unread: 1 });
    expect((await amara.get('/messages/unread').expect(200)).body).toEqual({ unread: 0 });
    const inbox = (await kwame.get('/messages/conversations').expect(200)).body as ConversationView[];
    expect(inbox).toEqual([expect.objectContaining({ id: convo.id, unread: 2, lastMessage: expect.objectContaining({ body: 'Are you coming to the Accra meetup?', mine: false }) })]);
    // One notification for the conversation, not one per message.
    const notes = (await kwame.get('/notifications').expect(200)).body.items as { type: string; href: string }[];
    expect(notes.filter((n) => n.type === 'message_received')).toEqual([expect.objectContaining({ href: `/messages/${convo.id}` })]);

    const page = (await kwame.get(`/messages/conversations/${convo.id}/messages`).expect(200)).body as MessagesPage;
    expect(page.items.map((m) => m.body)).toEqual(['Hello Kwame 👋', 'Are you coming to the Accra meetup?']);
    expect(page.olderCursor).toBeNull();
    await kwame.post(`/messages/conversations/${convo.id}/read`).expect(204);
    expect((await kwame.get('/messages/unread').expect(200)).body).toEqual({ unread: 0 });
    expect(((await amara.get('/messages/conversations').expect(200)).body as ConversationView[])[0]!.seenAt).toEqual(expect.any(String));

    const reply = await kwame.post(`/messages/conversations/${convo.id}/messages`, { body: 'Yes, see you there' }).expect(201);
    const fresh = (await amara.get(`/messages/conversations/${convo.id}/messages?after=${encodeURIComponent(first.body.createdAt)}`).expect(200)).body as MessagesPage;
    expect(fresh.items.map((m) => m.id)).toContain(reply.body.id);
    expect(fresh.items.map((m) => m.id)).not.toContain(first.body.id);

    // Nobody else can read or write in it.
    await leila.get(`/messages/conversations/${convo.id}/messages`).expect(404);
    await leila.post(`/messages/conversations/${convo.id}/messages`, { body: 'hi' }).expect(404);
    // The sender can take a message back; the other member can't.
    await kwame.delete(`/messages/${first.body.id}`).expect(404);
    expect((await amara.delete(`/messages/${first.body.id}`).expect(200)).body).toMatchObject({ deleted: true, body: '' });

    // Paging back through a longer conversation.
    for (let i = 0; i < 5; i += 1) await amara.post(`/messages/conversations/${convo.id}/messages`, { body: `Message ${i}` }).expect(201);
    const latest = (await kwame.get(`/messages/conversations/${convo.id}/messages?limit=3`).expect(200)).body as MessagesPage;
    expect(latest.items.map((m) => m.body)).toEqual(['Message 2', 'Message 3', 'Message 4']);
    const older = (await kwame.get(`/messages/conversations/${convo.id}/messages?limit=3&before=${latest.olderCursor}`).expect(200)).body as MessagesPage;
    expect(older.items.map((m) => m.body)).toEqual(['Yes, see you there', 'Message 0', 'Message 1']);

    // Blocking closes the conversation both ways; no longer being connected does not.
    expect((await kwame.post(`/blocks/${amara.id}`)).status).toBeLessThan(300);
    await amara.post(`/messages/conversations/${convo.id}/messages`, { body: 'Still there?' }).expect(403);
    expect(((await kwame.get('/messages/conversations').expect(200)).body as ConversationView[])[0]).toMatchObject({ canSend: false });
  });

  it('official accounts take no private messages', async () => {
    const official = await createMember(t, { name: 'Charter Official' });
    await connect(leila, official);
    await t.db.update(s.users).set({ isStaff: true, isOfficial: true }).where(eq(s.users.id, official.id));
    await leila.post('/messages/conversations', { memberId: official.id }).expect(403);
  });

  it('a member adds an intro video, a résumé and social links, and chooses who sees them', async () => {
    const video = await cleanFile(leila.id, 'profile_video', 'video/mp4', 'intro.mp4');
    const resume = await cleanFile(leila.id, 'profile_resume', 'application/pdf', 'Leila Benali CV.pdf');
    const notMine = await cleanFile(amara.id, 'profile_resume', 'application/pdf', 'other.pdf');
    await leila.patch('/me/profile', { resumeFileId: notMine }).expect(422);
    await leila.patch('/me/profile', { introVideoFileId: resume }).expect(422);
    const links = [
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/leila-benali' },
      { label: 'Portfolio', url: 'https://leila.example.com' },
    ];
    const own = (await leila.patch('/me/profile', { introVideoFileId: video, resumeFileId: resume, links }).expect(200)).body as OwnProfile;
    expect(own.introVideo).toMatchObject({ fileId: video, durationSeconds: 42 });
    expect(own.resume).toMatchObject({ fileId: resume, name: 'Leila Benali CV.pdf', sizeBytes: 12_345 });
    expect(own.fieldVisibility).toMatchObject({ introVideo: 'members', resume: 'connections' });

    // A member sees the video and links; the résumé is for connections until Leila says otherwise.
    const asMember = (await amara.get(`/members/${leila.handle}`).expect(200)).body as MemberProfile;
    expect(asMember.introVideo).toMatchObject({ url: expect.stringContaining(video) });
    expect(asMember.links).toEqual(links);
    expect(asMember.resume).toBeUndefined();
    await connect(amara, leila);
    expect(((await amara.get(`/members/${leila.handle}`).expect(200)).body as MemberProfile).resume).toMatchObject({ name: 'Leila Benali CV.pdf' });

    await leila.patch('/me/profile', { introVideoFileId: null, resumeFileId: null }).expect(200);
    const after = (await amara.get(`/members/${leila.handle}`).expect(200)).body as MemberProfile;
    expect(after.introVideo).toBeUndefined();
    expect(after.resume).toBeUndefined();
    // Up to ten links.
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `Link ${i}`, url: `https://example.com/${i}` }));
    await leila.patch('/me/profile', { links: many }).expect(422);
    await leila.patch('/me/profile', { links: many.slice(0, 10) }).expect(200);
  });
  it('a member can report a message; a moderator removing it hides the text from both members', async () => {
    const mod = await createMember(t, { name: 'Moderator M', roles: ['moderator'], admin: true });
    const zara = await createMember(t, { name: 'Zara Nkosi' });
    const tunde = await createMember(t, { name: 'Tunde Bakare' });
    await connect(zara, tunde);
    const convo = (await zara.post('/messages/conversations', { memberId: tunde.id }).expect(200)).body as ConversationView;
    const sent = (await tunde.post(`/messages/conversations/${convo.id}/messages`, { body: 'Send me your bank details and I will double it' }).expect(201)).body;
    // Only the other member of the conversation can report it, and not the sender.
    await leila.post('/reports', { targetType: 'message', targetId: sent.id, reason: 'scam' }).expect(404);
    await tunde.post('/reports', { targetType: 'message', targetId: sent.id, reason: 'scam' }).expect(422);
    const report = await zara.post('/reports', { targetType: 'message', targetId: sent.id, reason: 'scam', detail: 'Asking for money' }).expect(201);

    const queue = (await mod.get('/admin/reports').expect(200)).body.items as { id: string; target: { type: string; preview: string } }[];
    expect(queue.find((r) => r.id === report.body.id)?.target).toMatchObject({ type: 'message', preview: expect.stringContaining('bank details') });
    await mod.post(`/admin/reports/${report.body.id}/actions`, { action: 'remove', reason: REASON }).expect(201);

    for (const who of [zara, tunde]) {
      const page = (await who.get(`/messages/conversations/${convo.id}/messages`).expect(200)).body as MessagesPage;
      expect(page.items.find((m) => m.id === sent.id)).toMatchObject({ removed: true, body: '' });
    }
    const inbox = (await zara.get('/messages/conversations').expect(200)).body as ConversationView[];
    expect(inbox.find((c) => c.id === convo.id)?.lastMessage).toMatchObject({ removed: true, body: '' });
  });
});
