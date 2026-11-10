import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

/** Link previews for bots that are never signed in: only what a visitor may already see. */
describe('Link previews', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const photo = async (ownerId: string) => {
    const [row] = await t.db
      .insert(s.files)
      .values({ ownerId, purpose: 'avatar', mime: 'image/jpeg', declaredMime: 'image/jpeg', originalName: 'me.jpg', sizeBytes: 1000, storageKey: `uploads/avatar/${ownerId}`, scanStatus: 'clean' })
      .returning();
    return row!.id;
  };

  it('shows every member’s name and photo; the headline only for public profiles', async () => {
    const open = await createMember(t, { name: 'Open Person' });
    const quiet = await createMember(t, { name: 'Quiet Person' });
    for (const m of [open, quiet]) await t.db.update(s.memberProfiles).set({ avatarFileId: await photo(m.id), headline: 'Builder' }).where(eq(s.memberProfiles.userId, m.id));
    await t.db.update(s.memberProfiles).set({ profileVisibility: 'public' }).where(eq(s.memberProfiles.userId, open.id));
    const [{ handle: openHandle }] = await t.db.select({ handle: s.memberProfiles.handle }).from(s.memberProfiles).where(eq(s.memberProfiles.userId, open.id));
    const [{ handle: quietHandle }] = await t.db.select({ handle: s.memberProfiles.handle }).from(s.memberProfiles).where(eq(s.memberProfiles.userId, quiet.id));

    const shown = (await t.http().get('/api/v1/public/preview').query({ path: `/${openHandle}` }).expect(200)).body;
    expect(shown).toMatchObject({ title: 'Open Person · Charter Mission', description: 'Builder', image: `/public/preview-image/member/${openHandle}` });

    const membersOnly = (await t.http().get('/api/v1/public/preview').query({ path: `/${quietHandle}` }).expect(200)).body;
    expect(membersOnly).toEqual({ title: 'Quiet Person · Charter Mission', description: 'Member of Charter Mission', image: `/public/preview-image/member/${quietHandle}` });
    await t.http().get('/api/v1/public/preview').query({ path: '/nobody-here-at-all' }).expect(404);
    await t.http().get('/api/v1/public/preview').query({ path: 'https://evil.example' }).expect(404);
  });

  it('posts show their own picture, a repost shows the original’s, and hidden posts show nothing', async () => {
    const author = await createMember(t, { name: 'Picture Poster' });
    const reposter = await createMember(t, { name: 'Re Poster' });
    const insert = async (authorId: string, body: string, extra: Partial<typeof s.posts.$inferInsert> = {}) =>
      (await t.db.insert(s.posts).values({ authorId, body, ...extra }).returning())[0]!;
    const withImage = await insert(author.id, 'Harvest day in Tamale');
    await t.db.insert(s.postAttachments).values({ postId: withImage.id, fileId: await photo(author.id), kind: 'image', position: 0 });
    const repost = await insert(reposter.id, '', { repostOfId: withImage.id });
    const hidden = await insert(author.id, 'Taken down', { moderationState: 'hidden' });

    const own = (await t.http().get('/api/v1/public/preview').query({ path: `/posts/${withImage.id}` }).expect(200)).body;
    expect(own).toEqual({ title: 'Picture Poster on Charter Mission', description: 'Harvest day in Tamale', image: `/public/preview-image/post/${withImage.id}` });
    const re = (await t.http().get('/api/v1/public/preview').query({ path: `/posts/${repost.id}` }).expect(200)).body;
    expect(re).toEqual({ title: 'Re Poster reposted on Charter Mission', description: 'Harvest day in Tamale', image: `/public/preview-image/post/${repost.id}` });
    await t.http().get('/api/v1/public/preview').query({ path: `/posts/${hidden.id}` }).expect(404);
    await t.http().get(`/api/v1/public/preview-image/post/${hidden.id}`).expect(404);
  });
});
