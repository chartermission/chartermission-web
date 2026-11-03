import { client, createTestApp, type TestApp } from '../helpers.js';
import { registerVerified, resetLimits, STRONG, totp } from './support.js';

describe('Auth: member two-step sign-in, policy versions, onboarding avatar uploads', () => {
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

  it('a member with MFA on must enter a code after sign-in before using the session', async () => {
    const m = await registerVerified(t, { name: 'Ngozi Adeyemi' });
    const setup = await m.post('/auth/mfa/setup').expect(200);
    const secret = setup.body.secret as string;
    await m.post('/auth/mfa/enable', { code: totp(secret) }).expect(200);

    const fresh = client(t);
    const login = await fresh.post('/auth/login', { email: m.email, password: STRONG }).expect(200);
    expect(login.body).toEqual({ status: 'mfa_required' });

    const me = await fresh.get('/me').expect(200);
    expect(me.body.mfa).toEqual({ enabled: true, verifiedThisSession: false });
    const blocked = await fresh.get('/feed').expect(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    await fresh.post('/posts', { body: 'Hello' }).expect(403);

    await resetLimits();
    await fresh.post('/auth/mfa/verify', { code: totp(secret, 1) }).expect(200);
    await fresh.get('/feed').expect(200);
    const after = await fresh.get('/me').expect(200);
    expect(after.body.mfa.verifiedThisSession).toBe(true);
  });

  it('members without MFA sign in straight through', async () => {
    const m = await registerVerified(t, { name: 'Tendai Moyo' });
    const fresh = client(t);
    const login = await fresh.post('/auth/login', { email: m.email, password: STRONG }).expect(200);
    expect(login.body).toEqual({ status: 'ok' });
    await fresh.get('/feed').expect(200);
  });

  it('GET /policies returns the current versions without a session', async () => {
    const res = await t.http().get('/api/v1/policies').expect(200);
    expect(res.body).toEqual({ terms: expect.any(String), privacy: expect.any(String), guidelines: expect.any(String) });
  });

  it('unverified members can upload an avatar but not post media', async () => {
    const m = await registerVerified(t, { name: 'Imani Otieno', verify: false });
    await m.post('/uploads', { purpose: 'avatar', fileName: 'me.png', mime: 'image/png', sizeBytes: 2048 }).expect(201);
    const res = await m.post('/uploads', { purpose: 'post_image', fileName: 'x.png', mime: 'image/png', sizeBytes: 2048 }).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
