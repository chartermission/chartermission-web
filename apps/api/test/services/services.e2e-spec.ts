import { eq } from 'drizzle-orm';
import { SERVICES_MAX_PER_HOST, type AvailabilityView, type ServiceView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { allDay, consultation, createService, listing, makePage, type Member } from './service-helpers.js';

describe('Services: listing, permissions, privacy and availability', () => {
  let t: TestApp;
  let host: Member;
  let other: Member;
  let bookable: ServiceView;
  let hidden: ServiceView;

  beforeAll(async () => {
    t = await createTestApp();
    host = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    other = await createMember(t, { name: 'Amara Okafor' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('a verified member lists services; positions default to the end', async () => {
    const missing = await host.post('/services', consultation({ durationMinutes: null, mode: null, meetingDetails: null }));
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields).toMatchObject({
      durationMinutes: 'Choose how long a consultation lasts',
      mode: 'Choose how you meet',
      meetingDetails: 'Add the link, number or address people get once they book',
    });
    const unverified = await createMember(t, { verified: false });
    await unverified.post('/services', consultation()).expect(403);

    bookable = await createService(host);
    expect(bookable).toMatchObject({
      host: { type: 'member', member: { id: host.id } },
      skills: ['Payments', 'Product'],
      bookable: true,
      durationMinutes: 30,
      mode: 'video',
      meetingDetails: 'https://meet.example.com/kwame-clinic',
      position: 0,
      active: true,
      upcomingBookings: 0,
      viewer: { canManage: true, canBook: false, cantBookReason: 'You can’t book your own service' },
    });
    const plain = await createService(host, listing());
    expect(plain).toMatchObject({ bookable: false, durationMinutes: null, mode: null, position: 1 });
    hidden = await createService(host, listing({ title: 'Board advisory', active: false }));
    expect(hidden.position).toBe(2);
  });

  it('others see active services without the meeting details; the host sees everything', async () => {
    const own = (await host.get(`/members/${host.handle}/services`).expect(200)).body as ServiceView[];
    expect(own.map((x) => x.title)).toEqual(['Fintech product clinic', 'Market-entry research', 'Board advisory']);

    const seen = (await other.get(`/members/${host.handle}/services`).expect(200)).body as ServiceView[];
    expect(seen.map((x) => x.title)).toEqual(['Fintech product clinic', 'Market-entry research']);
    expect(seen[0]).toMatchObject({ meetingDetails: null, viewer: { canManage: false, canBook: false, cantBookReason: 'Not taking bookings right now' } });
    expect(seen[0]!.upcomingBookings).toBeUndefined();
    expect(seen[1]!.viewer.cantBookReason).toBe('This service can’t be booked online');
    await other.get(`/services/${hidden.id}`).expect(404);
    expect((await host.get(`/services/${hidden.id}`).expect(200)).body.active).toBe(false);
    expect((await other.get(`/services/${bookable.id}`).expect(200)).body.meetingDetails).toBeNull();
  });

  it('visitors: public profiles only, and they are asked to sign in to book', async () => {
    await t.http().get(`/api/v1/members/${host.handle}/services`).expect(401);
    await t.db.update(s.memberProfiles).set({ profileVisibility: 'public' }).where(eq(s.memberProfiles.userId, host.id));
    const anon = (await t.http().get(`/api/v1/members/${host.handle}/services`).expect(200)).body as ServiceView[];
    expect(anon).toHaveLength(2);
    expect(anon[0]).toMatchObject({ meetingDetails: null, viewer: { canBook: false, cantBookReason: 'Sign in to book a consultation' } });
    expect((await t.http().get(`/api/v1/services/${bookable.id}`).expect(200)).body.viewer.cantBookReason).toBe('Sign in to book a consultation');
    await t.http().get('/api/v1/members/nobody-here/services').expect(404);
  });

  it('only the host edits or deletes; the host can’t be changed', async () => {
    await other.patch(`/services/${bookable.id}`, consultation({ title: 'Mine now' })).expect(403);
    await other.delete(`/services/${bookable.id}`).expect(403);
    const page = await makePage(t, other, 'amara-page');
    const updated = (await host.patch(`/services/${bookable.id}`, consultation({ title: 'Payments clinic', host: { type: 'page', pageId: page.id } })).expect(200))
      .body as ServiceView;
    expect(updated).toMatchObject({ title: 'Payments clinic', host: { type: 'member', member: { id: host.id } }, position: 0 });
    await host.patch(`/services/${bookable.id}`, consultation({ bookable: true, mode: null })).expect(422);
    // Members can't list services for a page they don't manage.
    await host.post('/services', consultation({ host: { type: 'page', pageId: page.id } })).expect(403);
  });

  it(`up to ${SERVICES_MAX_PER_HOST} services per host`, async () => {
    const lots = await createMember(t);
    await t.db.insert(s.services).values(
      Array.from({ length: SERVICES_MAX_PER_HOST - 1 }, (_, i) => ({ hostUserId: lots.id, title: `Service ${i}`, description: 'x'.repeat(30), position: i })),
    );
    const last = await createService(lots, listing());
    expect(last.position).toBe(SERVICES_MAX_PER_HOST - 1);
    const over = await lots.post('/services', listing());
    expect(over.status).toBe(409);
    expect(over.body.error.message).toBe(`You can list up to ${SERVICES_MAX_PER_HOST} services.`);
    // Deleted ones don't count.
    await lots.delete(`/services/${last.id}`).expect(200);
    await createService(lots, listing());
  });

  it('availability: defaults until saved, validated, then bookable', async () => {
    const before = (await host.get('/availability').expect(200)).body as AvailabilityView;
    expect(before).toMatchObject({ configured: false, timezone: 'Africa/Accra', daysOff: [], bufferMinutes: 0, maxPerDay: null });
    expect(before.windows).toHaveLength(5);
    expect(((await other.get('/availability').expect(200)).body as AvailabilityView).timezone).toBe('Africa/Lagos');

    const overlap = await host.put('/availability', allDay({ windows: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }] }));
    expect(overlap.status).toBe(422);
    expect(overlap.body.error.fields['windows.1.start']).toBe('Times overlap');
    const backwards = await host.put('/availability', allDay({ windows: [{ weekday: 1, start: '12:00', end: '09:00' }] }));
    expect(backwards.body.error.fields['windows.0.end']).toBe('End after the start');
    expect((await host.put('/availability', allDay({ timezone: 'Mars/Olympus' }))).body.error.fields.timezone).toBe('Choose a valid time zone');
    await host.put('/availability', allDay({ bufferMinutes: 500 })).expect(422);
    await host.put('/availability', allDay({ windows: [{ weekday: 1, start: '9:00', end: '12:00' }] })).expect(422);

    const saved = (await host.put('/availability', allDay({ daysOff: ['2027-01-02', '2027-01-01', '2027-01-01'], bufferMinutes: 10, maxPerDay: 6 })).expect(200))
      .body as AvailabilityView;
    expect(saved).toMatchObject({ configured: true, timezone: 'Africa/Abidjan', daysOff: ['2027-01-01', '2027-01-02'], bufferMinutes: 10, maxPerDay: 6 });
    expect(saved.windows).toHaveLength(7);
    // Saving again replaces it.
    const again = (await host.put('/availability', allDay()).expect(200)).body as AvailabilityView;
    expect(again).toMatchObject({ daysOff: [], bufferMinutes: 0, maxPerDay: null });
    expect(await t.db.select().from(s.hostAvailability).where(eq(s.hostAvailability.hostUserId, host.id))).toHaveLength(1);

    const seen = (await other.get(`/services/${bookable.id}`).expect(200)).body as ServiceView;
    expect(seen.viewer).toEqual({ canManage: false, canBook: true, cantBookReason: null });
    const unverified = await createMember(t, { verified: false });
    expect((await unverified.get(`/services/${bookable.id}`).expect(200)).body.viewer.cantBookReason).toBe('Verify your email address to book');
  });

  it('page availability is for the page’s admins', async () => {
    const page = await makePage(t, other, 'amara-consulting');
    await host.get(`/availability?host=page&pageId=${page.id}`).expect(403);
    await host.put(`/availability?host=page&pageId=${page.id}`, allDay()).expect(403);
    await other.get('/availability?host=page').expect(422);
    expect(((await other.get(`/availability?host=page&pageId=${page.id}`).expect(200)).body as AvailabilityView).timezone).toBe('Africa/Accra');
    await other.put(`/availability?host=page&pageId=${page.id}`, allDay()).expect(200);
    expect((await other.get(`/availability?host=page&pageId=${page.id}`).expect(200)).body.configured).toBe(true);
    // The member's own availability is separate.
    expect((await other.get('/availability').expect(200)).body.configured).toBe(false);
  });

  it('blocked, suspended and deleted hosts are hidden; official accounts can offer services', async () => {
    const stranger = await createMember(t);
    await t.db.insert(s.blocks).values({ blockerId: host.id, blockedId: stranger.id });
    await stranger.get(`/members/${host.handle}/services`).expect(404);
    await stranger.get(`/services/${bookable.id}`).expect(404);
    await stranger.get(`/services/${bookable.id}/slots`).expect(404);
    await stranger.post(`/services/${bookable.id}/bookings`, { startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }).expect(404);

    const gone = await createMember(t);
    const theirs = await createService(gone, listing());
    await t.db.update(s.users).set({ status: 'suspended' }).where(eq(s.users.id, gone.id));
    await other.get(`/members/${gone.handle}/services`).expect(404);
    await other.get(`/services/${theirs.id}`).expect(404);
    await t.db.update(s.users).set({ status: 'deleted' }).where(eq(s.users.id, gone.id));
    await other.get(`/services/${theirs.id}`).expect(404);

    const official = await createMember(t, { name: 'Charter Mission Ghana' });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, official.id));
    const offered = await createService(official, listing());
    expect((await other.get(`/services/${offered.id}`).expect(200)).body.host.member.official).toBe(true);
  });

  it('page services: live pages only, managed by every admin', async () => {
    const admin = await createMember(t, { name: 'Page Admin' });
    const page = await makePage(t, other, 'accra-fintech-hub', [admin]);
    const pending = await makePage(t, other, 'pending-page', [], 'suspended');
    const refused = await other.post('/services', consultation({ host: { type: 'page', pageId: pending.id } }));
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields.host).toBe('Choose a live page you manage');

    const svc = await createService(other, consultation({ host: { type: 'page', pageId: page.id }, meetingDetails: 'Accra office, 3rd floor' }));
    await createService(admin, listing({ host: { type: 'page', pageId: page.id }, active: false }));
    expect(svc).toMatchObject({ host: { type: 'page', page: { id: page.id, slug: 'accra-fintech-hub' } }, viewer: { canManage: true } });

    const asAdmin = (await admin.get('/pages/accra-fintech-hub/services').expect(200)).body as ServiceView[];
    expect(asAdmin).toHaveLength(2);
    expect(asAdmin[0]).toMatchObject({ meetingDetails: 'Accra office, 3rd floor', viewer: { canManage: true, canBook: false, cantBookReason: 'You can’t book a service of a page you manage' } });
    const asHost = (await host.get('/pages/accra-fintech-hub/services').expect(200)).body as ServiceView[];
    expect(asHost).toHaveLength(1);
    expect(asHost[0]).toMatchObject({ meetingDetails: null, viewer: { canManage: false } });
    await t.http().get('/api/v1/pages/accra-fintech-hub/services').expect(401);
    await admin.patch(`/services/${svc.id}`, consultation({ title: 'Founder office hours', meetingDetails: 'Accra office' })).expect(200);
    await host.patch(`/services/${svc.id}`, consultation()).expect(403);

    await t.db.update(s.pages).set({ status: 'suspended' }).where(eq(s.pages.id, page.id));
    await host.get('/pages/accra-fintech-hub/services').expect(404);
    await host.get(`/services/${svc.id}`).expect(404);
    expect((await admin.get('/pages/accra-fintech-hub/services').expect(200)).body).toHaveLength(2);
  });
});
