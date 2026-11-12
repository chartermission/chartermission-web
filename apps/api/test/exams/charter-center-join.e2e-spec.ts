import { eq } from 'drizzle-orm';
import type {
  AdminExamAttempt,
  AdminExamDetail,
  ExamAttemptView,
  ExamCertificateView,
  ExamDetail,
  ExamInviteRow,
  ExamJoinInfo,
  ExamJoinStarted,
  ExamJoinVerified,
  ExamsAdminSettings,
  Page,
  PostView,
} from '@chartermission/contracts';
import { ExamCertificatesService } from '../../src/exams/exam-certificates.service.js';
import { client, createMember, createTestApp, lastEmail, PASSWORD, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const question = (prompt: string, correctIndex: number) => ({
  prompt,
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text })),
  correctIndex,
});

/** The 6-digit code in the newest email to an address. */
async function codeFor(t: TestApp, email: string): Promise<string> {
  const mail = await lastEmail(t.db, email);
  const m = mail?.textBody?.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`No code in the email to ${email}`);
  return m[1]!;
}

describe('Charter Center students: join from an exam link, certificate on passing', () => {
  let t: TestApp;
  let admin: Member;
  let exam: AdminExamDetail;
  let pageId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    const owner = await createMember(t, { name: 'Page Owner' });
    const [page] = await t.db
      .insert(s.pages)
      .values({ slug: 'charter-center', name: 'Charter Center', category: 'education', status: 'active', createdBy: owner.id })
      .returning();
    pageId = page!.id;

    exam = (await admin.post('/admin/exams', { title: 'CAPM Mock Exam', passPercent: 50, charterCenterCourseId: 'capm-101' }).expect(201)).body as AdminExamDetail;
    for (const [i, p] of ['First', 'Second'].entries()) await admin.post(`/admin/exams/${exam.id}/questions`, question(`${p} question?`, i)).expect(201);
    exam = (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published' }).expect(200)).body as AdminExamDetail;
    expect(exam).toMatchObject({ charterCenterCourseId: 'capm-101', shareCertificates: true, charterCenterCourse: null });
  });
  afterAll(async () => {
    await t.close();
  });

  async function passExam(m: ReturnType<typeof client>, right = 2): Promise<ExamAttemptView> {
    const attempt = (await m.post(`/exams/${exam.id}/attempts`).expect(201)).body as ExamAttemptView;
    for (const [i, q] of attempt.questions.entries()) {
      const correct = exam.questions.find((k) => k.id === q.id)!.correctOptionId;
      const optionId = i < right ? correct : q.options.find((o) => o.id !== correct)!.id;
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId }).expect(200);
    }
    return (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
  }

  it('shows the exam on the public join page (published exams only)', async () => {
    const info = (await t.http().get(`/api/v1/exam-join/${exam.slug}`).expect(200)).body as ExamJoinInfo;
    expect(info).toMatchObject({ slug: 'capm-mock-exam', title: 'CAPM Mock Exam', questionCount: 2, awardsCertificate: true });
    const draft = (await admin.post('/admin/exams', { title: 'Hidden Draft' }).expect(201)).body as AdminExamDetail;
    await t.http().get(`/api/v1/exam-join/${draft.slug}`).expect(404);
    await t.http().get('/api/v1/exam-join/no-such-exam').expect(404);
  });

  it('turns away emails Charter Center does not know', async () => {
    const visitor = client(t);
    const res = await visitor.post(`/exam-join/${exam.slug}/start`, { email: 'unknown.person@example.test' }).expect(422);
    expect(JSON.stringify(res.body)).toContain('Charter Center account');
    await visitor.post(`/exam-join/${exam.slug}/start`, { email: 'not-an-email' }).expect(422);
  });

  it('a student confirms the code, sees their Charter Center name and photo, sets a password and lands on the exam', async () => {
    const visitor = client(t);
    const email = 'amina.yusuf@example.test';
    const started = (await visitor.post(`/exam-join/${exam.slug}/start`, { email }).expect(200)).body as ExamJoinStarted;
    expect(started.maskedEmail).toBe('a••••••••f@example.test');
    // Nothing about the person before the code is confirmed.
    expect(started).not.toHaveProperty('name');

    await visitor.post('/exam-join/verify', { joinId: started.joinId, code: '000000' }).expect(422);
    await visitor.post('/exam-join/complete', { joinId: started.joinId, password: PASSWORD, acceptTerms: true }).expect(422);
    await visitor.post('/exam-join/resend', { joinId: started.joinId }).expect(429);

    const code = await codeFor(t, email);
    const verified = (await visitor.post('/exam-join/verify', { joinId: started.joinId, code }).expect(200)).body as ExamJoinVerified;
    expect(verified).toMatchObject({ status: 'new', name: 'Amina Yusuf', email });
    expect(verified.status === 'new' && verified.photo?.startsWith('data:image/jpeg;base64,')).toBe(true);

    await visitor.post('/exam-join/complete', { joinId: started.joinId, password: 'short', acceptTerms: true }).expect(422);
    const done = (await visitor.post('/exam-join/complete', { joinId: started.joinId, password: PASSWORD, acceptTerms: true }).expect(200)).body;
    expect(done).toEqual({ next: '/exams/capm-mock-exam' });

    const me = (await visitor.get('/me').expect(200)).body;
    expect(me).toMatchObject({ email, emailVerified: true, onboarding: { completed: false } });
    const [profile] = await t.db.select().from(s.memberProfiles).where(eq(s.memberProfiles.displayName, 'Amina Yusuf'));
    expect(profile!.avatarFileId).toBeTruthy();
    // The join can't be used twice.
    await visitor.post('/exam-join/complete', { joinId: started.joinId, password: PASSWORD, acceptTerms: true }).expect(422);

    const detail = (await visitor.get(`/exams/${exam.slug}`).expect(200)).body as ExamDetail;
    expect(detail).toMatchObject({ awardsCertificate: true, certificate: null });

    // Failing earns nothing.
    const failed = await passExam(visitor, 0);
    expect(failed.result?.passed).toBe(false);
    expect(failed.certificate).toBeNull();

    // Passing: Charter Center's certificate (mock) is fetched, stored and shared at once (queues run inline in tests).
    const passed = await passExam(visitor, 2);
    expect(passed.result?.passed).toBe(true);
    expect(passed.certificate).toMatchObject({ status: 'issued', certificateId: expect.stringMatching(/^CC-\d{4}-\d{6}$/) });
    expect(passed.certificate!.imageUrl).toMatch(/\/media\//);
    expect(passed.certificate!.downloadUrl).toMatch(/\/media\//);
    const cert = (await visitor.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
    expect(cert.postId).toBeTruthy();

    const download = await visitor.get(new URL(cert.downloadUrl!, 'http://x').pathname.replace(/^\/api\/v1/, '')).expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment');

    const email_ = await lastEmail(t.db, email);
    expect(email_?.subject).toBe('Your Charter Center certificate is ready');

    // The post: a "Certification" celebration by the member, about Charter Center's page.
    const post = (await visitor.get(`/posts/${cert.postId}`).expect(200)).body as PostView;
    expect(post.author.name).toBe('Amina Yusuf');
    expect(post.type).toBe('celebration');
    expect(post.celebration).toMatchObject({ category: 'certification', organisation: 'Charter Center' });
    expect(post.aboutPage).toMatchObject({ id: pageId, name: 'Charter Center' });
    expect(post.attachments).toHaveLength(1);

    // Everyone sees it in Following, without following Amina; and it is listed on Charter Center's page.
    const stranger = await createMember(t, { name: 'Somebody Else' });
    const following = (await stranger.get('/feed?tab=following').expect(200)).body as Page<PostView>;
    expect(following.items.map((p) => p.id)).toContain(cert.postId);
    const onPage = (await stranger.get('/feed?page=charter-center').expect(200)).body as Page<PostView>;
    expect(onPage.items.map((p) => p.id)).toContain(cert.postId);

    // Passing again doesn't make a second certificate or post.
    const again = await passExam(visitor, 2);
    expect(again.certificate?.id).toBe(cert.id);
    expect((await t.db.select().from(s.examCertificates)).length).toBe(1);

    const attempts = (await admin.get(`/admin/exams/${exam.id}/attempts?result=passed`).expect(200)).body as Page<AdminExamAttempt>;
    expect(attempts.items.find((a) => a.certificate)?.certificate).toMatchObject({ status: 'issued' });
  });

  it('someone who already has an account is told to sign in once the code is confirmed', async () => {
    const existing = await createMember(t, { name: 'Already Here', email: 'already.here@example.test' });
    const visitor = client(t);
    const started = (await visitor.post(`/exam-join/${exam.slug}/start`, { email: 'Already.Here@example.test' }).expect(200)).body as ExamJoinStarted;
    const verified = (await visitor.post('/exam-join/verify', { joinId: started.joinId, code: await codeFor(t, 'already.here@example.test') }).expect(200))
      .body as ExamJoinVerified;
    expect(verified).toEqual({ status: 'existing', email: 'already.here@example.test' });
    await visitor.post('/exam-join/complete', { joinId: started.joinId, password: PASSWORD, acceptTerms: true }).expect(409);
    expect(existing.id).toBeTruthy();
  });

  it('keeps asking Charter Center until the certificate is ready, and admins can retry', async () => {
    const m = await createMember(t, { name: 'Pending Student', email: 'pending.student@example.test' });
    const result = await passExam(m, 2);
    expect(result.certificate).toMatchObject({ status: 'pending', imageUrl: null, postId: null });
    const [row] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id));
    expect(row).toMatchObject({ tries: 1, status: 'pending' });
    expect(row!.lastError).toContain('no certificate');

    // Charter Center now has it (the mock's "pending" rule is on the email): an admin retries.
    await t.db.update(s.users).set({ email: 'ready.student@example.test' }).where(eq(s.users.id, m.id));
    await admin.post(`/admin/exam-certificates/${row!.id}/retry`).expect(200);
    const cert = (await m.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
    expect(cert).toMatchObject({ status: 'issued' });
    expect(cert.postId).toBeTruthy();
    await admin.post(`/admin/exam-certificates/${row!.id}/retry`).expect(409);
  });

  it('gives up after the last retry, and the sweep picks due ones up', async () => {
    const m = await createMember(t, { name: 'Never Ready', email: 'pending.forever@example.test' });
    await passExam(m, 2);
    const svc = t.app.get(ExamCertificatesService);
    const [row] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id));
    await t.db.update(s.examCertificates).set({ tries: 8, nextTryAt: new Date(Date.now() - 1000) }).where(eq(s.examCertificates.id, row!.id));
    await svc.sweep();
    const [after] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.id, row!.id));
    expect(after).toMatchObject({ status: 'failed', tries: 9 });
  });

  it('exams that don’t share certificates still issue them, without a post', async () => {
    await admin.patch(`/admin/exams/${exam.id}`, { shareCertificates: false }).expect(200);
    const m = await createMember(t, { name: 'Quiet Student' });
    const result = await passExam(m, 2);
    expect(result.certificate).toMatchObject({ status: 'issued', postId: null });
    await admin.patch(`/admin/exams/${exam.id}`, { shareCertificates: true }).expect(200);
  });

  it('admins invite by email and see who joined, took and passed', async () => {
    const invited = (await admin
      .post(`/admin/exams/${exam.id}/invites`, { emails: ['amina.yusuf@example.test', 'new.person@example.test', 'nonsense', 'NEW.person@example.test'], message: 'Good luck!' })
      .expect(200)).body;
    expect(invited).toEqual({ sent: 2, skipped: 0, invalid: ['nonsense'] });
    const mail = await lastEmail(t.db, 'new.person@example.test');
    expect(mail?.textBody).toContain(`/exams/${exam.slug}/join`);
    expect(mail?.textBody).toContain('Good luck!');

    // Not again within 10 minutes.
    expect((await admin.post(`/admin/exams/${exam.id}/invites`, { emails: ['new.person@example.test'] }).expect(200)).body).toMatchObject({ sent: 0, skipped: 1 });

    const rows = (await admin.get(`/admin/exams/${exam.id}/invites`).expect(200)).body as ExamInviteRow[];
    expect(Object.fromEntries(rows.map((r) => [r.email, r.status]))).toEqual({ 'amina.yusuf@example.test': 'passed', 'new.person@example.test': 'invited' });

    const draft = (await admin.post('/admin/exams', { title: 'Unpublished' }).expect(201)).body as AdminExamDetail;
    await admin.post(`/admin/exams/${draft.id}/invites`, { emails: ['x@example.test'] }).expect(409);
    const plain = await createMember(t, { name: 'Not Staff' });
    await plain.post(`/admin/exams/${exam.id}/invites`, { emails: ['x@example.test'] }).expect(403);
  });

  it('admins see the Charter Center connection and choose the certificate page', async () => {
    const settings = (await admin.get('/admin/exams-settings').expect(200)).body as ExamsAdminSettings;
    expect(settings).toEqual({ charterCenterMode: 'mock', certificatePage: { id: pageId, slug: 'charter-center', name: 'Charter Center' } });
    await admin.put('/admin/exams-settings', { certificatePageSlug: 'no-such-page' }).expect(422);
    const set = (await admin.put('/admin/exams-settings', { certificatePageSlug: 'https://chartermission.com/pages/charter-center' }).expect(200)).body as ExamsAdminSettings;
    expect(set.certificatePage?.id).toBe(pageId);
  });
});
