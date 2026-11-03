import { and, eq, sql } from 'drizzle-orm';
import { SessionUser } from '@chartermission/contracts';
import { client, count, createMember, createTestApp, lastEmail, PASSWORD, s, tokenFrom, type TestApp } from '../helpers.js';
import { STRONG, notificationsFor, profileOf, registerVerified, resetLimits, uniqueEmail, userByEmail } from './support.js';

describe('Auth: registration, verification, sign-in, reset (spec 4.2)', () => {
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

  it('register → email → verify → login → /me', async () => {
    const c = client(t);
    const email = uniqueEmail('amara');
    const res = await c
      .post('/auth/register', { name: 'Amara Okafor', email, password: STRONG, country: 'NG', acceptTerms: true })
      .expect(202);
    expect(res.body).toEqual({ ok: true });
    // No session is created by registration.
    expect(res.headers['set-cookie']).toBeUndefined();

    const user = await userByEmail(t, email);
    expect(user.status).toBe('unverified');
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    const profile = await profileOf(t, user.id);
    expect(profile.handle).toBe('amara-okafor');
    expect(profile.countryCode).toBe('NG');

    // CM-AUTH-06: three consent rows with policy version and timestamp.
    const consents = await t.db.select().from(s.consentRecords).where(eq(s.consentRecords.userId, user.id));
    expect(consents.map((r) => r.policyType).sort()).toEqual(['guidelines', 'privacy', 'terms']);
    for (const r of consents) {
      expect(r.policyVersion).toBe('2026-11');
      expect(r.acceptedAt).toBeInstanceOf(Date);
    }
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'account_registered'))).toBeGreaterThan(0);

    const mail = await lastEmail(t.db, email);
    expect(mail?.textBody).toContain('http://localhost:3000/verify-email?token=');
    const token = tokenFrom(mail?.textBody);
    // Only the hash is stored.
    const tokens = await t.db.select().from(s.authTokens).where(eq(s.authTokens.userId, user.id));
    expect(tokens.every((tk) => tk.tokenHash !== token)).toBe(true);
    expect(tokens[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);

    await c.post('/auth/verify', { token }).expect(200);
    expect((await userByEmail(t, email)).status).toBe('active');
    expect(await notificationsFor(t, user.id, 'welcome')).toHaveLength(1);
    expect(await count(t.db, s.analyticsEvents, eq(s.analyticsEvents.name, 'email_verified'))).toBeGreaterThan(0);

    const login = await c.post('/auth/login', { email, password: STRONG }).expect(200);
    expect(login.body).toEqual({ status: 'ok' });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toContain('cm_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const me = await c.get('/me').expect(200);
    expect(SessionUser.parse(me.body)).toBeTruthy();
    expect(me.body).toMatchObject({
      email,
      emailVerified: true,
      status: 'active',
      handle: 'amara-okafor',
      name: 'Amara Okafor',
      countryCode: 'NG',
      needsPolicyReaccept: false,
      sessionAudience: 'member',
      onboarding: { step: 0, completed: false },
      mfa: { enabled: false, verifiedThisSession: false },
    });
    expect(me.body.roles).toContain('member');
    expect((await userByEmail(t, email)).lastLoginAt).not.toBeNull();
  });

  it('derives a unique handle from the name', async () => {
    const a = await registerVerified(t, { name: 'Chidi Eze' });
    const b = await registerVerified(t, { name: 'Chidi Eze' });
    expect((await profileOf(t, a.id)).handle).toBe('chidi-eze');
    expect((await profileOf(t, b.id)).handle).toBe('chidi-eze-2');
  });

  it('register, forgot, resend and login answer identically for existing and unknown emails', async () => {
    const existing = await registerVerified(t, { name: 'Zainab Bello' });
    const unknown = uniqueEmail('nobody');
    const c = client(t);

    const regA = await c.post('/auth/register', { name: 'Someone Else', email: existing.email, password: STRONG, country: 'KE', acceptTerms: true });
    const regB = await c.post('/auth/register', { name: 'Someone Else', email: unknown, password: STRONG, country: 'KE', acceptTerms: true });
    expect([regA.status, regA.body]).toEqual([regB.status, regB.body]);
    expect(regA.status).toBe(202);
    // The existing owner is told someone tried; no second account was made.
    expect((await lastEmail(t.db, existing.email))?.subject).toMatch(/tried to create an account/);
    expect(await count(t.db, s.users, sql`lower(${s.users.email}) = ${existing.email}`)).toBe(1);

    const forgotA = await c.post('/auth/password/forgot', { email: existing.email });
    const forgotB = await c.post('/auth/password/forgot', { email: uniqueEmail('ghost') });
    expect([forgotA.status, forgotA.body]).toEqual([forgotB.status, forgotB.body]);

    const resendA = await c.post('/auth/resend', { email: existing.email });
    const resendB = await c.post('/auth/resend', { email: uniqueEmail('ghost') });
    expect([resendA.status, resendA.body]).toEqual([resendB.status, resendB.body]);

    const loginA = await c.post('/auth/login', { email: existing.email, password: 'wrong-password-123' });
    const loginB = await c.post('/auth/login', { email: uniqueEmail('ghost'), password: 'wrong-password-123' });
    expect(loginA.status).toBe(401);
    expect([loginA.status, loginA.body]).toEqual([loginB.status, loginB.body]);
    expect(loginA.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects weak, common, breached-list and personal passwords', async () => {
    const c = client(t);
    const base = { name: 'Ngozi Adeyemi', country: 'NG', acceptTerms: true };
    for (const password of ['short-pass', 'password1234', 'qwerty123456', 'Ngozi-Adeyemi-2026', 'ngozi.adeyemi!77']) {
      const res = await c.post('/auth/register', { ...base, email: 'ngozi.adeyemi@example.test', password }).expect(422);
      expect(res.body.error.fields.password).toBeTruthy();
    }
    const unknownCountry = await c.post('/auth/register', { ...base, email: uniqueEmail(), password: STRONG, country: 'XX' }).expect(422);
    expect(unknownCountry.body.error.fields.country).toBeTruthy();
  });

  it('rate-limits registration to 10 per hour per IP', async () => {
    const c = client(t);
    for (let i = 0; i < 10; i++) {
      // Valid shape, rejected by the password policy: still counts towards the limit.
      await c
        .post('/auth/register', { name: 'Rate Test', email: uniqueEmail(), password: 'password1234', country: 'NG', acceptTerms: true })
        .set('X-Forwarded-For', '203.0.113.7')
        .expect(422);
    }
    const res = await c
      .post('/auth/register', { name: 'Rate Test', email: uniqueEmail(), password: STRONG, country: 'NG', acceptTerms: true })
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('expired and reused verification tokens fail generically', async () => {
    const c = client(t);
    const email = uniqueEmail('tolu');
    await c.post('/auth/register', { name: 'Tolu Ade', email, password: STRONG, country: 'NG', acceptTerms: true }).expect(202);
    const token = tokenFrom((await lastEmail(t.db, email))?.textBody);
    const user = await userByEmail(t, email);
    await t.db.update(s.authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.authTokens.userId, user.id));
    const expired = await c.post('/auth/verify', { token }).expect(400);
    expect(expired.body.error.code).toBe('INVALID_TOKEN');

    // Resend issues a fresh token; it works once.
    await c.post('/auth/resend', { email }).expect(202);
    const fresh = tokenFrom((await lastEmail(t.db, email))?.textBody);
    await c.post('/auth/verify', { token: fresh }).expect(200);
    const reused = await c.post('/auth/verify', { token: fresh }).expect(400);
    expect(reused.body).toEqual(expired.body);
  });

  it('resend uses the session when signed in and is limited to 3 per hour per account', async () => {
    const m = await registerVerified(t, { name: 'Halima Musa', verify: false });
    for (let i = 0; i < 3; i++) await m.post('/auth/resend', {}).expect(202);
    expect(await count(t.db, s.emailOutbox, and(eq(s.emailOutbox.toAddress, m.email), eq(s.emailOutbox.template, 'auth.verify')))).toBe(4);
    await m.post('/auth/resend', {}).expect(429);
  });

  it('unverified members can sign in but cannot connect (403 EMAIL_NOT_VERIFIED)', async () => {
    const m = await registerVerified(t, { name: 'Ifeoma Nwosu', verify: false });
    const other = await createMember(t, { name: 'Target Person' });
    const me = await m.get('/me').expect(200);
    expect(me.body).toMatchObject({ emailVerified: false, status: 'unverified' });
    const res = await m.post('/connections', { memberId: other.id }).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    // They can still edit their profile.
    await m.patch('/me/profile', { headline: 'Data analyst' }).expect(200);
  });

  it('password reset: single use, expires, revokes every session', async () => {
    const m = await registerVerified(t, { name: 'Musa Danjuma' });
    const second = client(t);
    await second.post('/auth/login', { email: m.email, password: STRONG }).expect(200);
    await m.get('/me').expect(200);

    const c = client(t);
    await c.post('/auth/password/forgot', { email: m.email }).expect(202);
    const mail = await lastEmail(t.db, m.email);
    expect(mail?.textBody).toContain('http://localhost:3000/reset-password?token=');
    const token = tokenFrom(mail?.textBody);
    const [row] = await t.db.select().from(s.authTokens).where(and(eq(s.authTokens.userId, m.id), eq(s.authTokens.purpose, 'reset')));
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);

    const weak = await c.post('/auth/password/reset', { token, password: 'password1234' }).expect(422);
    expect(weak.body.error.fields.password).toBeTruthy();

    const newPassword = 'Baobab-Kettle-Ninety-7';
    await c.post('/auth/password/reset', { token, password: newPassword }).expect(200);
    await m.get('/me').expect(401);
    await second.get('/me').expect(401);
    expect((await lastEmail(t.db, m.email))?.subject).toBe('Your password was reset');

    const reused = await c.post('/auth/password/reset', { token, password: 'Another-Long-Phrase-88' }).expect(400);
    expect(reused.body.error.code).toBe('INVALID_TOKEN');
    await c.post('/auth/login', { email: m.email, password: STRONG }).expect(401);
    await c.post('/auth/login', { email: m.email, password: newPassword }).expect(200);

    // Expired reset token fails with the same generic error.
    await c.post('/auth/password/forgot', { email: m.email }).expect(202);
    const token2 = tokenFrom((await lastEmail(t.db, m.email))?.textBody);
    await t.db.update(s.authTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.authTokens.userId, m.id));
    const expired = await c.post('/auth/password/reset', { token: token2, password: 'Another-Long-Phrase-88' }).expect(400);
    expect(expired.body).toEqual(reused.body);
  });

  it('locks sign-in after 5 failures with 429 and Retry-After; success clears the account counter', async () => {
    const m = await createMember(t, { name: 'Lock Test' });
    const c = client(t);
    for (let i = 0; i < 4; i++) await c.post('/auth/login', { email: m.email, password: 'not-the-password' }).expect(401);
    await c.post('/auth/login', { email: m.email, password: PASSWORD }).expect(200);
    await resetLimits(); // clear the IP counter; the account counter was cleared by the success

    for (let i = 0; i < 5; i++) await c.post('/auth/login', { email: m.email, password: 'not-the-password' }).expect(401);
    const locked = await c.post('/auth/login', { email: m.email, password: PASSWORD }).expect(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(locked.body.error.retryAfter).toBeGreaterThan(0);

    // Per-IP limit applies across accounts too.
    await resetLimits();
    const ip = '198.51.100.9';
    for (let i = 0; i < 5; i++) {
      await c.post('/auth/login', { email: uniqueEmail('x'), password: 'nope-nope-nope' }).set('X-Forwarded-For', ip).expect(401);
    }
    await c.post('/auth/login', { email: m.email, password: PASSWORD }).set('X-Forwarded-For', ip).expect(429);
    const failures = await count(t.db, s.auditLog, eq(s.auditLog.action, 'auth.login.failure'));
    expect(failures).toBeGreaterThanOrEqual(14);
  });

  it('deleted accounts get invalid credentials; suspended members can sign in and read /me', async () => {
    const gone = await createMember(t, { name: 'Gone Member' });
    await t.db.update(s.users).set({ status: 'deleted' }).where(eq(s.users.id, gone.id));
    const c = client(t);
    const res = await c.post('/auth/login', { email: gone.email, password: PASSWORD }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    const susp = await createMember(t, { name: 'Suspended Member', status: 'suspended' });
    const c2 = client(t);
    await c2.post('/auth/login', { email: susp.email, password: PASSWORD }).expect(200);
    expect((await c2.get('/me').expect(200)).body.status).toBe('suspended');
  });

  it('sends a new-device email only for an unseen user agent (not on the first login)', async () => {
    const email = uniqueEmail('device');
    const c = client(t);
    await c.post('/auth/register', { name: 'Device Tester', email, password: STRONG, country: 'NG', acceptTerms: true }).expect(202);
    await c.post('/auth/login', { email, password: STRONG }).set('User-Agent', 'Phone A').expect(200);
    const after = () => count(t.db, s.emailOutbox, and(eq(s.emailOutbox.toAddress, email), eq(s.emailOutbox.template, 'security.new_sign_in')));
    expect(await after()).toBe(0);
    await c.post('/auth/login', { email, password: STRONG }).set('User-Agent', 'Phone A').expect(200);
    expect(await after()).toBe(0);
    await c.post('/auth/login', { email, password: STRONG }).set('User-Agent', 'Laptop B').expect(200);
    expect(await after()).toBe(1);
  });

  it('login rotates the session and logout revokes it', async () => {
    const m = await createMember(t, { name: 'Rotate Test' });
    const c = client(t);
    await c.post('/auth/login', { email: m.email, password: PASSWORD }).expect(200);
    const [first] = await t.db.select().from(s.sessions).where(eq(s.sessions.userId, m.id)).orderBy(sql`${s.sessions.createdAt} desc`).limit(1);
    await c.post('/auth/login', { email: m.email, password: PASSWORD }).expect(200);
    const [old] = await t.db.select().from(s.sessions).where(eq(s.sessions.id, first!.id));
    expect(old!.revokedAt).not.toBeNull();
    await c.get('/me').expect(200);
    const out = await c.post('/auth/logout').expect(200);
    expect(String(out.headers['set-cookie'])).toContain('cm_session=;');
    await c.get('/me').expect(401);
  });

  it('serves the dev mailbox outside production', async () => {
    const email = uniqueEmail('mailbox');
    const c = client(t);
    await c.post('/auth/register', { name: 'Mail Box', email, password: STRONG, country: 'NG', acceptTerms: true }).expect(202);
    const res = await c.get(`/dev/mailbox?to=${encodeURIComponent(email)}`).expect(200);
    expect(res.body.items[0].subject).toMatch(/Confirm your email/);
    expect(res.body.items[0].text).toContain('/verify-email?token=');

    process.env.DEV_TOOLS = 'false';
    try {
      await c.get(`/dev/mailbox?to=${encodeURIComponent(email)}`).expect(404);
    } finally {
      delete process.env.DEV_TOOLS;
    }
  });

  it('checks Have I Been Pwned when enabled (k-anonymity) and fails open on errors', async () => {
    const { createHash } = await import('node:crypto');
    const breached = 'Mango-Harbour-Sixty-Two';
    const sha1 = createHash('sha1').update(breached).digest('hex').toUpperCase();
    const requested: string[] = [];
    process.env.HIBP_ENABLED = 'true';
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      return new Response(`${sha1.slice(5)}:42\r\n0000000000000000000000000000000000A:0`, { status: 200 });
    });
    try {
      const c = client(t);
      const res = await c
        .post('/auth/register', { name: 'Pwned Check', email: uniqueEmail(), password: breached, country: 'NG', acceptTerms: true })
        .expect(422);
      expect(res.body.error.fields.password).toMatch(/breach/);
      // Only the 5-character prefix leaves the server.
      expect(requested).toEqual([`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`]);

      vi.stubGlobal('fetch', async () => {
        throw new Error('network down');
      });
      await c
        .post('/auth/register', { name: 'Pwned Check', email: uniqueEmail(), password: breached, country: 'NG', acceptTerms: true })
        .expect(202);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.HIBP_ENABLED;
    }
  });
});
