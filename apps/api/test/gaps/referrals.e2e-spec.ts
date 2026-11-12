import { and, eq, or } from 'drizzle-orm';
import type { AdminReferrals, InvitePreview, MyReferrals } from '@chartermission/contracts';
import { client, createMember, createTestApp, lastEmail, s, tokenFrom, type TestApp } from '../helpers.js';
import { STRONG, notificationsFor, resetLimits, uniqueEmail, userByEmail } from '../auth/support.js';
import { insertEvent } from '../events/event-helpers.js';

describe('Invitation pages and referrals', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  const signUp = async (name: string, invite?: Record<string, unknown>) => {
    const c = client(t);
    const email = uniqueEmail(name.split(' ')[0]!.toLowerCase());
    await c.post('/auth/register', { name, email, password: STRONG, country: 'GH', acceptTerms: true, ...(invite ? { invite } : {}) }).expect(202);
    const user = await userByEmail(t, email);
    return { c, email, user };
  };
  const verify = async (c: ReturnType<typeof client>, email: string) => {
    await c.post('/auth/verify', { token: tokenFrom((await lastEmail(t.db, email))?.textBody) }).expect(200);
  };

  it('the invitation page shows who invited and to what, without signing in', async () => {
    const inviter = await createMember(t, { name: 'Ifeoma Inviter', handle: 'ifeoma-inviter' });
    const event = await insertEvent(t, inviter.id, { startsAt: new Date(Date.now() + 3 * 86400_000), slug: 'referral-summit' });
    const anon = client(t);

    const personal = (await anon.get('/invites/preview?from=ifeoma-inviter').expect(200)).body as InvitePreview;
    expect(personal).toMatchObject({ kind: 'member', inviter: { handle: 'ifeoma-inviter', name: 'Ifeoma Inviter' }, target: null });

    const forEvent = (await anon.get('/invites/preview?from=ifeoma-inviter&kind=event&slug=referral-summit').expect(200)).body as InvitePreview;
    expect(forEvent).toMatchObject({ kind: 'event', target: { path: `/events/${event.slug}`, startsAt: expect.any(String) } });

    const [chapter] = await t.db.select({ slug: s.chapters.slug }).from(s.chapters).where(eq(s.chapters.status, 'active')).limit(1);
    const forChapter = (await anon.get(`/invites/preview?from=ifeoma-inviter&kind=chapter&slug=${chapter!.slug}`).expect(200)).body as InvitePreview;
    expect(forChapter).toMatchObject({ kind: 'chapter', target: { path: `/chapters/${chapter!.slug}`, memberCount: expect.any(Number) } });

    // Unknown inviter or target: still a page, inviting to Charter Mission.
    expect((await anon.get('/invites/preview?from=nobody-here&kind=event&slug=nope').expect(200)).body).toMatchObject({ kind: 'member', inviter: null, target: null });
  });

  it('signing up through an invitation credits the inviter; a personal invitation connects them once the email is confirmed', async () => {
    const inviter = await createMember(t, { name: 'Kofi Referrer', handle: 'kofi-referrer' });
    const { c, email, user } = await signUp('Ama Newcomer', { from: 'kofi-referrer', kind: 'member' });
    const [row] = await t.db.select().from(s.referrals).where(eq(s.referrals.inviteeId, user.id));
    expect(row).toMatchObject({ inviterId: inviter.id, kind: 'member', targetSlug: null });
    // Nothing for the inviter until the email is confirmed.
    expect(await notificationsFor(t, inviter.id, 'invite_joined')).toHaveLength(0);

    await verify(c, email);
    expect(await notificationsFor(t, inviter.id, 'invite_joined')).toHaveLength(1);
    const links = await t.db
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.status, 'accepted'),
          or(and(eq(s.connections.requesterId, inviter.id), eq(s.connections.addresseeId, user.id)), and(eq(s.connections.requesterId, user.id), eq(s.connections.addresseeId, inviter.id))),
        ),
      );
    expect(links).toHaveLength(1);

    // Event invitation: credited with the event, no automatic connection.
    const { c: c2, email: email2, user: guest } = await signUp('Yaw Guest', { from: 'kofi-referrer', kind: 'event', slug: 'some-event' });
    await verify(c2, email2);
    const [eventRow] = await t.db.select().from(s.referrals).where(eq(s.referrals.inviteeId, guest.id));
    expect(eventRow).toMatchObject({ kind: 'event', targetSlug: 'some-event' });

    const mine = (await inviter.get('/invites/mine').expect(200)).body as MyReferrals;
    expect(mine.total).toBe(2);
    expect(mine.people.map((p) => p.member.id).sort()).toEqual([user.id, guest.id].sort());

    // Inviting yourself or an unknown handle credits no one.
    const { user: loner } = await signUp('Solo Person', { from: 'no-such-member', kind: 'member' });
    expect(await t.db.select().from(s.referrals).where(eq(s.referrals.inviteeId, loner.id))).toHaveLength(0);

    const admin = await createMember(t, { roles: ['platform_admin'], admin: true });
    const report = (await admin.get('/admin/referrals').expect(200)).body as AdminReferrals;
    expect(report.leaders.find((l) => l.inviter.id === inviter.id)).toMatchObject({ joined: 2, verified: 2 });
    expect(report.recent.some((r) => r.invitee.id === guest.id && r.kind === 'event')).toBe(true);
    await inviter.get('/admin/referrals').expect(403);
  });
});
