import { and, eq } from 'drizzle-orm';
import { AccountExport, OnboardingState, Taxonomies } from '@chartermission/contracts';
import { SettingsService } from '../../src/infra/settings.service.js';
import { client, count, createMember, createTestApp, lastEmail, PASSWORD, s, type TestApp } from '../helpers.js';
import { STRONG, profileOf, registerVerified, resetLimits, userByEmail } from './support.js';

describe('Account, consents and onboarding (CM-AUTH-06/07/08)', () => {
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

  it('records consents with version and timestamp, and asks for re-acceptance after a version change', async () => {
    const m = await registerVerified(t, { name: 'Adaeze Obi' });
    const list = await m.get('/me/consents').expect(200);
    expect(list.body).toHaveLength(3);
    for (const c of list.body) {
      expect(c.policyVersion).toBe('2026-11');
      expect(Number.isNaN(Date.parse(c.acceptedAt))).toBe(false);
    }

    const settings = t.app.get(SettingsService);
    const original = await settings.get('policy_versions');
    await settings.set('policy_versions', { ...original, terms: '2027-01' }, null);
    try {
      expect((await m.get('/me').expect(200)).body.needsPolicyReaccept).toBe(true);
      const accepted = await m.post('/me/consents', { accept: true }).expect(200);
      expect(accepted.body.filter((c: { policyType: string; policyVersion: string }) => c.policyType === 'terms').map((c: { policyVersion: string }) => c.policyVersion)).toEqual(['2027-01', '2026-11']);
      expect((await m.get('/me').expect(200)).body.needsPolicyReaccept).toBe(false);
      expect(await count(t.db, s.consentRecords, eq(s.consentRecords.userId, m.id))).toBe(6);
    } finally {
      await settings.set('policy_versions', original, null);
    }
  });

  it('onboarding: steps saved server-side, skippable, and resumed at step 3 after the next sign-in', async () => {
    const m = await registerVerified(t, { name: 'Yaw Asante', country: 'GH' });
    const peer = await createMember(t, { name: 'Peer In Ghana', countryCode: 'GH' });
    const blockedPeer = await createMember(t, { name: 'Blocked In Ghana', countryCode: 'GH' });
    await blockedPeer.post(`/blocks/${m.id}`).expect(201);

    // A hashtag with recent posts that is also trending, and a quieter one.
    const [post] = await t.db.insert(s.posts).values({ authorId: peer.id, body: 'Trade #AfCFTA' }).returning();
    const [tagA] = await t.db.insert(s.hashtags).values({ tag: 'afcfta', display: 'AfCFTA', postCount: 1 }).returning();
    await t.db.insert(s.hashtags).values({ tag: 'quiet', display: 'Quiet' });
    await t.db.insert(s.postHashtags).values({ postId: post!.id, hashtagId: tagA!.id });
    await t.db.insert(s.trendingSnapshots).values({
      scopeType: 'global',
      window: '24h',
      entries: [{ tag: 'afcfta', display: 'AfCFTA', posts: 1, authors: 1, velocityPct: 10, status: 'trending' }],
    });

    const start = await m.get('/me/onboarding').expect(200);
    expect(OnboardingState.parse(start.body)).toBeTruthy();
    expect(start.body.step).toBe(0);
    expect(start.body.suggestions.hashtags[0]).toEqual({ tag: 'AfCFTA', posts: 1, trending: true });
    expect(start.body.suggestions.hashtags.find((h: { tag: string }) => h.tag === 'Quiet')).toEqual({ tag: 'Quiet', posts: 0, trending: false });
    const suggested = start.body.suggestions.members;
    expect(suggested.find((x: { id: string }) => x.id === peer.id)?.reason).toBe('Also in Ghana');
    expect(suggested.find((x: { id: string }) => x.id === blockedPeer.id)).toBeUndefined();
    expect(suggested.find((x: { id: string }) => x.id === m.id)).toBeUndefined();

    const tax = (await client(t).get('/taxonomies').expect(200)).body;
    await m.put('/me/onboarding', { step: 'about', action: 'save', data: { headline: 'Supply chain lead', city: 'Kumasi' } }).expect(200);
    await m
      .put('/me/onboarding', { step: 'topics', action: 'save', data: { interestIds: [tax.interests[0].id], followedHashtags: ['AfCFTA'] } })
      .expect(200);
    const skipped = await m.put('/me/onboarding', { step: 'skills', action: 'skip' }).expect(200);
    expect(skipped.body.step).toBe(3);

    // Sign in again on another device and resume.
    const phone = client(t);
    await phone.post('/auth/login', { email: m.email, password: STRONG }).expect(200);
    const resumed = await phone.get('/me/onboarding').expect(200);
    expect(resumed.body).toMatchObject({
      step: 3,
      completed: false,
      data: { headline: 'Supply chain lead', city: 'Kumasi', countryCode: 'GH', interestIds: [tax.interests[0].id], followedHashtags: ['AfCFTA'], skillIds: [] },
    });
    expect((await phone.get('/me').expect(200)).body.onboarding).toEqual({ step: 3, completed: false });

    const bad = await phone.put('/me/onboarding', { step: 'skills', action: 'save', data: { skillIds: ['not-a-skill'] } }).expect(422);
    expect(bad.body.error.fields.skillIds).toBeTruthy();

    const done = await phone
      .put('/me/onboarding', {
        step: 'community',
        action: 'save',
        data: { followedChapterIds: [tax.chapters[0].id], followedMemberIds: [peer.id, blockedPeer.id] },
      })
      .expect(200);
    expect(done.body).toMatchObject({ step: 4, completed: true });
    expect(done.body.data.followedChapterIds).toEqual([tax.chapters[0].id]);
    // The blocked member was skipped silently.
    expect(done.body.data.followedMemberIds).toEqual([peer.id]);
    expect((await profileOf(t, m.id)).onboardingCompletedAt).not.toBeNull();
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'onboarding_completed'))).toBe(1);
  });

  it('change password keeps this session, revokes others and sends a security email', async () => {
    const m = await registerVerified(t, { name: 'Esi Mensah' });
    const other = client(t);
    await other.post('/auth/login', { email: m.email, password: STRONG }).expect(200);

    const wrong = await m.post('/me/password', { currentPassword: 'nope', newPassword: 'Kente-Window-Rocket-31' }).expect(422);
    expect(wrong.body.error.fields.currentPassword).toBeTruthy();
    await m.post('/me/password', { currentPassword: STRONG, newPassword: 'Kente-Window-Rocket-31' }).expect(200);
    await m.get('/me').expect(200);
    await other.get('/me').expect(401);
    expect((await lastEmail(t.db, m.email))?.subject).toBe('Your password was changed');
  });

  it('lists and revokes sessions', async () => {
    const m = await createMember(t, { name: 'Session Lister' });
    const laptop = client(t);
    await laptop.post('/auth/login', { email: m.email, password: PASSWORD }).expect(200);
    const list = await m.get('/me/sessions').expect(200);
    expect(list.body).toHaveLength(2);
    const current = list.body.find((x: { current: boolean }) => x.current);
    const otherSession = list.body.find((x: { current: boolean }) => !x.current);
    expect(current).toBeTruthy();
    await m.delete(`/me/sessions/${otherSession.id}`).expect(200);
    await laptop.get('/me').expect(401);
    await m.delete('/me/sessions/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('deactivate and reactivate (reversible); deactivated members are hidden and cannot act', async () => {
    const m = await createMember(t, { name: 'Deactivating Member' });
    const viewer = await createMember(t, { name: 'Viewer Member' });
    await m.post('/me/deactivate', { password: 'wrong' }).expect(422);
    await m.post('/me/deactivate', { password: PASSWORD }).expect(200);
    expect((await userByEmail(t, m.email)).deactivatedAt).not.toBeNull();
    expect((await m.get('/me').expect(200)).body.status).toBe('deactivated');
    const blocked = await m.post('/connections', { memberId: viewer.id }).expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    await viewer.get(`/members/${m.handle}`).expect(404);

    await m.post('/me/reactivate', { password: PASSWORD }).expect(200);
    expect((await m.get('/me').expect(200)).body.status).toBe('active');
    await viewer.get(`/members/${m.handle}`).expect(200);
    await m.post('/me/reactivate', { password: PASSWORD }).expect(409);
  });

  it('deletion request: queued for admins, account pending deletion, signed out everywhere', async () => {
    const m = await createMember(t, { name: 'Leaving Member' });
    const res = await m.post('/me/deletion-request', { password: PASSWORD, reason: 'Moving on' }).expect(202);
    expect(res.body).toEqual({ ok: true });
    const [row] = await t.db.select().from(s.deletionRequests).where(eq(s.deletionRequests.userId, m.id));
    expect(row).toMatchObject({ status: 'pending', reason: 'Moving on' });
    expect((await userByEmail(t, m.email)).status).toBe('deletion_pending');
    await m.get('/me').expect(401);
    expect(await count(t.db, s.sessions, and(eq(s.sessions.userId, m.id)))).toBeGreaterThan(0);
    const live = await t.db.select().from(s.sessions).where(eq(s.sessions.userId, m.id));
    expect(live.every((x) => x.revokedAt)).toBe(true);
    expect((await lastEmail(t.db, m.email))?.subject).toMatch(/deletion request/);
  });

  it('exports the member’s own data', async () => {
    const m = await createMember(t, { name: 'Exporting Member' });
    await t.db.insert(s.posts).values({ authorId: m.id, body: 'My first post' });
    const res = await m.get('/me/export').expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = AccountExport.parse(res.body);
    expect(data.account.email).toBe(m.email);
    expect(data.posts[0]!.body).toBe('My first post');
    expect(data.profile.handle).toBe(m.handle);
  });

  it('serves taxonomies publicly with cache headers', async () => {
    const res = await t.http().get('/api/v1/taxonomies').expect(200);
    expect(res.headers['cache-control']).toContain('public');
    const tax = Taxonomies.parse(res.body);
    expect(tax.countries.find((c) => c.code === 'NG')?.name).toBe('Nigeria');
    expect(tax.chapters.length).toBeGreaterThan(0);
    expect(tax.skills.length).toBeGreaterThan(0);
  });
});
