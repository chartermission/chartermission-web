import { eq } from 'drizzle-orm';
import { DEFAULT_FIELD_VISIBILITY, MemberProfile, OwnProfile, type FieldVisibilityMap } from '@chartermission/contracts';
import { client, createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits, setLimitCounter } from '../auth/support.js';

/** PrivacySettingsInput.fieldVisibility is a complete map (zod 4 enum-keyed record). */
const vis = (overrides: FieldVisibilityMap | Record<string, string>) => ({ ...DEFAULT_FIELD_VISIBILITY, ...overrides });

async function connect(a: Awaited<ReturnType<typeof createMember>>, b: Awaited<ReturnType<typeof createMember>>) {
  const req = await a.post('/connections', { memberId: b.id }).expect(201);
  await b.post(`/connections/${req.body.id}/accept`).expect(200);
}

describe('Profiles: per-viewer allow-list, privacy, directory (spec 4.3, 4.6)', () => {
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

  it('contract test: a non-connection never receives connection-only fields (CM-PRF-02/03)', async () => {
    const owner = await createMember(t, { name: 'Wanjiru Kamau', countryCode: 'KE' });
    const stranger = await createMember(t, { name: 'Stranger Member' });
    const friend = await createMember(t, { name: 'Friend Member' });
    const mod = await createMember(t, { name: 'Admin Viewer', roles: ['moderator'], admin: true });
    const tax = (await client(t).get('/taxonomies')).body;

    await owner
      .patch('/me/profile', {
        bio: 'Climate policy analyst.',
        organisation: 'Green Futures',
        city: 'Nairobi',
        website: 'https://example.org',
        skillIds: [tax.skills[0].id],
        sectorIds: [tax.sectors[0].id],
        experience: [{ title: 'Analyst', organisation: 'Green Futures', startDate: '2022-01' }],
      })
      .expect(200);
    await owner
      .put('/me/privacy', {
        profileVisibility: 'public',
        fieldVisibility: vis({ bio: 'connections', organisation: 'connections', experience: 'connections', skills: 'only_me', location: 'public', email: 'members' }),
      })
      .expect(200);
    await connect(owner, friend);

    const asStranger = (await stranger.get(`/members/${owner.handle}`).expect(200)).body;
    expect(MemberProfile.parse(asStranger)).toBeTruthy();
    for (const hidden of ['bio', 'organisation', 'experience', 'skills']) expect(asStranger).not.toHaveProperty(hidden);
    expect(asStranger.email).toBe(owner.email);
    expect(asStranger.country).toEqual({ code: 'KE', name: 'Kenya' });
    expect(asStranger.sectors).toHaveLength(1);
    expect(asStranger.relationship).toMatchObject({ self: false, connection: 'none' });

    const asFriend = (await friend.get(`/members/${owner.handle}`).expect(200)).body;
    expect(MemberProfile.parse(asFriend)).toBeTruthy();
    expect(asFriend.bio).toBe('Climate policy analyst.');
    expect(asFriend.organisation).toBe('Green Futures');
    expect(asFriend.experience).toHaveLength(1);
    expect(asFriend).not.toHaveProperty('skills');
    expect(asFriend.relationship.connection).toBe('connected');
    expect(asFriend.counts.connections).toBe(1);

    const anonymous = (await t.http().get(`/api/v1/members/${owner.handle}`).expect(200)).body;
    expect(MemberProfile.parse(anonymous)).toBeTruthy();
    for (const hidden of ['bio', 'organisation', 'experience', 'skills', 'email', 'sectors', 'website']) {
      expect(anonymous).not.toHaveProperty(hidden);
    }
    expect(anonymous.city).toBe('Nairobi');

    const self = (await owner.get(`/members/${owner.handle}`).expect(200)).body;
    expect(self.skills).toHaveLength(1);
    expect(self.relationship.self).toBe(true);

    const asAdmin = (await mod.get(`/members/${owner.handle}`).expect(200)).body;
    expect(asAdmin.skills).toHaveLength(1);

    // Members-only profiles return 401 to visitors.
    await owner.put('/me/privacy', { profileVisibility: 'members' }).expect(200);
    const visitor = await t.http().get(`/api/v1/members/${owner.handle}`).expect(401);
    expect(visitor.body.error.code).toBe('UNAUTHENTICATED');
    await t.http().get('/api/v1/members/no-such-member').expect(404);

    // Lookup by id works too.
    await stranger.get(`/members/${owner.id}`).expect(200);
  });

  it('previews the own profile as public, member and connection (CM-PRF-05)', async () => {
    const owner = await createMember(t, { name: 'Preview Owner' });
    await owner.patch('/me/profile', { bio: 'Hello there', organisation: 'Org' }).expect(200);
    await owner.put('/me/privacy', { fieldVisibility: vis({ bio: 'connections', organisation: 'public' }) }).expect(200);
    const pub = (await owner.get('/me/profile/preview?as=public').expect(200)).body;
    expect(pub).not.toHaveProperty('bio');
    expect(pub.organisation).toBe('Org');
    const member = (await owner.get('/me/profile/preview?as=member').expect(200)).body;
    expect(member).not.toHaveProperty('bio');
    const conn = (await owner.get('/me/profile/preview?as=connection').expect(200)).body;
    expect(conn.bio).toBe('Hello there');
    expect(conn).not.toHaveProperty('email');
    await owner.get('/me/profile/preview?as=admin').expect(422);
  });

  it('own profile: completeness from non-sensitive fields, handle conflicts, avatar ownership', async () => {
    const a = await createMember(t, { name: 'Handle Owner', handle: 'taken-handle' });
    const b = await createMember(t, { name: 'Profile Editor' });
    const before = OwnProfile.parse((await b.get('/me/profile').expect(200)).body);
    expect(before.completeness.missing).toEqual(expect.arrayContaining(['bio', 'headline', 'avatar']));
    expect(before.completeness.missing).not.toContain('website');
    expect(before.completeness.missing).not.toContain('email');
    expect(before.fieldVisibility.email).toBe('only_me');

    const conflict = await b.patch('/me/profile', { handle: 'Taken-Handle' }).expect(409);
    expect(conflict.body.error.fields.handle).toBeTruthy();
    await b.patch('/me/profile', { handle: 'suggestions' }).expect(422);

    // Someone else's avatar upload is refused; your own clean avatar is accepted.
    const [foreign] = await t.db
      .insert(s.files)
      .values({ ownerId: a.id, purpose: 'avatar', storageKey: 'k1', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    const [mine] = await t.db
      .insert(s.files)
      .values({ ownerId: b.id, purpose: 'avatar', storageKey: 'k2', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'clean' })
      .returning();
    const [pending] = await t.db
      .insert(s.files)
      .values({ ownerId: b.id, purpose: 'avatar', storageKey: 'k3', declaredMime: 'image/png', mime: 'image/png', sizeBytes: 10, scanStatus: 'pending' })
      .returning();
    expect((await b.patch('/me/profile', { avatarFileId: foreign!.id }).expect(422)).body.error.fields.avatarFileId).toBeTruthy();
    await b.patch('/me/profile', { avatarFileId: pending!.id }).expect(422);

    const after = await b
      .patch('/me/profile', { avatarFileId: mine!.id, headline: 'Builder', bio: 'Bio', handle: 'new-handle' })
      .expect(200);
    expect(after.body.handle).toBe('new-handle');
    expect(after.body.avatarUrl).toContain(`/media/${mine!.id}`);
    expect(after.body.completeness.percent).toBeGreaterThan(before.completeness.percent);
    await b.get('/members/new-handle').expect(200);
  });

  it('blocked either way: profile 404, cannot connect or follow; connection and follows removed', async () => {
    const a = await createMember(t, { name: 'Blocker Member' });
    const b = await createMember(t, { name: 'Blocked Member' });
    await connect(a, b);
    await a.post('/follows', { targetType: 'member', targetId: b.id }).expect(201);
    await b.post('/follows', { targetType: 'member', targetId: a.id }).expect(201);

    await a.post(`/blocks/${b.id}`).expect(201);
    await b.get(`/members/${a.handle}`).expect(404);
    await a.get(`/members/${b.handle}`).expect(404);
    expect((await b.post('/connections', { memberId: a.id }).expect(404)).body.error.code).toBe('NOT_FOUND');
    await b.post('/follows', { targetType: 'member', targetId: a.id }).expect(404);
    await a.post('/follows', { targetType: 'member', targetId: b.id }).expect(404);

    const follows = await t.db.select().from(s.follows).where(eq(s.follows.targetType, 'member'));
    expect(follows.filter((f) => [a.id, b.id].includes(f.followerId) && [a.id, b.id].includes(f.targetId))).toHaveLength(0);
    expect((await a.get('/me/connections?filter=connected').expect(200)).body.items).toHaveLength(0);

    // Only the blocker sees the block.
    expect((await a.get('/me/blocks').expect(200)).body.map((x: { member: { id: string } }) => x.member.id)).toEqual([b.id]);
    expect((await b.get('/me/blocks').expect(200)).body).toEqual([]);

    await a.delete(`/blocks/${b.id}`).expect(200);
    await b.get(`/members/${a.handle}`).expect(200);
  });

  it('directory: only discoverable active members; never matches hidden fields', async () => {
    const viewer = await createMember(t, { name: 'Directory Viewer' });
    const visible = await createMember(t, { name: 'Oluwaseun Adebayo', countryCode: 'NG' });
    const hidden = await createMember(t, { name: 'Oluwaseun Hidden', countryCode: 'NG' });
    const secretOrg = await createMember(t, { name: 'Secret Org Person', countryCode: 'SN' });
    const unverified = await createMember(t, { name: 'Oluwaseun Unverified', verified: false });
    await hidden.put('/me/privacy', { discoverable: false }).expect(200);
    await secretOrg.patch('/me/profile', { organisation: 'Quantum Baobab Labs' }).expect(200);
    await secretOrg.put('/me/privacy', { fieldVisibility: vis({ organisation: 'connections', location: 'only_me' }) }).expect(200);

    const byName = await viewer.get('/members?q=oluwaseun').expect(200);
    const ids = byName.body.items.map((m: { id: string }) => m.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(unverified.id);
    expect(ids).not.toContain(viewer.id);

    // Typo tolerance via trigram similarity.
    const typo = await viewer.get('/members?q=Oluwasen').expect(200);
    expect(typo.body.items.map((m: { id: string }) => m.id)).toContain(visible.id);

    // Organisation is connections-only: no match for a stranger, a match for a connection.
    expect((await viewer.get('/members?q=Quantum%20Baobab').expect(200)).body.items).toHaveLength(0);
    // Location is only_me: the country filter never matches it.
    const sn = await viewer.get('/members?country=SN').expect(200);
    expect(sn.body.items.map((m: { id: string }) => m.id)).not.toContain(secretOrg.id);
    await connect(viewer, secretOrg);
    const asConnection = await viewer.get('/members?q=Quantum%20Baobab').expect(200);
    expect(asConnection.body.items.map((m: { id: string }) => m.id)).toEqual([secretOrg.id]);
    expect(asConnection.body.items[0].location).toBeNull();
    expect(asConnection.body.items[0].relationship.connection).toBe('connected');

    const ng = await viewer.get('/members?country=NG&sort=name').expect(200);
    expect(ng.body.items.find((m: { id: string }) => m.id === visible.id)?.location).toBe('Nigeria');

    // Blocked members are excluded.
    await visible.post(`/blocks/${viewer.id}`).expect(201);
    expect((await viewer.get('/members?q=oluwaseun').expect(200)).body.items).toHaveLength(0);
  });

  it('directory: filters by sector and skill, sorts and paginates with a cursor', async () => {
    const viewer = await createMember(t, { name: 'Paging Viewer' });
    const tax = (await client(t).get('/taxonomies')).body;
    const sector = tax.sectors[2];
    const people = [];
    for (const name of ['Paging Alpha', 'Paging Bravo', 'Paging Charlie']) {
      const p = await createMember(t, { name });
      await p.patch('/me/profile', { sectorIds: [sector.id] }).expect(200);
      people.push(p);
    }
    const page1 = await viewer.get(`/members?sector=${sector.slug}&sort=name&limit=2`).expect(200);
    expect(page1.body.items.map((m: { name: string }) => m.name)).toEqual(['Paging Alpha', 'Paging Bravo']);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await viewer.get(`/members?sector=${sector.id}&sort=name&limit=2&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items.map((m: { name: string }) => m.name)).toEqual(['Paging Charlie']);
    expect(page2.body.nextCursor).toBeNull();

    const recent = await viewer.get(`/members?sector=${sector.slug}&sort=recent&limit=1`).expect(200);
    expect(recent.body.items[0].id).toBe(people[2]!.id);
    const recent2 = await viewer.get(`/members?sector=${sector.slug}&sort=recent&limit=1&cursor=${recent.body.nextCursor}`).expect(200);
    expect(recent2.body.items[0].id).toBe(people[1]!.id);

    const rel = await viewer.get('/members?q=Paging&limit=2').expect(200);
    const rel2 = await viewer.get(`/members?q=Paging&limit=2&cursor=${rel.body.nextCursor}`).expect(200);
    const all = [...rel.body.items, ...rel2.body.items].map((m: { id: string }) => m.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining(people.map((p) => p.id)));

    expect((await viewer.get('/members?sector=unknown-sector').expect(200)).body.items).toEqual([]);
    expect((await viewer.get(`/members?skill=${tax.skills[0].slug}`).expect(200)).body.items).toEqual([]);
    await t.http().get('/api/v1/members').expect(401);
  });

  it('directory is rate-limited to 60 per minute per member', async () => {
    const viewer = await createMember(t, { name: 'Busy Searcher' });
    await setLimitCounter(`directory:${viewer.id}`, 60);
    expect((await viewer.get('/members?q=x').expect(429)).headers['retry-after']).toBeTruthy();
  });
});
