import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { ConversationView, MessageStreamEvent, MessagesPage, MessageView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { ffmpegPaths } from '../../src/media/video.js';
import { RealtimeService } from '../../src/messages/realtime.service.js';
import { chapterId, grantChapterLead, insertEvent } from '../events/event-helpers.js';
import { createPost, uploadBytes } from '../social/social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Messaging: requests, rich messages, organising, groups and announcements', () => {
  let t: TestApp;
  let amara: Member;
  let kwame: Member;
  let leila: Member;
  let tunde: Member;
  let dir: string;

  const connect = async (a: Member, b: Member) => {
    const req = await a.post('/connections', { memberId: b.id }).expect(201);
    await b.post(`/connections/${req.body.id}/accept`).expect(200);
  };
  const chat = async (a: Member, b: Member) => (await a.post('/messages/conversations', { memberId: b.id }).expect(200)).body as ConversationView;
  const send = async (m: Member, conversationId: string, body: Record<string, unknown>) =>
    (await m.post(`/messages/conversations/${conversationId}/messages`, body).expect(201)).body as MessageView;
  const page = async (m: Member, conversationId: string, q = '') =>
    (await m.get(`/messages/conversations/${conversationId}/messages${q}`).expect(200)).body as MessagesPage;

  beforeAll(async () => {
    t = await createTestApp();
    amara = await createMember(t, { name: 'Amara Okafor' });
    kwame = await createMember(t, { name: 'Kwame Mensah' });
    leila = await createMember(t, { name: 'Leila Benali' });
    tunde = await createMember(t, { name: 'Tunde Bakare' });
    await connect(amara, kwame);
    await connect(amara, tunde);
    dir = await mkdtemp(path.join(os.tmpdir(), 'cm-msg-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await t.close();
  });
  beforeEach(() => resetLimits());

  it('message requests: one message until accepted, a separate box, accept or decline', async () => {
    const request = await chat(leila, kwame);
    expect(request).toMatchObject({ status: 'request', request: 'outgoing', firstContact: true, canSend: true });
    await send(leila, request.id, { body: 'Hi Kwame, I run a logistics startup in Accra and would love your advice.' });
    // One message, then wait.
    const blocked = await leila.post(`/messages/conversations/${request.id}/messages`, { body: 'Hello?' }).expect(403);
    expect(blocked.body.error.message).toContain('accepts your message request');
    // Kwame sees it under Requests, not in his inbox.
    expect((await kwame.get('/messages/conversations').expect(200)).body.map((c: ConversationView) => c.id)).not.toContain(request.id);
    const requests = (await kwame.get('/messages/conversations?box=requests').expect(200)).body as ConversationView[];
    expect(requests).toEqual([expect.objectContaining({ id: request.id, request: 'incoming', firstContact: true, unread: 1 })]);
    expect((await kwame.get('/messages/unread').expect(200)).body).toMatchObject({ requests: 1 });
    // Accepting turns it into an ordinary chat.
    expect((await kwame.post(`/messages/conversations/${request.id}/accept`).expect(200)).body).toMatchObject({ status: 'active', request: null });
    await send(leila, request.id, { body: 'Thank you!' });

    // Declined: the sender can't write; the recipient no longer sees it.
    const second = await chat(tunde, leila);
    await send(tunde, second.id, { body: 'Hello Leila' });
    await leila.post(`/messages/conversations/${second.id}/decline`).expect(204);
    expect((await tunde.get(`/messages/conversations/${second.id}`).expect(200)).body).toMatchObject({ canSend: false, cantSendReason: expect.stringContaining('didn’t accept') });
    await leila.get(`/messages/conversations/${second.id}`).expect(404);
  });

  it('replies, reactions, edits, clientId retries, attachments and shared cards', async () => {
    const c = await chat(amara, kwame);
    const first = await send(amara, c.id, { body: 'Do you have the AfCFTA report?', clientId: '00000000-0000-4000-8000-000000000001' });
    // Retrying with the same clientId returns the same message.
    const retry = await send(amara, c.id, { body: 'Do you have the AfCFTA report?', clientId: '00000000-0000-4000-8000-000000000001' });
    expect(retry.id).toBe(first.id);
    expect((await page(kwame, c.id)).items.filter((m) => m.id === first.id)).toHaveLength(1);

    // Reply with a photo and a PDF.
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 120, b: 60 } } }).png().toBuffer();
    const photo = await uploadBytes(t, kwame, { purpose: 'message_image' as never, fileName: 'chart.png', mime: 'image/png', data: png });
    await kwame.post(`/uploads/${photo}/complete`).expect(200);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const doc = await uploadBytes(t, kwame, { purpose: 'message_file' as never, fileName: 'report.pdf', mime: 'application/pdf', data: pdf });
    await kwame.post(`/uploads/${doc}/complete`).expect(200);
    const reply = await send(kwame, c.id, { body: 'Here it is', replyToId: first.id, attachmentIds: [photo, doc] });
    expect(reply.replyTo).toMatchObject({ id: first.id, senderName: 'Amara Okafor', body: 'Do you have the AfCFTA report?' });
    expect(reply.attachments.map((a) => a.kind)).toEqual(['image', 'document']);
    // Someone else's upload can't be attached.
    await amara.post(`/messages/conversations/${c.id}/messages`, { body: 'x', attachmentIds: [photo] }).expect(400);

    // Reactions: one per member, replaced by a new one, removable.
    await amara.put(`/messages/${reply.id}/reaction`, { emoji: '👍' }).expect(200);
    const changed = (await amara.put(`/messages/${reply.id}/reaction`, { emoji: '🙏' }).expect(200)).body as MessageView;
    expect(changed.reactions).toEqual([expect.objectContaining({ emoji: '🙏', count: 1, mine: true, memberIds: [amara.id] })]);
    await amara.put(`/messages/${reply.id}/reaction`, { emoji: 'yes' }).expect(422);
    expect(((await amara.delete(`/messages/${reply.id}/reaction`).expect(200)).body as MessageView).reactions).toEqual([]);

    // Edit within 15 minutes; not after; not someone else's.
    const edited = (await amara.patch(`/messages/${first.id}`, { body: 'Do you have the latest AfCFTA report?' }).expect(200)).body as MessageView;
    expect(edited).toMatchObject({ body: 'Do you have the latest AfCFTA report?', editedAt: expect.any(String) });
    await kwame.patch(`/messages/${first.id}`, { body: 'hijack' }).expect(404);
    await t.db.update(s.messages).set({ createdAt: new Date(Date.now() - 20 * 60_000) }).where(eq(s.messages.id, first.id));
    await amara.patch(`/messages/${first.id}`, { body: 'too late' }).expect(409);

    // A shared post appears as a card; once deleted the card says so.
    const post = await createPost(tunde, 'Lagos agri-tech meetup next week');
    const card = await send(amara, c.id, { share: { type: 'post', key: post.id } });
    expect(card).toMatchObject({ kind: 'share', share: { type: 'post', path: `/posts/${post.id}`, available: true, title: expect.stringContaining('Tunde Bakare') } });
    await tunde.delete(`/posts/${post.id}`).expect(200);
    const later = (await page(kwame, c.id)).items.find((m) => m.id === card.id)!;
    expect(later.share).toMatchObject({ available: false });
    await amara.post(`/messages/conversations/${c.id}/messages`, { share: { type: 'post', key: post.id } }).expect(404);

    // Share to several people at once.
    const shared = await amara.post('/messages/share', { share: { type: 'member', key: (await handle(kwame.id)) }, body: 'Meet Kwame', memberIds: [tunde.id] }).expect(200);
    expect(shared.body).toEqual({ sent: 1 });
    await amara.post('/messages/share', { share: { type: 'member', key: 'x' }, memberIds: [leila.id] }).expect(403);
  });

  it('voice notes are converted to AAC and sent', async (ctx) => {
    const { ffmpeg } = await ffmpegPaths();
    if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status !== 0) ctx.skip();
    const out = path.join(dir, 'voice.webm');
    const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'libopus', out], { stdio: 'ignore' });
    if (made.status !== 0) spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'libvorbis', out], { stdio: 'ignore' });
    const id = await uploadBytes(t, amara, { purpose: 'voice_note' as never, fileName: 'voice.webm', mime: 'audio/webm;codecs=opus', data: await readFile(out) });
    const done = (await amara.post(`/uploads/${id}/complete`).expect(200)).body;
    expect(done).toMatchObject({ status: 'clean', mime: 'audio/mp4' });
    expect(done.durationSeconds).toBeGreaterThan(2);
    const c = await chat(amara, kwame);
    const voice = await send(amara, c.id, { voiceNoteId: id });
    expect(voice).toMatchObject({ kind: 'voice', attachments: [expect.objectContaining({ kind: 'voice', mime: 'audio/mp4' })] });
    const list = (await kwame.get('/messages/conversations').expect(200)).body as ConversationView[];
    expect(list.find((x) => x.id === c.id)!.lastMessage!.body).toContain('Voice message');
  });

  it('meetings: propose, accept, calendar file; translation into the reader’s language', async () => {
    const c = await chat(amara, tunde);
    const startsAt = new Date(Date.now() + 2 * 86400_000).toISOString();
    const meeting = await send(amara, c.id, { meeting: { title: 'Partnership call', startsAt, durationMinutes: 30 } });
    expect(meeting.meeting).toMatchObject({ title: 'Partnership call', status: 'proposed', link: expect.stringContaining('https://meet.jit.si/') });
    await amara.post(`/messages/${meeting.id}/meeting`, { response: 'accept' }).expect(403);
    expect((await tunde.post(`/messages/${meeting.id}/meeting`, { response: 'accept' }).expect(200)).body.meeting).toMatchObject({ status: 'accepted', respondedBy: tunde.id });
    const ics = await tunde.get(`/messages/${meeting.id}/meeting.ics`).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('SUMMARY:Partnership call');
    await leila.get(`/messages/${meeting.id}/meeting.ics`).expect(404);

    const text = await send(tunde, c.id, { body: 'Bonjour, à bientôt' });
    await t.db.update(s.users).set({ locale: 'en' }).where(eq(s.users.id, amara.id));
    expect((await amara.post(`/messages/${text.id}/translate`).expect(200)).body).toEqual({ text: '[en] Bonjour, à bientôt', lang: 'en' });
    expect((await amara.get('/messages/config').expect(200)).body).toMatchObject({ translation: true });
  });

  it('pin, archive, mute, mark unread, and search', async () => {
    const c = await chat(amara, kwame);
    await send(kwame, c.id, { body: 'The cocoa export numbers are in' });
    const before = (await amara.get('/messages/unread').expect(200)).body.unread as number;
    expect((await amara.patch(`/messages/conversations/${c.id}`, { pinned: true, mute: '8h' }).expect(200)).body).toMatchObject({ pinned: true, muted: true });
    // Muted conversations don't count towards the badge.
    expect((await amara.get('/messages/unread').expect(200)).body.unread).toBe(before - 1);
    await amara.patch(`/messages/conversations/${c.id}`, { mute: 'off' }).expect(200);
    await amara.post(`/messages/conversations/${c.id}/read`).expect(204);
    expect((await amara.get('/messages/unread').expect(200)).body.unread).toBe(before - 1);
    expect((await amara.patch(`/messages/conversations/${c.id}`, { unread: true }).expect(200)).body).toMatchObject({ markedUnread: true });
    expect((await amara.get('/messages/unread').expect(200)).body.unread).toBe(before);
    // Pinned first.
    expect(((await amara.get('/messages/conversations').expect(200)).body as ConversationView[])[0]!.id).toBe(c.id);
    // Archive moves it out of the inbox; a new message brings it back.
    await amara.patch(`/messages/conversations/${c.id}`, { archived: true }).expect(200);
    expect((await amara.get('/messages/conversations?box=archived').expect(200)).body.map((x: ConversationView) => x.id)).toContain(c.id);
    expect((await amara.get('/messages/conversations').expect(200)).body.map((x: ConversationView) => x.id)).not.toContain(c.id);
    await send(kwame, c.id, { body: 'Did you see them?' });
    expect((await amara.get('/messages/conversations').expect(200)).body.map((x: ConversationView) => x.id)).toContain(c.id);

    const hits = (await amara.get('/messages/search?q=cocoa').expect(200)).body as { conversation: { id: string }; message: MessageView }[];
    expect(hits).toEqual([expect.objectContaining({ conversation: expect.objectContaining({ id: c.id }), message: expect.objectContaining({ body: 'The cocoa export numbers are in' }) })]);
    expect((await leila.get('/messages/search?q=cocoa').expect(200)).body).toEqual([]);
    const around = await page(amara, c.id, `?around=${hits[0]!.message.id}&limit=4`);
    expect(around.items.map((m) => m.id)).toContain(hits[0]!.message.id);
  });

  it('an unread message is emailed later, unless muted or read', async () => {
    const c = await chat(tunde, amara);
    await t.db.delete(s.emailOutbox).where(eq(s.emailOutbox.toAddress, amara.email));
    await send(tunde, c.id, { body: 'Are you free on Friday?' });
    const mails = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, amara.email));
    expect(mails.filter((m) => m.template === 'notification.message_unread')).toHaveLength(1);
    expect(mails.find((m) => m.template === 'notification.message_unread')!.textBody).toContain('Are you free on Friday?');
    await amara.patch(`/messages/conversations/${c.id}`, { mute: 'always' }).expect(200);
    await t.db.delete(s.emailOutbox).where(eq(s.emailOutbox.toAddress, amara.email));
    await send(tunde, c.id, { body: 'Hello again' });
    expect(await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, amara.email))).toHaveLength(0);
    await amara.patch(`/messages/conversations/${c.id}`, { mute: 'off' }).expect(200);
  });

  it('groups: connections only, admins manage, system lines, leaving keeps an admin', async () => {
    const group = (await amara.post('/messages/groups', { title: 'Accra trip', memberIds: [kwame.id, tunde.id, leila.id] }).expect(201)).body as ConversationView;
    // Leila isn't Amara's connection, so she isn't added.
    expect(group).toMatchObject({ kind: 'group', title: 'Accra trip', memberCount: 3, canManage: true, admins: [amara.id] });
    expect(group.members.map((m) => m.id).sort()).toEqual([kwame.id, tunde.id].sort());
    await send(kwame, group.id, { body: 'Flights booked?' });
    expect(((await tunde.get('/messages/conversations').expect(200)).body as ConversationView[]).find((c) => c.id === group.id)).toMatchObject({ unread: 1 });
    // Non-admins can't rename or add; admins can.
    await kwame.patch(`/messages/groups/${group.id}`, { title: 'Mine' }).expect(403);
    await amara.patch(`/messages/groups/${group.id}`, { title: 'Accra trip 2026' }).expect(200);
    const lines = (await page(kwame, group.id)).items.filter((m) => m.kind === 'system').map((m) => m.body);
    expect(lines).toEqual(['Amara Okafor created the group “Accra trip”', 'Amara Okafor renamed the group “Accra trip 2026”']);
    await kwame.post(`/messages/groups/${group.id}/members`, { memberIds: [leila.id] }).expect(403);
    // The only admin leaves: the longest-standing member becomes admin.
    await amara.delete(`/messages/groups/${group.id}/members/${amara.id}`).expect(204);
    const after = (await kwame.get(`/messages/conversations/${group.id}`).expect(200)).body as ConversationView;
    expect(after.admins).toHaveLength(1);
    expect(after.memberCount).toBe(2);
    await amara.post(`/messages/conversations/${group.id}/messages`, { body: 'still here?' }).expect(403);
    // Admins remove people.
    const admin = after.admins[0] === kwame.id ? kwame : tunde;
    const other = admin === kwame ? tunde : kwame;
    await admin.delete(`/messages/groups/${group.id}/members/${other.id}`).expect(204);
    await other.post(`/messages/conversations/${group.id}/messages`, { body: 'hi' }).expect(403);
  });

  it('chapter groups and event groups, and a chapter’s announcements', async () => {
    const nigeria = await chapterId(t, 'nigeria');
    const lead = await createMember(t, { name: 'Chioma Lead' });
    await grantChapterLead(t, lead.id, nigeria);
    for (const m of [kwame, leila]) await m.post('/follows', { targetType: 'chapter', targetId: 'nigeria' }).expect((r) => expect(r.status).toBeLessThan(300));
    // Chapter group: the team adds chapter members who aren't their connections.
    await kwame.post('/messages/groups', { title: 'Nigeria volunteers', chapterSlug: 'nigeria', memberIds: [leila.id] }).expect(403);
    const team = (await lead.post('/messages/groups', { title: 'Nigeria volunteers', chapterSlug: 'nigeria', memberIds: [kwame.id, leila.id, tunde.id] }).expect(201)).body as ConversationView;
    expect(team.members.map((m) => m.id).sort()).toEqual([kwame.id, leila.id].sort());
    expect(team.chapter).toMatchObject({ slug: 'nigeria' });

    // Event group: the host adds every registered attendee.
    const event = await insertEvent(t, lead.id, { startsAt: new Date(Date.now() + 5 * 86400_000), slug: 'lagos-summit-chat' });
    for (const m of [kwame, tunde]) await t.db.insert(s.eventRegistrations).values({ eventId: event.id, userId: m.id, status: 'registered' });
    const attendees = (await lead.post('/messages/groups', { title: 'Summit attendees', eventSlug: 'lagos-summit-chat' }).expect(201)).body as ConversationView;
    expect(attendees.members.map((m) => m.id).sort()).toEqual([kwame.id, tunde.id].sort());
    await kwame.post('/messages/groups', { title: 'x', eventSlug: 'lagos-summit-chat' }).expect(403);

    // Announcements: the team posts, chapter members receive and can't reply in it, and can turn it off.
    const channel = (await lead.get('/messages/announcements/nigeria').expect(200)).body as ConversationView;
    expect(channel).toMatchObject({ kind: 'broadcast', title: expect.stringContaining('announcements'), canManage: true, members: [] });
    await send(lead, channel.id, { body: 'Monthly meetup this Saturday at 4pm' });
    const inbox = (await leila.get('/messages/conversations').expect(200)).body as ConversationView[];
    expect(inbox.find((c) => c.id === channel.id)).toMatchObject({ kind: 'broadcast', unread: 1, canSend: false, canManage: false });
    await leila.post(`/messages/conversations/${channel.id}/messages`, { body: 'me too' }).expect(403);
    await leila.put('/messages/announcements/nigeria/subscription', { on: false }).expect(200);
    await send(lead, channel.id, { body: 'Reminder: Saturday' });
    expect(((await leila.get('/messages/conversations').expect(200)).body as ConversationView[]).find((c) => c.id === channel.id)).toBeUndefined();
    // Not a member of the chapter: no access.
    await amara.get('/messages/announcements/nigeria').expect(403);
  });

  it('pushes live events to each member’s open stream', async () => {
    const realtime = t.app.get(RealtimeService);
    const got: MessageStreamEvent[] = [];
    const stop = realtime.listen(kwame.id, (e) => got.push(e));
    const c = await chat(amara, kwame);
    const m = await send(amara, c.id, { body: 'Live?' });
    await amara.post(`/messages/conversations/${c.id}/typing`).expect(204);
    await kwame.post(`/messages/conversations/${c.id}/read`).expect(204);
    for (let i = 0; i < 40 && !got.some((e) => e.type === 'typing'); i++) await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(got).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'message', conversationId: c.id, message: expect.objectContaining({ id: m.id }) }), expect.objectContaining({ type: 'typing', memberId: amara.id, name: 'Amara Okafor' })]));
  });

  async function handle(userId: string) {
    const [row] = await t.db.select({ handle: s.memberProfiles.handle }).from(s.memberProfiles).where(eq(s.memberProfiles.userId, userId));
    return row!.handle;
  }
});
