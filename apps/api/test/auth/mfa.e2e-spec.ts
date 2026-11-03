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
    const mod = await createMember(t, { name: 'Moderator One', roles: ['moderator'] });
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
    expect((await admin.get('/me').expect(200)).body.mfa).toEqual({ enabled: true, verifiedThisSession: false });

    const replay = await admin.post('/auth/mfa/verify', { code }).expect(400);
    expect(replay.body.error.code).toBe('INVALID_MFA_CODE');
    await admin.post('/auth/mfa/verify', { code: totp(secret, 1) }).expect(200);
    expect((await admin.get('/me').expect(200)).body.mfa).toEqual({ enabled: true, verifiedThisSession: true });

    // The member-audience session is separate.
    const memberSide = await mod.get('/me').expect(200);
    expect(memberSide.body.sessionAudience).toBe('member');

    // Privileged roles cannot turn MFA off.
    await admin.post('/auth/mfa/disable', { password: PASSWORD }).expect(403);

    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.actorId, mod.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa.enabled', 'auth.mfa.verified', 'auth.login.success']));
  });

  it('MFA verify locks out after 5 wrong codes', async () => {
    const mod = await createMember(t, { name: 'Moderator Two', roles: ['platform_admin'] });
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
