import { and, asc, eq } from 'drizzle-orm';
import { count, createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { EventRemindersService } from '../../src/events/event-reminders.service.js';
import { icsEscape, icsFold } from '../../src/events/ics.js';
import { DAY, eventInput, HOUR, insertEvent, insertRegistration, JOIN_URL, publishedEvent, type Member } from './event-helpers.js';

describe('Events: registration, waitlist, join links, reminders and .ics', () => {
  let t: TestApp;
  let staff: Member;
  beforeAll(async () => {
    t = await createTestApp();
    staff = await createMember(t, { name: 'Staff Publisher', roles: ['platform_admin'] });
  });
  afterAll(async () => {
    await t.close();
  });

  const members = async (n: number) => {
    const out: Member[] = [];
    for (let i = 0; i < n; i++) out.push(await createMember(t));
    return out;
  };

  it('registers, confirms by email with the .ics link, and rejects double registration', async () => {
    const ev = await publishedEvent(staff, { title: 'Confirm Me' });
    const m = await createMember(t);
    const res = await m.post(`/events/${ev.id}/registrations`, {}).expect(200);
    expect(res.body).toMatchObject({ status: 'registered', waitlistPosition: null });
    expect(res.body.event).toMatchObject({ registeredCount: 1, spotsLeft: 49, viewer: { status: 'registered' } });
    const mail = await lastEmail(t.db, m.email);
    expect(mail!.template).toBe('notification.event_registration_confirmed');
    expect(mail!.textBody).toContain(`/events/${ev.id}.ics`);
    expect(mail!.textBody).toContain(`/events/${ev.slug}`);
    expect(mail!.textBody).not.toContain(JOIN_URL);
    expect((await m.get('/notifications').expect(200)).body.items[0].type).toBe('event_registration_confirmed');
    expect((await m.post(`/events/${ev.id}/registrations`, {}).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await m.get('/me/events').expect(200)).body.items.map((e: { id: string }) => e.id)).toContain(ev.id);
  });

  it('enforces capacity under concurrency: capacity 100, 150 simultaneous sign-ups → 100 registered, 50 waitlisted in arrival order', async () => {
    const ev = await publishedEvent(staff, { title: 'Capacity Race', capacity: 100 });
    const crowd = await members(150);
    // One listening server for all 150 requests (supertest would otherwise bind one per request).
    const server = t.app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
    const results = await Promise.all(crowd.map((m) => m.post(`/events/${ev.id}/registrations`, {})));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const statuses = results.map((r) => r.body.status as string);
    expect(statuses.filter((x) => x === 'registered')).toHaveLength(100);
    expect(statuses.filter((x) => x === 'waitlisted')).toHaveLength(50);
    const [row] = await t.db.select().from(s.events).where(eq(s.events.id, ev.id));
    expect(row).toMatchObject({ registeredCount: 100, waitlistCount: 50 });
    // Waitlist positions are 1..50 and follow the order in which the lock was taken.
    const waitlist = await t.db
      .select()
      .from(s.eventRegistrations)
      .where(and(eq(s.eventRegistrations.eventId, ev.id), eq(s.eventRegistrations.status, 'waitlisted')))
      .orderBy(asc(s.eventRegistrations.position));
    expect(waitlist.map((r) => r.position)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const times = waitlist.map((r) => r.registeredAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const seatsLatest = Math.max(
      ...(await t.db.select().from(s.eventRegistrations).where(and(eq(s.eventRegistrations.eventId, ev.id), eq(s.eventRegistrations.status, 'registered')))).map(
        (r) => r.registeredAt.getTime(),
      ),
    );
    expect(seatsLatest).toBeLessThanOrEqual(times[0]!);
    expect(results.filter((r) => r.body.status === 'waitlisted').map((r) => r.body.waitlistPosition).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  }, 120_000);

  it('full without a waitlist is a CONFLICT', async () => {
    const ev = await publishedEvent(staff, { capacity: 1, waitlistEnabled: false });
    const [a, b] = await members(2);
    await a!.post(`/events/${ev.id}/registrations`, {}).expect(200);
    const res = await b!.post(`/events/${ev.id}/registrations`, {}).expect(409);
    expect(res.body.error.message).toBe('This event is full');
    expect((await b!.get(`/events/${ev.id}`).expect(200)).body.registrationOpen).toBe(false);
  });

  it('cancelling a seat promotes the first waitlisted member (notification + email); re-registering reuses the row', async () => {
    const ev = await publishedEvent(staff, { title: 'Promotion Event', capacity: 1 });
    const [seat, first, second] = await members(3);
    await seat!.post(`/events/${ev.id}/registrations`, {}).expect(200);
    const w1 = await first!.post(`/events/${ev.id}/registrations`, {}).expect(200);
    expect(w1.body).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect((await lastEmail(t.db, first!.email))!.template).toBe('notification.event_waitlisted');
    const w2 = await second!.post(`/events/${ev.id}/registrations`, {}).expect(200);
    expect(w2.body.waitlistPosition).toBe(2);

    const cancelled = await seat!.delete(`/events/${ev.id}/registrations/me`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const promotedView = (await first!.get(`/events/${ev.id}`).expect(200)).body;
    expect(promotedView.viewer).toMatchObject({ status: 'registered', waitlistPosition: null });
    expect((await first!.get('/notifications').expect(200)).body.items[0].type).toBe('event_waitlist_promoted');
    expect((await lastEmail(t.db, first!.email))!.template).toBe('notification.event_waitlist_promoted');
    expect((await second!.get(`/events/${ev.id}`).expect(200)).body.viewer.waitlistPosition).toBe(1);
    const [row] = await t.db.select().from(s.events).where(eq(s.events.id, ev.id));
    expect(row).toMatchObject({ registeredCount: 1, waitlistCount: 1 });

    // Cancelled member re-registers: same row, back of the waitlist.
    const again = await seat!.post(`/events/${ev.id}/registrations`, {}).expect(200);
    expect(again.body).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 });
    expect(await count(t.db, s.eventRegistrations, and(eq(s.eventRegistrations.eventId, ev.id), eq(s.eventRegistrations.userId, seat!.id)))).toBe(1);
    // Cancelling a waitlist place promotes nobody.
    await second!.delete(`/events/${ev.id}/registrations/me`).expect(200);
    expect((await seat!.get(`/events/${ev.id}`).expect(200)).body.viewer.waitlistPosition).toBe(1);
    await second!.delete(`/events/${ev.id}/registrations/me`).expect(404);

    // Raising capacity on a published event promotes from the waitlist.
    await staff.patch(`/events/${ev.id}`, { capacity: 5 }).expect(200);
    expect((await seat!.get(`/events/${ev.id}`).expect(200)).body.viewer.status).toBe('registered');

    // Host list: everyone active, then cancelled on request.
    const list = await staff.get(`/events/${ev.id}/registrations`).expect(200);
    expect(list.body.items.map((r: { status: string }) => r.status)).toEqual(['registered', 'registered']);
    const all = await staff.get(`/events/${ev.id}/registrations?status=cancelled`).expect(200);
    expect(all.body.items.map((r: { member: { id: string } }) => r.member.id)).toEqual([second!.id]);
    await first!.get(`/events/${ev.id}/registrations`).expect(403);
  });

  it('members may cancel only before the start; attendance is marked only after the start', async () => {
    const m = await createMember(t);
    const started = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR) });
    await insertRegistration(t, started.id, m.id);
    expect((await m.delete(`/events/${started.id}/registrations/me`).expect(412)).body.error.code).toBe('PRECONDITION_FAILED');
    const late = await createMember(t);
    await late.post(`/events/${started.id}/registrations`, {}).expect(412);

    const marked = await staff.put(`/events/${started.id}/registrations/${m.id}/attendance`, { attended: true }).expect(200);
    expect(marked.body).toMatchObject({ status: 'attended', attendedAt: expect.any(String) });
    const undone = await staff.put(`/events/${started.id}/registrations/${m.id}/attendance`, { attended: false }).expect(200);
    expect(undone.body.status).toBe('registered');
    await m.put(`/events/${started.id}/registrations/${m.id}/attendance`, { attended: true }).expect(403);

    const future = await publishedEvent(staff);
    await m.post(`/events/${future.id}/registrations`, {}).expect(200);
    await staff.put(`/events/${future.id}/registrations/${m.id}/attendance`, { attended: true }).expect(409);
  });

  it('closes registration at the deadline', async () => {
    const ev = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() + 2 * DAY), deadline: new Date(Date.now() - HOUR) });
    const m = await createMember(t);
    const res = await m.post(`/events/${ev.id}/registrations`, {}).expect(412);
    expect(res.body.error.message).toContain('closed');
    expect((await m.get(`/events/${ev.id}`).expect(200)).body.registrationOpen).toBe(false);
  });

  it('external-registration events refuse internal registration and expose the link until they end', async () => {
    const ev = await publishedEvent(staff, {
      registrationMode: 'external',
      externalUrl: 'https://tickets.example.org/forum',
      capacity: null,
    });
    const m = await createMember(t);
    const res = await m.post(`/events/${ev.id}/registrations`, {}).expect(412);
    expect(res.body.error.code).toBe('PRECONDITION_FAILED');
    const detail = (await m.get(`/events/${ev.id}`).expect(200)).body;
    expect(detail).toMatchObject({ registrationMode: 'external', externalUrl: 'https://tickets.example.org/forum', registrationOpen: true, capacity: null, spotsLeft: null });
    await staff.post('/events', eventInput({ registrationMode: 'external', externalUrl: 'https://user:pw@tickets.example.org' , capacity: null })).expect(422);
  });

  it('join links: hosts always; registered members from 24 h before start; never after the end', async () => {
    const host = staff;
    const reg = await createMember(t);
    const other = await createMember(t);
    const far = await insertEvent(t, host.id, { startsAt: new Date(Date.now() + 3 * DAY) });
    const near = await insertEvent(t, host.id, { startsAt: new Date(Date.now() + 2 * HOUR) });
    const past = await insertEvent(t, host.id, { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR) });
    for (const ev of [far, near, past]) await insertRegistration(t, ev.id, reg.id);

    const farReg = (await reg.get(`/events/${far.id}`).expect(200)).body;
    expect(farReg.online).toMatchObject({ platform: 'Zoom', joinUrl: null });
    expect(Date.parse(farReg.online.joinAvailableAt)).toBe(far.startsAt.getTime() - 24 * HOUR);
    expect((await host.get(`/events/${far.id}`).expect(200)).body.online.joinUrl).toBe(JOIN_URL);

    expect((await reg.get(`/events/${near.id}`).expect(200)).body.online).toMatchObject({ joinUrl: JOIN_URL, joinAvailableAt: null });
    expect((await other.get(`/events/${near.id}`).expect(200)).body.online).toMatchObject({ joinUrl: null, joinAvailableAt: null });

    const archived = (await reg.get(`/events/${past.id}`).expect(200)).body;
    expect(archived.past).toBe(true);
    expect(archived.online.joinUrl).toBeNull();
    expect((await host.get(`/events/${past.id}`).expect(200)).body.online.joinUrl).toBeNull();
    // Past events keep their description and appear under the Past tab.
    const pastTab = await other.get('/events?when=past').expect(200);
    expect(pastTab.body.items.map((e: { id: string }) => e.id)).toContain(past.id);
    expect(JSON.stringify(pastTab.body)).not.toContain('zoom.us');

    // Cancelled registration loses the link.
    await reg.delete(`/events/${near.id}/registrations/me`).expect(200);
    expect((await reg.get(`/events/${near.id}`).expect(200)).body.online.joinUrl).toBeNull();
  });

  it('reminder job sends 24 h and 1 h reminders once, respecting preferences, under concurrent runs', async () => {
    const reminders = t.app.get(EventRemindersService);
    const [a, b, waiting] = await members(3);
    const ev = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() + 20 * HOUR), capacity: 2 });
    await insertRegistration(t, ev.id, a!.id);
    await insertRegistration(t, ev.id, b!.id);
    await t.db.insert(s.eventRegistrations).values({ eventId: ev.id, userId: waiting!.id, status: 'waitlisted', position: 1 });
    // b turned off event emails.
    await b!.put('/me/notification-preferences', { preferences: [{ category: 'events', channel: 'email', enabled: false }] }).expect(200);

    const reminderCount = (userId: string) => count(t.db, s.notifications, and(eq(s.notifications.userId, userId), eq(s.notifications.type, 'event_reminder')));
    const reminderEmails = (to: string) => count(t.db, s.emailOutbox, and(eq(s.emailOutbox.toAddress, to), eq(s.emailOutbox.template, 'notification.event_reminder')));

    const runs = await Promise.all([reminders.sendReminders(), reminders.sendReminders(), reminders.sendReminders()]);
    expect(runs.reduce((x, y) => x + y, 0)).toBe(2);
    await reminders.sendReminders();
    expect(await reminderCount(a!.id)).toBe(1);
    expect(await reminderCount(b!.id)).toBe(1);
    expect(await reminderCount(waiting!.id)).toBe(0);
    expect(await reminderEmails(a!.email)).toBe(1);
    expect(await reminderEmails(b!.email)).toBe(0);

    // 19.5 hours later the 1 h window opens: one more each, then nothing.
    const later = new Date(ev.startsAt.getTime() - 30 * 60_000);
    expect(await reminders.sendReminders(later)).toBe(2);
    expect(await reminders.sendReminders(later)).toBe(0);
    expect(await reminderCount(a!.id)).toBe(2);
    const text = (await a!.get('/notifications').expect(200)).body.items[0].segments.map((x: { text: string }) => x.text).join('');
    expect(text).toContain('starts in 30 minutes');

    // In-app off for events: nothing in-app for a newly registered member.
    const c = await createMember(t);
    await c.put('/me/notification-preferences', { preferences: [{ category: 'events', channel: 'in_app', enabled: false }] }).expect(200);
    await insertRegistration(t, ev.id, c.id);
    await reminders.sendReminders(later);
    expect(await reminderCount(c.id)).toBe(0);
    expect(await count(t.db, s.eventRemindersSent, eq(s.eventRemindersSent.eventId, ev.id))).toBe(5);

    // The maintenance job runs inline through the queue too.
    const { QueueService } = await import('../../src/infra/queue.service.js');
    await t.app.get(QueueService).add('maintenance', 'event-reminders', {});
  });

  it('archives events a week after they end', async () => {
    const reminders = t.app.get(EventRemindersService);
    const old = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() - 9 * DAY) });
    await reminders.archiveEnded();
    const [row] = await t.db.select().from(s.events).where(eq(s.events.id, old.id));
    expect(row!.status).toBe('archived');
    const m = await createMember(t);
    expect((await m.get(`/events/${old.id}`).expect(200)).body.status).toBe('archived');
  });

  it('serves RFC 5545 .ics with UTC times, escaping, folding, the page URL and never the join link', async () => {
    const ev = await publishedEvent(staff, {
      title: 'Trade, Policy; and \\ Breakfast — a deliberately long title that will need folding across several lines ✓',
      format: 'hybrid',
      venue: { name: 'Kempinski', address: 'Gamel Abdul Nasser Ave', city: 'Accra', countryCode: 'GH' },
      timezone: 'Africa/Accra',
    });
    const res = await t.http().get(`/api/v1/events/${ev.id}.ics`).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${ev.slug}.ics"`);
    const body: string = res.text;
    expect(body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    for (const line of body.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    const unfolded = body.replace(/\r\n /g, '');
    const [row] = await t.db.select().from(s.events).where(eq(s.events.id, ev.id));
    const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    expect(unfolded).toContain(`UID:event-${ev.id}@localhost`);
    expect(unfolded).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(unfolded).toContain(`DTSTART:${utc(row!.startsAt)}`);
    expect(unfolded).toContain(`DTEND:${utc(row!.endsAt)}`);
    expect(unfolded).toContain('SUMMARY:Trade\\, Policy\\; and \\\\ Breakfast');
    expect(unfolded).toContain('LOCATION:Kempinski\\, Gamel Abdul Nasser Ave\\, Accra\\, Ghana & online (Zoom)');
    expect(unfolded).toContain(`URL:http://localhost:3000/events/${ev.slug}`);
    expect(unfolded).toContain('X-WR-TIMEZONE:Africa/Accra');
    expect(unfolded).toMatch(/DESCRIPTION:.*\\n\\n/);
    expect(unfolded).not.toContain('zoom.us');
    // Drafts are not public.
    const draft = (await staff.post('/events', eventInput()).expect(201)).body;
    await t.http().get(`/api/v1/events/${draft.id}.ics`).expect(404);
    await staff.get(`/events/${draft.id}.ics`).expect(200);

    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = icsFold('X:' + 'é'.repeat(80));
    expect(folded.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('X:' + 'é'.repeat(80));
  });
});
