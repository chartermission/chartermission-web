import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { assertSafeToSeedDemo, seedReference } from '../../src/db/seed.js';
import { BADGES, CHAPTERS, COUNTRIES, FEATURED_HASHTAGS, MEMBERS, REGION_HASHTAGS } from '../../src/db/seed-data.js';

describe('Admin catalogues: chapters, topics, badges and members', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createMember>>;
  let mod: Awaited<ReturnType<typeof createMember>>;
  let member: Awaited<ReturnType<typeof createMember>>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Amara Okafor', countryCode: 'GH' });
  });
  afterAll(() => t.close());

  it('seeds every country, a chapter per African and diaspora country, featured topics and badges', async () => {
    const countries = await t.db.select().from(s.countries);
    expect(countries.length).toBe(COUNTRIES.length);
    expect(countries.find((c) => c.code === 'PK')).toMatchObject({ name: 'Pakistan', region: 'Diaspora' });
    expect(countries.filter((c) => c.region !== 'Diaspora').length).toBeGreaterThanOrEqual(54);

    const chapters = await t.db.select().from(s.chapters);
    expect(chapters.length).toBe(CHAPTERS.length);
    expect(chapters.length).toBeGreaterThanOrEqual(54 + 19);

    const topics = await t.db.select().from(s.hashtags).where(eq(s.hashtags.featured, true));
    expect(topics.length).toBe(FEATURED_HASHTAGS.length + REGION_HASHTAGS.length);
    const badges = await t.db.select().from(s.badges);
    expect(badges.map((b) => b.slug)).toEqual(expect.arrayContaining(BADGES.map((b) => b.slug)));

    const tax = await member.get('/taxonomies').expect(200);
    expect(tax.body.countries.some((c: { code: string }) => c.code === 'PK')).toBe(true);
  });

  it('gives every chapter its own hashtag and an About text written for its country', async () => {
    const chapters = await t.db.select().from(s.chapters);
    expect(chapters.every((c) => !!c.about && !!c.hashtag)).toBe(true);
    const by = (slug: string) => chapters.find((c) => c.slug === slug)!;
    expect(by('nigeria')).toMatchObject({ hashtag: 'Nigeria' });
    expect(by('nigeria').about).toMatch(/^The Nigeria Chapter is the home on Charter Mission for members living, working and building in Nigeria\./);
    expect(by('nigeria').about).toContain('#Nigeria');
    expect(by('united-kingdom')).toMatchObject({ hashtag: 'UKDiaspora' });
    expect(by('united-kingdom').about).toMatch(/^The UK Diaspora Chapter brings together members of the African diaspora in the United Kingdom/);
    expect(by('cote-divoire').hashtag).toBe('CoteDIvoire');
    expect(by('sao-tome-and-principe').hashtag).toBe('SaoTomeAndPrincipe');
    expect(by('dr-congo').about).toContain('in the Democratic Republic of the Congo');
    // One hashtag per chapter, all different, each a valid topic that exists but isn't featured.
    const tags = chapters.map((c) => c.hashtag!);
    expect(new Set(tags.map((x) => x.toLowerCase())).size).toBe(chapters.length);
    expect(tags.every((x) => /^[A-Za-z0-9_]{2,50}$/.test(x))).toBe(true);
    expect(chapters.every((c) => c.about!.length <= 1000)).toBe(true);
    const [topic] = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'nigeria'));
    expect(topic).toMatchObject({ display: 'Nigeria', featured: false, status: 'active' });
    expect(topic!.description).toContain('Nigeria Chapter');

    // Members see it on the chapter, and can follow the topic.
    const detail = await member.get('/chapters/nigeria').expect(200);
    expect(detail.body).toMatchObject({ hashtag: 'Nigeria' });
    expect(detail.body.about).toContain('Nigeria');
    await member.post('/follows', { targetType: 'hashtag', targetId: 'Nigeria' }).expect(201);
  });

  it('upgrading a live database fills the gaps and leaves what people changed alone', async () => {
    // A database from before chapter profiles (chapters v2, hashtags v1), with edits made since.
    await t.db.update(s.chapters).set({ about: null, hashtag: null });
    await t.db.update(s.chapters).set({ about: 'We meet on the first Friday in Accra.' }).where(eq(s.chapters.slug, 'ghana'));
    await t.db.update(s.chapters).set({ hashtag: 'KenyaBuilds' }).where(eq(s.chapters.slug, 'kenya'));
    await t.db.delete(s.chapters).where(eq(s.chapters.slug, 'comoros'));
    await t.db.update(s.hashtags).set({ featured: false }).where(eq(s.hashtags.tag, 'tourism'));
    await t.db.delete(s.hashtags).where(eq(s.hashtags.tag, 'westafrica'));
    await t.db.insert(s.chapters).values({ slug: 'pk-test', name: 'Pakistan Diaspora Chapter', countryCode: 'PK' });
    await t.db.update(s.platformSettings).set({ value: { chapters: 2, hashtags: 1, badges: 1 } }).where(eq(s.platformSettings.key, 'reference_seeds'));

    await seedReference(t.db);

    const chapters = await t.db.select().from(s.chapters);
    const by = (slug: string) => chapters.find((c) => c.slug === slug);
    // Text an Ambassador wrote and a hashtag an admin chose are kept; only the gaps are filled.
    expect(by('ghana')).toMatchObject({ about: 'We meet on the first Friday in Accra.', hashtag: 'Ghana' });
    expect(by('kenya')!.hashtag).toBe('KenyaBuilds');
    expect(by('kenya')!.about).toContain('#KenyaBuilds');
    expect(by('senegal')).toMatchObject({ hashtag: 'Senegal' });
    // A chapter an admin removed stays removed; one they added is included.
    expect(by('comoros')).toBeUndefined();
    expect(by('pk-test')).toMatchObject({ hashtag: 'PakistanDiaspora' });
    expect(chapters.every((c) => !!c.about && !!c.hashtag)).toBe(true);
    // A topic an admin un-featured stays un-featured; the new regional topics arrive featured.
    const topics = await t.db.select().from(s.hashtags);
    expect(topics.find((x) => x.tag === 'tourism')!.featured).toBe(false);
    expect(topics.find((x) => x.tag === 'westafrica')).toMatchObject({ display: 'WestAfrica', featured: true });

    // Running it again changes nothing.
    await t.db.update(s.chapters).set({ about: 'Edited after the upgrade.' }).where(eq(s.chapters.slug, 'senegal'));
    await seedReference(t.db);
    const [senegal] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'senegal'));
    expect(senegal!.about).toBe('Edited after the upgrade.');
    await t.db.delete(s.chapters).where(eq(s.chapters.slug, 'pk-test'));
    await t.db.update(s.hashtags).set({ featured: true }).where(eq(s.hashtags.tag, 'tourism'));
  });

  it('the demo seed and reset refuse a database that has real accounts', async () => {
    // Demo accounts and test accounts on the reserved example domains don't count as real.
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts', '--reset'])).resolves.toBeUndefined();
    // One real member is enough to stop both commands.
    const [real] = await t.db.insert(s.users).values({ email: 'Real.Member@gmail.com', passwordHash: 'x', status: 'active' }).returning({ id: s.users.id });
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts'])).rejects.toThrow(/Refusing to add demo accounts.*real account/s);
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts', '--reset'])).rejects.toThrow(/Refusing to reset \(this deletes every member/);
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts', '--reset', '--confirm-database=production'])).rejects.toThrow(/Refusing/);
    const [{ name }] = (await t.db.execute<{ name: string }>(sql`select current_database() as name`)).rows as [{ name: string }];
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts', '--reset', `--confirm-database=${name}`])).resolves.toBeUndefined();
    // The seeded staff accounts are demo accounts even though they aren't on an example domain.
    await t.db.update(s.users).set({ email: MEMBERS.find((m) => m.roles?.includes('super_admin'))!.email }).where(eq(s.users.id, real!.id));
    await expect(assertSafeToSeedDemo(t.db, ['node', 'seed.ts', '--reset'])).resolves.toBeUndefined();
    await t.db.delete(s.users).where(eq(s.users.id, real!.id));
  });

  it('a removed seeded chapter is not re-created on the next start', async () => {
    const res = await admin.get('/admin/chapters?q=Lesotho').expect(200);
    const lesotho = res.body.find((c: { slug: string }) => c.slug === 'lesotho');
    await admin.delete(`/admin/chapters/${lesotho.id}`).expect(200);
    await seedReference(t.db);
    const after = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'lesotho'));
    expect(after).toHaveLength(0);
  });

  it('creates, deactivates, reactivates and removes chapters; members only see active ones', async () => {
    await mod.get('/admin/chapters').expect(403);
    const created = await admin.post('/admin/chapters', { name: 'Pakistan Diaspora Chapter', countryCode: 'PK' }).expect(201);
    expect(created.body).toMatchObject({ slug: 'pakistan-diaspora', status: 'active', countryName: 'Pakistan', imageUrl: null, hashtag: 'PakistanDiaspora' });
    expect(created.body.about).toContain('African diaspora in Pakistan');
    expect((await admin.patch(`/admin/chapters/${created.body.id}`, { hashtag: '#PakistanBuilds' }).expect(200)).body.hashtag).toBe('PakistanBuilds');
    await admin.patch(`/admin/chapters/${created.body.id}`, { hashtag: 'two words' }).expect(422);
    expect(await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'pakistanbuilds'))).toHaveLength(1);
    await admin.post('/admin/chapters', { name: 'Pakistan Diaspora Chapter', countryCode: 'PK' }).expect(422);

    let list = await member.get('/chapters').expect(200);
    expect(list.body.some((c: { slug: string }) => c.slug === 'pakistan-diaspora')).toBe(true);

    await admin.patch(`/admin/chapters/${created.body.id}`, { status: 'dormant' }).expect(200);
    list = await member.get('/chapters').expect(200);
    expect(list.body.some((c: { slug: string }) => c.slug === 'pakistan-diaspora')).toBe(false);

    const renamed = await admin.patch(`/admin/chapters/${created.body.id}`, { status: 'active', name: 'Pakistan Chapter' }).expect(200);
    expect(renamed.body).toMatchObject({ name: 'Pakistan Chapter', status: 'active' });

    // A chapter someone follows can't be removed, only deactivated.
    await member.post('/follows', { targetType: 'chapter', targetId: created.body.id }).expect((r) => expect(r.status).toBeLessThan(300));
    const blocked = await admin.delete(`/admin/chapters/${created.body.id}`).expect(409);
    expect(blocked.body.error.message).toMatch(/Deactivate it instead/);

    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, created.body.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['chapter.created', 'chapter.deactivated', 'chapter.activated']));
  });

  it('only admins can upload chapter pictures; a clean upload becomes the chapter picture and cover', async () => {
    await member.post('/uploads', { purpose: 'chapter_image', fileName: 'ng.png', mime: 'image/png', sizeBytes: 1000 }).expect(403);
    const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'nigeria'));
    // A file of the wrong purpose is refused.
    const [wrong] = await t.db
      .insert(s.files)
      .values({ ownerId: admin.id, purpose: 'avatar', storageKey: 'x/1', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    await admin.patch(`/admin/chapters/${chapter!.id}`, { imageFileId: wrong!.id }).expect(422);
    const [image] = await t.db
      .insert(s.files)
      .values({ ownerId: admin.id, purpose: 'chapter_image', storageKey: 'x/2', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    const [cover] = await t.db
      .insert(s.files)
      .values({ ownerId: admin.id, purpose: 'chapter_cover', storageKey: 'x/3', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    const res = await admin.patch(`/admin/chapters/${chapter!.id}`, { imageFileId: image!.id, coverFileId: cover!.id }).expect(200);
    expect(res.body.imageUrl).toBe(`/api/v1/media/${image!.id}`);
    expect(res.body.coverUrl).toBe(`/api/v1/media/${cover!.id}`);
    const detail = await member.get('/chapters/nigeria').expect(200);
    expect(detail.body).toMatchObject({ imageUrl: `/api/v1/media/${image!.id}`, coverUrl: `/api/v1/media/${cover!.id}` });

    await admin.patch(`/admin/chapters/${chapter!.id}`, { imageFileId: null }).expect(200);
    expect((await member.get('/chapters/nigeria').expect(200)).body.imageUrl).toBeNull();
  });

  it('topics: add, feature, deactivate (out of search and suggestions) and remove unused', async () => {
    const added = await mod.post('/admin/topics', { tag: '#BlueEconomy', description: 'Oceans and coasts' }).expect(201);
    expect(added.body).toMatchObject({ tag: 'blueeconomy', display: 'BlueEconomy', featured: true, status: 'active' });

    let suggest = await member.get('/hashtags/suggest?q=blue').expect(200);
    expect(suggest.body.map((x: { tag: string }) => x.tag)).toContain('BlueEconomy');
    let topics = await member.get('/topics?q=blue').expect(200);
    expect(topics.body.items.map((x: { tag: string }) => x.tag)).toContain('BlueEconomy');

    await mod.patch(`/admin/topics/${added.body.id}`, { status: 'disabled' }).expect(200);
    suggest = await member.get('/hashtags/suggest?q=blue').expect(200);
    expect(suggest.body).toHaveLength(0);
    topics = await member.get('/topics?q=blue').expect(200);
    expect(topics.body.items).toHaveLength(0);

    await mod.patch(`/admin/topics/${added.body.id}`, { display: 'Blueeconomy' }).expect(200);
    await mod.patch(`/admin/topics/${added.body.id}`, { display: 'GreenEconomy' }).expect(422);

    const onboarding = await member.get('/me/onboarding').expect(200);
    const suggested = onboarding.body.suggestions.hashtags.map((h: { tag: string }) => h.tag);
    expect(suggested).not.toContain('Blueeconomy');
    expect([...FEATURED_HASHTAGS, ...REGION_HASHTAGS].map(([d]) => d)).toEqual(expect.arrayContaining(suggested));

    await mod.delete(`/admin/topics/${added.body.id}`).expect(200);
    const used = await t.db.select().from(s.hashtags).where(eq(s.hashtags.tag, 'afcfta'));
    await t.db.update(s.hashtags).set({ postCount: 3 }).where(eq(s.hashtags.id, used[0]!.id));
    await mod.delete(`/admin/topics/${used[0]!.id}`).expect(409);
  });

  it('badges: create, award, show on the profile, hide when disabled, revoke', async () => {
    await mod.post('/admin/badges', { name: 'Ambassador of the Month' }).expect(403);
    const created = await admin.post('/admin/badges', { name: 'Ambassador of the Month', tone: 'accent', icon: 'flame' }).expect(201);
    expect(created.body).toMatchObject({ slug: 'ambassador-of-the-month', holders: 0, status: 'active' });
    const topVoice = (await admin.get('/admin/badges').expect(200)).body.find((b: { slug: string }) => b.slug === 'top-voice');

    await admin.post(`/admin/members/${member.id}/badges`, { badgeId: topVoice.id, note: 'Great posts' }).expect(201);
    const row = await admin.post(`/admin/members/${member.id}/badges`, { badgeId: created.body.id }).expect(201);
    expect(row.body.badges.map((b: { slug: string }) => b.slug)).toEqual(['top-voice', 'ambassador-of-the-month']);

    let profile = await (await createMember(t, { name: 'Viewer' })).get(`/members/${member.handle}`).expect(200);
    expect(profile.body.badges.map((b: { name: string }) => b.name)).toEqual(['Top Voice', 'Ambassador of the Month']);

    await admin.patch(`/admin/badges/${created.body.id}`, { status: 'disabled' }).expect(200);
    profile = await member.get(`/members/${member.handle}`).expect(200);
    expect(profile.body.badges.map((b: { name: string }) => b.name)).toEqual(['Top Voice']);
    await admin.post(`/admin/members/${member.id}/badges`, { badgeId: created.body.id }).expect(422);

    const revoked = await admin.delete(`/admin/members/${member.id}/badges/${topVoice.id}`).expect(200);
    expect(revoked.body.badges.map((b: { slug: string }) => b.slug)).toEqual(['ambassador-of-the-month']);
    await admin.delete(`/admin/badges/${created.body.id}`).expect(200);
    expect((await admin.get(`/admin/members/${member.id}`).expect(200)).body.badges).toEqual([]);
  });

  it('verified tick and featured suggestions on sign-up', async () => {
    const search = await admin.get(`/admin/members?q=${encodeURIComponent('amara')}`).expect(200);
    expect(search.body.items.map((m: { id: string }) => m.id)).toContain(member.id);
    await mod.get('/admin/members').expect(403);

    const verified = await admin.put(`/admin/members/${member.id}/verified`, { verified: true }).expect(200);
    expect(verified.body.verified).toBe(true);
    const viewer = await createMember(t, { name: 'Brand New', countryCode: 'KE' });
    expect((await viewer.get(`/members/${member.handle}`).expect(200)).body.verified).toBe(true);
    expect((await admin.get('/admin/members?filter=verified').expect(200)).body.items.map((m: { id: string }) => m.id)).toContain(member.id);

    // A new member in Kenya shares nothing with Amara (Ghana) but is offered her once she's featured.
    let onboarding = await viewer.get('/me/onboarding').expect(200);
    expect(onboarding.body.suggestions.members.map((m: { id: string }) => m.id)).not.toContain(member.id);
    await admin.put(`/admin/members/${member.id}/featured`, { featured: true }).expect(200);
    onboarding = await viewer.get('/me/onboarding').expect(200);
    expect(onboarding.body.suggestions.members[0]).toMatchObject({ id: member.id, reason: 'Recommended by Charter Mission' });
    expect((await admin.get('/admin/members?filter=featured').expect(200)).body.items.map((m: { id: string }) => m.id)).toEqual([member.id]);

    await admin.put(`/admin/members/${member.id}/featured`, { featured: false }).expect(200);
    await admin.put(`/admin/members/${member.id}/verified`, { verified: false }).expect(200);
    expect((await viewer.get(`/members/${member.handle}`).expect(200)).body.verified).toBe(false);
    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, member.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['member.verified', 'member.featured', 'member.unfeatured', 'member.unverified', 'member.badge_awarded']));
  });

  it('the admin console can load media without the audience header (img tags can’t send it)', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const key = 'uploads/avatar/admin-media-test';
    const path = join(process.env.STORAGE_LOCAL_DIR!, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const [file] = await t.db
      .insert(s.files)
      .values({ ownerId: member.id, purpose: 'avatar', storageKey: key, declaredMime: 'image/png', mime: 'image/png', sizeBytes: 4, scanStatus: 'clean' })
      .returning();
    // A plain GET with only the admin cookie, as an <img> on admin.chartermission.com sends it.
    await admin.agent.get(`/api/v1/media/${file!.id}`).expect(200);
    // Writes and other routes still need the header: the admin cookie alone isn't a member session.
    await admin.agent.get('/api/v1/me').expect(401);
    // Signed-out requests are still refused.
    await t.http().get(`/api/v1/media/${file!.id}`).expect(401);
  });
});
