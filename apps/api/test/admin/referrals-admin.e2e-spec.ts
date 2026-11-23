import { and, eq } from 'drizzle-orm';
import type { AdminReferrals } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { insertEvent } from '../events/event-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const DAY = 86400_000;

describe('Admin referrals: stats, filters, paging and CSV export', () => {
  let t: TestApp;
  let admin: Member;
  let mod: Member;
  let aisha: Member;
  let kofi: Member;
  const invitees: Record<string, Member> = {};

  /** A referral written straight to the database, joined `daysAgo` days ago. */
  async function refer(inviter: Member, invitee: Member, kind: 'member' | 'chapter' | 'event', slug: string | null, daysAgo: number) {
    await t.db.insert(s.referrals).values({ inviterId: inviter.id, inviteeId: invitee.id, kind, targetSlug: slug, createdAt: new Date(Date.now() - daysAgo * DAY) });
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Platform Admin', roles: ['platform_admin'], admin: true });
    mod = await createMember(t, { name: 'Queue Moderator', roles: ['moderator'], admin: true });
    aisha = await createMember(t, { name: 'Aisha Mohammed-Bello', handle: 'aisha-mb' });
    kofi = await createMember(t, { name: 'Kofi Mensah', handle: 'kofi-m' });
    const [chapter] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, 'nigeria'));
    expect(chapter).toBeDefined();
    await insertEvent(t, kofi.id, { startsAt: new Date(Date.now() + 10 * DAY), slug: 'lagos-founders-summit' });
    for (const [key, name, verified] of [
      ['ngozi', 'Ngozi Adeyemi', true],
      ['tunde', 'Tunde Bakare', false],
      ['amina', 'Amina Yusuf', true],
      ['kwame', 'Kwame Asante', true],
      ['zara', 'Zara Okoro', false],
    ] as const) {
      invitees[key] = await createMember(t, { name, handle: key, email: `${key}@example.test`, verified });
    }
    await refer(aisha, invitees.ngozi!, 'member', null, 1);
    await refer(aisha, invitees.tunde!, 'chapter', 'nigeria', 3);
    await refer(aisha, invitees.amina!, 'chapter', 'nigeria', 20);
    await refer(kofi, invitees.kwame!, 'event', 'lagos-founders-summit', 45);
    await refer(kofi, invitees.zara!, 'event', 'gone-event', 120);
  });
  afterAll(() => t.close());

  it('only members managers see referrals; others are refused', async () => {
    await mod.get('/admin/referrals').expect(403);
    await mod.get('/admin/referrals/export.csv').expect(403);
    await aisha.get('/admin/referrals').expect(403);
  });

  it('gives all-time stats, top inviters for the period, and the newest sign-ups first', async () => {
    const body = (await admin.get('/admin/referrals').expect(200)).body as AdminReferrals;
    expect(body.stats).toEqual({ total: 5, last7Days: 2, last30Days: 3, confirmedPercent: 60, byKind: { member: 1, chapter: 2, event: 2 } });
    expect(body.total).toBe(5);
    // 30 days by default: only Aisha's three count.
    expect(body.period).toBe('30d');
    expect(body.leaders.map((l) => [l.inviter.handle, l.joined, l.verified])).toEqual([['aisha-mb', 3, 2]]);
    expect(body.recent.map((r) => r.invitee.handle)).toEqual(['ngozi', 'tunde', 'amina', 'kwame', 'zara']);
    expect(body.nextCursor).toBeNull();
    expect(body.inviter).toBeNull();

    // The invitation names the chapter (or event) and links to it; a deleted event keeps its slug only.
    const tunde = body.recent.find((r) => r.invitee.handle === 'tunde')!;
    expect(tunde).toMatchObject({ kind: 'chapter', slug: 'nigeria', target: { name: expect.stringContaining('Nigeria'), path: '/chapters/nigeria' }, verified: false });
    expect(body.recent.find((r) => r.invitee.handle === 'kwame')).toMatchObject({ target: { name: 'Inserted event', path: '/events/lagos-founders-summit' } });
    const zara = body.recent.find((r) => r.invitee.handle === 'zara')!;
    expect(zara).toMatchObject({ kind: 'event', slug: 'gone-event', target: null });

    const all = (await admin.get('/admin/referrals?period=all').expect(200)).body as AdminReferrals;
    expect(all.leaders.map((l) => [l.inviter.handle, l.joined])).toEqual([
      ['aisha-mb', 3],
      ['kofi-m', 2],
    ]);
    const ninety = (await admin.get('/admin/referrals?period=90d').expect(200)).body as AdminReferrals;
    expect(ninety.leaders.map((l) => [l.inviter.handle, l.joined])).toEqual([
      ['aisha-mb', 3],
      ['kofi-m', 1],
    ]);
  });

  it('filters sign-ups by search, kind, inviter, dates and confirmed email', async () => {
    const list = async (qs: string) => ((await admin.get(`/admin/referrals?${qs}`).expect(200)).body as AdminReferrals).recent.map((r) => r.invitee.handle);
    // Invitee name, @handle or email, or the inviter's.
    expect(await list('q=ngozi')).toEqual(['ngozi']);
    expect(await list('q=%40tunde')).toEqual(['tunde']);
    expect(await list('q=amina%40example')).toEqual(['amina']);
    expect(await list('q=Mensah')).toEqual(['kwame', 'zara']);
    expect(await list('q=100%25')).toEqual([]);
    expect(await list('kind=chapter')).toEqual(['tunde', 'amina']);
    expect(await list('kind=event&confirmed=yes')).toEqual(['kwame']);
    expect(await list('confirmed=no')).toEqual(['tunde', 'zara']);
    const day = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
    expect(await list(`from=${day(25)}&to=${day(2)}`)).toEqual(['tunde', 'amina']);

    const byKofi = (await admin.get(`/admin/referrals?inviter=${kofi.id}`).expect(200)).body as AdminReferrals;
    expect(byKofi.inviter).toMatchObject({ id: kofi.id, name: 'Kofi Mensah' });
    expect(byKofi.recent.map((r) => r.invitee.handle)).toEqual(['kwame', 'zara']);
    // Stats stay all-time whatever the filters.
    expect(byKofi.stats.total).toBe(5);

    await admin.get('/admin/referrals?inviter=not-a-uuid').expect(422);
    await admin.get('/admin/referrals?from=yesterday').expect(422);
  });

  it('pages through sign-ups with a cursor', async () => {
    const first = (await admin.get('/admin/referrals?limit=2').expect(200)).body as AdminReferrals;
    expect(first.recent.map((r) => r.invitee.handle)).toEqual(['ngozi', 'tunde']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await admin.get(`/admin/referrals?limit=2&cursor=${first.nextCursor}`).expect(200)).body as AdminReferrals;
    expect(second.recent.map((r) => r.invitee.handle)).toEqual(['amina', 'kwame']);
    const third = (await admin.get(`/admin/referrals?limit=2&cursor=${second.nextCursor}`).expect(200)).body as AdminReferrals;
    expect(third.recent.map((r) => r.invitee.handle)).toEqual(['zara']);
    expect(third.nextCursor).toBeNull();
  });

  it('exports the filtered sign-ups as CSV and audits the export', async () => {
    const res = await admin.get('/admin/referrals/export.csv?kind=chapter').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="referrals-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('joined_at,member,member_handle,member_email,invited_by,invited_by_handle,invitation,invited_to,link_slug,email_confirmed');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',Tunde Bakare,tunde,tunde@example.test,Aisha Mohammed-Bello,aisha-mb,chapter,');
    expect(lines[1]).toMatch(/,nigeria,no$/);
    expect(lines[2]).toMatch(/,Amina Yusuf,amina,.*,nigeria,yes$/);

    const [entry] = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'referrals.exported'), eq(s.auditLog.actorId, admin.id)));
    expect(entry).toMatchObject({ targetType: 'referrals' });
    expect((entry!.after as { filters: Record<string, unknown> }).filters).toMatchObject({ kind: 'chapter' });
  });
});
