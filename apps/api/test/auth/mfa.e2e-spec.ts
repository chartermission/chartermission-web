import { eq } from 'drizzle-orm';
import { client, createMember, createTestApp, PASSWORD, s, type TestApp } from '../helpers.js';
import { resetLimits, totp } from './support.js';

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
    expect(pending!.mfaSecretEnc).not.toContain(secret); // encrypted at rest

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
  });
});
