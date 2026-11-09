import type { ChapterDetail, ChapterSummary } from '@chartermission/contracts';
import { createMember, createTestApp, type TestApp } from '../helpers.js';
import { chapterId, eventInput, grantChapterLead } from '../events/event-helpers.js';
import { createPost, follow } from '../social/social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Chapters: pages, members and Ambassador pins', () => {
  let t: TestApp;
  let lagos: string;
  let ghana: string;
  let ambassador: Member;
  let member: Member;
  beforeAll(async () => {
    t = await createTestApp();
    lagos = await chapterId(t, 'nigeria');
    ghana = await chapterId(t, 'ghana');
    ambassador = await createMember(t, { name: 'Ngozi Ambassador' });
    await grantChapterLead(t, ambassador.id, lagos, 'ambassador');
    member = await createMember(t, { name: 'Plain Chapter Member' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('lists active chapters with follower counts and the viewer’s membership', async () => {
    await follow(t, member.id, 'chapter', lagos);
    const res = await member.get('/chapters').expect(200);
    const nigeria = (res.body as ChapterSummary[]).find((c) => c.slug === 'nigeria');
    expect(nigeria).toMatchObject({ countryName: expect.any(String), viewer: { following: true } });
    expect(nigeria!.followers).toBeGreaterThanOrEqual(1);
    expect((res.body as ChapterSummary[]).find((c) => c.slug === 'ghana')?.viewer.following).toBe(false);
  });

  it('serves a chapter page by slug with its team, members and counts; unknown slugs are 404', async () => {
    const res = await member.get('/chapters/nigeria').expect(200);
    const page = res.body as ChapterDetail;
    expect(page.team.map((m) => m.member.id)).toContain(ambassador.id);
    expect(page.team.find((m) => m.member.id === ambassador.id)?.label).toMatch(/Ambassador/);
    expect(page.recentMembers.map((m) => m.id)).toContain(member.id);
    expect(page.viewer).toEqual({ following: true, canManage: false, canHostAsChapter: false });
    expect((await ambassador.get('/chapters/nigeria').expect(200)).body.viewer).toMatchObject({ canManage: true, canHostAsChapter: true });
    await member.get('/chapters/atlantis').expect(404);

    const members = await member.get('/chapters/nigeria/members').expect(200);
    expect(members.body.items.map((m: { id: string }) => m.id)).toContain(member.id);
  });

  it('lets the chapter’s Ambassador pin up to three chapter posts; others cannot', async () => {
    const posts = [];
    for (let i = 0; i < 4; i += 1) posts.push(await createPost(member, `Chapter update ${i}`, { chapterId: lagos }));
    const elsewhere = await createPost(member, 'Not in the chapter');

    await member.post('/chapters/nigeria/pins', { postId: posts[0]!.id }).expect(403);
    await ambassador.post('/chapters/nigeria/pins', { postId: elsewhere.id }).expect(409);
    for (const p of posts.slice(0, 3)) await ambassador.post('/chapters/nigeria/pins', { postId: p.id }).expect(201);
    const full = await ambassador.post('/chapters/nigeria/pins', { postId: posts[3]!.id }).expect(409);
    expect(full.body.error.message).toMatch(/up to 3/);
    // Pinning again is a no-op, not an error.
    await ambassador.post('/chapters/nigeria/pins', { postId: posts[0]!.id }).expect(201);

    const page = (await member.get('/chapters/nigeria').expect(200)).body as ChapterDetail;
    expect(page.pinned.map((p) => p.id).sort()).toEqual(posts.slice(0, 3).map((p) => p.id).sort());

    // An Ambassador of Nigeria can't pin in Ghana.
    const ghanaPost = await createPost(member, 'Accra meetup', { chapterId: ghana });
    await ambassador.post('/chapters/ghana/pins', { postId: ghanaPost.id }).expect(403);

    const after = (await ambassador.delete(`/chapters/nigeria/pins/${posts[0]!.id}`).expect(200)).body as ChapterDetail;
    expect(after.pinned).toHaveLength(2);
    await member.delete(`/chapters/nigeria/pins/${posts[1]!.id}`).expect(403);
  });

  it('lets the team edit About, and Ambassadors host events as their chapter', async () => {
    await member.patch('/chapters/nigeria', { about: 'Not mine to edit' }).expect(403);
    const res = await ambassador.patch('/chapters/nigeria', { about: 'Monthly meetups in Lagos and Abuja.' }).expect(200);
    expect(res.body.about).toBe('Monthly meetups in Lagos and Abuja.');

    const options = await ambassador.get('/events/host-options').expect(200);
    expect(options.body.chapters.map((c: { slug: string }) => c.slug)).toEqual(['nigeria']);
    const ev = await ambassador.post('/events', eventInput({ host: { type: 'chapter', chapterId: lagos } })).expect(201);
    expect(ev.body.host).toMatchObject({ type: 'chapter', chapter: { slug: 'nigeria' } });
  });
});
