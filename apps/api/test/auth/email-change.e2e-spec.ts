import { eq } from 'drizzle-orm';
import { client, createMember, createTestApp, lastEmail, s, tokenFrom, type TestApp } from '../helpers.js';
import { STRONG, registerVerified, resetLimits, uniqueEmail, userByEmail } from './support.js';

describe('Changing the account email', () => {
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

  it('confirmed accounts: the new address must be confirmed; the old one works until then and is told', async () => {
    const m = await registerVerified(t, { name: 'Esi Mensah' });
    const next = uniqueEmail('esi.new');

    await m.post('/me/email', { email: next, password: 'wrong-password' }).expect(422);
    await m.post('/me/email', { email: m.email.toUpperCase(), password: STRONG }).expect(422);
    const res = await m.post('/me/email', { email: next, password: STRONG }).expect(200);
    expect(res.body).toEqual({ status: 'pending', email: next });

    const me = await m.get('/me').expect(200);
    expect(me.body).toMatchObject({ email: m.email, emailVerified: true, pendingEmail: next });
    const heads = await lastEmail(t.db, m.email);
    expect(heads?.subject).toBe('Your email is being changed');
    expect(heads?.textBody).toContain(next);

    // Still signs in with the current address until the link is opened.
    await client(t).post('/auth/login', { email: m.email, password: STRONG }).expect(200);

    // Resend issues a new link and retires the earlier one.
    const first = tokenFrom((await lastEmail(t.db, next))?.textBody);
    await m.post('/me/email/resend').expect(202);
    const second = tokenFrom((await lastEmail(t.db, next))?.textBody);
    expect(second).not.toBe(first);
    await client(t).post('/auth/email/confirm', { token: first }).expect(400);

    // Opened on another device, no session needed.
    await client(t).post('/auth/email/confirm', { token: second }).expect(200);
    const after = await m.get('/me').expect(200);
    expect(after.body).toMatchObject({ email: next, emailVerified: true, pendingEmail: null });
    expect((await lastEmail(t.db, m.email))?.subject).toBe('Your email was changed');
    await client(t).post('/auth/login', { email: m.email, password: STRONG }).expect(401);
    await client(t).post('/auth/login', { email: next, password: STRONG }).expect(200);
    await client(t).post('/auth/email/confirm', { token: second }).expect(400);
  });

  it('a pending change can be cancelled, and an address another account uses is refused', async () => {
    const m = await registerVerified(t, { name: 'Kwesi Appiah' });
    const other = await createMember(t, { name: 'Other Owner' });
    const [otherUser] = await t.db.select().from(s.users).where(eq(s.users.id, other.id));
    const taken = await m.post('/me/email', { email: otherUser!.email, password: STRONG }).expect(422);
    expect(taken.body.error.fields.email).toBe('That email is already used by another Charter Mission account');

    const next = uniqueEmail('kwesi.new');
    await m.post('/me/email', { email: next, password: STRONG }).expect(200);
    const token = tokenFrom((await lastEmail(t.db, next))?.textBody);
    await m.delete('/me/email').expect(200);
    expect((await m.get('/me').expect(200)).body.pendingEmail).toBeNull();
    await client(t).post('/auth/email/confirm', { token }).expect(400);
    await m.post('/me/email/resend').expect(422);
    expect((await userByEmail(t, m.email)).email).toBe(m.email);
  });

  it('if someone else takes the address before the link is opened, the change is refused', async () => {
    const m = await registerVerified(t, { name: 'Abena Owusu' });
    const next = uniqueEmail('abena.new');
    await m.post('/me/email', { email: next, password: STRONG }).expect(200);
    const token = tokenFrom((await lastEmail(t.db, next))?.textBody);
    await createMember(t, { name: 'Quick Taker', email: next });
    await client(t).post('/auth/email/confirm', { token }).expect(422);
    expect((await m.get('/me').expect(200)).body.email).toBe(m.email);
  });

  it('unconfirmed accounts switch at once (a typo at sign-up) and the verification link goes to the new address', async () => {
    const m = await registerVerified(t, { name: 'Yaa Asantewaa', verify: false });
    const fixed = uniqueEmail('yaa.fixed');
    const res = await m.post('/me/email', { email: fixed, password: STRONG }).expect(200);
    expect(res.body).toEqual({ status: 'changed', email: fixed });
    const me = await m.get('/me').expect(200);
    expect(me.body).toMatchObject({ email: fixed, emailVerified: false, pendingEmail: null, status: 'unverified' });

    const mail = await lastEmail(t.db, fixed);
    expect(mail?.subject).toBe('Confirm your email for Charter Mission');
    await client(t).post('/auth/verify', { token: tokenFrom(mail?.textBody) }).expect(200);
    expect((await m.get('/me').expect(200)).body).toMatchObject({ email: fixed, emailVerified: true, status: 'active' });
  });

  it('right after sign-up, before signing in: the password fixes a mistyped address', async () => {
    const typo = uniqueEmail('ama.typo');
    const fixed = uniqueEmail('ama.fixed');
    const c = client(t);
    await c.post('/auth/register', { name: 'Ama Darko', email: typo, password: STRONG, country: 'GH', acceptTerms: true }).expect(202);
    const oldLink = tokenFrom((await lastEmail(t.db, typo))?.textBody);

    const wrong = await c.post('/auth/email/correct', { email: typo, password: 'not-the-password', newEmail: fixed }).expect(422);
    expect(wrong.body.error.fields.password).toBeDefined();
    await c.post('/auth/email/correct', { email: typo, password: STRONG, newEmail: fixed }).expect(200);

    await c.post('/auth/verify', { token: oldLink }).expect(400);
    await c.post('/auth/verify', { token: tokenFrom((await lastEmail(t.db, fixed))?.textBody) }).expect(200);
    await c.post('/auth/login', { email: fixed, password: STRONG }).expect(200);

    // Once confirmed, it has to go through Settings (and the new address's link).
    await resetLimits();
    const again = await client(t).post('/auth/email/correct', { email: fixed, password: STRONG, newEmail: uniqueEmail('ama.x') }).expect(422);
    expect(again.body.error.fields.newEmail).toContain('already confirmed');
  });
});
