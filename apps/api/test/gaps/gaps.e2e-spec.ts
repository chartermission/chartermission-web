import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_VISIBILITY, type AdminLeadDetail, type PeoplePage } from '@chartermission/contracts';
import { client, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { createPost } from '../social/social-helpers.js';
import { COOKIE_NAMES, SessionService } from '../../src/core/session.service.js';
import { CHAPTERS, moreDiasporaChapters, NO_CHAPTER } from '../../src/db/seed-data.js';
import { CHAPTER_PHOTOS } from '../../src/db/chapter-photos.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Team and official accounts, console sign-on, usernames, member lists, journey, trim, chapters', () => {
  let t: TestApp;
  let admin: Member;
  let amara: Member;
  let kwame: Member;
  let leila: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    amara = await createMember(t, { name: 'Amara Okafor' });
    kwame = await createMember(t, { name: 'Kwame Mensah' });
    leila = await createMember(t, { name: 'Leila Benali' });
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  describe('team members and official accounts', () => {
    it('a team member connects like anyone; an official account is follow-only', async () => {
      const staff = await createMember(t, { name: 'Team Person', mfa: true });
      await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
      const seen = await amara.get(`/members/${staff.handle}`).expect(200);
      expect(seen.body).toMatchObject({ staff: true, official: false, relationship: { canConnect: true } });
      const req = await amara.post('/connections', { memberId: staff.id }).expect(201);
      await staff.post(`/connections/${req.body.id}/accept`).expect(200);

      // Marked official in the console: the Connect option goes and the connection becomes a follow.
      const row = await admin.put(`/admin/members/${staff.id}/official`, { official: true }).expect(200);
      expect(row.body).toMatchObject({ official: true, staff: true, verified: true });
      const after = await amara.get(`/members/${staff.handle}`).expect(200);
      expect(after.body).toMatchObject({ official: true, relationship: { canConnect: false, connection: 'none', following: true } });
      await kwame.post('/connections', { memberId: staff.id }).expect(403);

      // And back: an ordinary account again.
      await admin.put(`/admin/members/${staff.id}/official`, { official: false }).expect(200);
      await kwame.post('/connections', { memberId: staff.id }).expect(201);
      await amara.put(`/admin/members/${staff.id}/official`, { official: true }).expect(403);
    });
  });

  describe('single sign-on into the admin console', () => {
    /** A browser signed in on the member site (its own cookie jar; the console has a separate one). */
    const memberSite = async (user: Member, mfaVerified: boolean) => {
      const { token } = await t.app.get(SessionService).create(user.id, 'member', { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as never, { mfaVerified });
      const c = client(t, 'member');
      c.agent.jar.setCookie(`${COOKIE_NAMES.member}=${token}; Path=/`, '127.0.0.1');
      return c;
    };
    const start = async (site: ReturnType<typeof client>) => new URL((await site.get('/auth/admin/sso/start?next=/members').expect(302)).headers.location as string);

    it('opens the console for a team member signed in on the member site, without the password', async () => {
      const person = await createMember(t, { name: 'Console Person', roles: ['moderator'] });
      const to = await start(await memberSite(person, true));
      expect(to.origin + to.pathname).toBe('http://localhost:3001/sso');
      expect(to.searchParams.get('next')).toBe('/members');
      const code = to.searchParams.get('code')!;

      const consoleBrowser = client(t, 'admin');
      await consoleBrowser.get('/admin/queues').expect(401);
      expect((await consoleBrowser.post('/auth/admin/sso', { code }).expect(200)).body).toEqual({ status: 'ok' });
      await consoleBrowser.get('/admin/queues').expect(200);
      expect((await consoleBrowser.get('/me').expect(200)).body).toMatchObject({ name: 'Console Person', sessionAudience: 'admin', mfa: { verifiedThisSession: true } });
      // The code works once.
      await client(t, 'admin').post('/auth/admin/sso', { code }).expect(403);
      // The member site learns where the console is, for the account menu link.
      expect((await person.get('/me').expect(200)).body.adminConsoleUrl).toBe('http://localhost:3001');
    });

    it('still asks for the authenticator code when it was not entered recently on the member site', async () => {
      const person = await createMember(t, { name: 'Code Needed', roles: ['moderator'] });
      const site = await memberSite(person, true);
      await t.db.update(s.sessions).set({ mfaVerifiedAt: new Date(Date.now() - 45 * 60_000) }).where(eq(s.sessions.userId, person.id));
      const code = (await start(site)).searchParams.get('code')!;
      const consoleBrowser = client(t, 'admin');
      expect((await consoleBrowser.post('/auth/admin/sso', { code }).expect(200)).body).toEqual({ status: 'mfa_required' });
      await consoleBrowser.get('/admin/queues').expect(403);
    });

    it('sends everyone else to the ordinary sign-in form', async () => {
      const ordinary = await start(await memberSite(amara, false));
      expect(ordinary.pathname).toBe('/signin');
      expect(ordinary.searchParams.get('sso')).toBe('unavailable');
      expect(ordinary.searchParams.get('code')).toBeNull();
      expect((await start(client(t, 'member'))).pathname).toBe('/signin');
      await client(t, 'admin').post('/auth/admin/sso', { code: 'x'.repeat(43) }).expect(403);
      expect((await amara.get('/me').expect(200)).body.adminConsoleUrl).toBeNull();
    });
  });

  describe('changing a username', () => {
    it('changes it, keeps the old address working, holds the old name and limits how often', async () => {
      const zara = await createMember(t, { name: 'Zara Old', handle: 'zara-old' });
      expect((await zara.get('/me/handle-availability?handle=zara-new').expect(200)).body).toMatchObject({ available: true });
      expect((await zara.get(`/me/handle-availability?handle=${amara.handle}`).expect(200)).body).toMatchObject({ available: false });
      await zara.get('/me/handle-availability?handle=No Spaces!').expect(422);

      const own = await zara.patch('/me/profile', { handle: 'zara-new' }).expect(200);
      expect(own.body.handle).toBe('zara-new');
      expect(own.body.handleChangeAvailableAt).toBeTruthy();
      // The old address answers with the profile under its new name (the web app redirects).
      expect((await amara.get('/members/zara-old').expect(200)).body.handle).toBe('zara-new');
      // Nobody else can take the old name; she can't change again straight away.
      expect((await kwame.get('/me/handle-availability?handle=zara-old').expect(200)).body.available).toBe(false);
      await kwame.patch('/me/profile', { handle: 'zara-old' }).expect(422);
      const again = await zara.patch('/me/profile', { handle: 'zara-third' }).expect(422);
      expect(again.body.error.fields.handle).toMatch(/recently/);

      // After the waiting period she may go back to her own old name.
      await t.db.update(s.memberProfiles).set({ handleChangedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(s.memberProfiles.userId, zara.id));
      expect((await zara.patch('/me/profile', { handle: 'zara-old' }).expect(200)).body.handle).toBe('zara-old');
      expect((await amara.get('/members/zara-new').expect(200)).body.handle).toBe('zara-old');
    });
  });

  describe('member lists behind the counts', () => {
    it('lists who reacted, commented and reposted, newest first, without blocked members', async () => {
      const post = await createPost(amara, 'Who is building in agritech?');
      await kwame.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'like' }).expect(200);
      await leila.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'insightful' }).expect(200);
      const comment = await kwame.post(`/posts/${post.id}/comments`, { body: 'We are, in Accra.' }).expect(201);
      await kwame.post(`/posts/${post.id}/comments`, { body: 'Happy to share notes.' }).expect(201);
      await leila.put('/reactions', { targetType: 'comment', targetId: comment.body.id, kind: 'support' }).expect(200);

      const all = (await amara.get(`/posts/${post.id}/reactions`).expect(200)).body as PeoplePage;
      expect(all).toMatchObject({ total: 2, byReaction: { like: 1, insightful: 1, support: 0 } });
      expect(all.items.map((p) => [p.name, p.reaction])).toEqual([
        ['Leila Benali', 'insightful'],
        ['Kwame Mensah', 'like'],
      ]);
      expect(all.items[0]!.relationship).toMatchObject({ self: false, canConnect: true });
      const likes = (await amara.get(`/posts/${post.id}/reactions?kind=like`).expect(200)).body as PeoplePage;
      expect(likes.items.map((p) => p.name)).toEqual(['Kwame Mensah']);

      const commenters = (await amara.get(`/posts/${post.id}/commenters`).expect(200)).body as PeoplePage;
      expect(commenters).toMatchObject({ total: 1 });
      expect(commenters.items.map((p) => p.name)).toEqual(['Kwame Mensah']);
      const onComment = (await amara.get(`/comments/${comment.body.id}/reactions`).expect(200)).body as PeoplePage;
      expect(onComment.items.map((p) => [p.name, p.reaction])).toEqual([['Leila Benali', 'support']]);

      // Someone the viewer blocked is left out of the list and its counts.
      await amara.post(`/blocks/${leila.id}`).expect(201);
      const filtered = (await amara.get(`/posts/${post.id}/reactions`).expect(200)).body as PeoplePage;
      expect(filtered.items.map((p) => p.name)).toEqual(['Kwame Mensah']);
      expect(filtered.total).toBe(1);
      await amara.delete(`/blocks/${leila.id}`).expect(200);

      // Signed-out visitors don't get member lists.
      await t.http().get(`/api/v1/posts/${post.id}/reactions`).expect(401);
    });

    it("lists a member's connections, followers and following, unless they keep them private", async () => {
      const hub = await createMember(t, { name: 'Hub Person' });
      const friend = await createMember(t, { name: 'Friend One' });
      const fan = await createMember(t, { name: 'Fan Two' });
      const req = await friend.post('/connections', { memberId: hub.id }).expect(201);
      await hub.post(`/connections/${req.body.id}/accept`).expect(200);
      await fan.post('/follows', { targetType: 'member', targetId: hub.id }).expect(201);
      await hub.post('/follows', { targetType: 'member', targetId: fan.id }).expect(201);

      const privacy = (network: string) => ({ profileVisibility: 'members', fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY, network }, discoverable: true, findableByEmail: false, connectionRequestsFrom: 'members' });
      const names = async (who: Member, list: string) => ((await who.get(`/members/${hub.handle}/${list}`).expect(200)).body as PeoplePage).items.map((p) => p.name);
      expect(await names(amara, 'connections')).toEqual(['Friend One']);
      expect(await names(amara, 'followers')).toContain('Fan Two');
      expect(await names(amara, 'following')).toEqual(['Fan Two']);

      // "Connections and followers: Only me" in privacy settings.
      await hub.put('/me/privacy', privacy('only_me')).expect(200);
      const refused = await amara.get(`/members/${hub.handle}/connections`).expect(403);
      expect(refused.body.error.message).toMatch(/keeps this list private/);
      expect(await names(hub, 'connections')).toEqual(['Friend One']);
      // "Connections": a connection may look, others may not.
      await hub.put('/me/privacy', privacy('connections')).expect(200);
      expect(await names(friend, 'followers')).toContain('Fan Two');
      await amara.get(`/members/${hub.handle}/followers`).expect(403);
    });
  });

  describe('ambassador journey', () => {
    it('records each stage as completed or waived, and reopens stages when going back', async () => {
      const manager = await createMember(t, { name: 'Amb Manager', roles: ['ambassador_manager'], admin: true });
      const created = (await manager.post('/admin/ambassadors/leads', { fullName: 'Journey Lead', email: 'journey.lead@example.test', countryCode: 'GH', source: 'outreach' }).expect(201)).body as AdminLeadDetail;
      const base = `/admin/ambassadors/leads/${created.id}`;
      const STAGE_OK = 200;
      const states = (d: AdminLeadDetail) => Object.fromEntries(d.journey.map((j) => [j.stage, j.state]));
      expect(states(created)).toMatchObject({ new: 'current', screening: 'upcoming', onboarding: 'upcoming' });

      let d = (await manager.post(`${base}/stage`, { stage: 'screening' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(states(d)).toMatchObject({ new: 'done', screening: 'current' });
      // Waive screening with a reason.
      d = (await manager.post(`${base}/stage`, { stage: 'review', waive: true, note: 'Known to the team' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(d.journey.find((j) => j.stage === 'screening')).toMatchObject({ state: 'waived', note: 'Known to the team', by: { name: 'Amb Manager' } });
      // Skip ahead: the stage left is completed, the ones jumped over are waived.
      d = (await manager.post(`${base}/stage`, { stage: 'decision', note: 'Fast track' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(states(d)).toMatchObject({ review: 'done', interview: 'waived', references: 'waived', decision: 'current' });
      // Go back to interview: it and everything after it reopen; earlier records stay.
      d = (await manager.post(`${base}/stage`, { stage: 'interview' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(states(d)).toMatchObject({ new: 'done', screening: 'waived', review: 'done', interview: 'current', references: 'upcoming', decision: 'upcoming' });
      expect(d.activity[0]!.body).toMatch(/^Sent back from Panel decision to Interview/);
      // Closing keeps the record; reopening resumes where chosen.
      d = (await manager.post(`${base}/stage`, { stage: 'talent_pool' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(states(d)).toMatchObject({ review: 'done', interview: 'upcoming' });
      d = (await manager.post(`${base}/stage`, { stage: 'interview' }).expect(STAGE_OK)).body as AdminLeadDetail;
      expect(states(d).interview).toBe('current');
    });
  });

  describe('video trim', () => {
    it('keeps the chosen part with the upload, for videos only', async () => {
      const video = await amara.post('/uploads', { purpose: 'post_video', fileName: 'clip.mp4', mime: 'video/mp4', sizeBytes: 5_000_000, trim: { startMs: 6250, endMs: 16250 } }).expect(201);
      const [row] = await t.db.select().from(s.files).where(eq(s.files.id, video.body.fileId));
      expect(row).toMatchObject({ trimStartMs: 6250, trimEndMs: 16250 });
      const image = await amara.post('/uploads', { purpose: 'post_image', fileName: 'a.png', mime: 'image/png', sizeBytes: 1000, trim: { startMs: 0, endMs: 5000 } }).expect(201);
      const [img] = await t.db.select().from(s.files).where(eq(s.files.id, image.body.fileId));
      expect(img).toMatchObject({ trimStartMs: null, trimEndMs: null });
      await amara.post('/uploads', { purpose: 'post_video', fileName: 'clip.mp4', mime: 'video/mp4', sizeBytes: 5_000_000, trim: { startMs: 100, endMs: 600 } }).expect(422);
    });
  });

  describe('chapters', () => {
    it('has a diaspora chapter for every other country, each with a hashtag, About text and (mostly) a landmark photo', async () => {
      const chapters = await t.db.select().from(s.chapters);
      const more = moreDiasporaChapters();
      expect(chapters.length).toBe(CHAPTERS.length + more.length);
      expect(more.length).toBeGreaterThan(150);
      const by = (code: string) => chapters.find((c) => c.countryCode === code)!;
      expect(by('IN')).toMatchObject({ slug: 'india', name: 'India Diaspora Chapter', hashtag: 'IndiaDiaspora', status: 'active' });
      expect(by('PK')).toMatchObject({ slug: 'pakistan', name: 'Pakistan Diaspora Chapter', hashtag: 'PakistanDiaspora' });
      expect(by('PK').about).toMatch(/^The Pakistan Diaspora Chapter brings together members of the African diaspora in Pakistan/);
      expect(by('PH').about).toContain('in the Philippines');
      expect(chapters.some((c) => NO_CHAPTER.has(c.countryCode))).toBe(false);
      expect(new Set(chapters.map((c) => c.slug)).size).toBe(chapters.length);
      expect(new Set(chapters.map((c) => c.hashtag!.toLowerCase())).size).toBe(chapters.length);

      // Photos: an Unsplash image address with the photographer, for every chapter that has one listed.
      const withPhoto = chapters.filter((c) => c.photoUrl);
      expect(withPhoto.length).toBe(chapters.filter((c) => CHAPTER_PHOTOS[c.countryCode]).length);
      expect(withPhoto.length).toBeGreaterThan(220);
      expect(by('NG')).toMatchObject({ photoUrl: CHAPTER_PHOTOS.NG!.url, photoCredit: CHAPTER_PHOTOS.NG!.credit });
      expect(withPhoto.every((c) => /^https:\/\/images\.unsplash\.com\/photo-[\w-]+$/.test(c.photoUrl!) && !!c.photoCredit && /^https:\/\/unsplash\.com\/@/.test(c.photoCreditUrl!))).toBe(true);
      const detail = await amara.get('/chapters/india').expect(200);
      expect(detail.body.photo).toMatchObject({ url: CHAPTER_PHOTOS.IN!.url, credit: CHAPTER_PHOTOS.IN!.credit });

      // An admin can swap or remove a chapter's photo.
      const row = await admin.patch(`/admin/chapters/${by('IN').id}`, { photoUrl: null, photoCredit: null, photoCreditUrl: null }).expect(200);
      expect(row.body.photoUrl).toBeNull();
      await admin.patch(`/admin/chapters/${by('IN').id}`, { photoUrl: 'http://insecure.example/x.jpg' }).expect(422);
    });
  });
});
