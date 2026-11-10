import { eq } from 'drizzle-orm';
import type { AdminMemberRow } from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

describe('Admin console: giving members team access', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('platform admins grant console roles but not Super Admin; changes are audited and emailed', async () => {
    const admin = await createMember(t, { name: 'Pat Admin', roles: ['platform_admin'], admin: true });
    const member = await createMember(t, { name: 'Rose Member' });

    const row = (await admin.put(`/admin/members/${member.id}/roles`, { role: 'moderator', granted: true }).expect(200)).body as AdminMemberRow;
    expect(row).toMatchObject({ roles: ['moderator'], staff: true });
    await admin.put(`/admin/members/${member.id}/roles`, { role: 'super_admin', granted: true }).expect(403);
    await admin.put(`/admin/members/${admin.id}/roles`, { role: 'event_host', granted: true }).expect(403);

    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, member.id));
    expect(audit.map((a) => a.action)).toContain('role.granted.moderator');
    const mails = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, member.email));
    expect(mails.map((m) => m.template)).toContain('admin.role_granted');

    const back = (await admin.put(`/admin/members/${member.id}/roles`, { role: 'moderator', granted: false }).expect(200)).body as AdminMemberRow;
    expect(back).toMatchObject({ roles: [], staff: false });
  });

  it('Super Admins manage Super Admin, but never their own access', async () => {
    const supers = await t.db
      .select({ id: s.userRoles.userId })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(eq(s.roles.key, 'super_admin'));
    for (const r of supers) await t.db.update(s.userRoles).set({ revokedAt: new Date() }).where(eq(s.userRoles.userId, r.id));
    const one = await createMember(t, { name: 'Sole Super', roles: ['super_admin'], admin: true });
    const two = await createMember(t, { name: 'Second Super', roles: ['super_admin'], admin: true });
    await one.put(`/admin/members/${two.id}/roles`, { role: 'super_admin', granted: false }).expect(200);
    await one.put(`/admin/members/${one.id}/roles`, { role: 'super_admin', granted: false }).expect(403);
  });
});
