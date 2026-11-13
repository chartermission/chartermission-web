import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { DAY, insertEvent, publishedEvent, type Member } from './event-helpers.js';

describe('Events: sharing an event to the feed', () => {
  let t: TestApp;
  let staff: Member;
  beforeAll(async () => {
    t = await createTestApp();
    staff = await createMember(t, { name: 'Staff Publisher', roles: ['platform_admin'] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('a member shares an event with a comment; followers see the live event card with their own registration', async () => {
    const ev = await publishedEvent(staff, { title: 'Lagos Founders Meetup' });
    const sharer = await createMember(t);
    const reader = await createMember(t);

    const res = await sharer.post('/posts', { body: 'Who’s coming? https://example.com/agenda', eventId: ev.id }).expect(201);
    expect(res.body).toMatchObject({ isEventShare: true, linkPreview: null, event: { id: ev.id, title: 'Lagos Founders Meetup', viewer: { status: null } } });
    const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, res.body.id));
    expect(row!.eventId).toBe(ev.id);
    expect(row!.linkUrl).toBeNull();

    // A share with no comment is allowed, like a plain repost.
    await sharer.post('/posts', { body: '', eventId: ev.id }).expect(201);

    await reader.post(`/events/${ev.id}/registrations`, {}).expect(200);
    const seen = await reader.get(`/posts/${res.body.id}`).expect(200);
    expect(seen.body.event).toMatchObject({ registeredCount: 1, viewer: { status: 'registered' } });

    const analytics = await t.db.select().from(s.analyticsEvents).where(eq(s.analyticsEvents.name, 'event_shared'));
    expect(analytics.map((a) => a.subjectId)).toContain(ev.id);
  });

  it('refuses events that are not shareable and mixes with other content', async () => {
    const sharer = await createMember(t);
    const ev = await publishedEvent(staff, { title: 'Mixing Rules' });
    const ended = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() - 2 * DAY) });
    const draft = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() + 5 * DAY), status: 'draft' });
    const cancelled = await insertEvent(t, staff.id, { startsAt: new Date(Date.now() + 5 * DAY) });
    await t.db.update(s.events).set({ cancelledAt: new Date() }).where(eq(s.events.id, cancelled.id));

    expect((await sharer.post('/posts', { body: '', eventId: ended.id }).expect(422)).body.error.fields.eventId).toBe('This event has ended');
    expect((await sharer.post('/posts', { body: '', eventId: cancelled.id }).expect(422)).body.error.fields.eventId).toBe('This event was cancelled');
    await sharer.post('/posts', { body: '', eventId: draft.id }).expect(404);
    await sharer.post('/posts', { body: 'Q about this event?', type: 'question', eventId: ev.id }).expect(422);
    await sharer
      .post('/posts', { body: 'Vote', eventId: ev.id, poll: { question: 'Coming?', options: ['Yes', 'No'] } })
      .expect(422);
  });

  it('the card says the event is gone once it is unpublished', async () => {
    const ev = await publishedEvent(staff, { title: 'Soon Gone' });
    const sharer = await createMember(t);
    const post = (await sharer.post('/posts', { body: 'Join us', eventId: ev.id }).expect(201)).body;
    await t.db.update(s.events).set({ status: 'unpublished' }).where(eq(s.events.id, ev.id));
    const seen = await sharer.get(`/posts/${post.id}`).expect(200);
    expect(seen.body).toMatchObject({ isEventShare: true, event: null });
  });
});
