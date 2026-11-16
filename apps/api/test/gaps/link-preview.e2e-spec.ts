import { eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import sharp from 'sharp';
import { MediaService } from '../../src/media/media.service.js';

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
    expect(shown).toMatchObject({ title: 'Open Person · Charter Mission', description: 'Builder', image: expect.stringMatching(new RegExp(`^${escapeRe(`/public/preview-image/member/${openHandle}`)}\\?v=[0-9a-f]{8}$`)) });

    const membersOnly = (await t.http().get('/api/v1/public/preview').query({ path: `/${quietHandle}` }).expect(200)).body;
    expect(membersOnly).toEqual({ title: 'Quiet Person · Charter Mission', description: 'Member of Charter Mission', image: expect.stringMatching(new RegExp(`^${escapeRe(`/public/preview-image/member/${quietHandle}`)}\\?v=[0-9a-f]{8}$`)) });
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
    expect(own).toEqual({ title: 'Picture Poster on Charter Mission', description: 'Harvest day in Tamale', image: expect.stringMatching(new RegExp(`^${escapeRe(`/public/preview-image/post/${withImage.id}`)}\\?v=[0-9a-f]{8}$`)) });
    const re = (await t.http().get('/api/v1/public/preview').query({ path: `/posts/${repost.id}` }).expect(200)).body;
    expect(re).toEqual({ title: 'Re Poster reposted on Charter Mission', description: 'Harvest day in Tamale', image: expect.stringMatching(new RegExp(`^${escapeRe(`/public/preview-image/post/${repost.id}`)}\\?v=[0-9a-f]{8}$`)) });
    await t.http().get('/api/v1/public/preview').query({ path: `/posts/${hidden.id}` }).expect(404);
    await t.http().get(`/api/v1/public/preview-image/post/${hidden.id}`).expect(404);
  });

  it('initiatives show their title, summary and cover; hidden or deleted ones show nothing', async () => {
    const lead = await createMember(t, { name: 'Initiative Lead' });
    const insert = async (slug: string, extra: Partial<typeof s.initiatives.$inferInsert> = {}) =>
      (await t.db.insert(s.initiatives).values({ slug, title: 'Solar Schools Accra', summary: 'Rooftop solar for 10 public schools.', leadId: lead.id, ...extra }).returning())[0]!;
    await insert('solar-schools-preview', { coverFileId: await photo(lead.id) });
    await insert('plain-initiative-preview');
    await insert('hidden-initiative-preview', { moderationState: 'hidden' });
    await insert('gone-initiative-preview', { deletedAt: new Date() });

    const shown = (await t.http().get('/api/v1/public/preview').query({ path: '/initiatives/solar-schools-preview' }).expect(200)).body;
    expect(shown).toEqual({ title: 'Solar Schools Accra', description: 'Rooftop solar for 10 public schools.', image: expect.stringMatching(new RegExp(`^${escapeRe('/public/preview-image/initiative/solar-schools-preview')}\\?v=[0-9a-f]{8}$`)) });
    const plain = (await t.http().get('/api/v1/public/preview').query({ path: '/initiatives/plain-initiative-preview' }).expect(200)).body;
    expect(plain.image).toBeNull();
    await t.http().get('/api/v1/public/preview').query({ path: '/initiatives/hidden-initiative-preview' }).expect(404);
    await t.http().get('/api/v1/public/preview').query({ path: '/initiatives/gone-initiative-preview' }).expect(404);
    await t.http().get('/api/v1/public/preview-image/initiative/hidden-initiative-preview').expect(404);
  });

  it('serves preview pictures as small JPEGs, never a redirect: 1200×630 for wide photos, a square for avatars', async () => {
    const storage = t.app.get(MediaService).storage;
    const lead = await createMember(t, { name: 'Picture Person' });
    const store = async (key: string, data: Buffer) => {
      await storage.write(key, data, 'image/jpeg');
      const [row] = await t.db
        .insert(s.files)
        .values({ ownerId: lead.id, purpose: 'initiative_cover', mime: 'image/jpeg', declaredMime: 'image/jpeg', originalName: 'x.jpg', sizeBytes: data.length, storageKey: key, scanStatus: 'clean' })
        .returning();
      return row!.id;
    };
    // A big, noisy "phone photo" (several MB) and a square avatar.
    const noise = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const photoJpeg = await sharp(noise, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    expect(photoJpeg.length).toBeGreaterThan(2_000_000);
    const avatarJpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#067239' } }).jpeg().toBuffer();
    await t.db.insert(s.initiatives).values({ slug: 'wide-photo-preview', title: 'Wide', summary: 'A wide photo.', leadId: lead.id, coverFileId: await store(`uploads/test/${lead.id}-wide`, photoJpeg) });
    await t.db.update(s.memberProfiles).set({ avatarFileId: await store(`uploads/test/${lead.id}-avatar`, avatarJpeg) }).where(eq(s.memberProfiles.userId, lead.id));
    const [{ handle }] = await t.db.select({ handle: s.memberProfiles.handle }).from(s.memberProfiles).where(eq(s.memberProfiles.userId, lead.id));

    const wide = await t.http().get('/api/v1/public/preview-image/initiative/wide-photo-preview').responseType('blob').expect(200);
    expect(wide.headers['content-type']).toBe('image/jpeg');
    expect(wide.headers.location).toBeUndefined();
    const wideMeta = await sharp(wide.body as Buffer).metadata();
    expect([wideMeta.width, wideMeta.height, wideMeta.format]).toEqual([1200, 630, 'jpeg']);
    expect((wide.body as Buffer).length).toBeLessThan(600_000);

    const square = await t.http().get(`/api/v1/public/preview-image/member/${handle}`).responseType('blob').expect(200);
    const squareMeta = await sharp(square.body as Buffer).metadata();
    expect([squareMeta.width, squareMeta.height]).toEqual([512, 512]);

    // Made once, then served from storage.
    const cached = await storage.read(`previews/${(await t.db.select({ id: s.initiatives.coverFileId }).from(s.initiatives).where(eq(s.initiatives.slug, 'wide-photo-preview')))[0]!.id}-v1.jpg`);
    expect(cached?.length).toBe((wide.body as Buffer).length);
  });
});

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
