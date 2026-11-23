import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { seedReference } from '../../src/db/seed.js';
import { REFERENCE_SEED_VERSIONS, SKILLS } from '../../src/db/seed-data.js';

type Row = { id: string; slug: string; name: string; position: number; status: string; usage: number };

describe('Admin: profile options', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createMember>>;
  let mod: Awaited<ReturnType<typeof createMember>>;
  let member: Awaited<ReturnType<typeof createMember>>;

  const list = async (kind: string, query = '') => (await admin.get(`/admin/profile-options/${kind}${query}`).expect(200)).body as { items: Row[]; counts: Record<string, number> };
  const audits = async (action: string) => t.db.select().from(s.auditLog).where(eq(s.auditLog.action, action));

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Moderator', roles: ['moderator'], admin: true });
    member = await createMember(t, { name: 'Amara Okafor' });
  });
  afterAll(() => t.close());

  it('only staff who manage settings can open it', async () => {
    await mod.get('/admin/profile-options').expect(403);
    await mod.get('/admin/profile-options/skills').expect(403);
    await mod.post('/admin/profile-options/skills', { name: 'Nope' }).expect(403);
    await mod.post('/admin/profile-options/skills/bulk', { ids: [admin.id], action: 'hide' }).expect(403);
    await member.get('/admin/profile-options/skills').expect(403);
    await admin.get('/admin/profile-options/colours').expect(404);
  });

  it('lists every kind with counts, in order, with usage', async () => {
    const summary = (await admin.get('/admin/profile-options').expect(200)).body;
    expect(Object.keys(summary).sort()).toEqual(['event-categories', 'interests', 'languages', 'sectors', 'skills']);
    expect(summary.skills).toEqual({ all: SKILLS.length, active: SKILLS.length, hidden: 0 });

    const skills = await list('skills');
    expect(skills.items).toHaveLength(SKILLS.length);
    expect(skills.items.slice(0, 3).map((r) => r.name)).toEqual(SKILLS.slice(0, 3));
    expect(skills.items[0]).toMatchObject({ slug: 'product-management', position: 0, status: 'active', usage: 0 });

    await member.patch('/me/profile', { skillIds: [skills.items[2]!.id] }).expect(200);
    const byUsage = await list('skills', '?sort=usage');
    expect(byUsage.items[0]).toMatchObject({ id: skills.items[2]!.id, usage: 1 });
    const byName = await list('skills', '?sort=name');
    const names = byName.items.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    const found = await list('skills', '?q=software');
    expect(found.items.map((r) => r.name)).toContain('Software engineering');
    expect(found.counts.all).toBe(SKILLS.length);
  });

  it('creates, renames and hides; hidden options leave pickers but members keep theirs', async () => {
    const created = await admin.post('/admin/profile-options/skills', { name: '  Drone  piloting ' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Drone piloting', slug: 'drone-piloting', status: 'active', usage: 0, position: SKILLS.length });
    // Same name ignoring case, or a slug in use, is refused.
    expect((await admin.post('/admin/profile-options/skills', { name: 'DRONE PILOTING' }).expect(422)).body.error.fields.name).toMatch(/already/);
    await admin.post('/admin/profile-options/skills', { name: 'Drones', slug: 'drone-piloting' }).expect(422);

    const id = created.body.id as string;
    const renamed = await admin.patch(`/admin/profile-options/skills/${id}`, { name: 'Drone operation', slug: 'drone-operation' }).expect(200);
    expect(renamed.body).toMatchObject({ name: 'Drone operation', slug: 'drone-operation' });
    await admin.patch(`/admin/profile-options/skills/${id}`, { name: 'Design' }).expect(422);

    // A member picks it, then an admin hides it.
    const tax = (await member.get('/taxonomies').expect(200)).body;
    expect(tax.skills.map((x: { id: string }) => x.id)).toContain(id);
    const other = tax.skills[0].id as string;
    await member.patch('/me/profile', { skillIds: [id] }).expect(200);
    await admin.patch(`/admin/profile-options/skills/${id}`, { status: 'hidden' }).expect(200);

    const after = (await member.get('/taxonomies').expect(200)).body;
    expect(after.skills.map((x: { id: string }) => x.id)).not.toContain(id);
    // The member keeps it and can still save their profile with it.
    const saved = await member.patch('/me/profile', { skillIds: [id, other] }).expect(200);
    expect(saved.body.skills.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([id, other]));
    // Someone who doesn't have it can't pick it.
    const newcomer = await createMember(t, { name: 'Kofi Mensah' });
    await newcomer.patch('/me/profile', { skillIds: [id] }).expect(422);
    // Directory filters still find members by it.
    const dir = await newcomer.get('/members?skill=drone-operation').expect(200);
    expect(JSON.stringify(dir.body)).toContain(member.handle);

    const hidden = await list('skills', '?status=hidden');
    expect(hidden.items.map((r) => r.id)).toEqual([id]);
    expect(hidden.counts).toMatchObject({ hidden: 1, active: SKILLS.length });

    const updates = await t.db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'profile_option.updated'), eq(s.auditLog.targetId, id)));
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.at(-1)!.after).toMatchObject({ kind: 'skills', status: 'hidden' });
    expect((await audits('profile_option.created')).some((a) => a.targetId === id)).toBe(true);
  });

  it('hidden event categories leave the host picker', async () => {
    const cats = await list('event-categories');
    const first = cats.items[0]!;
    await admin.post('/admin/profile-options/event-categories/bulk', { ids: [first.id], action: 'hide' }).expect(200);
    const picker = (await member.get('/events/categories').expect(200)).body as { id: string }[];
    expect(picker.map((c) => c.id)).not.toContain(first.id);
    await admin.post('/admin/profile-options/event-categories/bulk', { ids: [first.id], action: 'show' }).expect(200);
    expect(((await member.get('/events/categories').expect(200)).body as { id: string }[])[0]!.id).toBe(first.id);
  });

  it('reorders by hand and alphabetically; pickers follow', async () => {
    const before = await list('languages');
    const [a, b, c] = before.items;
    await admin.post('/admin/profile-options/languages/reorder', { ids: [c!.id, a!.id] }).expect(200);
    const after = await list('languages');
    expect(after.items.slice(0, 3).map((r) => r.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(after.items.map((r) => r.position)).toEqual(after.items.map((_, i) => i));
    const tax = (await member.get('/taxonomies').expect(200)).body;
    expect(tax.languages[0].id).toBe(c!.id);
    await admin.post('/admin/profile-options/languages/reorder', { ids: [member.id] }).expect(422);

    await admin.post('/admin/profile-options/languages/sort-alphabetically').expect(200);
    const sorted = await list('languages');
    const names = sorted.items.map((r) => r.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })));
    expect((await audits('profile_option.reordered')).length).toBe(2);
  });

  it('deletes only unused options', async () => {
    const created = await admin.post('/admin/profile-options/interests', { name: 'Kite surfing' }).expect(201);
    const tax = (await member.get('/taxonomies').expect(200)).body;
    const used = tax.interests[0].id as string;
    await member.patch('/me/profile', { interestIds: [used] }).expect(200);
    const refused = await admin.delete(`/admin/profile-options/interests/${used}`).expect(409);
    expect(refused.body.error.message).toMatch(/1 member has this interest\. Hide it from pickers or merge it/);
    await admin.delete(`/admin/profile-options/interests/${created.body.id}`).expect(200);
    expect(await t.db.select().from(s.interests).where(eq(s.interests.id, created.body.id))).toHaveLength(0);
    const [entry] = (await audits('profile_option.deleted')).filter((a) => a.targetId === created.body.id);
    expect(entry!.before).toMatchObject({ kind: 'interests', name: 'Kite surfing' });
    await admin.delete(`/admin/profile-options/interests/${created.body.id}`).expect(404);

    // A sector a page uses can't be deleted either.
    const sector = await admin.post('/admin/profile-options/sectors', { name: 'Space industry' }).expect(201);
    const [page] = await t.db.insert(s.pages).values({ slug: 'orbit-co', name: 'Orbit Co', createdBy: admin.id }).returning();
    await t.db.insert(s.pageSectors).values({ pageId: page!.id, sectorId: sector.body.id });
    expect((await admin.delete(`/admin/profile-options/sectors/${sector.body.id}`).expect(409)).body.error.message).toMatch(/pages use this sector/);
    await t.db.delete(s.pages).where(eq(s.pages.id, page!.id));
    await admin.delete(`/admin/profile-options/sectors/${sector.body.id}`).expect(200);
  });

  it('merges: members move to the target once, the source goes', async () => {
    const from = (await admin.post('/admin/profile-options/sectors', { name: 'Fin tech' }).expect(201)).body as Row;
    const into = (await list('sectors', '?q=Finance')).items[0]!;
    const both = await createMember(t, { name: 'Has Both' });
    const one = await createMember(t, { name: 'Has One' });
    await both.patch('/me/profile', { sectorIds: [from.id, into.id] }).expect(200);
    await one.patch('/me/profile', { sectorIds: [from.id] }).expect(200);
    // A page in both sectors keeps just the target.
    const [page] = await t.db.insert(s.pages).values({ slug: 'fin-co', name: 'Fin Co', createdBy: admin.id }).returning();
    await t.db.insert(s.pageSectors).values([{ pageId: page!.id, sectorId: from.id }, { pageId: page!.id, sectorId: into.id }]);

    await admin.post(`/admin/profile-options/sectors/${from.id}/merge`, { intoId: from.id }).expect(422);
    const res = await admin.post(`/admin/profile-options/sectors/${from.id}/merge`, { intoId: into.id }).expect(200);
    expect(res.body).toMatchObject({ moved: 1, dropped: 1, into: { id: into.id, usage: into.usage + 2 } });

    expect(await t.db.select().from(s.sectors).where(eq(s.sectors.id, from.id))).toHaveLength(0);
    const links = await t.db.select().from(s.profileSectors).where(inArray(s.profileSectors.userId, [both.id, one.id]));
    expect(links.map((l) => l.itemId).every((x) => x === into.id)).toBe(true);
    expect(links).toHaveLength(2);
    const [entry] = (await audits('profile_option.merged')).filter((a) => a.targetId === from.id);
    expect(entry!.after).toMatchObject({ kind: 'sectors', intoId: into.id, moved: { members: { moved: 1, dropped: 1 }, pages: { moved: 0, dropped: 1 } } });
    expect(await t.db.select().from(s.pageSectors).where(eq(s.pageSectors.pageId, page!.id))).toEqual([{ pageId: page!.id, sectorId: into.id }]);
    await t.db.delete(s.pages).where(eq(s.pages.id, page!.id));
  });

  it('bulk: partial failure reports each id, the rest still change', async () => {
    const a = (await admin.post('/admin/profile-options/interests', { name: 'Bulk one' }).expect(201)).body as Row;
    const b = (await admin.post('/admin/profile-options/interests', { name: 'Bulk two' }).expect(201)).body as Row;
    const used = (await member.get('/me/profile').expect(200)).body.interests[0].id as string;
    const missing = '00000000-0000-4000-8000-000000000000';

    const del = await admin.post('/admin/profile-options/interests/bulk', { ids: [a.id, used, missing], action: 'delete' }).expect(200);
    expect(del.body.done).toEqual([a.id]);
    expect(del.body.failed).toEqual([
      { id: used, error: expect.stringMatching(/Hide it from pickers or merge it/) },
      { id: missing, error: 'That interest was not found' },
    ]);

    const hide = await admin.post('/admin/profile-options/interests/bulk', { ids: [b.id, used], action: 'hide' }).expect(200);
    expect(hide.body).toEqual({ done: [b.id, used], failed: [] });
    expect((await list('interests', '?status=hidden')).items.map((r) => r.id).sort()).toEqual([b.id, used].sort());

    await admin.post('/admin/profile-options/interests/bulk', { ids: [b.id], action: 'merge' }).expect(422);
    await admin.post('/admin/profile-options/interests/bulk', { ids: [b.id], action: 'merge', intoId: missing }).expect(422);
    const merge = await admin.post('/admin/profile-options/interests/bulk', { ids: [b.id, used], action: 'merge', intoId: used }).expect(200);
    expect(merge.body.done).toEqual([b.id]);
    expect(merge.body.failed).toEqual([{ id: used, error: 'Choose a different option to merge into' }]);
  });

  it('import: dry run writes nothing, bad rows are reported by row number', async () => {
    const before = await list('skills');
    const auditsBefore = (await audits('profile_option.imported')).length;
    const rows = [
      { row: 2, name: 'Robotics' },
      { row: 3, name: '' },
      { row: 4, name: 'x'.repeat(81) },
      { row: 5, name: 'Welding', status: 'maybe' },
      { row: 6, name: 'robotics' },
      { row: 7, name: 'Design' },
      { row: 8, name: 'Carpentry', position: 'first' },
    ];
    const res = await admin.post('/admin/profile-options/skills/import', { rows, mode: 'add', dryRun: true }).expect(200);
    expect(res.body).toEqual({
      created: 1,
      updated: 0,
      unchanged: 1,
      dryRun: true,
      problems: [
        { row: 3, message: 'Name is missing' },
        { row: 4, message: 'Name is longer than 80 characters' },
        { row: 5, message: 'Status must be active or hidden' },
        { row: 6, message: 'Same option as row 2' },
        { row: 8, message: 'Position must be a whole number, 0 or more' },
      ],
    });
    expect((await list('skills')).items).toHaveLength(before.items.length);
    expect((await audits('profile_option.imported')).length).toBe(auditsBefore);

    const done = await admin.post('/admin/profile-options/skills/import', { rows, mode: 'add', dryRun: false }).expect(200);
    expect(done.body).toMatchObject({ created: 1, dryRun: false });
    const robotics = (await list('skills', '?q=robotics')).items[0]!;
    expect(robotics).toMatchObject({ name: 'Robotics', slug: 'robotics', status: 'active', position: before.items.length });
    await admin.post('/admin/profile-options/skills/import', { rows: Array.from({ length: 2001 }, (_, i) => ({ row: i + 2, name: `S${i}` })), mode: 'add', dryRun: true }).expect(422);
  });

  it('import upsert: matches by slug, then by name ignoring case, and updates name, position and status', async () => {
    const res = await admin
      .post('/admin/profile-options/skills/import', {
        mode: 'upsert',
        dryRun: false,
        rows: [
          { row: 2, name: 'Robotics & automation', slug: 'robotics', position: '0' },
          { row: 3, name: 'MARKETING', status: 'hidden' },
          { row: 4, name: 'Sales' },
          { row: 5, name: 'Beekeeping', status: 'Hidden' },
          { row: 6, name: 'Data analysis', slug: 'product-management' },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({ created: 1, updated: 2, unchanged: 1, problems: [{ row: 6, message: 'Another option is already called Data analysis' }] });
    const all = (await list('skills')).items;
    expect(all.find((r) => r.slug === 'robotics')).toMatchObject({ name: 'Robotics & automation', position: 0 });
    expect(all.find((r) => r.slug === 'marketing')).toMatchObject({ name: 'MARKETING', status: 'hidden' });
    expect(all.find((r) => r.slug === 'beekeeping')).toMatchObject({ status: 'hidden' });
    const [entry] = (await audits('profile_option.imported')).slice(-1);
    expect(entry!.after).toMatchObject({ kind: 'skills', mode: 'upsert', created: 1, updated: 2, unchanged: 1, skipped: 1 });
  });

  it('seeding does not re-create a deleted or merged option, and records the version', async () => {
    const victim = (await list('languages', '?q=Wolof')).items[0]!;
    await admin.delete(`/admin/profile-options/languages/${victim.id}`).expect(200);
    await seedReference(t.db);
    expect(await t.db.select().from(s.languages).where(eq(s.languages.slug, 'wolof'))).toHaveLength(0);

    // A database from before versioned profile options: it has the lists, so they are left alone.
    const [seeds] = await t.db.select().from(s.platformSettings).where(eq(s.platformSettings.key, 'reference_seeds'));
    expect(seeds!.value).toMatchObject({ taxonomies: REFERENCE_SEED_VERSIONS.taxonomies });
    const { taxonomies: _, ...older } = seeds!.value as Record<string, number>;
    await t.db.update(s.platformSettings).set({ value: older }).where(eq(s.platformSettings.key, 'reference_seeds'));
    await seedReference(t.db);
    expect(await t.db.select().from(s.languages).where(eq(s.languages.slug, 'wolof'))).toHaveLength(0);
    const [again] = await t.db.select().from(s.platformSettings).where(eq(s.platformSettings.key, 'reference_seeds'));
    expect(again!.value).toMatchObject({ taxonomies: REFERENCE_SEED_VERSIONS.taxonomies });
  });
});
