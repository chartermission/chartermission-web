import { desc, eq } from 'drizzle-orm';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { resetLimits } from '../auth/support.js';

/** Errors and emails come back in the reader's language. */
describe('API language', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetLimits());

  it('translates error messages and field messages from the language cookie', async () => {
    const res = await t.http().get('/api/v1/posts/00000000-0000-4000-8000-000000000000').set('Cookie', 'cm_locale=fr').expect(404);
    expect(res.body.error.message).toBe('Publication introuvable');
    const ar = await t.http().get('/api/v1/posts/00000000-0000-4000-8000-000000000000').set('Accept-Language', 'ar-EG,ar;q=0.9').expect(404);
    expect(ar.body.error.message).toBe('المنشور غير موجود');
    const en = await t.http().get('/api/v1/posts/00000000-0000-4000-8000-000000000000').expect(404);
    expect(en.body.error.message).toBe('Post was not found');
  });

  it('writes emails in the recipient’s language, right to left for Arabic', async () => {
    const amara = await createMember(t, { name: 'Amara Lang' });
    const kwame = await createMember(t, { name: 'Kwame Lang' });
    await t.db.update(s.users).set({ locale: 'ar' }).where(eq(s.users.id, kwame.id));
    await amara.post('/connections', { memberId: kwame.id }).expect(201);
    const [mail] = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, kwame.email)).orderBy(desc(s.emailOutbox.createdAt)).limit(1);
    expect(mail!.subject).toContain('يريد Amara Lang التواصل معك');
    expect(mail!.htmlBody).toContain('dir="rtl"');
    expect(mail!.htmlBody).toContain('lang="ar"');
  });

  it('writes invitations in the inviter’s language', async () => {
    const leila = await createMember(t, { name: 'Leila Lang' });
    leila.agent.jar.setCookie('cm_locale=fr; Path=/', '127.0.0.1');
    await leila.post('/invites', { emails: ['someone.new@example.org'] }).expect(200);
    const [mail] = await t.db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toAddress, 'someone.new@example.org')).limit(1);
    expect(mail!.subject).toBe('Leila Lang vous invite à rejoindre Charter Mission');
    expect(mail!.textBody).toContain('Accepter l’invitation');
  });
});
