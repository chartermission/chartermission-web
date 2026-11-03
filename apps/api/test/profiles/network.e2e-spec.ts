import { and, eq } from 'drizzle-orm';
import { ConnectionView, DEFAULT_FIELD_VISIBILITY, FollowView, SuggestedMember } from '@chartermission/contracts';
import { client, count, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits, setLimitCounter } from '../auth/support.js';

describe('Networking: connections, follows, mutes, suggestions (spec 4.6, CM-DSH-03)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetLimits();
  });

  it('connection lifecycle: request → accept → remove, with notifications and analytics', async () => {
    const a = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    const b = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });

    const req = await a.post('/connections', { memberId: b.id, note: 'Met at the Accra summit' }).expect(201);
    expect(ConnectionView.parse(req.body)).toMatchObject({ status: 'pending', direction: 'outgoing', note: 'Met at the Accra summit' });
    expect(req.body.member.id).toBe(b.id);

    // One open request per pair, in either direction.
    await a.post('/connections', { memberId: b.id }).expect(409);
    await b.post('/connections', { memberId: a.id }).expect(409);
    await a.post('/connections', { memberId: a.id }).expect(400);

    const incoming = await b.get('/me/connections?filter=incoming').expect(200);
    expect(incoming.body.items.map((c: { id: string; direction: string }) => [c.id, c.direction])).toEqual([[req.body.id, 'incoming']]);
    expect((await a.get('/me/connections?filter=outgoing').expect(200)).body.items).toHaveLength(1);

    const [requestNote] = await notificationsFor(t, b.id, 'connection_request');
    expect(requestNote).toMatchObject({ actorIds: [a.id], objectId: req.body.id });
    expect((requestNote!.data as { href: string }).href).toBe('/network?tab=requests');

    // Only the addressee can accept.
    await a.post(`/connections/${req.body.id}/accept`).expect(404);
    const accepted = await b.post(`/connections/${req.body.id}/accept`).expect(200);
    expect(accepted.body).toMatchObject({ status: 'accepted', direction: 'incoming' });
    await b.post(`/connections/${req.body.id}/accept`).expect(409);
    const [acceptNote] = await notificationsFor(t, a.id, 'connection_accepted');
    expect((acceptNote!.data as { href: string }).href).toBe(`/members/${b.handle}`);
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'connection_requested'))).toBe(1);
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'connection_accepted'))).toBe(1);

    const connected = await a.get('/me/connections?filter=connected').expect(200);
    expect(connected.body.items[0]).toMatchObject({ id: req.body.id, status: 'accepted', member: { id: b.id } });
    expect((await a.get(`/members/${b.handle}`).expect(200)).body.relationship).toMatchObject({ connection: 'connected', connectionId: req.body.id });

    const removed = await b.delete(`/connections/${req.body.id}`).expect(200);
    expect(removed.body.status).toBe('removed');
    expect((await a.get('/me/connections').expect(200)).body.items).toHaveLength(0);
    // After removal a new request is possible.
    await a.post('/connections', { memberId: b.id }).expect(201);
  });

  it('withdraw; decline starts a 30-day cool-off and the sender is not notified', async () => {
    const a = await createMember(t, { name: 'Sender Member' });
    const c = await createMember(t, { name: 'Decliner Member' });

    const first = await a.post('/connections', { memberId: c.id }).expect(201);
    await c.post(`/connections/${first.body.id}/withdraw`).expect(404);
    expect((await a.post(`/connections/${first.body.id}/withdraw`).expect(200)).body.status).toBe('withdrawn');

    const second = await a.post('/connections', { memberId: c.id }).expect(201);
    expect((await c.post(`/connections/${second.body.id}/decline`).expect(200)).body.status).toBe('declined');
    const blocked = await a.post('/connections', { memberId: c.id }).expect(409);
    expect(blocked.body.error.code).toBe('CONFLICT');
    expect(await notificationsFor(t, a.id)).toHaveLength(0);

    // The addressee can still reach out; the cool-off binds the sender only.
    const reverse = await c.post('/connections', { memberId: a.id }).expect(201);
    await a.post(`/connections/${reverse.body.id}/decline`).expect(200);

    await t.db
      .update(s.connections)
      .set({ respondedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(s.connections.id, second.body.id));
    await a.post('/connections', { memberId: c.id }).expect(201);
  });

  it('respects connectionRequestsFrom, restrictions and the 50/day cap', async () => {
    const a = await createMember(t, { name: 'Cap Sender' });
    const closed = await createMember(t, { name: 'Closed Member' });
    await closed.put('/me/privacy', { connectionRequestsFrom: 'nobody' }).expect(200);
    expect((await a.post('/connections', { memberId: closed.id }).expect(403)).body.error.code).toBe('FORBIDDEN');

    const target = await createMember(t, { name: 'Cap Target' });
    await setLimitCounter(`connections:day:${a.id}`, 50);
    expect((await a.post('/connections', { memberId: target.id }).expect(429)).body.error.code).toBe('RATE_LIMITED');

    const restricted = await createMember(t, { name: 'Restricted Member' });
    await t.db
      .update(s.users)
      .set({ restrictedConnectingUntil: new Date(Date.now() + 3600_000) })
      .where(eq(s.users.id, restricted.id));
    expect((await restricted.post('/connections', { memberId: target.id }).expect(403)).body.error.code).toBe('ACCOUNT_RESTRICTED');

    await a.post('/connections', { memberId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await a.post('/connections/not-a-uuid/accept').expect(404);
  });

  it('follows members, hashtags and chapters; member follows notify', async () => {
    const a = await createMember(t, { name: 'Follower Member' });
    const b = await createMember(t, { name: 'Followed Member' });
    await a.post('/follows', { targetType: 'member', targetId: b.id }).expect(201);
    await a.post('/follows', { targetType: 'member', targetId: b.handle }).expect(201); // idempotent, by handle
    expect(await notificationsFor(t, b.id, 'follow')).toHaveLength(1);
    expect((await b.get(`/members/${a.handle}`).expect(200)).body.relationship.followsYou).toBe(true);
    expect((await a.get(`/members/${b.handle}`).expect(200)).body.counts.followers).toBe(1);
    expect((await b.get(`/members/${a.handle}`).expect(200)).body.counts.followers).toBe(0);

    await a.post('/follows', { targetType: 'member', targetId: a.id }).expect(400);

    await a.post('/follows', { targetType: 'hashtag', targetId: '#CleanCooking' }).expect(201);
    const [tag] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'cleancooking'));
    expect(tag).toMatchObject({ display: 'CleanCooking', followerCount: 1 });
    await a.post('/follows', { targetType: 'hashtag', targetId: 'bad tag!' }).expect(422);
    await a.post('/follows', { targetType: 'chapter', targetId: 'lagos' }).expect(201);
    await a.post('/follows', { targetType: 'chapter', targetId: 'atlantis' }).expect(404);

    const all = await a.get('/me/follows').expect(200);
    expect(all.body.items).toHaveLength(3);
    for (const f of all.body.items) FollowView.parse(f);
    const tags = await a.get('/me/follows?type=hashtag').expect(200);
    expect(tags.body.items[0]).toMatchObject({ targetId: 'cleancooking', hashtag: { tag: 'cleancooking', display: 'CleanCooking' } });
    const page = await a.get('/me/follows?limit=2').expect(200);
    const rest = await a.get(`/me/follows?limit=2&cursor=${page.body.nextCursor}`).expect(200);
    expect(page.body.items.length + rest.body.items.length).toBe(3);

    await a.delete('/follows', { targetType: 'hashtag', targetId: 'cleancooking' }).expect(200);
    const [after] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'cleancooking'));
    expect(after!.followerCount).toBe(0);
    await a.delete('/follows', { targetType: 'member', targetId: b.id }).expect(200);
    await a.delete('/follows', { targetType: 'chapter', targetId: 'lagos' }).expect(200);
    expect((await a.get('/me/follows').expect(200)).body.items).toHaveLength(0);

    // Unverified members cannot follow (spec 6.2: verified member).
    const unverified = await createMember(t, { name: 'Unverified Follower', verified: false });
    expect((await unverified.post('/follows', { targetType: 'member', targetId: b.id }).expect(403)).body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('mutes members and hashtags', async () => {
    const a = await createMember(t, { name: 'Muting Member' });
    const b = await createMember(t, { name: 'Noisy Member' });
    await a.post('/mutes', { targetType: 'member', targetId: b.id }).expect(201);
    await a.post('/mutes', { targetType: 'hashtag', targetId: '#Crypto' }).expect(201);
    await a.post('/mutes', { targetType: 'member', targetId: a.id }).expect(400);
    const list = await a.get('/me/mutes').expect(200);
    expect(list.body.map((m: { targetType: string; targetId: string }) => [m.targetType, m.targetId]).sort()).toEqual([
      ['hashtag', 'crypto'],
      ['member', b.id],
    ]);
    expect(list.body.find((m: { targetType: string }) => m.targetType === 'member').member.id).toBe(b.id);
    // The profile relationship carries the mute, for the viewer only.
    expect((await a.get(`/members/${b.handle}`).expect(200)).body.relationship.muted).toBe(true);
    expect((await b.get(`/members/${a.handle}`).expect(200)).body.relationship.muted).toBe(false);
    await a.delete('/mutes', { targetType: 'member', targetId: b.id }).expect(200);
    expect((await a.get(`/members/${b.handle}`).expect(200)).body.relationship.muted).toBe(false);
    await a.delete('/mutes', { targetType: 'hashtag', targetId: 'crypto' }).expect(200);
    expect(await count(t.db, s.mutes, and(eq(s.mutes.userId, a.id), eq(s.mutes.targetType, 'hashtag')))).toBe(0);
  });

  it('suggestions are rule-based and labelled with their reason', async () => {
    const tax = (await client(t).get('/taxonomies')).body;
    const me = await createMember(t, { name: 'Suggestion Seeker', countryCode: 'RW' });
    const sameSector = await createMember(t, { name: 'Same Sector', countryCode: 'ZA' });
    const sameCountry = await createMember(t, { name: 'Same Country', countryCode: 'RW' });
    const hiddenSector = await createMember(t, { name: 'Hidden Sector', countryCode: 'ZA' });
    const connected = await createMember(t, { name: 'Already Connected', countryCode: 'RW' });
    await me.patch('/me/profile', { sectorIds: [tax.sectors[5].id] }).expect(200);
    await sameSector.patch('/me/profile', { sectorIds: [tax.sectors[5].id] }).expect(200);
    await hiddenSector.patch('/me/profile', { sectorIds: [tax.sectors[5].id] }).expect(200);
    await hiddenSector.put('/me/privacy', { fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY, sectors: 'only_me' } }).expect(200);
    const req = await me.post('/connections', { memberId: connected.id }).expect(201);
    await connected.post(`/connections/${req.body.id}/accept`).expect(200);

    const res = await me.get('/members/suggestions').expect(200);
    const byId = new Map(res.body.map((x: SuggestedMember) => [x.id, SuggestedMember.parse(x)]));
    expect((byId.get(sameSector.id) as SuggestedMember).reason).toBe(`Also works in ${tax.sectors[5].name}`);
    expect((byId.get(sameCountry.id) as SuggestedMember).reason).toBe('Also in Rwanda');
    expect(byId.has(hiddenSector.id)).toBe(false);
    expect(byId.has(connected.id)).toBe(false);
    expect(byId.has(me.id)).toBe(false);
  });
});
