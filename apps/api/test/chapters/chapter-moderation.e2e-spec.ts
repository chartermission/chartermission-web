import { eq } from 'drizzle-orm';
import type { ChapterBan, ChapterDetail, ChapterReviewQueue, PostView } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';
import { chapterId, grantChapterLead } from '../events/event-helpers.js';
import { createPost, follow } from '../social/social-helpers.js';
import { SettingsService } from '../../src/infra/settings.service.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Chapter moderation by the chapter team, and post approval', () => {
  let t: TestApp;
  let kenya: string;
  let ghana: string;
  let ambassador: Member;
  let second: Member;
  let member: Member;
  let other: Member;
  let admin: Member;

  const feedIds = async (m: Member, slug: string) => ((await m.get(`/feed?tab=latest&chapter=${slug}`).expect(200)).body.items as PostView[]).map((p) => p.id);
  const setRule = async (approval: 'direct' | 'review') => {
    await admin.put('/admin/settings/chapter-posts', { approval }).expect(200);
    t.app.get(SettingsService).clearCache();
  };

  beforeAll(async () => {
    t = await createTestApp();
    kenya = await chapterId(t, 'kenya');
    ghana = await chapterId(t, 'ghana');
    ambassador = await createMember(t, { name: 'Wanjiru Ambassador' });
    second = await createMember(t, { name: 'Otieno Lead' });
    await grantChapterLead(t, ambassador.id, kenya, 'ambassador');
    await grantChapterLead(t, second.id, kenya, 'chapter_lead');
    member = await createMember(t, { name: 'Plain Member' });
    other = await createMember(t, { name: 'Other Member' });
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    await follow(t, member.id, 'chapter', kenya);
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('shows the team who pinned a post; members see the pin but not the name', async () => {
    const post = await createPost(member, 'Nairobi meetup this Friday', { chapterId: kenya });
    await ambassador.post('/chapters/kenya/pins', { postId: post.id }).expect(201);
    const forTeam = (await second.get('/chapters/kenya').expect(200)).body as ChapterDetail;
    expect(forTeam.pins).toEqual([{ postId: post.id, pinnedBy: expect.objectContaining({ id: ambassador.id }), pinnedAt: expect.any(String) }]);
    expect(forTeam.moderation).toEqual({ pendingPosts: 0, bannedMembers: 0 });
    const forMember = (await member.get('/chapters/kenya').expect(200)).body as ChapterDetail;
    expect(forMember.pinned.map((p) => p.id)).toEqual([post.id]);
    expect(forMember.pins).toEqual([]);
    expect(forMember.moderation).toBeNull();
    await ambassador.delete(`/chapters/kenya/pins/${post.id}`).expect(200);
  });

  it('posts go straight in by default; the team can send one back for review, approve it again or remove it', async () => {
    const post = await createPost(member, 'Selling cheap dollars, message me', { chapterId: kenya });
    expect(post.status).toBe('published');
    expect(await feedIds(other, 'kenya')).toContain(post.id);

    // Only the chapter's team moderates, and only in its own chapter.
    await other.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'hold' }).expect(403);
    await ambassador.post(`/chapters/ghana/posts/${post.id}/review`, { action: 'hold' }).expect(403);
    await ambassador.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'approve' }).expect(409);

    await ambassador.post('/chapters/kenya/pins', { postId: post.id }).expect(201);
    const held = await ambassador.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'hold', note: 'Looks like a scam, please check' }).expect(200);
    expect(held.body).toEqual({ status: 'in_review' });
    expect(await feedIds(other, 'kenya')).not.toContain(post.id);
    await other.get(`/posts/${post.id}`).expect(404);
    // The author still sees it, with where it stands.
    const own = (await member.get(`/posts/${post.id}`).expect(200)).body as PostView;
    expect(own).toMatchObject({ status: 'in_review', chapterReview: { state: 'pending', note: 'Looks like a scam, please check' } });
    // It left the pins and joined the queue, where the other team member sees who held it.
    expect(((await second.get('/chapters/kenya').expect(200)).body as ChapterDetail).pinned).toHaveLength(0);
    const queue = (await second.get('/chapters/kenya/review').expect(200)).body as ChapterReviewQueue;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ id: post.id, chapterReview: { state: 'pending', by: { id: ambassador.id } } });
    await member.get('/chapters/kenya/review').expect(403);
    // Nobody can comment or react while it waits.
    await other.post(`/posts/${post.id}/comments`, { body: 'hello' }).expect(404);

    await second.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'approve' }).expect(200);
    expect(await feedIds(other, 'kenya')).toContain(post.id);
    expect(((await member.get(`/posts/${post.id}`).expect(200)).body as PostView).chapterReview).toBeUndefined();

    const removed = await second.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'remove', note: 'Not for this chapter' }).expect(200);
    expect(removed.body).toEqual({ status: 'declined' });
    expect(await feedIds(other, 'kenya')).not.toContain(post.id);
    expect(((await member.get(`/posts/${post.id}`).expect(200)).body as PostView).chapterReview).toMatchObject({ state: 'declined', note: 'Not for this chapter' });
    // A declined post can't be approved back in; the author posts again.
    await ambassador.post(`/chapters/kenya/posts/${post.id}/review`, { action: 'approve' }).expect(409);

    const notes = (await member.get('/notifications').expect(200)).body.items as { type: string }[];
    expect(notes.filter((n) => n.type === 'chapter_post_reviewed').length).toBeGreaterThanOrEqual(2);
    // The team's own posts aren't moderated this way.
    const mine = await createPost(ambassador, 'From the team', { chapterId: kenya });
    await ambassador.post(`/chapters/kenya/posts/${mine.id}/review`, { action: 'remove' }).expect(409);
  });

  it('with approval switched on, a member’s post waits for the team; the team and staff post directly', async () => {
    await other.put('/admin/settings/chapter-posts', { approval: 'review' }).expect(403);
    await setRule('review');
    expect(((await member.get('/chapters/kenya').expect(200)).body as ChapterDetail).postApproval).toBe('review');

    const waiting = await createPost(member, 'Looking for a co-founder in Mombasa', { chapterId: kenya });
    expect(waiting).toMatchObject({ status: 'in_review', chapterReview: { state: 'pending' } });
    expect(await feedIds(other, 'kenya')).not.toContain(waiting.id);
    expect(await feedIds(member, 'kenya')).toContain(waiting.id);
    const fromTeam = await createPost(ambassador, 'Welcome to the chapter', { chapterId: kenya });
    expect(fromTeam.status).toBe('published');
    // Posts outside chapters are never held.
    expect((await createPost(member, 'Not in a chapter')).status).toBe('published');

    // The team is told, and so is staff through the chapter page count.
    const told = (await second.get('/notifications').expect(200)).body.items as { type: string; href: string }[];
    expect(told.find((n) => n.type === 'chapter_post_pending')).toMatchObject({ href: '/chapters/kenya#review' });
    expect(((await admin.get('/chapters/kenya').expect(200)).body as ChapterDetail).moderation).toMatchObject({ pendingPosts: 1 });
    const rows = (await admin.get('/admin/chapters').expect(200)).body as { slug: string; pendingPosts: number; postApproval: string | null }[];
    expect(rows.find((r) => r.slug === 'kenya')).toMatchObject({ pendingPosts: 1, postApproval: null });

    // Staff can approve too.
    await admin.post(`/chapters/kenya/posts/${waiting.id}/review`, { action: 'approve' }).expect(200);
    expect(await feedIds(other, 'kenya')).toContain(waiting.id);

    const second2 = await createPost(member, 'Buy followers here', { chapterId: kenya });
    await ambassador.post(`/chapters/kenya/posts/${second2.id}/review`, { action: 'decline', note: 'Advertising isn’t allowed' }).expect(200);
    await ambassador.post(`/chapters/kenya/posts/${second2.id}/review`, { action: 'decline' }).expect(409);
    expect(await feedIds(other, 'kenya')).not.toContain(second2.id);
    expect(((await member.get(`/posts/${second2.id}`).expect(200)).body as PostView).status).toBe('declined');

    // A chapter can have its own rule, whatever the platform says.
    const ghanaRow = rows.find((r) => r.slug === 'ghana') as unknown as { id: string };
    await admin.patch(`/admin/chapters/${ghanaRow.id}`, { postApproval: 'direct' }).expect(200);
    expect((await createPost(member, 'Accra calling', { chapterId: ghana })).status).toBe('published');
    await admin.patch(`/admin/chapters/${ghanaRow.id}`, { postApproval: null }).expect(200);
    await setRule('direct');
    expect((await createPost(member, 'Back to normal', { chapterId: kenya })).status).toBe('published');
  });

  it('the team removes a member from the chapter: they leave it and can’t rejoin or post until let back in', async () => {
    await member.post('/chapters/kenya/bans', { userId: other.id }).expect(403);
    await ambassador.post('/chapters/kenya/bans', { userId: second.id }).expect(403);
    await ambassador.post('/chapters/kenya/bans', { userId: admin.id }).expect(403);

    const bans = (await ambassador.post('/chapters/kenya/bans', { userId: member.id, reason: 'Repeated adverts' }).expect(200)).body as ChapterBan[];
    expect(bans).toEqual([expect.objectContaining({ member: expect.objectContaining({ id: member.id }), bannedBy: expect.objectContaining({ id: ambassador.id }), reason: 'Repeated adverts' })]);
    const page = (await member.get('/chapters/kenya').expect(200)).body as ChapterDetail;
    expect(page.viewer).toMatchObject({ following: false, banned: true });
    await member.post('/follows', { targetType: 'chapter', targetId: kenya }).expect(403);
    const refused = await member.post('/posts', { body: 'Let me in', chapterId: kenya }).expect(403);
    expect(refused.body.error.message).toMatch(/can’t post in this chapter/);
    // Other chapters and the rest of the platform are unaffected.
    expect((await createPost(member, 'Hello Ghana', { chapterId: ghana })).status).toBe('published');
    expect(((await member.get('/notifications').expect(200)).body.items as { type: string }[]).some((n) => n.type === 'chapter_ban')).toBe(true);
    expect(((await second.get('/chapters/kenya').expect(200)).body as ChapterDetail).moderation).toMatchObject({ bannedMembers: 1 });

    expect((await second.delete(`/chapters/kenya/bans/${member.id}`).expect(200)).body).toEqual([]);
    await member.post('/follows', { targetType: 'chapter', targetId: kenya }).expect(201);
    expect((await createPost(member, 'Back again', { chapterId: kenya })).status).toBe('published');
  });

  it('the team reports fraud straight into the platform moderation queue at high priority', async () => {
    const post = await createPost(other, 'Send me 50 dollars and I will double it', { chapterId: kenya });
    await member.post('/chapters/kenya/fraud-reports', { targetType: 'post', targetId: post.id, detail: 'Classic advance fee scam' }).expect(403);
    await ambassador.post('/chapters/kenya/fraud-reports', { targetType: 'post', targetId: post.id, detail: 'short' }).expect(422);
    const report = await ambassador.post('/chapters/kenya/fraud-reports', { targetType: 'post', targetId: post.id, detail: 'Classic advance fee scam' }).expect(201);
    const [row] = await t.db.select().from(s.contentReports).where(eq(s.contentReports.id, report.body.id));
    expect(row).toMatchObject({ reasonCode: 'scam', priority: 'high', targetType: 'post', targetId: post.id });
    expect(row!.detail).toMatch(/Kenya Chapter team/);
    // A member can be reported the same way; a post from another chapter can't.
    await ambassador.post('/chapters/kenya/fraud-reports', { targetType: 'member', targetId: other.id, detail: 'Asks members for money in messages' }).expect(201);
    const elsewhere = await createPost(other, 'In Ghana', { chapterId: ghana });
    await ambassador.post('/chapters/kenya/fraud-reports', { targetType: 'post', targetId: elsewhere.id, detail: 'Not my chapter to report' }).expect(404);
  });
});
