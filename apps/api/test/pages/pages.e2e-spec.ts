import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PageDetail, PostAnalytics, PostView, PublicOverview, VerificationStatus } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { notificationsFor, resetLimits } from '../auth/support.js';
import { createPost } from '../social/social-helpers.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { closeStaffConnections } from '../../src/profiles/staff-connections.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const PAGE = { name: 'Lagos AgriHub', category: 'company', tagline: 'Cold storage for smallholders', about: 'We run shared cold rooms.', website: 'https://agrihub.example' };

describe('Official accounts, pages, verification and post analytics', () => {
  let t: TestApp;
  let admin: Member;
  let amara: Member;
  let kwame: Member;
  let leila: Member;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    amara = await createMember(t, { name: 'Amara Okafor', countryCode: 'NG' });
    kwame = await createMember(t, { name: 'Kwame Mensah', countryCode: 'GH' });
    leila = await createMember(t, { name: 'Leila Benali', countryCode: 'MA' });
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  const setPolicy = async (memberCreation: 'open' | 'review' | 'closed') => {
    await t.app.get(SettingsService).set('pages', { memberCreation, maxPagesPerMember: 5 }, null);
  };

  describe('official (staff) accounts are follow-only', () => {
    it('refuses connection requests to and from a staff account, and says so in the relationship', async () => {
      const official = await createMember(t, { name: 'Charter Mission', mfa: true });
      await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, official.id));

      const to = await amara.post('/connections', { memberId: official.id }).expect(403);
      expect(to.body.error.message).toMatch(/official Charter Mission account/i);
      await official.post('/connections', { memberId: amara.id }).expect(403);

      const profile = await amara.get(`/members/${official.handle}`).expect(200);
      expect(profile.body).toMatchObject({ staff: true, relationship: { canConnect: false, connection: 'none' } });
      // Between two ordinary members connecting is still offered.
      expect((await amara.get(`/members/${kwame.handle}`).expect(200)).body.relationship.canConnect).toBe(true);
      // Seen from the official account, nobody can be connected with either.
      expect((await official.get(`/members/${amara.handle}`).expect(200)).body.relationship.canConnect).toBe(false);

      // Following works as before.
      await amara.post('/follows', { targetType: 'member', targetId: official.id }).expect(201);
      expect((await amara.get(`/members/${official.handle}`).expect(200)).body.relationship.following).toBe(true);
    });

    it('turns existing connections into follows when an account becomes official', async () => {
      const soon = await createMember(t, { name: 'Soon Official' });
      const friend = await createMember(t, { name: 'Old Friend' });
      const asker = await createMember(t, { name: 'Asker' });
      const req = await friend.post('/connections', { memberId: soon.id }).expect(201);
      await soon.post(`/connections/${req.body.id}/accept`).expect(200);
      await asker.post('/connections', { memberId: soon.id }).expect(201);

      await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, soon.id));
      await closeStaffConnections(t.db, soon.id);

      const open = await t.db
        .select({ status: s.connections.status })
        .from(s.connections)
        .where(eq(s.connections.addresseeId, soon.id));
      expect(open.map((c) => c.status).sort()).toEqual(['removed', 'withdrawn']);
      const followers = await t.db
        .select({ id: s.follows.followerId })
        .from(s.follows)
        .where(and(eq(s.follows.targetType, 'member'), eq(s.follows.targetId, soon.id)));
      expect(followers.map((f) => f.id).sort()).toEqual([friend.id, asker.id].sort());
    });
  });

  describe('pages', () => {
    it('a member-created page waits for review, then goes live and can post to its followers', async () => {
      await setPolicy('review');
      const created = await amara.post('/pages', PAGE).expect(201);
      const page = PageDetail.parse(created.body);
      expect(page).toMatchObject({ slug: 'lagos-agrihub', status: 'pending', viewer: { role: 'owner', canEdit: true, canPost: false } });

      // Not visible to other members, and it can't post yet.
      await kwame.get('/pages/lagos-agrihub').expect(404);
      expect((await kwame.get('/pages').expect(200)).body.items).toHaveLength(0);
      await amara.post('/posts', { body: 'Hello from the hub', pageId: page.id }).expect(403);
      await kwame.post('/follows', { targetType: 'page', targetId: page.id }).expect(404);

      // Members can't use the admin routes; the admin sees it first in the queue.
      await amara.get('/admin/pages').expect(403);
      const queue = await admin.get('/admin/pages?status=pending').expect(200);
      expect(queue.body.items.map((p: { slug: string }) => p.slug)).toEqual(['lagos-agrihub']);
      expect(queue.body.items[0].owner).toMatchObject({ id: amara.id, email: amara.email });
      expect((await admin.get('/admin/queues').expect(200)).body).toMatchObject({ pages: 1 });

      // Rejecting needs a note; the owner is told, edits, and the page goes back for review.
      await admin.post(`/admin/pages/${page.id}/status`, { action: 'reject' }).expect(422);
      await admin.post(`/admin/pages/${page.id}/status`, { action: 'reject', note: 'Add your website' }).expect(200);
      const [rejected] = await notificationsFor(t, amara.id, 'page_rejected');
      expect(JSON.stringify(rejected!.data)).toContain('Add your website');
      expect((await amara.get('/pages/lagos-agrihub').expect(200)).body).toMatchObject({ status: 'rejected', reviewNote: 'Add your website' });
      expect((await amara.patch('/pages/lagos-agrihub', { website: 'https://lagosagrihub.example' }).expect(200)).body.status).toBe('pending');

      await admin.post(`/admin/pages/${page.id}/status`, { action: 'approve' }).expect(200);
      expect(await notificationsFor(t, amara.id, 'page_approved')).toHaveLength(1);
      expect((await kwame.get('/pages/lagos-agrihub').expect(200)).body).toMatchObject({ status: 'active', viewer: { role: null, canEdit: false } });

      // Kwame follows the page; Leila doesn't.
      await kwame.post('/follows', { targetType: 'page', targetId: 'lagos-agrihub' }).expect(201);
      expect((await kwame.get('/pages?following=true').expect(200)).body.items[0]).toMatchObject({ slug: 'lagos-agrihub', following: true, followers: 1 });
      expect((await kwame.get('/me/follows?type=page').expect(200)).body.items[0].page).toMatchObject({ slug: 'lagos-agrihub' });

      const post = PostView.parse((await amara.post('/posts', { body: 'Our third cold room opens next month #ColdChain', pageId: page.id }).expect(201)).body);
      // Shown as the page; the admin who wrote it is not exposed.
      expect(post.page).toMatchObject({ slug: 'lagos-agrihub', name: 'Lagos AgriHub' });
      expect(post.author).toMatchObject({ id: page.id, handle: 'lagos-agrihub', name: 'Lagos AgriHub' });
      expect(JSON.stringify(post)).not.toContain(amara.id);
      expect(post.viewer).toMatchObject({ canEdit: true, canDelete: true, canViewAnalytics: true });

      const following = await kwame.get('/feed?tab=following').expect(200);
      expect(following.body.items.map((p: { id: string }) => p.id)).toContain(post.id);
      expect((await leila.get('/feed?tab=following').expect(200)).body.items.map((p: { id: string }) => p.id)).not.toContain(post.id);
      const seen = (await kwame.get(`/posts/${post.id}`).expect(200)).body;
      expect(seen.viewer).toMatchObject({ canEdit: false, canDelete: false, canViewAnalytics: false });

      // The page's Posts tab lists it; Amara's own profile does not.
      expect((await kwame.get('/feed?page=lagos-agrihub').expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
      expect((await kwame.get(`/feed?author=${amara.handle}`).expect(200)).body.items).toHaveLength(0);
      expect((await kwame.get(`/members/${amara.handle}`).expect(200)).body.counts.posts).toBe(0);

      // Page posts can't be announcements, chapter posts or reposts.
      await amara.post('/posts', { body: 'x'.repeat(20), pageId: page.id, repostOfId: post.id }).expect(422);
      // Someone who doesn't manage the page can't post as it.
      await kwame.post('/posts', { body: 'Not mine to post', pageId: page.id }).expect(403);
    });

    it('owners add and remove admins; any admin can edit and post, and manage the page’s posts', async () => {
      const page = (await amara.get('/pages/lagos-agrihub').expect(200)).body as PageDetail;
      await kwame.post('/pages/lagos-agrihub/admins', { handle: leila.handle }).expect(403);
      await amara.post('/pages/lagos-agrihub/admins', { handle: 'nobody-here' }).expect(422);
      const admins = await amara.post('/pages/lagos-agrihub/admins', { handle: `@${leila.handle}` }).expect(200);
      expect(admins.body.map((a: { member: { id: string }; role: string }) => [a.member.id, a.role])).toEqual([
        [amara.id, 'owner'],
        [leila.id, 'admin'],
      ]);
      await amara.post('/pages/lagos-agrihub/admins', { handle: leila.handle }).expect(409);
      expect(await notificationsFor(t, leila.id, 'page_admin_added')).toHaveLength(1);
      expect((await leila.get('/me/pages').expect(200)).body).toMatchObject([{ slug: 'lagos-agrihub', role: 'admin' }]);

      // The new admin edits the page and the owner's page post.
      await leila.patch('/pages/lagos-agrihub', { tagline: 'Cold rooms, booked by the crate' }).expect(200);
      const [existing] = (await leila.get('/feed?page=lagos-agrihub').expect(200)).body.items as PostView[];
      expect(existing!.viewer).toMatchObject({ canEdit: true, canDelete: true });
      await leila.patch(`/posts/${existing!.id}`, { body: 'Our third cold room opens in Ikorodu next month #ColdChain' }).expect(200);
      await kwame.patch(`/posts/${existing!.id}`, { body: 'Hijacked' }).expect(403);

      // Admins can leave; only the owner removes others or deletes the page; the owner can't be removed.
      await leila.delete(`/pages/lagos-agrihub/admins/${amara.id}`).expect(403);
      await amara.delete(`/pages/lagos-agrihub/admins/${amara.id}`).expect(409);
      await leila.delete('/pages/lagos-agrihub').expect(403);
      await leila.delete(`/pages/lagos-agrihub/admins/${leila.id}`).expect(200);
      await leila.patch('/pages/lagos-agrihub', { tagline: 'No longer mine' }).expect(403);
      expect(page.viewer.canManageAdmins).toBe(true);
    });

    it('follows the creation policy: open goes live at once, closed is for staff only', async () => {
      await setPolicy('open');
      const live = await kwame.post('/pages', { name: 'PayBridge', category: 'company' }).expect(201);
      expect(live.body.status).toBe('active');
      // Same name again gets its own address.
      expect((await kwame.post('/pages', { name: 'PayBridge', category: 'company' }).expect(201)).body.slug).toBe('paybridge-2');
      await kwame.post('/pages', { name: 'Taken', slug: 'paybridge', category: 'company' }).expect(422);
      await kwame.post('/pages', { name: 'Reserved', slug: 'new', category: 'company' }).expect(422);

      await setPolicy('closed');
      await kwame.post('/pages', { name: 'Not allowed', category: 'community' }).expect(403);
      await setPolicy('review');
    });

    it('admins create official pages for a member, verify, suspend and remove them', async () => {
      const created = await admin
        .post('/admin/pages', { name: 'Charter Mission', slug: 'charter-mission-news', category: 'organisation', owner: leila.email, official: true, verified: true })
        .expect(201);
      expect(created.body).toMatchObject({ status: 'active', official: true, verified: true, owner: { id: leila.id }, admins: 1 });
      expect((await kwame.get('/pages').expect(200)).body.items[0]).toMatchObject({ slug: 'charter-mission-news', official: true, verified: true });
      expect((await leila.get('/pages/charter-mission-news').expect(200)).body.viewer).toMatchObject({ role: 'owner', canPost: true });
      await admin.post('/admin/pages', { name: 'No Owner', category: 'community', owner: 'ghost@example.test' }).expect(422);

      const post = await createPost(leila, 'Chapters are open for every country', { pageId: created.body.id });
      await kwame.post('/follows', { targetType: 'page', targetId: created.body.id }).expect(201);

      // Suspended: hidden from members, its posts leave feeds, and it can't post; the owner still sees why.
      await admin.post(`/admin/pages/${created.body.id}/status`, { action: 'suspend', note: 'Impersonation report' }).expect(200);
      await kwame.get('/pages/charter-mission-news').expect(404);
      await kwame.get(`/posts/${post.id}`).expect(404);
      expect((await kwame.get('/feed?tab=following').expect(200)).body.items.map((p: { id: string }) => p.id)).not.toContain(post.id);
      expect((await leila.get('/pages/charter-mission-news').expect(200)).body).toMatchObject({ status: 'suspended', reviewNote: 'Impersonation report' });
      await leila.post('/posts', { body: 'Still here?', pageId: created.body.id }).expect(403);
      await admin.post(`/admin/pages/${created.body.id}/status`, { action: 'approve' }).expect(409);
      await admin.post(`/admin/pages/${created.body.id}/status`, { action: 'restore' }).expect(200);
      await kwame.get(`/posts/${post.id}`).expect(200);

      await admin.patch(`/admin/pages/${created.body.id}`, { verified: false, owner: kwame.handle }).expect(200);
      expect((await kwame.get('/pages/charter-mission-news').expect(200)).body).toMatchObject({ verified: false, viewer: { role: 'owner' } });

      await admin.delete(`/admin/pages/${created.body.id}`).expect(200);
      await kwame.get('/pages/charter-mission-news').expect(404);
      await kwame.get(`/posts/${post.id}`).expect(404);

      // Moderators don't hold pages.manage.
      const mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
      await mod.get('/admin/pages').expect(403);
      expect((await admin.put('/admin/settings/pages', { memberCreation: 'open', maxPagesPerMember: 3 }).expect(200)).body.memberCreation).toBe('open');
      expect((await kwame.get('/pages/settings').expect(200)).body).toEqual({ memberCreation: 'open', maxPagesPerMember: 3 });
      await setPolicy('review');
    });
  });

  describe('verification requests', () => {
    const APPLICATION = {
      category: 'individual',
      legalName: 'Amara Ngozi Okafor',
      statement: 'I run Lagos AgriHub and speak for it publicly; members ask whether this account is really mine.',
      links: ['https://agrihub.example/team'],
    };

    it('members apply once their profile is ready; staff approve or decline with a note', async () => {
      const before = VerificationStatus.parse((await amara.get('/me/verification').expect(200)).body);
      expect(before).toMatchObject({ verified: false, eligible: false, request: null });
      expect(before.requirements.filter((r) => !r.met).map((r) => r.key)).toEqual(['photo', 'headline']);
      await amara.post('/me/verification', APPLICATION).expect(409);

      await t.db
        .update(s.memberProfiles)
        .set({ headline: 'Founder, Lagos AgriHub', bio: 'Agronomist turned founder.', avatarFileId: '00000000-0000-4000-8000-000000000001' })
        .where(eq(s.memberProfiles.userId, amara.id));
      await amara.post('/me/verification', { ...APPLICATION, links: [] }).expect(422);
      const applied = await amara.post('/me/verification', APPLICATION).expect(200);
      expect(applied.body).toMatchObject({ eligible: true, request: { status: 'pending', legalName: 'Amara Ngozi Okafor' } });
      await amara.post('/me/verification', APPLICATION).expect(409);

      await amara.get('/admin/verification').expect(403);
      const queue = await admin.get('/admin/verification').expect(200);
      expect(queue.body.items).toHaveLength(1);
      expect(queue.body.items[0]).toMatchObject({ subjectType: 'member', applicant: { id: amara.id, email: amara.email }, page: null, facts: { twoStep: false } });
      const id = queue.body.items[0].id as string;

      await admin.post(`/admin/verification/${id}/decision`, { decision: 'decline' }).expect(422);
      await admin.post(`/admin/verification/${id}/decision`, { decision: 'decline', note: 'The link doesn’t show your name' }).expect(200);
      await admin.post(`/admin/verification/${id}/decision`, { decision: 'approve' }).expect(409);
      const [declined] = await notificationsFor(t, amara.id, 'verification_declined');
      expect(JSON.stringify(declined!.data)).toContain('The link doesn’t show your name');
      const after = (await amara.get('/me/verification').expect(200)).body;
      expect(after).toMatchObject({ verified: false, request: { status: 'declined', decisionNote: 'The link doesn’t show your name' } });
      expect(after.canApplyAt).toBeTruthy();
      await amara.post('/me/verification', APPLICATION).expect(409);

      // After the cool-off they apply again and are approved: the tick is on everywhere.
      await t.db.update(s.verificationRequests).set({ decidedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(s.verificationRequests.id, id));
      await amara.post('/me/verification', APPLICATION).expect(200);
      const [next] = (await admin.get('/admin/verification').expect(200)).body.items;
      await admin.post(`/admin/verification/${next.id}/decision`, { decision: 'approve' }).expect(200);
      expect((await kwame.get(`/members/${amara.handle}`).expect(200)).body.verified).toBe(true);
      expect((await amara.get('/me/verification').expect(200)).body).toMatchObject({ verified: true, request: { status: 'approved' } });
      expect(await notificationsFor(t, amara.id, 'verification_approved')).toHaveLength(1);
      expect((await admin.get('/admin/verification?status=all').expect(200)).body.items).toHaveLength(2);
    });

    it('page admins apply for the page; a pending request can be withdrawn', async () => {
      const status = (await amara.get('/pages/lagos-agrihub/verification').expect(200)).body;
      expect(status.requirements.filter((r: { met: boolean }) => !r.met).map((r: { key: string }) => r.key)).toEqual(['logo']);
      await kwame.get('/pages/lagos-agrihub/verification').expect(403);
      const page = await t.db.select().from(s.pages).where(eq(s.pages.slug, 'lagos-agrihub'));
      await t.db.update(s.pages).set({ logoFileId: '00000000-0000-4000-8000-000000000002' }).where(eq(s.pages.id, page[0]!.id));

      const application = { category: 'organisation', legalName: 'Lagos AgriHub Ltd', statement: 'Registered in Lagos State; this page is run by the founding team and is our only official presence here.', links: ['https://agrihub.example'] };
      await amara.post('/pages/lagos-agrihub/verification', application).expect(200);
      await amara.delete('/pages/lagos-agrihub/verification').expect(200);
      await amara.delete('/pages/lagos-agrihub/verification').expect(404);
      await amara.post('/pages/lagos-agrihub/verification', application).expect(200);

      const [request] = (await admin.get('/admin/verification').expect(200)).body.items;
      expect(request).toMatchObject({ subjectType: 'page', page: { slug: 'lagos-agrihub' }, applicant: { id: amara.id } });
      await admin.post(`/admin/verification/${request.id}/decision`, { decision: 'approve' }).expect(200);
      expect((await kwame.get('/pages/lagos-agrihub').expect(200)).body.verified).toBe(true);
      expect((await admin.get('/admin/queues').expect(200)).body).toMatchObject({ verification: 0 });
    });
  });

  describe('post analytics', () => {
    it('counts impressions and reach, splits the audience and keeps it to the author', async () => {
      const author = await createMember(t, { name: 'Thabo Nkosi', countryCode: 'ZA' });
      const viewers = await Promise.all(['GH', 'GH', 'GH', 'KE'].map((countryCode, i) => createMember(t, { name: `Viewer ${i}`, countryCode })));
      const post = await createPost(author, 'Solar micro-grids for clinics: what we learned in year one');
      expect(post.viewer.canViewAnalytics).toBe(true);
      // One viewer follows the author, one is connected.
      await viewers[0]!.post('/follows', { targetType: 'member', targetId: author.id }).expect(201);
      const req = await viewers[1]!.post('/connections', { memberId: author.id }).expect(201);
      await author.post(`/connections/${req.body.id}/accept`).expect(200);

      for (const v of viewers) await v.post('/posts/views', { postIds: [post.id] }).expect(200);
      // Seeing it again straight away doesn't count twice; the author's own views never count.
      await viewers[0]!.post('/posts/views', { postIds: [post.id] }).expect(200);
      await author.post('/posts/views', { postIds: [post.id] }).expect(200);
      await viewers[0]!.put('/reactions', { targetType: 'post', targetId: post.id, kind: 'insightful' }).expect(200);
      await viewers[1]!.post(`/posts/${post.id}/comments`, { body: 'Which inverter did you settle on?' }).expect(201);
      await viewers[2]!.put('/bookmarks', { targetType: 'post', targetId: post.id }).expect(200);

      const a = PostAnalytics.parse((await author.get(`/posts/${post.id}/analytics`).expect(200)).body);
      expect(a.totals).toMatchObject({ impressions: 4, reach: 4, reactions: 1, comments: 1, reposts: 0, saves: 1, engagements: 3, engagementRate: 0.75 });
      expect(a.reactions).toEqual({ like: 0, insightful: 1, support: 0 });
      expect(a.audience).toMatchObject({ connections: 1, followers: 1, others: 2 });
      // Kenya has one viewer, so it is folded into "Other" (no single viewer is identifiable).
      expect(a.audience.countries).toEqual([
        { code: 'GH', name: 'Ghana', viewers: 3 },
        { code: null, name: 'Other', viewers: 1 },
      ]);
      expect(a.daily).toHaveLength(28);
      expect(a.daily.at(-1)).toMatchObject({ impressions: 4, viewers: 4, engagements: 2 });

      // A later visit (after the 30 minute window) is a new impression, not new reach.
      await t.db.update(s.postViews).set({ lastSeenAt: new Date(Date.now() - 3_600_000) }).where(eq(s.postViews.postId, post.id));
      await viewers[0]!.post('/posts/views', { postIds: [post.id] }).expect(200);
      const b = (await author.get(`/posts/${post.id}/analytics?days=7`).expect(200)).body;
      expect(b.totals).toMatchObject({ impressions: 5, reach: 4 });
      expect(b.daily).toHaveLength(7);

      // Nobody else can open them, and no member ids are stored with the views.
      await viewers[0]!.get(`/posts/${post.id}/analytics`).expect(404);
      await author.get(`/posts/${post.id}/analytics?days=5`).expect(422);
      const stored = await t.db.select().from(s.postViews).where(eq(s.postViews.postId, post.id));
      expect(stored.every((r) => !viewers.some((v) => r.viewerKey.includes(v.id)))).toBe(true);

      const overview = (await author.get('/me/analytics').expect(200)).body;
      expect(overview.totals).toMatchObject({ posts: 1, impressions: 5, engagements: 2, followers: 1, newFollowers: 1 });
      expect(overview.topPosts[0]).toMatchObject({ id: post.id, impressions: 5, reach: 4 });
    });

    it('page admins see the analytics of page posts', async () => {
      const [pagePost] = (await amara.get('/feed?page=lagos-agrihub').expect(200)).body.items as PostView[];
      await kwame.post('/posts/views', { postIds: [pagePost!.id] }).expect(200);
      // A page admin's own view of the page's post doesn't count.
      await amara.post('/posts/views', { postIds: [pagePost!.id] }).expect(200);
      const a = (await amara.get(`/posts/${pagePost!.id}/analytics`).expect(200)).body;
      expect(a.totals).toMatchObject({ impressions: 1, reach: 1 });
      expect(a.audience).toMatchObject({ followers: 1, connections: 0 });
      expect(a.post.page).toMatchObject({ slug: 'lagos-agrihub' });
      await kwame.get(`/posts/${pagePost!.id}/analytics`).expect(404);
      const overview = (await amara.get('/me/analytics?page=lagos-agrihub').expect(200)).body;
      expect(overview).toMatchObject({ page: { slug: 'lagos-agrihub' }, totals: { impressions: 1, followers: 1 } });
      await kwame.get('/me/analytics?page=lagos-agrihub').expect(404);
    });
  });

  it('GET /public/overview gives the landing page its numbers without a session', async () => {
    const res = await t.http().get('/api/v1/public/overview').expect(200);
    const overview = PublicOverview.parse(res.body);
    expect(overview.members).toBeGreaterThan(5);
    expect(overview.chapters).toBeGreaterThan(50);
    expect(overview.pages).toBeGreaterThanOrEqual(1);
    expect(overview.trending.map((x) => x.tag)).toContain('ColdChain');
    expect(JSON.stringify(res.body)).not.toContain('@example.test');
  });
});
