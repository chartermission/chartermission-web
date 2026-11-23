import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;
type Row = { id: string; name: string; emailVerified: boolean; lastActiveAt: string | null; chapterNames: string[] };

/** Parses the simple CSV the export writes (quoted cells may hold commas). */
function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
          cells.push(cur);
          cur = '';
        } else cur += c;
      }
      cells.push(cur);
      return cells;
    });
}

describe('Admin Members page: filters, export, batch changes and the detail panel', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let plain: Member;
  // Everyone below is called "Filterable …", so a search keeps the other accounts out of the way.
  let ada: Member; // Ghana, chapter follower, skill + sector, photo, referred by Bola, two-step on, old account
  let bola: Member; // Kenya, event host, interest + language, invited Ada
  let chidi: Member; // Nigeria, unverified email, suspended
  let dayo: Member; // Nigeria, official account, chapter lead (role in the chapter)
  let chapterId: string;
  let skillId: string;
  let sectorId: string;
  let interestId: string;
  let languageId: string;

  const ids = async (query: string) => {
    const res = await admin.get(`/admin/members?q=Filterable&limit=50&${query}`).expect(200);
    return (res.body.items as Row[]).map((r) => r.id).sort((a, b) => a.localeCompare(b));
  };
  const sorted = (...members: Member[]) => members.map((m) => m.id).sort((a, b) => a.localeCompare(b));

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    plain = await createMember(t, { name: 'Plain Member' });
    await t.db.update(s.users).set({ isStaff: true }).where(inArray(s.users.id, [admin.id, mod.id]));
    ada = await createMember(t, { name: 'Filterable Ada', countryCode: 'GH', mfa: true });
    bola = await createMember(t, { name: 'Filterable Bola', countryCode: 'KE', roles: ['event_host'] });
    chidi = await createMember(t, { name: 'Filterable Chidi', countryCode: 'NG', verified: false, status: 'suspended' });
    dayo = await createMember(t, { name: 'Filterable Dayo', countryCode: 'NG' });

    const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'ghana'));
    chapterId = chapter!.id;
    await t.db.insert(s.follows).values({ followerId: ada.id, targetType: 'chapter', targetId: chapterId });
    const [lead] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'chapter_lead'));
    await t.db.insert(s.userRoles).values({ userId: dayo.id, roleId: lead!.id, scopeType: 'chapter', scopeId: chapterId });
    await t.db.update(s.users).set({ isOfficial: true }).where(eq(s.users.id, dayo.id));

    const [skill] = await t.db.insert(s.skills).values({ slug: 'filter-skill', name: 'Filter skill' }).returning();
    const [sector] = await t.db.insert(s.sectors).values({ slug: 'filter-sector', name: 'Filter sector' }).returning();
    const [interest] = await t.db.insert(s.interests).values({ slug: 'filter-interest', name: 'Filter interest' }).returning();
    const [language] = await t.db.insert(s.languages).values({ slug: 'filter-language', name: 'Filter language' }).returning();
    [skillId, sectorId, interestId, languageId] = [skill!.id, sector!.id, interest!.id, language!.id];
    await t.db.insert(s.profileSkills).values({ userId: ada.id, itemId: skillId });
    await t.db.insert(s.profileSectors).values({ userId: ada.id, itemId: sectorId });
    await t.db.insert(s.profileInterests).values({ userId: bola.id, itemId: interestId });
    await t.db.insert(s.profileLanguages).values({ userId: bola.id, itemId: languageId });

    await t.db.update(s.memberProfiles).set({ avatarFileId: '00000000-0000-4000-8000-000000000001', city: 'Accra' }).where(eq(s.memberProfiles.userId, ada.id));
    await t.db.insert(s.referrals).values({ inviterId: bola.id, inviteeId: ada.id });
    await t.db.update(s.users).set({ createdAt: new Date('2025-03-10T12:00:00Z') }).where(eq(s.users.id, ada.id));
  });
  afterAll(() => t.close());

  it('each filter narrows the list', async () => {
    expect(await ids('')).toEqual(sorted(ada, bola, chidi, dayo));
    expect(await ids('country=GH')).toEqual(sorted(ada));
    expect(await ids('country=ng')).toEqual(sorted(chidi, dayo));
    // In the chapter: follows it (Ada) or holds a role in it (Dayo).
    expect(await ids(`chapter=${chapterId}`)).toEqual(sorted(ada, dayo));
    expect(await ids('status=suspended')).toEqual(sorted(chidi));
    expect(await ids('status=active')).toEqual(sorted(ada, bola, dayo));
    expect(await ids('role=event_host')).toEqual(sorted(bola));
    expect(await ids('role=official')).toEqual(sorted(dayo));
    expect(await ids('role=moderator')).toEqual([]);
    expect((await admin.get('/admin/members?role=team&limit=50').expect(200)).body.items.map((r: Row) => r.id)).toEqual(
      expect.arrayContaining([admin.id, mod.id]),
    );
    expect(await ids('joinedTo=2025-03-10')).toEqual(sorted(ada));
    expect(await ids('joinedFrom=2025-03-11')).toEqual(sorted(bola, chidi, dayo));
    expect(await ids('joinedFrom=2025-03-10&joinedTo=2025-03-10')).toEqual(sorted(ada));
    expect(await ids('emailVerified=no')).toEqual(sorted(chidi));
    expect(await ids('emailVerified=yes')).toEqual(sorted(ada, bola, dayo));
    expect(await ids('twoStep=on')).toEqual(sorted(ada));
    expect(await ids('twoStep=off')).toEqual(sorted(bola, chidi, dayo));
    expect(await ids('photo=yes')).toEqual(sorted(ada));
    expect(await ids('photo=no')).toEqual(sorted(bola, chidi, dayo));
    expect(await ids('referred=yes')).toEqual(sorted(ada));
    expect(await ids('referred=no')).toEqual(sorted(bola, chidi, dayo));
    expect(await ids(`skill=${skillId}`)).toEqual(sorted(ada));
    expect(await ids(`sector=${sectorId}`)).toEqual(sorted(ada));
    expect(await ids(`interest=${interestId}`)).toEqual(sorted(bola));
    expect(await ids(`language=${languageId}`)).toEqual(sorted(bola));
    // Filters combine, and the quick filters still work alongside them.
    expect(await ids(`country=NG&role=official`)).toEqual(sorted(dayo));
    expect(await ids(`country=GH&filter=verified`)).toEqual([]);

    const page = (await admin.get('/admin/members?q=Filterable&country=NG').expect(200)).body;
    expect(page.total).toBe(2);
    expect(page.counts.all).toBeGreaterThanOrEqual(7);

    await admin.get('/admin/members?joinedFrom=2025-04-01&joinedTo=2025-03-01').expect(422);
    await admin.get('/admin/members?joinedFrom=2025-02-30').expect(422);
    await admin.get('/admin/members?status=deleted').expect(422);
    await admin.get('/admin/members?chapter=ghana').expect(422);
    await mod.get('/admin/members?country=GH').expect(403);
  });

  it('rows carry email confirmation, last activity and chapters', async () => {
    const rows = (await admin.get('/admin/members?q=Filterable&limit=50').expect(200)).body.items as Row[];
    const by = (m: Member) => rows.find((r) => r.id === m.id)!;
    expect(by(ada)).toMatchObject({ emailVerified: true, chapterNames: ['Ghana Chapter'] });
    expect(by(ada).lastActiveAt).toBeTruthy(); // createMember signs them in
    expect(by(chidi).emailVerified).toBe(false);
    expect(by(dayo).chapterNames).toEqual(['Ghana Chapter']);
    expect(by(bola).chapterNames).toEqual([]);
  });

  it('sorts newest, oldest or by name, with keyset paging', async () => {
    const walk = async (sort: string) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: { body: { items: Row[]; nextCursor: string | null } } = await admin
          .get(`/admin/members?q=Filterable&sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        seen.push(...res.body.items.map((r) => r.name));
        cursor = res.body.nextCursor;
      } while (cursor);
      return seen;
    };
    expect(await walk('name')).toEqual(['Filterable Ada', 'Filterable Bola', 'Filterable Chidi', 'Filterable Dayo']);
    const newest = await walk('newest');
    expect(newest).toHaveLength(4);
    expect(newest[3]).toBe('Filterable Ada');
    expect(await walk('oldest')).toEqual([...newest].reverse());

    // A cursor belongs to its sort; junk is refused.
    const first = (await admin.get('/admin/members?q=Filterable&sort=name&limit=1').expect(200)).body;
    await admin.get(`/admin/members?q=Filterable&sort=newest&limit=1&cursor=${first.nextCursor}`).expect(400);
    await admin.get('/admin/members?cursor=not-a-cursor').expect(400);
  });

  it('exports the filtered list, or the picked members, as CSV (audited)', async () => {
    const res = await admin.get('/admin/members/export.csv?q=Filterable&country=NG&sort=name').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="members-\d{4}-\d{2}-\d{2}\.csv"/);
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual(['name', 'handle', 'email', 'country', 'status', 'joined', 'email_confirmed', 'verified', 'roles', 'badges', 'two_step']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['Filterable Chidi', 'Filterable Dayo']);
    expect(rows[1]).toEqual(['Filterable Chidi', chidi.handle, chidi.email, 'NG', 'suspended', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'no', 'no', '', '', 'off']);
    expect(rows[2]![8]).toBe('Official account');

    const all = parseCsv((await admin.get('/admin/members/export.csv?q=Filterable').expect(200)).text);
    const adaRow = all.find((r) => r[0] === 'Filterable Ada')!;
    expect(adaRow.slice(3, 7)).toEqual(['GH', 'active', '2025-03-10', 'yes']);
    expect(adaRow[10]).toBe('on');
    expect(all.find((r) => r[0] === 'Filterable Bola')![8]).toBe('Event Host');

    const picked = parseCsv((await admin.get(`/admin/members/export.csv?ids=${ada.id},${bola.id}&sort=name`).expect(200)).text);
    expect(picked.slice(1).map((r) => r[0])).toEqual(['Filterable Ada', 'Filterable Bola']);
    await admin.get('/admin/members/export.csv?ids=nope').expect(422);
    // A long pick goes in a POST body.
    const posted = await admin.post('/admin/members/export.csv', { ids: [chidi.id, dayo.id], sort: 'name' }).expect(200);
    expect(parseCsv(posted.text).slice(1).map((r) => r[0])).toEqual(['Filterable Chidi', 'Filterable Dayo']);
    await admin.post('/admin/members/export.csv', { ids: [] }).expect(422);
    await mod.post('/admin/members/export.csv', { ids: [ada.id] }).expect(403);

    const audits = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'members.exported')).orderBy(s.auditLog.id);
    expect(audits).toHaveLength(4);
    expect(audits[0]).toMatchObject({ actorId: admin.id, targetType: 'members', after: { filters: { q: 'Filterable', country: 'NG', sort: 'name' } } });
    expect(audits[2]!.after).toEqual({ ids: 2 });
    expect(audits[3]!.after).toEqual({ ids: 2 });

    await mod.get('/admin/members/export.csv').expect(403);
    const member = await plain.get('/admin/members/export.csv');
    expect([401, 403]).toContain(member.status);
  });

  it('changes many members at once, reporting each failure, with the usual audit entries', async () => {
    const unknown = '00000000-0000-4000-8000-0000000000ff';
    const res = await admin.post('/admin/members/bulk', { ids: [ada.id, bola.id, unknown, 'not-an-id'], action: 'verify' }).expect(200);
    expect(res.body.done).toEqual([ada.id, bola.id]);
    expect(res.body.failed).toEqual([
      { id: unknown, error: 'That member was not found' },
      { id: 'not-an-id', error: 'That member was not found' },
    ]);
    expect(await ids('filter=verified')).toEqual(sorted(ada, bola));
    const verifiedAudit = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'member.verified'), eq(s.auditLog.actorId, admin.id)));
    expect(verifiedAudit.map((a) => a.targetId!).sort((a, b) => a.localeCompare(b))).toEqual(sorted(ada, bola));

    await admin.post('/admin/members/bulk', { ids: [ada.id, bola.id], action: 'unverify' }).expect(200);
    expect(await ids('filter=verified')).toEqual([]);

    await admin.post('/admin/members/bulk', { ids: [ada.id, chidi.id], action: 'feature' }).expect(200);
    expect(await ids('filter=featured')).toEqual(sorted(ada, chidi));
    await admin.post('/admin/members/bulk', { ids: [ada.id, chidi.id], action: 'unfeature' }).expect(200);
    expect(await ids('filter=featured')).toEqual([]);

    // Badges: the badge is checked once; awarding needs an active badge.
    const [badge] = await t.db.select().from(s.badges).where(eq(s.badges.status, 'active')).limit(1);
    await admin.post('/admin/members/bulk', { ids: [ada.id], action: 'award_badge' }).expect(422);
    await admin.post('/admin/members/bulk', { ids: [ada.id], action: 'award_badge', badgeId: unknown }).expect(404);
    const awarded = await admin.post('/admin/members/bulk', { ids: [ada.id, dayo.id], action: 'award_badge', badgeId: badge!.id, note: 'Spring cohort' }).expect(200);
    expect(awarded.body).toEqual({ done: [ada.id, dayo.id], failed: [] });
    expect(await ids(`filter=badge&badge=${badge!.slug}`)).toEqual(sorted(ada, dayo));
    const [awardAudit] = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'member.badge_awarded'), eq(s.auditLog.targetId, ada.id)));
    expect(awardAudit!.after).toEqual({ badge: badge!.slug, note: 'Spring cohort' });
    await admin.post('/admin/members/bulk', { ids: [ada.id, dayo.id], action: 'remove_badge', badgeId: badge!.id }).expect(200);
    expect(await ids(`filter=badge&badge=${badge!.slug}`)).toEqual([]);
    const revoked = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'member.badge_revoked'));
    expect(revoked.map((a) => a.targetId!).sort((a, b) => a.localeCompare(b))).toEqual(sorted(ada, dayo));

    // Claude access: an account being deleted can't be given it (same rule as one at a time).
    await t.db.update(s.users).set({ status: 'deletion_pending' }).where(eq(s.users.id, chidi.id));
    const claude = await admin.post('/admin/members/bulk', { ids: [ada.id, chidi.id], action: 'claude_on' }).expect(200);
    expect(claude.body).toEqual({ done: [ada.id], failed: [{ id: chidi.id, error: 'This account is closed or being deleted' }] });
    await t.db.update(s.users).set({ status: 'suspended' }).where(eq(s.users.id, chidi.id));
    expect(await ids('filter=claude')).toEqual(sorted(ada));
    await admin.post('/admin/members/bulk', { ids: [ada.id], action: 'claude_off' }).expect(200);
    expect(await ids('filter=claude')).toEqual([]);
    const claudeAudit = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, ada.id))).map((a) => a.action);
    expect(claudeAudit).toEqual(expect.arrayContaining(['member.mcp_access_granted', 'member.mcp_access_revoked']));

    // Roles, official accounts and suspensions are never changed in bulk.
    await admin.post('/admin/members/bulk', { ids: [ada.id], action: 'suspend' }).expect(422);
    await admin.post('/admin/members/bulk', { ids: [ada.id], action: 'official' }).expect(422);
    await admin.post('/admin/members/bulk', { ids: [], action: 'verify' }).expect(422);
    await mod.post('/admin/members/bulk', { ids: [ada.id], action: 'verify' }).expect(403);
  });

  it('shows everything about one member in the detail panel', async () => {
    await t.db.insert(s.posts).values({ authorId: ada.id, body: 'Hello from Accra' });
    await t.db.insert(s.connections).values({ requesterId: ada.id, addresseeId: plain.id, status: 'accepted' });
    await t.db.insert(s.follows).values({ followerId: plain.id, targetType: 'member', targetId: ada.id });
    await t.db.insert(s.contentReports).values({ reporterId: plain.id, targetType: 'member', targetId: ada.id, targetUserId: ada.id, reasonCode: 'spam' });
    await t.db
      .insert(s.contentReports)
      .values({ reporterId: bola.id, targetType: 'member', targetId: ada.id, targetUserId: ada.id, reasonCode: 'spam', status: 'dismissed' });

    const res = await admin.get(`/admin/members/${ada.id}/overview`).expect(200);
    const o = res.body;
    expect(o.member).toMatchObject({ id: ada.id, name: 'Filterable Ada', countryCode: 'GH', twoStep: true, emailVerified: true });
    expect(o.city).toBe('Accra');
    expect(o.chapters).toEqual([{ id: chapterId, slug: 'ghana', name: 'Ghana Chapter' }]);
    expect(o.counts).toEqual({ posts: 1, connections: 1, followers: 1 });
    expect(o.invitedBy).toMatchObject({ id: bola.id, handle: bola.handle });
    expect(o.invited).toEqual({ total: 0, recent: [] });
    expect(o.openReports.total).toBe(1);
    expect(o.openReports.recent[0]).toMatchObject({ targetType: 'member', reasonCode: 'spam', status: 'open' });
    expect(o.audit.length).toBeGreaterThan(0);
    expect(o.audit.length).toBeLessThanOrEqual(10);
    expect(o.audit[0]).toMatchObject({ actor: { id: admin.id }, targetId: ada.id, ipHash: null });
    expect(o.audit.map((a: { action: string }) => a.action)).toContain('member.mcp_access_revoked');

    const inviter = (await admin.get(`/admin/members/${bola.id}/overview`).expect(200)).body;
    expect(inviter.invitedBy).toBeNull();
    expect(inviter.invited.total).toBe(1);
    expect(inviter.invited.recent.map((m: { id: string }) => m.id)).toEqual([ada.id]);

    await admin.get('/admin/members/00000000-0000-4000-8000-0000000000ff/overview').expect(404);
    await mod.get(`/admin/members/${ada.id}/overview`).expect(403);
  });
});
