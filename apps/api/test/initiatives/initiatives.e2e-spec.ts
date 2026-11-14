import { and, eq } from 'drizzle-orm';
import type { InitiativeDetail, InitiativeJoinRequestView, InitiativeSummary, Page, PostView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { chapterId, grantChapterLead } from '../events/event-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const base = (extra: Record<string, unknown> = {}) => ({
  title: 'Farm-to-Port Lagos',
  summary: 'Cold-chain hubs that move smallholder produce from farm gate to port in under 48 hours.',
  description: 'We start with one hub and one corridor.',
  status: 'recruiting',
  countryCode: 'NG',
  roles: [
    { title: 'Logistics lead', description: 'Plan the routes.', skills: ['Logistics', 'Ops'] },
    { title: 'Data volunteer', description: 'Build the dashboard.', skills: ['SQL'] },
  ],
  milestones: [
    { title: 'Farms signed', note: '40 farms', done: true },
    { title: 'Hub live', done: true },
    { title: 'Second corridor' },
    { title: 'Scale to 3 hubs', targetDate: '2027-09-30' },
  ],
  ...extra,
});

describe('Initiatives', () => {
  let t: TestApp;
  let lead: Member;
  let initiative: InitiativeDetail;

  beforeAll(async () => {
    t = await createTestApp();
    lead = await createMember(t, { name: 'Amara Okafor' });
  });
  afterAll(async () => {
    await t.close();
  });

  const sector = async (name = 'Agriculture & food') => (await t.db.select().from(s.sectors).where(eq(s.sectors.name, name)))[0]!.id;
  const list = async (m: Member, query = '') => ((await m.get(`/initiatives${query}`).expect(200)).body as Page<InitiativeSummary>).items.map((i) => i.slug);

  it('a member starts an initiative: live at once, they lead it, with roles and milestones', async () => {
    await lead.post('/initiatives', { title: 'Hi', summary: 'short' }).expect(422);
    const unverified = await createMember(t, { verified: false });
    await unverified.post('/initiatives', base()).expect(403);

    initiative = (await lead.post('/initiatives', base({ themeId: await sector() })).expect(201)).body as InitiativeDetail;
    expect(initiative).toMatchObject({
      slug: 'farm-to-port-lagos',
      status: 'recruiting',
      theme: { name: 'Agriculture & food' },
      country: { code: 'NG' },
      host: { type: 'member', member: { id: lead.id } },
      lead: { id: lead.id },
      teamCount: 1,
      milestones: { done: 2, total: 4, current: 'Second corridor' },
      percent: 50,
      viewer: { canManage: true, canDelete: true, member: true, following: false, request: null },
      pendingRequests: 0,
    });
    expect(initiative.milestoneList.map((m) => m.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(initiative.roles.map((r) => r.title)).toEqual(['Logistics lead', 'Data volunteer']);
    expect(initiative.team).toEqual([expect.objectContaining({ lead: true, organiser: true, role: 'Initiative lead' })]);

    // Same title, its own link name.
    const twin = (await lead.post('/initiatives', base({ title: 'Farm-to-Port Lagos' })).expect(201)).body as InitiativeDetail;
    expect(twin.slug).toBe('farm-to-port-lagos-2');

    const other = await createMember(t);
    const seen = (await other.get('/initiatives/farm-to-port-lagos').expect(200)).body as InitiativeDetail;
    expect(seen.viewer).toMatchObject({ canManage: false, canDelete: false, member: false });
    expect(await list(other)).toEqual(expect.arrayContaining(['farm-to-port-lagos', 'farm-to-port-lagos-2']));
  });

  it('hosts: pages the member manages and chapters they lead, nothing else', async () => {
    const owner = await createMember(t, { name: 'Page Owner' });
    const [page] = await t.db.insert(s.pages).values({ slug: 'lagos-agrihub', name: 'Lagos AgriHub', status: 'active', createdBy: owner.id }).returning();
    await t.db.insert(s.pageAdmins).values({ pageId: page!.id, userId: owner.id, role: 'owner' });
    const outsider = await createMember(t);
    await outsider.post('/initiatives', base({ title: 'Not My Page', host: { type: 'page', pageId: page!.id } })).expect(422);
    const byPage = (await owner.post('/initiatives', base({ title: 'AgriHub Corridor', host: { type: 'page', pageId: page!.id } })).expect(201)).body as InitiativeDetail;
    expect(byPage.host).toMatchObject({ type: 'page', page: { slug: 'lagos-agrihub' } });
    expect(await list(outsider, '?page=lagos-agrihub')).toEqual(['agrihub-corridor']);

    const kenya = await chapterId(t, 'kenya');
    const chapterLead = await createMember(t, { name: 'Chapter Lead' });
    await chapterLead.post('/initiatives', base({ title: 'Kenya Chapter Project', host: { type: 'chapter', chapterId: kenya } })).expect(422);
    await grantChapterLead(t, chapterLead.id, kenya);
    expect(((await chapterLead.get('/initiatives/host-options').expect(200)).body as { chapters: { id: string }[] }).chapters.map((c) => c.id)).toEqual([kenya]);
    const byChapter = (await chapterLead.post('/initiatives', base({ title: 'Kenya Chapter Project', host: { type: 'chapter', chapterId: kenya } })).expect(201))
      .body as InitiativeDetail;
    expect(byChapter.host).toMatchObject({ type: 'chapter', chapter: { slug: 'kenya' } });

    // Another lead of the same chapter organises it too (but isn't on the team).
    const coLead = await createMember(t);
    await grantChapterLead(t, coLead.id, kenya);
    const asCoLead = (await coLead.get(`/initiatives/${byChapter.slug}`).expect(200)).body as InitiativeDetail;
    expect(asCoLead.viewer).toMatchObject({ canManage: true, canDelete: true, member: false });
  });

  it('filters by status, theme, country and text', async () => {
    const m = await createMember(t);
    await lead.post('/initiatives', base({ title: 'Clean Cooking Nairobi', status: 'active', countryCode: 'KE', themeId: await sector('Climate & energy'), roles: [], milestones: [] })).expect(201);
    expect(await list(m, '?status=active')).toEqual(['clean-cooking-nairobi']);
    expect(await list(m, '?theme=' + (await sector('Climate & energy')))).toEqual(['clean-cooking-nairobi']);
    expect(await list(m, '?country=KE')).toEqual(['clean-cooking-nairobi']);
    expect(await list(m, '?q=cooking')).toEqual(['clean-cooking-nairobi']);
    expect(await list(m, '?scope=mine')).toEqual([]);
  });

  it('join requests: one at a time, organisers accept or decline, members are told', async () => {
    const helper = await createMember(t, { name: 'Tunde Bakare' });
    const role = initiative.roles[0]!;
    await helper.post(`/initiatives/${initiative.id}/join-requests`, { note: 'too short' }).expect(422);
    await helper.post(`/initiatives/${initiative.id}/join-requests`, { roleId: '00000000-0000-4000-8000-000000000000', note: 'I ran cold-chain routes for four years.' }).expect(422);
    const asked = (await helper.post(`/initiatives/${initiative.id}/join-requests`, { roleId: role.id, skills: 'Routing', note: 'I ran cold-chain routes for four years.' }).expect(200))
      .body as InitiativeDetail;
    expect(asked.viewer.request).toMatchObject({ status: 'pending', roleId: role.id });
    expect((await helper.post(`/initiatives/${initiative.id}/join-requests`, { note: 'Asking a second time, just in case.' }).expect(409)).body.error.message).toMatch(/already asked/);

    const notes = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, lead.id), eq(s.notifications.type, 'initiative_join_requested')));
    expect(notes).toHaveLength(1);

    await helper.get(`/initiatives/${initiative.id}/join-requests`).expect(403);
    const requests = (await lead.get(`/initiatives/${initiative.id}/join-requests`).expect(200)).body as InitiativeJoinRequestView[];
    expect(requests).toEqual([expect.objectContaining({ member: expect.objectContaining({ id: helper.id }), role: { id: role.id, title: 'Logistics lead' }, skills: 'Routing', status: 'pending' })]);
    expect(((await lead.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).pendingRequests).toBe(1);

    const accepted = (await lead.post(`/initiatives/${initiative.id}/join-requests/${requests[0]!.id}/decision`, { decision: 'accept', message: 'Welcome aboard!' }).expect(200))
      .body as InitiativeJoinRequestView;
    expect(accepted.status).toBe('accepted');
    await lead.post(`/initiatives/${initiative.id}/join-requests/${requests[0]!.id}/decision`, { decision: 'decline' }).expect(409);
    const after = (await helper.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail;
    expect(after.viewer).toMatchObject({ member: true, canManage: false });
    expect(after.team.find((m) => m.member.id === helper.id)).toMatchObject({ role: 'Logistics lead', organiser: false, lead: false });
    const [told] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, helper.id), eq(s.notifications.type, 'initiative_join_decided')));
    expect(JSON.stringify(told!.data)).toContain('Welcome aboard!');
    await helper.post(`/initiatives/${initiative.id}/join-requests`, { note: 'I am already on the team, though.' }).expect(409);

    // Declined and withdrawn requests.
    const second = await createMember(t);
    await second.post(`/initiatives/${initiative.id}/join-requests`, { note: 'I can help with the data dashboard.' }).expect(200);
    const withdrawn = (await second.delete(`/initiatives/${initiative.id}/join-requests/me`).expect(200)).body as InitiativeDetail;
    expect(withdrawn.viewer.request?.status).toBe('withdrawn');
    await second.post(`/initiatives/${initiative.id}/join-requests`, { note: 'Trying again with a better note.' }).expect(200);
    const pending = ((await lead.get(`/initiatives/${initiative.id}/join-requests`).expect(200)).body as InitiativeJoinRequestView[]).find((r) => r.status === 'pending')!;
    await lead.post(`/initiatives/${initiative.id}/join-requests/${pending.id}/decision`, { decision: 'decline' }).expect(200);
    expect(((await second.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).viewer.request?.status).toBe('declined');

    // Only while recruiting.
    const active = (await lead.post('/initiatives', base({ title: 'Already Running', status: 'active' })).expect(201)).body as InitiativeDetail;
    await second.post(`/initiatives/${active.id}/join-requests`, { note: 'Can I still help out here?' }).expect(409);
  });

  it('organisers run the team: make someone an organiser, remove members; members can leave; the lead stays', async () => {
    const team = ((await lead.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).team;
    const helper = team.find((m) => !m.lead)!.member;
    const helperSession = (await t.db.select().from(s.users).where(eq(s.users.id, helper.id)))[0]!;
    expect(helperSession).toBeTruthy();
    const promoted = (await lead.patch(`/initiatives/${initiative.id}/team/${helper.id}`, { organiser: true, role: 'Corridor lead · Ibadan' }).expect(200)).body as InitiativeDetail;
    expect(promoted.team.find((m) => m.member.id === helper.id)).toMatchObject({ organiser: true, role: 'Corridor lead · Ibadan' });
    await lead.patch(`/initiatives/${initiative.id}/team/${lead.id}`, { organiser: false }).expect(409);
    await lead.delete(`/initiatives/${initiative.id}/team/${lead.id}`).expect(409);

    const joiner = await createMember(t);
    await joiner.post(`/initiatives/${initiative.id}/join-requests`, { note: 'I would love to volunteer on data.' }).expect(200);
    const req = ((await lead.get(`/initiatives/${initiative.id}/join-requests`).expect(200)).body as InitiativeJoinRequestView[]).find((r) => r.member.id === joiner.id)!;
    await lead.post(`/initiatives/${initiative.id}/join-requests/${req.id}/decision`, { decision: 'accept' }).expect(200);
    const left = (await joiner.delete(`/initiatives/${initiative.id}/team/${joiner.id}`).expect(200)).body as InitiativeDetail;
    expect(left.viewer.member).toBe(false);
    const stranger = await createMember(t);
    await stranger.delete(`/initiatives/${initiative.id}/team/${helper.id}`).expect(403);
  });

  it('organisers edit it: roles and milestones keep their ids; closed roles are only shown to organisers', async () => {
    const before = (await lead.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail;
    const [logistics, data] = before.roles;
    const [m1, m2, m3] = before.milestoneList;
    const edited = (
      await lead
        .patch(`/initiatives/${initiative.id}`, {
          summary: 'Cold-chain hubs moving produce from farm gate to port in under 48 hours, now in two corridors.',
          roles: [
            { id: logistics!.id, title: 'Logistics lead', open: false },
            { id: data!.id, title: 'Data volunteer', skills: ['SQL', 'Python'] },
            { title: 'Export advisor' },
          ],
          milestones: [{ id: m1!.id, title: 'Farms signed', done: true }, { id: m2!.id, title: 'Hub live', done: true }, { id: m3!.id, title: 'Second corridor', done: true }, { title: 'Scale' }],
        })
        .expect(200)
    ).body as InitiativeDetail;
    expect(edited.roles.map((r) => [r.title, r.open])).toEqual([['Logistics lead', false], ['Data volunteer', true], ['Export advisor', true]]);
    expect(edited.roles[0]!.id).toBe(logistics!.id);
    expect(edited.milestoneList[0]!.doneAt).toBe(m1!.doneAt);
    expect(edited).toMatchObject({ milestones: { done: 3, total: 4, current: 'Scale' }, percent: 75 });
    expect(edited.openRoles.map((r) => r.title)).toEqual(['Data volunteer', 'Export advisor']);
    const other = await createMember(t);
    expect(((await other.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).roles.map((r) => r.title)).toEqual(['Data volunteer', 'Export advisor']);
    await other.patch(`/initiatives/${initiative.id}`, { status: 'paused' }).expect(403);
  });

  it('followers and the team get the updates organisers post; nobody else can post them', async () => {
    const follower = await createMember(t, { name: 'Follower' });
    await follower.put(`/initiatives/${initiative.id}/follow`).expect(200);
    await follower.put(`/initiatives/${initiative.id}/follow`).expect(200);
    const followed = (await follower.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail;
    expect(followed).toMatchObject({ followerCount: 1, viewer: { following: true } });
    expect(await list(follower, '?scope=mine')).toEqual(['farm-to-port-lagos']);

    const outsider = await createMember(t);
    expect((await outsider.post('/posts', { body: 'Pretending to be the team.', initiativeId: initiative.id }).expect(422)).body.error.fields.initiativeId).toMatch(/organisers/);
    const update = (await lead.post('/posts', { body: 'Milestone 3 done: first truck at the port in 31 hours.', initiativeId: initiative.id }).expect(201)).body as PostView;
    expect(update.initiative).toEqual({ id: initiative.id, slug: 'farm-to-port-lagos', title: 'Farm-to-Port Lagos' });

    const onPage = (await outsider.get('/feed?initiative=farm-to-port-lagos').expect(200)).body as Page<PostView>;
    expect(onPage.items.map((p) => p.id)).toEqual([update.id]);
    const following = (await follower.get('/feed?tab=following').expect(200)).body as Page<PostView>;
    expect(following.items.map((p) => p.id)).toContain(update.id);
    expect(((await follower.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).updatesCount).toBe(1);

    await follower.delete(`/initiatives/${initiative.id}/follow`).expect(200);
    expect(((await follower.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail).followerCount).toBe(0);
  });

  it('members report it; moderators hide it; organisers still see it, flagged', async () => {
    const reporter = await createMember(t);
    await reporter.post('/reports', { targetType: 'initiative', targetId: initiative.id, reason: 'spam' }).expect(201);
    const mod = await createMember(t, { name: 'Mo Moderator', roles: ['moderator'], admin: true });
    await mod.post('/admin/moderation-actions', { targetType: 'initiative', targetId: initiative.id, action: 'hide', reason: 'Checking this listing' }).expect(201);
    expect(await list(reporter)).not.toContain('farm-to-port-lagos');
    await reporter.get(`/initiatives/${initiative.id}`).expect(404);
    const asLead = (await lead.get(`/initiatives/${initiative.id}`).expect(200)).body as InitiativeDetail;
    expect(asLead.moderationState).toBe('hidden');
    expect((await lead.post('/posts', { body: 'An update while hidden.', initiativeId: initiative.id }).expect(422)).body.error.fields.initiativeId).toMatch(/hidden/);
  });

  it('the lead deletes it; other organisers can’t', async () => {
    const mine = (await lead.post('/initiatives', base({ title: 'Short Lived' })).expect(201)).body as InitiativeDetail;
    const helper = await createMember(t);
    await t.db.insert(s.initiativeMembers).values({ initiativeId: mine.id, userId: helper.id, organiser: true });
    await helper.patch(`/initiatives/${mine.id}`, { status: 'paused' }).expect(200);
    await helper.delete(`/initiatives/${mine.id}`).expect(403);
    await lead.delete(`/initiatives/${mine.id}`).expect(200);
    await helper.get(`/initiatives/${mine.id}`).expect(404);
    expect(await list(helper)).not.toContain('short-lived');
  });
});
