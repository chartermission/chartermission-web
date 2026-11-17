import { and, desc, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { AnnouncementAudienceCount, AnnouncementView, ConversationView, MessagesPage, NotificationPreferences } from '@chartermission/contracts';
import { client, count, createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { MailService, type OutgoingEmail } from '../../src/infra/mail.service.js';
import { QueueService } from '../../src/infra/queue.service.js';
import { AnnouncementsService, BATCH_JOB } from '../../src/announcements/announcements.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Messages from Charter Mission (announcements)', () => {
  let t: TestApp;
  let official: Member;
  let admin: Member;
  let moderator: Member;
  let ngozi: Member; // NG, verified tick, French, ambassador, passed the exam, in the chapter and sector
  let kofi: Member; // GH, turned announcement emails off
  let wanjiru: Member; // KE, joined in January 2025
  let tariq: Member; // unconfirmed email
  let examId: string;
  let chapterId: string;
  let sectorId: string;
  let sent: OutgoingEmail[] = [];

  const draft = {
    subject: 'Charter Mission Summit 2027',
    body: 'Dear member,\n\nRegistration for the summit is open: https://example.com/summit.\nSee you there!\n\nThe Charter Mission team',
    linkUrl: 'https://example.com/summit',
    linkLabel: 'Register now',
    channels: { email: true, message: true, notification: true },
    audience: {},
    important: false,
  };
  const create = async (overrides: Record<string, unknown> = {}) => (await admin.post('/admin/announcements', { ...draft, ...overrides }).expect(201)).body as AnnouncementView;
  const audience = async (a: Record<string, unknown>, important = false) =>
    (await admin.post('/admin/announcements/audience', { audience: a, important }).expect(200)).body as AnnouncementAudienceCount;
  const recipient = async (announcementId: string, userId: string) =>
    (await t.db.select().from(s.announcementRecipients).where(and(eq(s.announcementRecipients.announcementId, announcementId), eq(s.announcementRecipients.userId, userId))))[0];
  const emailsTo = (to: string, template = 'announcement') => sent.filter((m) => m.to === to && m.template === template);

  beforeAll(async () => {
    t = await createTestApp();
    const mail = t.app.get(MailService);
    const original = mail.send.bind(mail);
    vi.spyOn(mail, 'send').mockImplementation(async (m: OutgoingEmail) => {
      sent.push(m);
      return original(m);
    });

    official = await createMember(t, { name: 'Charter Mission' });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, official.id));
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true, countryCode: 'ZA' });
    moderator = await createMember(t, { name: 'Moe Moderator', roles: ['moderator'], admin: true, countryCode: 'ZA' });
    ngozi = await createMember(t, { name: 'Ngozi Eze', countryCode: 'NG', roles: ['ambassador'] });
    kofi = await createMember(t, { name: 'Kofi Boateng', countryCode: 'GH' });
    wanjiru = await createMember(t, { name: 'Wanjiru Kamau', countryCode: 'KE' });
    tariq = await createMember(t, { name: 'Tariq Haddad', countryCode: 'MA', verified: false });
    const suspended = await createMember(t, { name: 'Sam Suspended', countryCode: 'NG', status: 'suspended' });
    void suspended;

    await t.db.update(s.users).set({ verifiedAt: new Date(), locale: 'fr' }).where(eq(s.users.id, ngozi.id));
    await t.db.update(s.users).set({ createdAt: new Date('2025-01-15T10:00:00Z') }).where(eq(s.users.id, wanjiru.id));
    await kofi.put('/me/notification-preferences', { preferences: [{ category: 'announcements', channel: 'email', enabled: false }] }).expect(200);

    const [exam] = await t.db.insert(s.exams).values({ slug: 'announcement-exam', title: 'Foundations' }).returning();
    examId = exam!.id;
    await t.db.insert(s.examAttempts).values({ examId, userId: ngozi.id, questionOrder: [] as never, passed: true, status: 'submitted' });
    await t.db.insert(s.examAttempts).values({ examId, userId: kofi.id, questionOrder: [] as never, passed: false, status: 'submitted' });
    const [chapter] = await t.db.select().from(s.chapters).limit(1);
    chapterId = chapter!.id;
    await t.db.insert(s.follows).values({ followerId: ngozi.id, targetType: 'chapter', targetId: chapterId });
    const [sector] = await t.db.select().from(s.sectors).limit(1);
    sectorId = sector!.id;
    await t.db.insert(s.profileSectors).values({ userId: ngozi.id, itemId: sectorId });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    sent = [];
    await resetLimits();
  });

  it('permissions: members.message only; members never', async () => {
    await moderator.get('/admin/announcements').expect(403);
    await moderator.post('/admin/announcements', draft).expect(403);
    await moderator.post('/admin/announcements/audience', { audience: {} }).expect(403);
    await ngozi.get('/admin/announcements').expect(403);
    await ngozi.post('/admin/announcements', draft).expect(403);
  });

  it('notification preferences include announcements (email on by default)', async () => {
    const prefs = (await wanjiru.get('/me/notification-preferences').expect(200)).body as NotificationPreferences;
    expect(prefs.preferences.filter((p) => p.category === 'announcements')).toEqual([
      { category: 'announcements', channel: 'in_app', enabled: true },
      { category: 'announcements', channel: 'email', enabled: true },
      { category: 'announcements', channel: 'push', enabled: true },
    ]);
  });

  it('audience filters and counts', async () => {
    // Everyone active and not official: admin, moderator, Ngozi, Kofi, Wanjiru, Tariq (not the suspended member or the official account).
    const all = await audience({});
    expect(all.members).toBe(6);
    expect(all.optedOut).toBe(1);
    expect(all.emailable).toBe(4); // Kofi opted out, Tariq's email unconfirmed
    expect((await audience({}, true)).emailable).toBe(5);
    expect(all.sample.length).toBe(5);

    const ids = async (a: Record<string, unknown>) => (await audience(a)).sample.map((m) => m.id).sort();
    expect(await ids({ countries: ['NG', 'GH'] })).toEqual([ngozi.id, kofi.id].sort());
    expect(await ids({ chapterIds: [chapterId] })).toEqual([ngozi.id]);
    expect(await ids({ sectorIds: [sectorId] })).toEqual([ngozi.id]);
    expect(await ids({ verified: 'verified' })).toContain(ngozi.id);
    expect(await ids({ verified: 'verified', countries: ['NG', 'GH', 'KE'] })).toEqual([ngozi.id]);
    expect((await audience({ verified: 'unverified' })).members).toBe(all.members - 1); // only Ngozi has the tick
    expect(await ids({ joinedFrom: '2025-01-01', joinedTo: '2025-01-31' })).toEqual([wanjiru.id]);
    expect(await ids({ joinedFrom: '2025-01-16', joinedTo: '2025-02-01' })).toEqual([]);
    expect(await ids({ passedExamIds: [examId] })).toEqual([ngozi.id]);
    expect(await ids({ locales: ['fr'] })).toEqual([ngozi.id]);
    expect((await audience({ locales: ['en'] })).members).toBe(all.members - 1);
    expect(await ids({ ambassadorsOnly: true })).toEqual([ngozi.id]);
    await admin.post('/admin/announcements/audience', { audience: { joinedFrom: '2025-02-01', joinedTo: '2025-01-01' } }).expect(422);
  });

  it('drafts: create, validate, edit, list, delete', async () => {
    await admin.post('/admin/announcements', { ...draft, channels: { email: false, message: false, notification: false } }).expect(422);
    await admin.post('/admin/announcements', { ...draft, linkUrl: 'ftp://example.com' }).expect(422);
    const a = await create();
    expect(a).toMatchObject({ status: 'draft', subject: draft.subject, linkLabel: 'Register now', createdBy: { id: admin.id, name: 'Ada Admin' }, sentBy: null });
    const edited = (await admin.patch(`/admin/announcements/${a.id}`, { ...draft, subject: 'Summit 2027: registration open', linkUrl: null }).expect(200)).body as AnnouncementView;
    expect(edited).toMatchObject({ subject: 'Summit 2027: registration open', linkUrl: null, linkLabel: null });
    const drafts = (await admin.get('/admin/announcements?status=draft').expect(200)).body;
    expect(drafts.items.map((i: AnnouncementView) => i.id)).toContain(a.id);
    expect((await admin.get('/admin/announcements?status=sent').expect(200)).body.items.map((i: AnnouncementView) => i.id)).not.toContain(a.id);
    await admin.delete(`/admin/announcements/${a.id}`).expect(204);
    await admin.get(`/admin/announcements/${a.id}`).expect(404);
    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, a.id))).map((r) => r.action).sort();
    expect(actions).toEqual(['announcement.created', 'announcement.deleted', 'announcement.updated']);
  });

  it('sending a message channel needs a sender; an empty audience is refused', async () => {
    const other = await createMember(t, { name: 'Charter Mission Ghana' });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, other.id));
    const a = await create();
    const res = await admin.post(`/admin/announcements/${a.id}/send`).expect(409);
    expect(res.body.error.message).toBe('Choose the Charter Mission account messages are sent from in Messages settings');
    await t.db.update(s.users).set({ isOfficial: false, status: 'deactivated' }).where(eq(s.users.id, other.id));
    const none = await create({ audience: { countries: ['ZW'] } });
    expect((await admin.post(`/admin/announcements/${none.id}/send`).expect(409)).body.error.message).toBe('No members match this audience');
    expect(((await admin.get(`/admin/announcements/${none.id}`).expect(200)).body as AnnouncementView).status).toBe('draft');
  });

  it('sends through every channel: branded email with one-click unsubscribe, a message in the official conversation, a notification', async () => {
    const a = await create({ audience: { countries: ['NG', 'GH', 'MA'] } });
    const result = (await admin.post(`/admin/announcements/${a.id}/send`).expect(200)).body.announcement as AnnouncementView;
    expect(result).toMatchObject({ status: 'sent', sentBy: { id: admin.id }, counts: { recipients: 3, emailed: 1, messaged: 3, notified: 3, optedOut: 1, failed: 0, remaining: 0 } });
    expect(result.finishedAt).toBeTruthy();

    // Email: Ngozi only (Kofi opted out, Tariq's address isn't confirmed).
    expect(emailsTo(kofi.email)).toHaveLength(0);
    expect(emailsTo(tariq.email)).toHaveLength(0);
    expect((await recipient(a.id, kofi.id))).toMatchObject({ emailSkipped: 'opted_out' });
    expect((await recipient(a.id, tariq.id))).toMatchObject({ emailSkipped: 'unconfirmed' });
    const [email] = emailsTo(ngozi.email);
    expect(email!.subject).toBe(draft.subject);
    expect(email!.unsubscribeUrl).toMatch(/\/api\/v1\/notifications\/unsubscribe\?t=/);
    expect(email!.html).toContain('<a href="https://example.com/summit" style="color:#046D35">https://example.com/summit</a>.');
    expect(email!.html).toContain('Register now');
    expect(email!.html).toMatch(/\/unsubscribe\?t=[^"]+"[^>]*>[^<]+</);
    expect(email!.text).toContain('Dear member,');
    // The chrome follows the member's language; the text itself is sent as written.
    expect(email!.html).toContain('lang="fr"');
    expect(email!.html).toContain('Registration for the summit is open');
    const outbox = await lastEmail(t.db, ngozi.email);
    expect(outbox!.template).toBe('announcement');

    // Message in the official conversation, from the official account; the member can reply.
    const list = (await ngozi.get('/messages/conversations').expect(200)).body as ConversationView[];
    const convo = list.find((c) => c.kind === 'official')!;
    expect(convo).toMatchObject({ member: { id: official.id }, unread: 1, canSend: true });
    const page = (await ngozi.get(`/messages/conversations/${convo.id}/messages`).expect(200)).body as MessagesPage;
    expect(page.items[0]!.body).toBe(`${draft.subject}\n\n${draft.body}\n\nRegister now: https://example.com/summit`);
    const [row] = await t.db.select().from(s.messages).where(eq(s.messages.id, page.items[0]!.id));
    expect(row).toMatchObject({ announcementId: a.id, sentByStaffId: null, senderId: official.id });
    await ngozi.post(`/messages/conversations/${convo.id}/messages`, { body: 'Will there be a livestream?' }).expect(201);

    // One notification (the announcement), pointing at the conversation; no separate new-message notification or email.
    const notes = await t.db.select().from(s.notifications).where(eq(s.notifications.userId, ngozi.id));
    expect(notes.map((n) => n.type)).toEqual(['announcement']);
    expect(notes[0]).toMatchObject({ category: 'announcements', data: expect.objectContaining({ href: `/messages/${convo.id}`, icon: 'alert', segments: [{ text: draft.subject, strong: true }] }) });
    expect(emailsTo(ngozi.email, 'notification.message_unread')).toHaveLength(0);
    const list2 = (await ngozi.get('/notifications').expect(200)).body;
    expect(list2.items[0]).toMatchObject({ type: 'announcement', segments: [{ text: draft.subject, strong: true }] });

    // The reply waits in the admin inbox, marked as part of the bulk message.
    const inbox = (await admin.get('/admin/inbox?filter=unread').expect(200)).body;
    expect(inbox.items.map((i: { conversationId: string }) => i.conversationId)).toContain(convo.id);
    const thread = (await admin.get(`/admin/inbox/${convo.id}`).expect(200)).body;
    expect(thread.messages[0]).toMatchObject({ from: 'team', staff: null, announcement: { id: a.id, subject: draft.subject } });

    // Sent ones can't be edited, deleted or sent again.
    await admin.patch(`/admin/announcements/${a.id}`, draft).expect(409);
    await admin.delete(`/admin/announcements/${a.id}`).expect(409);
    await admin.post(`/admin/announcements/${a.id}/send`).expect(409);
    expect((await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.targetId, a.id), eq(s.auditLog.action, 'announcement.sent')))).length).toBe(1);
  });

  it('important notices reach members who opted out, without an unsubscribe header', async () => {
    const a = await create({ audience: { countries: ['GH'] }, channels: { email: true, message: false, notification: true }, important: true });
    const result = (await admin.post(`/admin/announcements/${a.id}/send`).expect(200)).body.announcement as AnnouncementView;
    expect(result.counts).toMatchObject({ recipients: 1, emailed: 1, optedOut: 0, notified: 1, messaged: 0 });
    const [email] = emailsTo(kofi.email);
    expect(email!.unsubscribeUrl).toBeUndefined();
    expect(email!.text).toContain('important service notice');
    expect(email!.text).not.toContain('/unsubscribe?t=');
    expect(email!.text).toContain('/settings/notifications');
    // Notification channel without a message: the notification opens the link.
    const [note] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, kofi.id), eq(s.notifications.objectId, a.id)));
    expect(note!.data).toMatchObject({ href: 'https://example.com/summit' });
  });

  it('message only: the usual new-message notification and email follow', async () => {
    const a = await create({ audience: { countries: ['KE'] }, channels: { email: false, message: true, notification: false } });
    await admin.post(`/admin/announcements/${a.id}/send`).expect(200);
    expect(await count(t.db, s.notifications, and(eq(s.notifications.userId, wanjiru.id), eq(s.notifications.type, 'message_received')))).toBe(1);
    expect(emailsTo(wanjiru.email, 'notification.message_unread')).toHaveLength(1);
    expect(emailsTo(wanjiru.email)).toHaveLength(0);
  });

  it('unsubscribe: the signed link turns announcement emails off; tampered or unknown links are refused', async () => {
    const a = await create({ audience: { countries: ['NG'] }, channels: { email: true, message: false, notification: false } });
    await admin.post(`/admin/announcements/${a.id}/send`).expect(200);
    const [email] = emailsTo(ngozi.email);
    const token = decodeURIComponent(/\/unsubscribe\?t=([^\s"&]+)/.exec(email!.text)![1]!);
    const visitor = client(t);

    const tampered = `${token.slice(0, -2)}xx`;
    const bad = await visitor.post('/notifications/unsubscribe', { token: tampered }).expect(400);
    expect(bad.body.error.code).toBe('INVALID_TOKEN');
    const forged = `${Buffer.from(JSON.stringify({ u: kofi.id, c: 'announcements' })).toString('base64url')}.${token.split('.')[1]}`;
    expect((await visitor.post('/notifications/unsubscribe', { token: forged }).expect(400)).body.error.code).toBe('INVALID_TOKEN');
    await visitor.post('/notifications/unsubscribe', { token: 'short' }).expect(422);

    expect((await visitor.post('/notifications/unsubscribe', { token }).expect(200)).body).toEqual({ category: 'announcements', done: true });
    const prefs = (await ngozi.get('/me/notification-preferences').expect(200)).body as NotificationPreferences;
    expect(prefs.preferences).toContainEqual({ category: 'announcements', channel: 'email', enabled: false });

    // Mail apps' one-click POST: the token in the URL, no CSRF header.
    await ngozi.put('/me/notification-preferences', { preferences: [{ category: 'announcements', channel: 'email', enabled: true }] }).expect(200);
    await t.http().post(`/api/v1/notifications/unsubscribe?t=${encodeURIComponent(token)}`).type('form').send('List-Unsubscribe=One-Click').expect(200);
    const again = (await ngozi.get('/me/notification-preferences').expect(200)).body as NotificationPreferences;
    expect(again.preferences).toContainEqual({ category: 'announcements', channel: 'email', enabled: false });
    await ngozi.put('/me/notification-preferences', { preferences: [{ category: 'announcements', channel: 'email', enabled: true }] }).expect(200);
  });

  it('test send: only to the admin, marked [Test], no conversation message', async () => {
    const a = await create({ audience: { countries: ['NG'] } });
    const before = await count(t.db, s.messages);
    const res = (await admin.post(`/admin/announcements/${a.id}/test`).expect(200)).body.announcement as AnnouncementView;
    expect(res.status).toBe('draft');
    expect(sent.filter((m) => m.template === 'announcement').map((m) => [m.to, m.subject])).toEqual([[admin.email, `[Test] ${draft.subject}`]]);
    const [note] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, admin.id), eq(s.notifications.type, 'announcement'))).orderBy(desc(s.notifications.createdAt));
    expect((note!.data as { segments: { text: string }[] }).segments[0]!.text).toBe(`[Test] ${draft.subject}`);
    expect(await count(t.db, s.messages)).toBe(before);
    await moderator.post(`/admin/announcements/${a.id}/test`).expect(403);
    const messageOnly = await create({ channels: { email: false, message: true, notification: false } });
    await admin.post(`/admin/announcements/${messageOnly.id}/test`).expect(409);
  });

  it('cancel mid-send: batches stop, members already reached keep it', async () => {
    const service = t.app.get(AnnouncementsService);
    const queue = t.app.get(QueueService);
    const add = queue.add.bind(queue);
    const held: string[] = [];
    const spy = vi.spyOn(queue, 'add').mockImplementation(async (name, jobName, data, opts) => {
      if (jobName === BATCH_JOB) {
        held.push((data as { id: string }).id);
        return;
      }
      return add(name, jobName, data, opts);
    });
    service.batchSize = 2;
    try {
      const a = await create({ channels: { email: false, message: true, notification: false } });
      const queued = (await admin.post(`/admin/announcements/${a.id}/send`).expect(200)).body.announcement as AnnouncementView;
      expect(queued).toMatchObject({ status: 'sending', counts: { recipients: 6, remaining: 6, messaged: 0 } });
      expect(held).toEqual([a.id]);
      await service.runBatch(a.id);
      const mid = (await admin.get(`/admin/announcements/${a.id}`).expect(200)).body as AnnouncementView;
      expect(mid).toMatchObject({ status: 'sending', counts: { messaged: 2, remaining: 4 } });
      expect(held).toHaveLength(2);

      const cancelled = (await admin.post(`/admin/announcements/${a.id}/cancel`).expect(200)).body.announcement as AnnouncementView;
      expect(cancelled).toMatchObject({ status: 'cancelled', counts: { messaged: 2, remaining: 4 } });
      await service.runBatch(a.id);
      expect(((await admin.get(`/admin/announcements/${a.id}`).expect(200)).body as AnnouncementView).counts).toMatchObject({ messaged: 2, remaining: 4 });
      expect(await count(t.db, s.messages, eq(s.messages.announcementId, a.id))).toBe(2);
      await admin.post(`/admin/announcements/${a.id}/cancel`).expect(409);
      expect((await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.targetId, a.id), eq(s.auditLog.action, 'announcement.cancelled')))).length).toBe(1);

      // A send left half-way (a restart) is picked up by the sweep.
      const b = await create({ channels: { email: false, message: false, notification: true } });
      await admin.post(`/admin/announcements/${b.id}/send`).expect(200);
      held.length = 0;
      await service.sweep();
      expect(held).toEqual([b.id]);
      service.batchSize = 100;
      await service.runBatch(b.id);
      expect(((await admin.get(`/admin/announcements/${b.id}`).expect(200)).body as AnnouncementView)).toMatchObject({ status: 'sent', counts: { notified: 6, remaining: 0 } });
    } finally {
      spy.mockRestore();
      service.batchSize = 200;
    }
  });
});
