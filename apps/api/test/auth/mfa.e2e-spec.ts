import { and, eq } from 'drizzle-orm';
import type { MfaDeviceSetup, MfaDeviceView } from '@chartermission/contracts';
import { client, createMember, createTestApp, lastEmail, PASSWORD, s, type TestApp } from '../helpers.js';
import { decrypt, encrypt } from '../../src/common/crypto.js';
import { resetLimits, totp } from './support.js';

/** The secret test accounts created as already enrolled (helpers.createMember) carry on their own row. */
const LEGACY = 'JBSWY3DPEHPK3PXP';

describe('Auth: admin sessions and TOTP MFA (CM-AUTH-09)', () => {
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

  it('admin audience is refused for members without a privileged role (generic error)', async () => {
    const m = await createMember(t, { name: 'Plain Member' });
    const admin = client(t, 'admin');
    const res = await admin.post('/auth/login', { email: m.email, password: PASSWORD, audience: 'admin' }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('admin login → mfa_setup_required → setup → enable → /me shows MFA verified; then mfa_required flow', async () => {
    const mod = await createMember(t, { name: 'Moderator One', roles: ['moderator'], mfa: false });
    const admin = client(t, 'admin');
    const login = await admin.post('/auth/login', { email: mod.email, password: PASSWORD, audience: 'admin' }).expect(200);
    expect(login.body).toEqual({ status: 'mfa_setup_required' });
    expect(String(login.headers['set-cookie'])).toContain('cm_admin_session=');

    const before = await admin.get('/me').expect(200);
    expect(before.body).toMatchObject({ sessionAudience: 'admin', mfa: { enabled: false, verifiedThisSession: false } });

    const setup = await admin.post('/auth/mfa/setup').expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Charter%20Mission:/);
    expect(setup.body.otpauthUrl).toContain('digits=6');
    expect(setup.body.otpauthUrl).toContain('period=30');
    expect(setup.body.qrSvg).toContain('<svg');
    const secret: string = setup.body.secret;
    const [pending] = await t.db.select().from(s.users).where(eq(s.users.id, mod.id));
    expect(pending!.mfaEnabledAt).toBeNull();
    const [waiting] = await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, mod.id));
    expect(waiting).toMatchObject({ confirmedAt: null });
    expect(waiting!.secretEnc).not.toContain(secret); // encrypted at rest

    const wrong = await admin.post('/auth/mfa/enable', { code: totp(secret) === '000000' ? '111111' : '000000' }).expect(400);
    expect(wrong.body.error.code).toBe('INVALID_MFA_CODE');

    const code = totp(secret);
    await admin.post('/auth/mfa/enable', { code }).expect(200);
    const after = await admin.get('/me').expect(200);
    expect(after.body).toMatchObject({ sessionAudience: 'admin', mfa: { enabled: true, verifiedThisSession: true } });
    expect(after.body.roles).toContain('moderator');
    await admin.post('/auth/mfa/setup').expect(409);

    // Sign in again: MFA now required, and the code already used cannot be replayed.
    await admin.post('/auth/logout').expect(200);
    await admin.get('/me').expect(401);
    const again = await admin.post('/auth/login', { email: mod.email, password: PASSWORD, audience: 'admin' }).expect(200);
    expect(again.body).toEqual({ status: 'mfa_required' });
    expect((await admin.get('/me').expect(200)).body.mfa).toEqual({ enabled: true, verifiedThisSession: false, required: true });

    const replay = await admin.post('/auth/mfa/verify', { code }).expect(400);
    expect(replay.body.error.code).toBe('INVALID_MFA_CODE');
    await admin.post('/auth/mfa/verify', { code: totp(secret, 1) }).expect(200);
    expect((await admin.get('/me').expect(200)).body.mfa).toEqual({ enabled: true, verifiedThisSession: true, required: true });

    // The member-audience session is separate (and, MFA now being on, also needs a code).
    const memberSide = await mod.get('/me').expect(200);
    expect(memberSide.body.sessionAudience).toBe('member');
    expect((await mod.get('/feed').expect(403)).body.error.code).toBe('MFA_REQUIRED');

    // Privileged roles cannot turn MFA off.
    await admin.post('/auth/mfa/disable', { password: PASSWORD }).expect(403);

    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.actorId, mod.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa.enabled', 'auth.mfa.verified', 'auth.login.success']));
  });

  it('MFA verify locks out after 5 wrong codes', async () => {
    const mod = await createMember(t, { name: 'Moderator Two', roles: ['platform_admin'], mfa: false });
    const admin = client(t, 'admin');
    await admin.post('/auth/login', { email: mod.email, password: PASSWORD, audience: 'admin' }).expect(200);
    const { body } = await admin.post('/auth/mfa/setup').expect(200);
    await admin.post('/auth/mfa/enable', { code: totp(body.secret) }).expect(200);
    await admin.post('/auth/logout').expect(200);
    await admin.post('/auth/login', { email: mod.email, password: PASSWORD, audience: 'admin' }).expect(200);
    const bad = totp(body.secret, 5);
    for (let i = 0; i < 5; i++) await admin.post('/auth/mfa/verify', { code: bad }).expect(400);
    const locked = await admin.post('/auth/mfa/verify', { code: totp(body.secret, 1) }).expect(429);
    expect(locked.headers['retry-after']).toBeTruthy();
  });

  it('staff accounts must set up MFA before using the member app, and can’t turn it off', async () => {
    const manager = await createMember(t, { name: 'Staff Without Mfa', roles: ['ambassador_manager'], mfa: false });
    const fresh = client(t);
    const login = await fresh.post('/auth/login', { email: manager.email, password: PASSWORD }).expect(200);
    expect(login.body).toEqual({ status: 'mfa_setup_required' });
    expect((await fresh.get('/me').expect(200)).body.mfa).toEqual({ enabled: false, verifiedThisSession: false, required: true });
    expect((await fresh.get('/feed').expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    await fresh.post('/posts', { body: 'Hello' }).expect(403);

    const { body } = await fresh.post('/auth/mfa/setup').expect(200);
    await fresh.post('/auth/mfa/enable', { code: totp(body.secret) }).expect(200);
    await fresh.get('/feed').expect(200);
    await fresh.post('/auth/mfa/disable', { password: PASSWORD }).expect(403);

    // A staff flag alone (the official team account) is enough.
    const staff = await createMember(t, { name: 'Team Account', mfa: false });
    await t.db.update(s.users).set({ isStaff: true }).where(eq(s.users.id, staff.id));
    const staffLogin = await client(t).post('/auth/login', { email: staff.email, password: PASSWORD }).expect(200);
    expect(staffLogin.body).toEqual({ status: 'mfa_setup_required' });

    // Ordinary members are unaffected.
    const member = await createMember(t, { name: 'Plain Member Two' });
    expect((await member.get('/me').expect(200)).body.mfa.required).toBe(false);
  });

  it('members can turn optional MFA on and off with their password', async () => {
    const m = await createMember(t, { name: 'Optional Mfa' });
    const { body } = await m.post('/auth/mfa/setup').expect(200);
    await m.post('/auth/mfa/enable', { code: totp(body.secret) }).expect(200);
    expect((await m.get('/me').expect(200)).body.mfa.enabled).toBe(true);
    await m.post('/auth/mfa/disable', { password: 'wrong-password' }).expect(422);
    await m.post('/auth/mfa/disable', { password: PASSWORD }).expect(200);
    expect((await m.get('/me').expect(200)).body.mfa.enabled).toBe(false);
    expect(await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, m.id))).toHaveLength(0);
    expect((await m.get('/auth/mfa/devices').expect(200)).body).toEqual([]);
    await m.post('/auth/mfa/devices', { name: 'Phone', code: '123456' }).expect(409);
  });

  it('holds several devices: either signs in, adding and removing take a code, and the last one stays', async () => {
    const mod = await createMember(t, { name: 'Two Devices', roles: ['moderator'], mfa: false });
    const admin = client(t, 'admin');
    const signIn = () => admin.post('/auth/login', { email: mod.email, password: PASSWORD, audience: 'admin' }).expect(200);
    const names = async () => ((await admin.get('/auth/mfa/devices').expect(200)).body as MfaDeviceView[]).map((d) => d.name);
    await signIn();
    const first = (await admin.post('/auth/mfa/setup').expect(200)).body as MfaDeviceSetup;
    await admin.post('/auth/mfa/enable', { code: totp(first.secret) }).expect(200);
    const [only] = (await admin.get('/auth/mfa/devices').expect(200)).body as MfaDeviceView[];
    expect(only).toMatchObject({ name: 'Authenticator app' });
    expect(only!.lastUsedAt).not.toBeNull();
    // The only device can't be removed.
    await admin.post(`/auth/mfa/devices/${only!.id}/remove`, { code: totp(first.secret, 1) }).expect(409);

    // Adding takes a code from a device already on the account, then one from the new device.
    expect((await admin.post('/auth/mfa/devices', { name: 'Work phone', code: totp(first.secret, 5) }).expect(400)).body.error.code).toBe('INVALID_MFA_CODE');
    await admin.post('/auth/mfa/devices', { name: ' ', code: totp(first.secret, 1) }).expect(422);
    const second = (await admin.post('/auth/mfa/devices', { name: 'Work phone', code: totp(first.secret, 1) }).expect(200)).body as MfaDeviceSetup;
    expect(second.secret).not.toBe(first.secret);
    expect(second.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Charter%20Mission:/);
    // Until it is confirmed with its own code, the new device counts for nothing.
    expect(await names()).toEqual(['Authenticator app']);
    await admin.post(`/auth/mfa/devices/${second.deviceId}/confirm`, { code: totp(first.secret, 1) }).expect(400);
    const added = (await admin.post(`/auth/mfa/devices/${second.deviceId}/confirm`, { code: totp(second.secret) }).expect(200)).body as MfaDeviceView;
    expect(added).toMatchObject({ id: second.deviceId, name: 'Work phone' });
    expect(await names()).toEqual(['Authenticator app', 'Work phone']);
    await admin.post(`/auth/mfa/devices/${second.deviceId}/confirm`, { code: totp(second.secret, 1) }).expect(404);
    expect((await lastEmail(t.db, mod.email))?.subject).toBe('A two-step device was added');

    // A code from either device signs in; a session waiting for its code can't look at the devices.
    for (const secret of [second.secret, first.secret]) {
      await resetLimits();
      await admin.post('/auth/logout').expect(200);
      expect((await signIn()).body).toEqual({ status: 'mfa_required' });
      expect((await admin.get('/auth/mfa/devices').expect(403)).body.error.code).toBe('MFA_REQUIRED');
      await admin.post('/auth/mfa/verify', { code: totp(secret) }).expect(200);
    }

    // Someone else's device is not theirs to confirm or remove.
    const other = await createMember(t, { name: 'Other Admin', roles: ['moderator'], admin: true });
    await other.post(`/auth/mfa/devices/${second.deviceId}/remove`, { code: totp(LEGACY) }).expect(404);
    await other.post(`/auth/mfa/devices/${second.deviceId}/confirm`, { code: totp(LEGACY, 1) }).expect(404);

    // Removing takes a code from any device. Two removals at once can't take both: one device always stays.
    await resetLimits();
    const both = await Promise.all([
      admin.post(`/auth/mfa/devices/${only!.id}/remove`, { code: totp(first.secret) }),
      admin.post(`/auth/mfa/devices/${second.deviceId}/remove`, { code: totp(second.secret) }),
    ]);
    expect(both.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const [kept] = (await admin.get('/auth/mfa/devices').expect(200)).body as MfaDeviceView[];
    expect(await names()).toHaveLength(1);
    const keptSecret = kept!.id === only!.id ? first.secret : second.secret;
    const goneSecret = kept!.id === only!.id ? second.secret : first.secret;
    expect((await lastEmail(t.db, mod.email))?.subject).toBe('A two-step device was removed');
    // The removed device's codes stop working; the one that stayed still signs in.
    await admin.post('/auth/logout').expect(200);
    await signIn();
    await admin.post('/auth/mfa/verify', { code: totp(goneSecret) }).expect(400);
    await admin.post('/auth/mfa/verify', { code: totp(keptSecret, 1) }).expect(200);

    // An account holds five devices at most.
    await t.db.insert(s.mfaDevices).values([1, 2, 3, 4].map((n) => ({ userId: mod.id, name: `Spare ${n}`, secretEnc: `spare-${n}`, confirmedAt: new Date() })));
    await admin.post('/auth/mfa/devices', { name: 'One too many', code: '123456' }).expect(409);

    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.actorId, mod.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa.device_add_started', 'auth.mfa.device_added', 'auth.mfa.device_removed']));
  });

  it('carries over accounts enrolled before devices existed, and never brings an old secret back', async () => {
    // Enrolled the old way: one secret on the account's own row, no device yet.
    const old = await createMember(t, { name: 'Old Enrolment', roles: ['moderator'], admin: true });
    expect(await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, old.id))).toHaveLength(0);
    const [original] = (await old.get('/auth/mfa/devices').expect(200)).body as MfaDeviceView[];
    expect(original).toMatchObject({ name: 'Authenticator app' });

    // A second sign-in, waiting for its code.
    const elsewhere = client(t);
    await elsewhere.post('/auth/login', { email: old.email, password: PASSWORD }).expect(200);
    await elsewhere.get('/me').expect(200);

    // Add a second device, then remove the original one.
    const spare = (await old.post('/auth/mfa/devices', { name: 'Spare', code: totp(LEGACY) }).expect(200)).body as MfaDeviceSetup;
    await old.post(`/auth/mfa/devices/${spare.deviceId}/confirm`, { code: totp(spare.secret) }).expect(200);
    await old.post(`/auth/mfa/devices/${original!.id}/remove`, { code: totp(spare.secret, 1) }).expect(200);
    // Its copy on the account's row goes with it, and the account's other sessions are signed out.
    const [row] = await t.db.select().from(s.users).where(eq(s.users.id, old.id));
    expect(row).toMatchObject({ mfaSecretEnc: null });
    expect(row!.mfaEnabledAt).not.toBeNull();
    await elsewhere.get('/me').expect(401);
    await old.get('/me').expect(200);
    await resetLimits();
    const back = client(t, 'admin');
    await back.post('/auth/login', { email: old.email, password: PASSWORD, audience: 'admin' }).expect(200);
    await back.post('/auth/mfa/verify', { code: totp(LEGACY) }).expect(400);
    await back.post('/auth/mfa/verify', { code: totp(spare.secret) }).expect(200);

    // Enrolled by the previous version while this one was starting: on, with only a leftover unconfirmed row.
    const late = await createMember(t, { name: 'Late Enrolment', roles: ['moderator'], mfa: false });
    await t.db.insert(s.mfaDevices).values({ userId: late.id, name: 'Authenticator app', secretEnc: 'left-over-from-an-abandoned-setup' });
    await t.db.update(s.users).set({ mfaSecretEnc: encrypt(LEGACY), mfaEnabledAt: new Date() }).where(eq(s.users.id, late.id));
    const lateAdmin = client(t, 'admin');
    await resetLimits();
    expect((await lateAdmin.post('/auth/login', { email: late.email, password: PASSWORD, audience: 'admin' }).expect(200)).body).toEqual({ status: 'mfa_required' });
    await lateAdmin.post('/auth/mfa/verify', { code: totp(LEGACY) }).expect(200);
    expect((await lateAdmin.get('/auth/mfa/devices').expect(200)).body).toHaveLength(1);

    // Turned off by the previous version (its columns cleared, device rows left behind): setting up again starts clean.
    const off = await createMember(t, { name: 'Turned Off' });
    await t.db.insert(s.mfaDevices).values({ userId: off.id, name: 'Authenticator app', secretEnc: encrypt(LEGACY), confirmedAt: new Date() });
    expect((await off.get('/auth/mfa/devices').expect(200)).body).toEqual([]);
    const again = (await off.post('/auth/mfa/setup').expect(200)).body as MfaDeviceSetup;
    await off.post('/auth/mfa/enable', { code: totp(again.secret) }).expect(200);
    const rows = await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, off.id));
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0]!.secretEnc)).toBe(again.secret);
  });

  it('a newer setup replaces an older one, and a device must be confirmed in time', async () => {
    const m = await createMember(t, { name: 'Two Tabs' });
    const one = (await m.post('/auth/mfa/setup').expect(200)).body as MfaDeviceSetup;
    const two = (await m.post('/auth/mfa/setup').expect(200)).body as MfaDeviceSetup;
    await m.post('/auth/mfa/enable', { code: totp(one.secret) }).expect(400);
    await m.post('/auth/mfa/enable', { code: totp(two.secret) }).expect(200);
    expect(await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, m.id))).toHaveLength(1);

    // A device being added waits 15 minutes at most for its code.
    const slow = (await m.post('/auth/mfa/devices', { name: 'Slow', code: totp(two.secret, 1) }).expect(200)).body as MfaDeviceSetup;
    await t.db.update(s.mfaDevices).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(s.mfaDevices.id, slow.deviceId));
    await m.post(`/auth/mfa/devices/${slow.deviceId}/confirm`, { code: totp(slow.secret) }).expect(409);
    await m.post(`/auth/mfa/devices/${slow.deviceId}/confirm`, { code: totp(slow.secret) }).expect(404);
    expect((await m.get('/auth/mfa/devices').expect(200)).body).toHaveLength(1);
  });

  it('a Super Admin can reset someone’s two-step verification: they are signed out and set it up again', async () => {
    const boss = await createMember(t, { name: 'Super Boss', roles: ['super_admin'], admin: true });
    const platformAdmin = await createMember(t, { name: 'Platform Pat', roles: ['platform_admin'], admin: true });
    const lost = await createMember(t, { name: 'Lost Phone', roles: ['moderator'], admin: true });
    const reset = `/admin/members/${lost.id}/two-step/reset`;
    await lost.get('/me').expect(200);

    // Super Admins only, and never on their own account.
    await platformAdmin.post(reset).expect(403);
    await lost.post(reset).expect(403);
    await boss.post(`/admin/members/${boss.id}/two-step/reset`).expect(403);
    expect((await boss.get('/admin/members?q=Lost%20Phone').expect(200)).body.items[0]).toMatchObject({ id: lost.id, twoStep: true });

    expect((await boss.post(reset).expect(200)).body).toMatchObject({ id: lost.id, twoStep: false });
    const [after] = await t.db.select().from(s.users).where(eq(s.users.id, lost.id));
    expect(after).toMatchObject({ mfaEnabledAt: null, mfaSecretEnc: null });
    expect(await t.db.select().from(s.mfaDevices).where(eq(s.mfaDevices.userId, lost.id))).toHaveLength(0);
    // Signed out everywhere, told by email, and on the audit log.
    await lost.get('/me').expect(401);
    expect((await lastEmail(t.db, lost.email))?.subject).toBe('Two-step verification was reset on your account');
    const [entry] = await t.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'auth.mfa.reset'), eq(s.auditLog.targetId, lost.id)));
    expect(entry).toMatchObject({ actorId: boss.id, targetType: 'user' });

    // Their old device no longer counts: the next sign-in asks them to set two-step verification up again.
    const again = client(t, 'admin');
    expect((await again.post('/auth/login', { email: lost.email, password: PASSWORD, audience: 'admin' }).expect(200)).body).toEqual({ status: 'mfa_setup_required' });
    expect((await again.post('/auth/mfa/verify', { code: totp(LEGACY) }).expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    const fresh = (await again.post('/auth/mfa/setup').expect(200)).body as MfaDeviceSetup;
    await again.post('/auth/mfa/enable', { code: totp(fresh.secret) }).expect(200);
    expect((await again.get('/me').expect(200)).body.mfa).toEqual({ enabled: true, verifiedThisSession: true, required: true });
    // And it stays gone once they are set up again.
    await again.post('/auth/logout').expect(200);
    await again.post('/auth/login', { email: lost.email, password: PASSWORD, audience: 'admin' }).expect(200);
    await again.post('/auth/mfa/verify', { code: totp(LEGACY) }).expect(400);
    await again.post('/auth/mfa/verify', { code: totp(fresh.secret, 1) }).expect(200);

    // Nothing to reset on an account without it.
    const plain = await createMember(t, { name: 'No Two Step' });
    await boss.post(`/admin/members/${plain.id}/two-step/reset`).expect(409);
  });
});
