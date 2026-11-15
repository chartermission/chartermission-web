import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { BOOKINGS_OPEN_PER_HOST, BOOKINGS_PER_DAY, type BookingView, type Page, type ServiceView, type SlotsView } from '@chartermission/contracts';
import { count, createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { BookingRemindersService } from '../../src/services/booking-reminders.service.js';
import { QueueService } from '../../src/infra/queue.service.js';
import { allDay, consultation, createService, firstSlot, makePage, type Member } from './service-helpers.js';

const notes = (t: TestApp, userId: string, type: string) => count(t.db, s.notifications, and(eq(s.notifications.userId, userId), eq(s.notifications.type, type)));

describe('Services: bookings', () => {
  let t: TestApp;
  let host: Member;
  let booker: Member;
  let service: ServiceView;

  beforeAll(async () => {
    t = await createTestApp();
    host = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    booker = await createMember(t, { name: 'Amara Okafor', countryCode: 'NG' });
    service = await createService(host);
  });
  afterAll(async () => {
    await t.close();
  });

  it('no slots and no booking until the host saves availability', async () => {
    const view = (await booker.get(`/services/${service.id}/slots`).expect(200)).body as SlotsView;
    expect(view).toMatchObject({ hostTimezone: 'Africa/Accra', timezone: 'Africa/Accra', durationMinutes: 30, nextAvailable: null });
    expect(view.days).toHaveLength(14);
    expect(view.days.every((d) => d.slots.length === 0)).toBe(true);
    const res = await booker.post(`/services/${service.id}/bookings`, { startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Not taking bookings right now');
    await host.put('/availability', allDay()).expect(200);
  });

  it('slots are grouped in the viewer’s zone', async () => {
    const from = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const view = (await booker.get(`/services/${service.id}/slots?from=${from}&days=2&tz=Asia/Dubai`).expect(200)).body as SlotsView;
    expect(view).toMatchObject({ timezone: 'Asia/Dubai', hostTimezone: 'Africa/Abidjan' });
    expect(view.days.map((d) => d.date)).toEqual([from, new Date(Date.parse(from) + 86_400_000).toISOString().slice(0, 10)]);
    // Dubai is UTC+4: the day starts at 20:00 UTC the evening before, every 30 minutes; the host's
    // 23:30 slot would end after 23:59, so 47 a day.
    expect(view.days[0]!.slots[0]!.startsAt.slice(11, 16)).toBe('20:00');
    expect(view.days[0]!.slots).toHaveLength(47);
    expect(view.nextAvailable).not.toBeNull();
    await booker.get(`/services/${service.id}/slots?tz=Nowhere/Land`).expect(422);
    await booker.get(`/services/${service.id}/slots?days=40`).expect(422);
  });

  let booking: BookingView;

  it('books an open slot: host notified, emails to both sides, details shared', async () => {
    await host.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(host, service.id) }).expect(403);
    const unverified = await createMember(t, { verified: false });
    await unverified.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(booker, service.id) }).expect(403);
    const off = new Date(Date.parse(await firstSlot(booker, service.id)) + 10 * 60_000).toISOString();
    const bad = await booker.post(`/services/${service.id}/bookings`, { startsAt: off });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.startsAt).toBe('Pick one of the open times');
    await booker.post(`/services/${service.id}/bookings`, { startsAt: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 13) + ':00:00Z' }).expect(422);

    const startsAt = await firstSlot(booker, service.id);
    const res = await booker.post(`/services/${service.id}/bookings`, { startsAt, note: 'Our wallet launch in Ghana: what licences do we need?' });
    expect(res.status).toBe(201);
    booking = res.body as BookingView;
    expect(booking).toMatchObject({
      service: { id: service.id, title: 'Fintech product clinic', durationMinutes: 30, mode: 'video' },
      host: { type: 'member', member: { id: host.id } },
      booker: { id: booker.id },
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
      hostTimezone: 'Africa/Abidjan',
      status: 'confirmed',
      meetingDetails: 'https://meet.example.com/kwame-clinic',
      locationHint: 'Google Meet',
      cancelledBy: null,
      past: false,
      viewer: { role: 'booker', canCancel: true },
    });

    expect(await notes(t, host.id, 'booking_received')).toBe(1);
    const n = (await host.get('/notifications').expect(200)).body.items[0];
    expect(n.type).toBe('booking_received');
    expect(n.href).toBe(`/bookings/${booking.id}`);
    expect(n.segments.map((x: { text: string }) => x.text).join('')).toContain('Amara Okafor booked Fintech product clinic for ');

    const hostMail = await lastEmail(t.db, host.email);
    expect(hostMail).toMatchObject({ template: 'notification.booking_received', subject: 'New booking: Fintech product clinic' });
    expect(hostMail!.textBody).toContain('Africa/Abidjan');
    expect(hostMail!.textBody).toContain('Video call: https://meet.example.com/kwame-clinic');
    expect(hostMail!.textBody).toContain('Their note: “Our wallet launch in Ghana: what licences do we need?”');
    expect(hostMail!.textBody).toContain(`/bookings/${booking.id}/calendar.ics`);
    const bookerMail = await lastEmail(t.db, booker.email);
    expect(bookerMail).toMatchObject({ template: 'booking.confirmed', subject: 'Booked: Fintech product clinic with Kwame Mensah' });
    // The booker has no availability: their country's zone.
    expect(bookerMail!.textBody).toContain('(Africa/Lagos)');
    expect(bookerMail!.textBody).toContain('Video call: https://meet.example.com/kwame-clinic');

    // The booker now sees the meeting details on the service; others still don't.
    expect((await booker.get(`/services/${service.id}`).expect(200)).body.meetingDetails).toBe('https://meet.example.com/kwame-clinic');
    expect((await unverified.get(`/services/${service.id}`).expect(200)).body.meetingDetails).toBeNull();
    expect((await host.get(`/services/${service.id}`).expect(200)).body.upcomingBookings).toBe(1);

    // The slot is gone, for everyone.
    const other = await createMember(t);
    const from = startsAt.slice(0, 10);
    const slots = ((await other.get(`/services/${service.id}/slots?from=${from}&days=1&tz=UTC`).expect(200)).body as SlotsView).days[0]!.slots;
    expect(slots.map((x) => x.startsAt)).not.toContain(new Date(startsAt).toISOString());
    const taken = await other.post(`/services/${service.id}/bookings`, { startsAt });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toBe('That time was just taken. Pick another.');
  });

  it('both sides list, open and download the booking; nobody else can', async () => {
    const mine = (await booker.get('/bookings').expect(200)).body as Page<BookingView>;
    expect(mine.items.map((b) => b.id)).toEqual([booking.id]);
    expect(mine.nextCursor).toBeNull();
    const hosting = (await host.get('/bookings?role=host').expect(200)).body as Page<BookingView>;
    expect(hosting.items[0]).toMatchObject({ id: booking.id, viewer: { role: 'host', canCancel: true }, note: 'Our wallet launch in Ghana: what licences do we need?' });
    expect(((await host.get('/bookings').expect(200)).body as Page<BookingView>).items).toEqual([]);
    expect(((await booker.get('/bookings?when=past').expect(200)).body as Page<BookingView>).items).toEqual([]);

    expect((await host.get(`/bookings/${booking.id}`).expect(200)).body.viewer.role).toBe('host');
    const stranger = await createMember(t);
    await stranger.get(`/bookings/${booking.id}`).expect(404);
    await stranger.get(`/bookings/${booking.id}/calendar.ics`).expect(404);
    await stranger.post(`/bookings/${booking.id}/cancel`, {}).expect(404);

    const ics = await booker.get(`/bookings/${booking.id}/calendar.ics`).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('SUMMARY:Fintech product clinic with Kwame Mensah');
    expect(ics.text).toContain('LOCATION:https://meet.example.com/kwame-clinic');
    expect(ics.text).toContain('STATUS:CONFIRMED');
    expect((await host.get(`/bookings/${booking.id}/calendar.ics`).expect(200)).text).toContain('SUMMARY:Fintech product clinic with Amara Okafor');
  });

  it('two people booking the same slot at once: one gets it, the other a 409', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const startsAt = await firstSlot(a, service.id, 3);
    const results = await Promise.all([a.post(`/services/${service.id}/bookings`, { startsAt }), b.post(`/services/${service.id}/bookings`, { startsAt })]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.message).toBe('That time was just taken. Pick another.');
    const rows = await t.db.select().from(s.bookings).where(and(eq(s.bookings.serviceId, service.id), eq(s.bookings.startsAt, new Date(startsAt))));
    expect(rows).toHaveLength(1);
  });

  it('the buffer and the daily limit apply across the host’s services', async () => {
    const second = await createService(host, consultation({ title: 'Hiring a product team', durationMinutes: 60 }));
    await host.put('/availability', allDay({ bufferMinutes: 30 })).expect(200);
    const start = await firstSlot(booker, service.id, 5);
    const res = await booker.post(`/services/${second.id}/bookings`, { startsAt: start }).expect(201);
    const end = Date.parse(res.body.endsAt);
    const day = start.slice(0, 10);
    const slots = ((await createMember(t).then((m) => m.get(`/services/${service.id}/slots?from=${day}&days=1&tz=UTC`))).body as SlotsView).days[0]!.slots.map((x) =>
      Date.parse(x.startsAt),
    );
    // Nothing from 30 minutes before the start to 30 minutes after the end.
    expect(slots.filter((x) => x + 30 * 60_000 > Date.parse(start) - 30 * 60_000 && x < end + 30 * 60_000)).toEqual([]);
    await host.put('/availability', allDay({ maxPerDay: 1 })).expect(200);
    const view = (await (await createMember(t)).get(`/services/${service.id}/slots?from=${day}&days=1&tz=Africa/Abidjan`).expect(200)).body as SlotsView;
    expect(view.days[0]!.slots).toEqual([]);
    await host.put('/availability', allDay()).expect(200);
  });

  it(`limits: ${BOOKINGS_OPEN_PER_HOST} upcoming with one host, ${BOOKINGS_PER_DAY} a day`, async () => {
    const keen = await createMember(t);
    for (let i = 0; i < BOOKINGS_OPEN_PER_HOST; i++) {
      await keen.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(keen, service.id, 10 + i) }).expect(201);
    }
    const over = await keen.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(keen, service.id, 15) });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toBe(`You can have up to ${BOOKINGS_OPEN_PER_HOST} upcoming consultations with the same host.`);

    const busy = await createMember(t);
    const redis = new Redis(process.env.REDIS_URL!);
    await redis.set(`rl:bookings:${busy.id}`, String(BOOKINGS_PER_DAY), 'EX', 3600);
    await redis.quit();
    const limited = await busy.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(busy, service.id, 16) });
    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toBe(`You can book ${BOOKINGS_PER_DAY} consultations a day.`);

    // Your own consultations at the same time are not offered, and can't be booked.
    const elsewhere = await createMember(t, { name: 'Fatou Diallo' });
    await elsewhere.put('/availability', allDay()).expect(200);
    const twin = await createService(elsewhere, consultation({ title: 'Investor readiness' }));
    const mineAt = booking.startsAt;
    expect(((await (await createMember(t)).get(`/services/${twin.id}/slots?from=${mineAt.slice(0, 10)}&days=1&tz=UTC`).expect(200)).body as SlotsView).days[0]!.slots.map((x) => x.startsAt)).toContain(mineAt);
    const clash = await booker.post(`/services/${twin.id}/bookings`, { startsAt: mineAt });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toBe('You already have a consultation at that time');
    const slots = ((await booker.get(`/services/${twin.id}/slots?from=${mineAt.slice(0, 10)}&days=1&tz=UTC`).expect(200)).body as SlotsView).days[0]!.slots;
    expect(slots.map((x) => x.startsAt)).not.toContain(mineAt);
  });

  it('cancelling: either side, once, before it starts; the other side is told', async () => {
    const res = await booker.post(`/bookings/${booking.id}/cancel`, { reason: 'Our launch moved to January.' }).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledBy: 'booker', cancelReason: 'Our launch moved to January.', meetingDetails: null, viewer: { canCancel: false } });
    expect(res.body.cancelledAt).toBeTruthy();
    expect(await notes(t, host.id, 'booking_cancelled')).toBe(1);
    const mail = await lastEmail(t.db, host.email);
    expect(mail).toMatchObject({ template: 'notification.booking_cancelled', subject: 'Cancelled: Fintech product clinic' });
    expect(mail!.textBody).toContain('Their reason: “Our launch moved to January.”');
    const again = await host.post(`/bookings/${booking.id}/cancel`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('This consultation was already cancelled');
    expect(((await booker.get('/bookings?when=cancelled').expect(200)).body as Page<BookingView>).items.map((b) => b.id)).toContain(booking.id);
    expect((await booker.get(`/services/${service.id}`).expect(200)).body.meetingDetails).toBeNull();
    expect((await booker.get(`/bookings/${booking.id}/calendar.ics`).expect(200)).text).toContain('STATUS:CANCELLED');

    // The host cancels another one.
    const next = (await booker.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(booker, service.id, 20) }).expect(201)).body as BookingView;
    const byHost = await host.post(`/bookings/${next.id}/cancel`, { reason: null }).expect(200);
    expect(byHost.body).toMatchObject({ cancelledBy: 'host', viewer: { role: 'host' } });
    expect(await notes(t, booker.id, 'booking_cancelled')).toBe(1);

    // Too late once it has started.
    const started = (await booker.post(`/services/${service.id}/bookings`, { startsAt: await firstSlot(booker, service.id, 21) }).expect(201)).body as BookingView;
    await t.db
      .update(s.bookings)
      .set({ startsAt: new Date(Date.now() - 5 * 60_000), endsAt: new Date(Date.now() + 25 * 60_000) })
      .where(eq(s.bookings.id, started.id));
    const late = await booker.post(`/bookings/${started.id}/cancel`, {});
    expect(late.status).toBe(409);
    expect(late.body.error.message).toBe('This consultation has started, so it can’t be cancelled');
    expect((await booker.get(`/bookings/${started.id}`).expect(200)).body.viewer.canCancel).toBe(false);
  });

  it('reminders 24 h and 1 h before, to both sides, once', async () => {
    const svc = await createService(host, consultation({ title: 'Quick question' }));
    const person = await createMember(t, { name: 'Tunde Bakare' });
    const soon = new Date(Date.now() + 50 * 60_000);
    const [b] = await t.db
      .insert(s.bookings)
      .values({ serviceId: svc.id, hostUserId: host.id, bookerId: person.id, startsAt: soon, endsAt: new Date(soon.getTime() + 30 * 60_000) })
      .returning();
    const reminders = t.app.get(BookingRemindersService);
    const runs = await Promise.all([reminders.run(), reminders.run(), reminders.run()]);
    expect(runs.reduce((a, n) => a + n, 0)).toBe(2);
    expect(await reminders.run()).toBe(0);
    expect(await notes(t, person.id, 'booking_reminder')).toBe(1);
    expect(await notes(t, host.id, 'booking_reminder')).toBe(1);
    const n = (await person.get('/notifications').expect(200)).body.items[0];
    expect(n.segments.map((x: { text: string }) => x.text).join('')).toMatch(/^Quick question with Kwame Mensah is coming up: \w{3} \d{1,2} \w{3}, \d{2}:\d{2}$/);
    expect(n.segments.at(-1).at).toEqual(expect.any(String));
    const mail = await lastEmail(t.db, person.email);
    expect(mail!.template).toBe('notification.booking_reminder');
    expect(mail!.textBody).toContain('Video call: https://meet.example.com/kwame-clinic');
    // Only the 1 h reminder once inside the hour.
    expect(await count(t.db, s.bookingRemindersSent, eq(s.bookingRemindersSent.bookingId, b!.id))).toBe(2);

    // A day ahead: the 24 h one, then the 1 h one later on. Cancelled bookings get none.
    const tomorrow = new Date(Date.now() + 23 * 3_600_000);
    await t.db.insert(s.bookings).values({ serviceId: svc.id, hostUserId: host.id, bookerId: person.id, startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + 1_800_000) });
    await t.db
      .insert(s.bookings)
      .values({ serviceId: svc.id, hostUserId: host.id, bookerId: booker.id, startsAt: tomorrow, endsAt: new Date(tomorrow.getTime() + 1_800_000), status: 'cancelled', cancelledBy: 'booker' });
    expect(await reminders.run()).toBe(2);
    expect(await reminders.run(new Date(tomorrow.getTime() - 30 * 60_000))).toBe(2);
    expect(await notes(t, booker.id, 'booking_reminder')).toBe(0);
    // Registered as a maintenance job.
    await t.app.get(QueueService).add('maintenance', 'booking-reminders', {});
  });

  it('deleting a service cancels its upcoming bookings and tells the bookers', async () => {
    const svc = await createService(host, consultation({ title: 'Last-minute review' }));
    const person = await createMember(t);
    const booked = (await person.post(`/services/${svc.id}/bookings`, { startsAt: await firstSlot(person, svc.id, 25) }).expect(201)).body as BookingView;
    await host.delete(`/services/${svc.id}`).expect(200);
    await person.get(`/services/${svc.id}`).expect(404);
    expect((await person.get(`/bookings/${booked.id}`).expect(200)).body).toMatchObject({ status: 'cancelled', cancelledBy: 'host' });
    expect(await notes(t, person.id, 'booking_cancelled')).toBe(1);
    expect((await lastEmail(t.db, person.email))!.textBody).toContain('Kwame Mensah no longer offers Last-minute review');
  });

  it('page services: every admin is the host', async () => {
    const owner = await createMember(t, { name: 'Amaka Owner' });
    const admin = await createMember(t, { name: 'Ade Admin' });
    const page = await makePage(t, owner, 'lagos-agrihub', [admin]);
    const svc = await createService(admin, consultation({ title: 'Cold-room booking advice', host: { type: 'page', pageId: page.id }, meetingDetails: 'Ikorodu hub, gate 2', mode: 'in_person' }));
    await owner.put(`/availability?host=page&pageId=${page.id}`, allDay()).expect(200);

    await owner.post(`/services/${svc.id}/bookings`, { startsAt: await firstSlot(owner, svc.id) }).expect(403);
    const farmer = await createMember(t, { name: 'Bisi Farmer' });
    const b = (await farmer.post(`/services/${svc.id}/bookings`, { startsAt: await firstSlot(farmer, svc.id), note: 'Two tonnes of tomatoes weekly' }).expect(201))
      .body as BookingView;
    expect(b).toMatchObject({ host: { type: 'page', page: { slug: 'lagos-agrihub' } }, meetingDetails: 'Ikorodu hub, gate 2', service: { mode: 'in_person' } });
    expect(await notes(t, owner.id, 'booking_received')).toBe(1);
    expect(await notes(t, admin.id, 'booking_received')).toBe(1);
    expect((await lastEmail(t.db, farmer.email))!.subject).toBe('Booked: Cold-room booking advice with lagos agrihub');

    const forPage = (await admin.get(`/bookings?role=host&pageId=${page.id}`).expect(200)).body as Page<BookingView>;
    expect(forPage.items.map((x) => x.id)).toEqual([b.id]);
    expect(forPage.items[0]!.viewer.role).toBe('host');
    await farmer.get(`/bookings?role=host&pageId=${page.id}`).expect(403);
    expect((await owner.get(`/bookings/${b.id}`).expect(200)).body.viewer).toEqual({ role: 'host', canCancel: true });

    // Reminders go to the booker and every admin.
    await t.db.update(s.bookings).set({ startsAt: new Date(Date.now() + 40 * 60_000), endsAt: new Date(Date.now() + 70 * 60_000) }).where(eq(s.bookings.id, b.id));
    await t.app.get(BookingRemindersService).run();
    for (const m of [farmer, owner, admin]) expect(await notes(t, m.id, 'booking_reminder')).toBe(1);

    await admin.post(`/bookings/${b.id}/cancel`, { reason: 'The hub is closed for repairs that day.' }).expect(200);
    expect(await notes(t, farmer.id, 'booking_cancelled')).toBe(1);
    expect((await lastEmail(t.db, farmer.email))!.textBody).toContain('lagos agrihub cancelled Cold-room booking advice');
  });
});
