import { and, eq } from 'drizzle-orm';
import { count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { DAY, eventInput, publishedEvent, type Member } from './event-helpers.js';

describe('Events: admin review queue, unpublish and featuring', () => {
  let t: TestApp;
  let staff: Member;
  let host: Member;
  let moderator: Member;
  let admin: Member;
  beforeAll(async () => {
    t = await createTestApp();
    staff = await createMember(t, { roles: ['platform_admin'] });
    host = await createMember(t, { name: 'Queue Host', roles: ['event_host'] });
    moderator = await createMember(t, { name: 'Queue Moderator', roles: ['moderator'], admin: true });
    admin = await createMember(t, { name: 'Queue Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  const submitted = async (title: string) => {
    const ev = (await host.post('/events', eventInput({ title })).expect(201)).body;
    await host.post(`/events/${ev.id}/submit`, { note: 'Ready when you are' }).expect(200);
    return ev as { id: string; slug: string };
  };

  it('needs an admin session with event.review', async () => {
    await host.get('/admin/events').expect(403);
    await staff.get('/admin/events').expect(403); // member-audience session
    const ev = await submitted('Permission Check');
    await host.post(`/admin/events/${ev.id}/review`, { decision: 'approve' }).expect(403);
    await moderator.get('/admin/events').expect(200);
  });

  it('lists the queue oldest first with age filter and submit notes', async () => {
    const a = await submitted('Queue Old');
    const b = await submitted('Queue New');
    await t.db.update(s.events).set({ submittedAt: new Date(Date.now() - 3 * DAY) }).where(eq(s.events.id, a.id));
    const queue = await moderator.get('/admin/events?q=Queue').expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toEqual([a.id, b.id]);
    expect(queue.body.items[0]).toMatchObject({ status: 'pending_review', submitNote: 'Ready when you are', createdBy: { id: host.id } });
    const old = await moderator.get('/admin/events?q=Queue&olderThanHours=48').expect(200);
    expect(old.body.items.map((r: { id: string }) => r.id)).toEqual([a.id]);
    const newest = await moderator.get('/admin/events?q=Queue&sort=newest&limit=1').expect(200);
    expect(newest.body.items.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect(newest.body.nextCursor).toBeTruthy();
  });

  it('review decisions need notes for changes/reject, are audited and only apply to pending events', async () => {
    const ev = await submitted('Reject Me');
    const bad = await moderator.post(`/admin/events/${ev.id}/review`, { decision: 'reject' }).expect(422);
    expect(bad.body.error.fields.note).toBeTruthy();
    const res = await moderator.post(`/admin/events/${ev.id}/review`, { decision: 'reject', note: 'Not a fit for the platform' }).expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', reviewNote: 'Not a fit for the platform', reviewedBy: { id: moderator.id } });
    expect((await host.get('/notifications').expect(200)).body.items[0].type).toBe('event_review_rejected');
    expect(await count(t.db, s.auditLog, and(eq(s.auditLog.action, 'event.review.reject'), eq(s.auditLog.targetId, ev.id)))).toBe(1);
    await moderator.post(`/admin/events/${ev.id}/review`, { decision: 'approve' }).expect(409);
    // A never-published rejected event can be deleted by its host; or edited and resubmitted.
    expect((await host.get(`/events/${ev.id}`).expect(200)).body.review.note).toBe('Not a fit for the platform');
    await host.patch(`/events/${ev.id}`, { summary: 'A better summary for the reviewer.' }).expect(200);
    await host.delete(`/events/${ev.id}`).expect(204);
  });

  it('unpublish hides a published event from lists and is audited; resubmission goes back to review', async () => {
    const ev = await publishedEvent(staff, { title: 'Unpublish Me' });
    const m = await createMember(t);
    await m.post(`/events/${ev.id}/registrations`, {}).expect(200);
    await moderator.post(`/admin/events/${ev.id}/unpublish`, { reason: 'x' }).expect(422);
    const res = await moderator.post(`/admin/events/${ev.id}/unpublish`, { reason: 'Misleading description' }).expect(200);
    expect(res.body.status).toBe('unpublished');
    expect((await m.get('/events?q=Unpublish').expect(200)).body.items).toHaveLength(0);
    await m.get(`/events/${ev.id}`).expect(404);
    expect(await count(t.db, s.eventRegistrations, eq(s.eventRegistrations.eventId, ev.id))).toBe(1);
    expect(await count(t.db, s.auditLog, and(eq(s.auditLog.action, 'event.unpublish'), eq(s.auditLog.targetId, ev.id)))).toBe(1);
    await moderator.post(`/admin/events/${ev.id}/unpublish`, { reason: 'Misleading description' }).expect(409);
    // Staff resubmitting publish directly again.
    expect((await staff.post(`/events/${ev.id}/submit`, {}).expect(200)).body.status).toBe('published');
  });

  it('featuring needs event.feature, is audited and shows with featured=true', async () => {
    const ev = await publishedEvent(staff, { title: 'Feature Me' });
    await moderator.put(`/admin/events/${ev.id}/featured`, { featured: true }).expect(403);
    const res = await admin.put(`/admin/events/${ev.id}/featured`, { featured: true }).expect(200);
    expect(res.body.featured).toBe(true);
    expect(await count(t.db, s.auditLog, and(eq(s.auditLog.action, 'event.feature'), eq(s.auditLog.targetId, ev.id)))).toBe(1);
    const featured = await host.get('/events?featured=true').expect(200);
    expect(featured.body.items.map((e: { id: string }) => e.id)).toEqual([ev.id]);
    // Featured events are not lifted in the normal list (ordered by start).
    const draft = (await host.post('/events', eventInput()).expect(201)).body;
    await admin.put(`/admin/events/${draft.id}/featured`, { featured: true }).expect(409);
    await admin.put(`/admin/events/${ev.id}/featured`, { featured: false }).expect(200);
    expect((await host.get('/events?featured=true').expect(200)).body.items).toHaveLength(0);
    await admin.post('/admin/events/not-a-uuid/review', { decision: 'approve' }).expect(404);
  });
});
