import { and, eq } from 'drizzle-orm';
import { count, createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { chapterId, DAY, eventInput, eventually, grantChapterLead, JOIN_URL, publishedEvent, type Member } from './event-helpers.js';

describe('Events: hosting, review and visibility', () => {
  let t: TestApp;
  let staff: Member;
  let host: Member;
  let member: Member;
  beforeAll(async () => {
    t = await createTestApp();
    staff = await createMember(t, { name: 'Staff Publisher', roles: ['platform_admin'] });
    host = await createMember(t, { name: 'Event Host', roles: ['event_host'] });
    member = await createMember(t, { name: 'Plain Member' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('stores times in UTC from any offset and keeps the IANA zone (18:00 Lagos is 21:00 in Dubai)', async () => {
    const res = await host
      .post('/events', eventInput({ startsAt: '2027-03-04T18:00:00+01:00', endsAt: '2027-03-04T20:00:00+01:00', timezone: 'Africa/Lagos' }))
      .expect(201);
    expect(res.body.startsAt).toBe('2027-03-04T17:00:00.000Z');
    expect(res.body.endsAt).toBe('2027-03-04T19:00:00.000Z');
    expect(res.body.timezone).toBe('Africa/Lagos');
    expect(res.body.status).toBe('draft');
    const [row] = await t.db.select().from(s.events).where(eq(s.events.id, res.body.id));
    expect(row!.startsAt.toISOString()).toBe('2027-03-04T17:00:00.000Z');
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(res.body.startsAt));
    expect(fmt('Africa/Lagos')).toBe('18:00');
    expect(fmt('Asia/Dubai')).toBe('21:00');
    // The join link is stored encrypted, never in clear.
    expect(row!.onlineUrlEnc).not.toContain('zoom.us');
    expect(res.body.online.joinUrl).toBe(JOIN_URL);
  });

  it('validates cross-field rules and rejects bad time zones', async () => {
    const bad = await host
      .post('/events', eventInput({ format: 'in_person', timezone: 'Mars/Olympus', registrationMode: 'external', externalUrl: 'http://example.com' }))
      .expect(422);
    expect(bad.body.error.fields).toMatchObject({ timezone: expect.any(String), externalUrl: expect.any(String) });
    const cross = await host.post('/events', eventInput({ format: 'in_person' })).expect(422);
    expect(cross.body.error.fields).toMatchObject({ venue: expect.any(String), online: expect.any(String) });
  });

  it('every verified member can propose an event; unverified emails are blocked from writes', async () => {
    const proposed = await member.post('/events', eventInput()).expect(201);
    expect(proposed.body.status).toBe('draft');
    const unverified = await createMember(t, { verified: false });
    const res = await unverified.post('/events', eventInput()).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const ev = await publishedEvent(staff);
    const reg = await unverified.post(`/events/${ev.id}/registrations`, {}).expect(403);
    expect(reg.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('drafts are visible only to hosts and reviewers; review flow notifies the host', async () => {
    const draft = (await host.post('/events', eventInput({ title: 'Review Flow Event' })).expect(201)).body;
    await member.get(`/events/${draft.id}`).expect(404);
    await member.get(`/events/${draft.slug}`).expect(404);
    expect((await host.get(`/events/${draft.slug}`).expect(200)).body.viewer.canManage).toBe(true);
    const moderator = await createMember(t, { roles: ['moderator'] });
    const seen = await moderator.get(`/events/${draft.id}`).expect(200);
    expect(seen.body.viewer.canManage).toBe(false);
    expect(seen.body.online.joinUrl).toBeNull();

    const submitted = await host.post(`/events/${draft.id}/submit`, { note: 'Please review' }).expect(200);
    expect(submitted.body.status).toBe('pending_review');
    expect(submitted.body.review.submittedAt).toBeTruthy();
    await host.patch(`/events/${draft.id}`, { title: 'Changed while in review' }).expect(409);
    await host.post(`/events/${draft.id}/submit`, {}).expect(409);
    const listed = await member.get('/events?q=Review%20Flow').expect(200);
    expect(listed.body.items).toHaveLength(0);

    const admin = await createMember(t, { roles: ['moderator'], admin: true });
    const changes = await admin.post(`/admin/events/${draft.id}/review`, { decision: 'request_changes', note: 'Add an agenda please' }).expect(200);
    expect(changes.body.status).toBe('changes_requested');
    expect(changes.body.reviewNote).toBe('Add an agenda please');
    const notes = await host.get('/notifications').expect(200);
    expect(notes.body.items[0].type).toBe('event_review_changes_requested');

    await host.patch(`/events/${draft.id}`, { description: 'Now with an agenda.' }).expect(200);
    expect((await host.post(`/events/${draft.id}/submit`, {}).expect(200)).body.status).toBe('pending_review');
    const approved = await admin.post(`/admin/events/${draft.id}/review`, { decision: 'approve' }).expect(200);
    expect(approved.body.status).toBe('published');
    expect((await host.get('/notifications').expect(200)).body.items[0].type).toBe('event_review_approved');
    expect((await member.get('/events?q=Review%20Flow').expect(200)).body.items).toHaveLength(1);
    expect(await eventually(() => count(t.db, s.analyticsEvents, and(eq(s.analyticsEvents.name, 'event_published'), eq(s.analyticsEvents.subjectId, draft.id))), (n) => n === 1)).toBe(1);
  });

  it('staff with event.publish publish directly; submit needs a future start', async () => {
    const created = (await staff.post('/events', eventInput({ title: 'Direct Publish Event' })).expect(201)).body;
    const res = await staff.post(`/events/${created.id}/submit`, {}).expect(200);
    expect(res.body.status).toBe('published');
    expect(res.body.review.publishedAt).toBeTruthy();

    const past = (await staff.post('/events', eventInput({}, -3)).expect(201)).body;
    const fail = await staff.post(`/events/${past.id}/submit`, {}).expect(422);
    expect(fail.body.error.fields.startsAt).toBeTruthy();
  });

  it('chapter leads host only for the chapter they lead', async () => {
    const lagos = await chapterId(t, 'nigeria');
    const accra = await chapterId(t, 'ghana');
    const lead = await createMember(t, { name: 'Lagos Lead' });
    await grantChapterLead(t, lead.id, lagos);
    // The scoped role still carries event.create (hosting as themselves works).
    const options = await lead.get('/events/host-options').expect(200);
    expect(options.body).toMatchObject({ canHostAsMember: true, canPublishDirectly: false });
    expect(options.body.chapters.map((c: { slug: string }) => c.slug)).toEqual(['nigeria']);
    expect((await member.get('/events/host-options').expect(200)).body).toEqual({ canHostAsMember: true, chapters: [], canPublishDirectly: false });

    const ok = await lead.post('/events', eventInput({ host: { type: 'chapter', chapterId: lagos } })).expect(201);
    expect(ok.body.host).toMatchObject({ type: 'chapter', chapter: { slug: 'nigeria' } });
    await lead.post('/events', eventInput({ host: { type: 'chapter', chapterId: accra } })).expect(403);
    await host.post('/events', eventInput({ host: { type: 'chapter', chapterId: lagos } })).expect(403);
    await lead.patch(`/events/${ok.body.id}`, { host: { type: 'chapter', chapterId: accra } }).expect(403);

    // Another Lagos lead can manage the chapter's event; an outsider cannot.
    const coLead = await createMember(t);
    await grantChapterLead(t, coLead.id, lagos);
    expect((await coLead.get(`/events/${ok.body.id}`).expect(200)).body.viewer.canManage).toBe(true);
    await coLead.patch(`/events/${ok.body.id}`, { title: 'Edited by co-lead' }).expect(200);
    await host.patch(`/events/${ok.body.id}`, { title: 'Edited by outsider' }).expect(404);
    const mine = await coLead.get('/me/events?role=hosting').expect(200);
    expect(mine.body.items.map((e: { id: string }) => e.id)).toContain(ok.body.id);

    // A certified Ambassador hosts as their chapter too.
    const ambassador = await createMember(t, { name: 'Lagos Ambassador' });
    await grantChapterLead(t, ambassador.id, lagos, 'ambassador');
    const ambOptions = await ambassador.get('/events/host-options').expect(200);
    expect(ambOptions.body.chapters.map((c: { slug: string }) => c.slug)).toEqual(['nigeria']);
    await ambassador.post('/events', eventInput({ host: { type: 'chapter', chapterId: lagos } })).expect(201);
    await ambassador.post('/events', eventInput({ host: { type: 'chapter', chapterId: accra } })).expect(403);
  });

  it('editing a published event’s time notifies registrants and resets reminders; title edits do not', async () => {
    const ev = await publishedEvent(staff, { title: 'Edit Notify Event' });
    const a = await createMember(t);
    const b = await createMember(t);
    await a.post(`/events/${ev.id}/registrations`, {}).expect(200);
    await b.post(`/events/${ev.id}/registrations`, {}).expect(200);
    await t.db.insert(s.eventRemindersSent).values({ eventId: ev.id, userId: a.id, offsetMinutes: 1440 });

    await staff.patch(`/events/${ev.id}`, { title: 'Edit Notify Event (renamed)' }).expect(200);
    expect(await count(t.db, s.notifications, and(eq(s.notifications.userId, a.id), eq(s.notifications.type, 'event_updated')))).toBe(0);

    const start = new Date(Date.now() + 12 * DAY);
    const res = await staff
      .patch(`/events/${ev.id}`, { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() })
      .expect(200);
    expect(res.body.status).toBe('published');
    for (const m of [a, b]) {
      const n = (await m.get('/notifications').expect(200)).body.items[0];
      expect(n.type).toBe('event_updated');
      expect(n.segments.map((x: { text: string }) => x.text).join('')).toContain('time changed');
    }
    expect((await lastEmail(t.db, a.email))!.subject).toContain('Updated');
    expect(await count(t.db, s.eventRemindersSent, eq(s.eventRemindersSent.eventId, ev.id))).toBe(0);

    await staff.patch(`/events/${ev.id}`, { capacity: 1 }).expect(422);
    await staff.patch(`/events/${ev.id}`, { host: { type: 'chapter', chapterId: await chapterId(t) } }).expect(422);
  });

  it('cancel notifies registered and waitlisted members by email; cancelled events cannot be edited', async () => {
    const ev = await publishedEvent(staff, { title: 'To Be Cancelled', capacity: 1 });
    const a = await createMember(t);
    const w = await createMember(t);
    await a.post(`/events/${ev.id}/registrations`, {}).expect(200);
    expect((await w.post(`/events/${ev.id}/registrations`, {}).expect(200)).body.status).toBe('waitlisted');
    await member.post(`/events/${ev.id}/cancel`, { reason: 'No longer needed' }).expect(403);
    const res = await staff.post(`/events/${ev.id}/cancel`, { reason: 'Venue flooded, sorry' }).expect(200);
    expect(res.body.cancelledAt).toBeTruthy();
    expect(res.body.status).toBe('published');
    expect(res.body.registrationOpen).toBe(false);
    for (const m of [a, w]) {
      expect((await m.get('/notifications').expect(200)).body.items[0].type).toBe('event_cancelled');
      const mail = await lastEmail(t.db, m.email);
      expect(mail!.template).toBe('notification.event_cancelled');
      expect(mail!.textBody).toContain('Venue flooded');
    }
    await staff.post(`/events/${ev.id}/cancel`, { reason: 'Again please' }).expect(409);
    await staff.patch(`/events/${ev.id}`, { title: 'Edited after cancel' }).expect(409);
    const late = await createMember(t);
    expect((await late.post(`/events/${ev.id}/registrations`, {}).expect(412)).body.error.code).toBe('PRECONDITION_FAILED');
    // Still listed, flagged.
    const listed = (await member.get('/events?q=To%20Be%20Cancelled').expect(200)).body.items[0];
    expect(listed.cancelledAt).toBeTruthy();
    expect(await eventually(() => count(t.db, s.analyticsEvents, and(eq(s.analyticsEvents.name, 'event_cancelled'), eq(s.analyticsEvents.subjectId, ev.id))), (n) => n === 1)).toBe(1);
  });

  it('deletes drafts only', async () => {
    const draft = (await host.post('/events', eventInput()).expect(201)).body;
    await member.delete(`/events/${draft.id}`).expect(404);
    await host.delete(`/events/${draft.id}`).expect(204);
    await host.get(`/events/${draft.id}`).expect(404);
    const ev = await publishedEvent(staff);
    await staff.delete(`/events/${ev.id}`).expect(409);
  });

  it('lists with filters, tabs, cursor and a month calendar in the viewer’s zone', async () => {
    const lagos = await chapterId(t, 'nigeria');
    const lead = await createMember(t, { roles: ['platform_admin'] });
    await grantChapterLead(t, lead.id, lagos);
    const [cat] = await t.db.select().from(s.eventCategories).where(eq(s.eventCategories.slug, 'workshop'));
    const made: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ev = await publishedEvent(
        lead,
        {
          title: `Filter Workshop ${i}`,
          format: 'in_person',
          online: null,
          venue: { name: 'Hall', city: 'Lagos', countryCode: 'NG' },
          categoryId: cat!.id,
          host: { type: 'chapter', chapterId: lagos },
        },
        20 + i,
      );
      made.push(ev.id);
    }
    const page1 = await member.get('/events?category=workshop&country=NG&chapter=lagos&format=in_person&limit=2').expect(200);
    expect(page1.body.items.map((e: { id: string }) => e.id)).toEqual(made.slice(0, 2));
    expect(page1.body.items[0].location).toMatchObject({ label: 'Lagos, Nigeria', shortLabel: 'Lagos', countryCode: 'NG' });
    const page2 = await member.get(`/events?category=workshop&country=NG&chapter=lagos&format=in_person&limit=2&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items.map((e: { id: string }) => e.id)).toEqual([made[2]]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await member.get('/events?category=nope').expect(200)).body.items).toEqual([]);
    expect((await member.get('/events?when=past&category=workshop').expect(200)).body.items).toEqual([]);

    // chapter=mine: chapters the viewer follows; mine=registered: the viewer's registrations.
    const follower = await createMember(t);
    expect((await follower.get('/events?chapter=mine&category=workshop').expect(200)).body.items).toEqual([]);
    await t.db.insert(s.follows).values({ followerId: follower.id, targetType: 'chapter', targetId: lagos });
    expect((await follower.get('/events?chapter=mine&category=workshop').expect(200)).body.items).toHaveLength(3);
    await follower.post(`/events/${made[1]}/registrations`, {}).expect(200);
    expect((await follower.get('/events?mine=registered').expect(200)).body.items.map((e: { id: string }) => e.id)).toEqual([made[1]]);
    expect((await follower.get('/me/events?role=registered').expect(200)).body.items.map((e: { id: string }) => e.id)).toEqual([made[1]]);
    expect((await lead.get('/events?mine=hosting&category=workshop').expect(200)).body.items).toHaveLength(3);

    const ev = (await member.get(`/events/${made[0]}`).expect(200)).body;
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit' }).format(new Date(ev.startsAt));
    const cal = await member.get(`/events/calendar?month=${month}&tz=Asia/Dubai&category=workshop`).expect(200);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ev.startsAt));
    expect(cal.body.days.find((d: { date: string }) => d.date === day)?.events[0].id).toBe(made[0]);
    await member.get('/events/calendar?month=2026-13').expect(422);

    const cats = await member.get('/events/categories').expect(200);
    expect(cats.body[0].name).toBe('Conference');
  });
});
