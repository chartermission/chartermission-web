import { and, eq } from 'drizzle-orm';
import { OpportunityInput, type OpportunityDetail, type PostView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { follow } from '../social/social-helpers.js';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { OpportunityFeedService } from '../../src/opportunities/opportunity-feed.service.js';
import { SessionService } from '../../src/core/session.service.js';
import { RateLimitService } from '../../src/infra/rate-limit.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function listing(overrides: Record<string, unknown> = {}) {
  return {
    type: 'employment',
    title: 'Operations Lead, Cold Chain',
    organisation: 'FreshRoute',
    summary: 'Run cold-chain logistics for 40 farms around Kumasi.',
    description: 'You will run daily operations for our cold-chain network, working with farmers, drivers and buyers across the Ashanti region.',
    remoteMode: 'in_person',
    countryCode: 'GH',
    city: 'Kumasi',
    deadline: inDays(30),
    ...overrides,
  };
}

/** Posts that share the listing (deleted ones included). */
function sharePosts(t: TestApp, opportunityId: string) {
  return t.db.select().from(s.posts).where(eq(s.posts.opportunityId, opportunityId));
}

async function feed(m: Member, tab: 'following' | 'for_you' = 'following'): Promise<PostView[]> {
  return (await m.get(`/feed?tab=${tab}`).expect(200)).body.items as PostView[];
}

describe('Opportunities in the feed', () => {
  let t: TestApp;
  let poster: Member;
  let connection: Member;
  let follower: Member;
  let stranger: Member;
  beforeAll(async () => {
    t = await createTestApp();
    poster = await createMember(t, { name: 'Efua Poster' });
    connection = await createMember(t, { name: 'Kofi Connection' });
    follower = await createMember(t, { name: 'Ama Follower' });
    stranger = await createMember(t, { name: 'Sipho Stranger' });
    await t.db.insert(s.connections).values({ requesterId: connection.id, addresseeId: poster.id, status: 'accepted', respondedAt: new Date() });
    await follow(t, follower.id, 'member', poster.id);
  });
  afterAll(async () => {
    await t.close();
  });

  it('a new listing is shared to the feed once, with its card, and reaches connections and followers', async () => {
    const o = (await poster.post('/opportunities', listing()).expect(201)).body as OpportunityDetail;
    const rows = await sharePosts(t, o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorId: poster.id, pageId: null, type: 'standard', kind: 'standard', body: '', status: 'published', visibility: 'members', linkUrl: null });

    for (const viewer of [connection, follower, poster]) {
      const post = (await feed(viewer)).find((p) => p.id === rows[0]!.id);
      expect(post).toMatchObject({
        isOpportunityShare: true,
        isEventShare: false,
        author: { id: poster.id },
        page: null,
        opportunity: {
          id: o.id,
          slug: o.slug,
          type: 'employment',
          title: 'Operations Lead, Cold Chain',
          organisation: 'FreshRoute',
          remoteMode: 'in_person',
          country: { code: 'GH', name: 'Ghana' },
          city: 'Kumasi',
          deadline: o.deadline,
          status: 'open',
          applyUrl: null,
          page: null,
          poster: { id: poster.id },
        },
      });
    }
    // A member's listing isn't pushed to people outside their network.
    expect((await feed(stranger)).some((p) => p.id === rows[0]!.id)).toBe(false);
    // Signed-out readers never see members-only posts or cards.
    await t.http().get(`/api/v1/posts/${rows[0]!.id}`).expect(404);
  });

  it('shareToFeed false makes no post; sharing doesn’t use up the member’s daily posts', async () => {
    const quiet = (await poster.post('/opportunities', listing({ title: 'Quiet Listing', shareToFeed: false })).expect(201)).body as OpportunityDetail;
    expect(await sharePosts(t, quiet.id)).toHaveLength(0);
    expect(await t.app.get(RateLimitService).peek(`posts:${poster.id}`)).toBe(0);
  });

  it('a listing imported as an official page is posted as the page and reaches every member', async () => {
    const admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    const owner = await createMember(t, { name: 'Page Owner' });
    const page = (
      await admin
        .post('/admin/pages', { name: 'Charter Mission Opportunities', slug: 'cm-opportunities', category: 'organisation', owner: owner.email, official: true, verified: true })
        .expect(201)
    ).body as { id: string };
    // The staff member who imports isn't one of the page's admins: the share is a trusted internal post.
    const staff = await createMember(t, { name: 'Ops Staff', roles: ['platform_admin'] });
    const staffUser = (await t.app.get(SessionService).userById(staff.id))!;
    const service = t.app.get(OpportunitiesService);
    const row = await service.createListing(
      staffUser,
      OpportunityInput.parse(listing({ title: 'Fellowship in Climate Policy', type: 'fellowship', applyUrl: 'apply@greenfund.example' })),
      { source: 'import', pageId: page.id },
    );
    expect(row).toMatchObject({ source: 'import', pageId: page.id, applyUrl: 'mailto:apply@greenfund.example' });

    const rows = await sharePosts(t, row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authorId: staff.id, pageId: page.id, status: 'published' });

    const seen = (await feed(stranger)).find((p) => p.id === rows[0]!.id);
    expect(seen).toMatchObject({
      author: { id: page.id, name: 'Charter Mission Opportunities' },
      page: { id: page.id, official: true },
      opportunity: { id: row.id, applyUrl: 'mailto:apply@greenfund.example', page: { id: page.id, slug: 'cm-opportunities', official: true }, poster: { id: staff.id } },
    });
    expect((await feed(stranger, 'for_you')).some((p) => p.id === rows[0]!.id)).toBe(true);

    // Idempotent: sharing the same listing again returns the same post.
    expect(await t.app.get(OpportunityFeedService).share(row)).toBe(rows[0]!.id);
    expect(await sharePosts(t, row.id)).toHaveLength(1);

    // On the member site: the page is the poster, and applications happen on the organisation's side.
    const detail = (await stranger.get(`/opportunities/${row.slug}`).expect(200)).body as OpportunityDetail;
    expect(detail).toMatchObject({ page: { id: page.id }, applyUrl: 'mailto:apply@greenfund.example', viewer: { canApply: false, cannotApplyReason: null } });
    await stranger.post(`/opportunities/${row.id}/applications`, { note: 'I would love to apply for this fellowship.' }).expect(409);

    // A page that isn't live can't post: the listing still goes up, without a post.
    await t.db.update(s.pages).set({ status: 'suspended' }).where(eq(s.pages.id, page.id));
    const quiet = await service.createListing(staffUser, OpportunityInput.parse(listing({ title: 'Posted While Suspended' })), { source: 'import', pageId: page.id });
    expect(await sharePosts(t, quiet.id)).toHaveLength(0);
    await t.db.update(s.pages).set({ status: 'active' }).where(eq(s.pages.id, page.id));
  });

  it('the card says the listing is gone once it is deleted, hidden or removed — in reposts too', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Short-lived Listing' })).expect(201)).body as OpportunityDetail;
    const [share] = await sharePosts(t, o.id);
    const repost = (await connection.post('/posts', { body: '', repostOfId: share!.id }).expect(201)).body as PostView;
    expect(repost.repostOf).toMatchObject({ isOpportunityShare: true, opportunity: { id: o.id } });

    await t.db.update(s.opportunities).set({ moderationState: 'hidden' }).where(eq(s.opportunities.id, o.id));
    expect((await follower.get(`/posts/${share!.id}`).expect(200)).body).toMatchObject({ isOpportunityShare: true, opportunity: null });
    await t.db.update(s.opportunities).set({ moderationState: 'visible' }).where(eq(s.opportunities.id, o.id));
    expect((await follower.get(`/posts/${share!.id}`).expect(200)).body.opportunity).toMatchObject({ id: o.id });

    // Closed by the poster: the card stays, marked closed.
    await poster.post(`/opportunities/${o.id}/close`, {}).expect(200);
    expect((await follower.get(`/posts/${share!.id}`).expect(200)).body.opportunity).toMatchObject({ status: 'closed' });
    await poster.post(`/opportunities/${o.id}/reopen`, {}).expect(200);

    await poster.delete(`/opportunities/${o.id}`).expect(204);
    expect((await follower.get(`/posts/${share!.id}`).expect(200)).body).toMatchObject({ isOpportunityShare: true, opportunity: null });
    const again = (await connection.get(`/posts/${repost.id}`).expect(200)).body as PostView;
    expect(again.repostOf).toMatchObject({ isOpportunityShare: true, opportunity: null });

    const removed = (await poster.post('/opportunities', listing({ title: 'Removed By Moderators', type: 'grant' })).expect(201)).body as OpportunityDetail;
    const [removedShare] = await sharePosts(t, removed.id);
    const mod = await createMember(t, { roles: ['moderator'], admin: true });
    await mod.post('/admin/moderation-actions', { targetType: 'opportunity', targetId: removed.id, action: 'remove', reason: 'Asks applicants to pay a fee' }).expect(201);
    expect((await follower.get(`/posts/${removedShare!.id}`).expect(200)).body).toMatchObject({ isOpportunityShare: true, opportunity: null });
  });

  it('members share an open listing by hand; closed, expired, removed and mixed shares are refused', async () => {
    const o = (await poster.post('/opportunities', listing({ title: 'Data Analyst', shareToFeed: false })).expect(201)).body as OpportunityDetail;
    const res = await stranger.post('/posts', { body: 'Worth a look https://example.com/more', opportunityId: o.id, visibility: 'public' }).expect(201);
    expect(res.body).toMatchObject({ isOpportunityShare: true, linkPreview: null, author: { id: stranger.id }, opportunity: { id: o.id, title: 'Data Analyst' } });
    const [row] = await t.db.select().from(s.posts).where(eq(s.posts.id, res.body.id));
    expect(row).toMatchObject({ opportunityId: o.id, linkUrl: null, visibility: 'members' });
    // No comment needed, like sharing an event.
    await stranger.post('/posts', { body: '', opportunityId: o.id }).expect(201);
    // A share can be edited down to no words: the card carries it.
    await stranger.patch(`/posts/${res.body.id}`, { body: '' }).expect(200);

    const fields = async (body: object, status = 422) => (await stranger.post('/posts', body).expect(status)).body.error?.fields ?? {};
    expect((await fields({ body: 'Q?', type: 'question', opportunityId: o.id })).opportunityId).toBeDefined();
    expect((await fields({ body: 'Vote', opportunityId: o.id, poll: { question: 'Apply?', options: ['Yes', 'No'] } })).opportunityId).toBeDefined();
    const other = (await poster.post('/posts', { body: 'Something to repost' }).expect(201)).body as PostView;
    expect((await fields({ body: '', opportunityId: o.id, repostOfId: other.id })).opportunityId).toBeDefined();

    await poster.post(`/opportunities/${o.id}/close`, {}).expect(200);
    expect((await fields({ body: '', opportunityId: o.id })).opportunityId).toBe('This opportunity is closed');
    await poster.post(`/opportunities/${o.id}/reopen`, {}).expect(200);
    await t.db.update(s.opportunities).set({ deadline: inDays(-1) }).where(eq(s.opportunities.id, o.id));
    expect((await fields({ body: '', opportunityId: o.id })).opportunityId).toBe('The deadline for this opportunity has passed');

    await t.db.update(s.opportunities).set({ deadline: inDays(10), moderationState: 'removed' }).where(eq(s.opportunities.id, o.id));
    await stranger.post('/posts', { body: '', opportunityId: o.id }).expect(404);
    await stranger.post('/posts', { body: '', opportunityId: '00000000-0000-4000-8000-000000000000' }).expect(404);

    // Blocked either way: the listing doesn't exist for them.
    await t.db.update(s.opportunities).set({ moderationState: 'visible' }).where(eq(s.opportunities.id, o.id));
    await t.db.insert(s.blocks).values({ blockerId: poster.id, blockedId: stranger.id });
    await stranger.post('/posts', { body: '', opportunityId: o.id }).expect(404);
    await t.db.delete(s.blocks).where(and(eq(s.blocks.blockerId, poster.id), eq(s.blocks.blockedId, stranger.id)));
  });
});
