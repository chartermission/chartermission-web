import { and, eq } from 'drizzle-orm';
import type {
  AdminExamAttempt,
  AdminExamDetail,
  ExamAttemptView,
  ExamCertificateView,
  ExamDetail,
  ExamInviteRow,
  ExamJoinInfo,
  ExamSummary,
  ExamsAdminSettings,
  Page,
  PostView,
} from '@chartermission/contracts';
import { LEARNING_ACCESS_DEFAULTS } from '@chartermission/contracts';
import { ExamCertificatesService } from '../../src/exams/exam-certificates.service.js';
import { createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const question = (prompt: string, correctIndex: number) => ({
  prompt,
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text })),
  correctIndex,
});

describe('Exams by invitation link, and Charter Center certificates for everyone who passes', () => {
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

    exam = (await admin.post('/admin/exams', { title: 'CAPM Mock Exam', passPercent: 50 }).expect(201)).body as AdminExamDetail;
    for (const [i, p] of ['First', 'Second'].entries()) await admin.post(`/admin/exams/${exam.id}/questions`, question(`${p} question?`, i)).expect(201);
    exam = (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published' }).expect(200)).body as AdminExamDetail;
    expect(exam).toMatchObject({ shareCertificates: true });
    expect(exam).not.toHaveProperty('charterCenterCourseId');
  });
  afterAll(async () => {
    await t.close();
  });

  const invite = (m: Member, slug = exam.slug) => m.post(`/exams/${slug}/access`);

  async function passExam(m: Member, right = 2): Promise<ExamAttemptView> {
    const attempt = (await m.post(`/exams/${exam.id}/attempts`).expect(201)).body as ExamAttemptView;
    for (const [i, q] of attempt.questions.entries()) {
      const correct = exam.questions.find((k) => k.id === q.id)!.correctOptionId;
      const optionId = i < right ? correct : q.options.find((o) => o.id !== correct)!.id;
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId }).expect(200);
    }
    return (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
  }

  it('shows the exam on the public invitation page (published exams only)', async () => {
    const info = (await t.http().get(`/api/v1/exam-join/${exam.slug}`).expect(200)).body as ExamJoinInfo;
    expect(info).toEqual({ slug: 'capm-mock-exam', title: 'CAPM Mock Exam', titleAlt: null, language: 'en', secondLanguage: null, questionCount: 2, timeLimitMinutes: null, passPercent: 50 });
    const draft = (await admin.post('/admin/exams', { title: 'Hidden Draft' }).expect(201)).body as AdminExamDetail;
    await t.http().get(`/api/v1/exam-join/${draft.slug}`).expect(404);
    await t.http().get('/api/v1/exam-join/no-such-exam').expect(404);
    // The old code-and-lookup join is gone.
    await t.http().post(`/api/v1/exam-join/${exam.slug}/start`).send({ email: 'x@example.test' }).expect(404);
  });

  it('only members who open the link get the exam, and keep it', async () => {
    const outsider = await createMember(t, { name: 'Not Invited' });
    expect((await outsider.get('/exams').expect(200)).body).toEqual([]);
    await outsider.get(`/exams/${exam.slug}`).expect(404);
    await outsider.post(`/exams/${exam.id}/attempts`).expect(404);
    await outsider.get(`/exams/${exam.id}/certificate`).expect(404);

    const m = await createMember(t, { name: 'Invited Member' });
    const got = (await invite(m).expect(200)).body as ExamSummary;
    expect(got).toMatchObject({ id: exam.id, slug: exam.slug, questionCount: 2, viewer: { attempts: 0 } });
    expect(got).not.toHaveProperty('locked');
    // Opening the link again changes nothing.
    await invite(m).expect(200);
    const rows = await t.db.select().from(s.examAccess).where(and(eq(s.examAccess.examId, exam.id), eq(s.examAccess.userId, m.id)));
    expect(rows).toHaveLength(1);
    const joined = await t.db.select().from(s.analyticsEvents).where(and(eq(s.analyticsEvents.name, 'exam_joined'), eq(s.analyticsEvents.subjectId, exam.id)));
    expect(joined).toHaveLength(1);

    expect(((await m.get('/exams').expect(200)).body as ExamSummary[]).map((e) => e.slug)).toEqual([exam.slug]);
    const detail = (await m.get(`/exams/${exam.slug}`).expect(200)).body as ExamDetail;
    expect(detail).toMatchObject({ certificate: null });
    expect(detail).not.toHaveProperty('awardsCertificate');

    // Links to drafts or exams that don't exist give nothing.
    const draft = (await admin.post('/admin/exams', { title: 'Another Draft' }).expect(201)).body as AdminExamDetail;
    await invite(m, draft.slug).expect(404);
    await invite(m, 'no-such-exam').expect(404);
    await invite(m, 'Not A Slug!').expect(404);
  });

  it('an invited exam can be taken while e-learning is still locked', async () => {
    await admin.put('/admin/settings/learning-access', { ...LEARNING_ACCESS_DEFAULTS, enabled: true }).expect(200);
    const m = await createMember(t, { name: 'Locked Learner' });
    await m.get('/learning').expect(403);
    await invite(m).expect(200);
    await m.post(`/exams/${exam.id}/attempts`).expect(201);
    await admin.put('/admin/settings/learning-access', LEARNING_ACCESS_DEFAULTS).expect(200);
  });

  it('every exam awards a certificate: Charter Center gets the email, name and exam title; it is stored and shared', async () => {
    const m = await createMember(t, { name: 'Amina Yusuf', email: 'amina.yusuf@example.test' });
    await invite(m).expect(200);

    // Failing earns nothing.
    const failed = await passExam(m, 0);
    expect(failed.result?.passed).toBe(false);
    expect(failed).toMatchObject({ awardsCertificate: true, certificate: null });

    // Passing: Charter Center's certificate (mock) is fetched, stored and shared at once (queues run inline in tests).
    const passed = await passExam(m, 2);
    expect(passed.result?.passed).toBe(true);
    expect(passed.certificate).toMatchObject({ status: 'issued', certificateId: expect.stringMatching(/^CC-\d{4}-\d{6}$/) });
    expect(passed.certificate!.imageUrl).toMatch(/\/media\//);
    const cert = (await m.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
    expect(cert.postId).toBeTruthy();

    const download = await m.get(new URL(cert.downloadUrl!, 'http://x').pathname.replace(/^\/api\/v1/, '')).expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');

    expect((await lastEmail(t.db, 'amina.yusuf@example.test'))?.subject).toBe('Your Charter Center certificate is ready');

    // The post: a "Certification" celebration by the member, about Charter Center's page, headed with the exam's title.
    const post = (await m.get(`/posts/${cert.postId}`).expect(200)).body as PostView;
    expect(post.author.name).toBe('Amina Yusuf');
    expect(post.celebration).toMatchObject({ category: 'certification', headline: 'CAPM Mock Exam', organisation: 'Charter Center' });
    expect(post.aboutPage).toMatchObject({ id: pageId, name: 'Charter Center' });

    // Everyone sees it, without following Amina.
    const stranger = await createMember(t, { name: 'Somebody Else' });
    expect(((await stranger.get('/feed?tab=following').expect(200)).body as Page<PostView>).items.map((p) => p.id)).toContain(cert.postId);

    // Passing again doesn't make a second certificate.
    const again = await passExam(m, 2);
    expect(again.certificate?.id).toBe(cert.id);
    expect(await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id))).toHaveLength(1);

    const attempts = (await admin.get(`/admin/exams/${exam.id}/attempts?result=passed`).expect(200)).body as Page<AdminExamAttempt>;
    expect(attempts.items.find((a) => a.certificate)?.certificate).toMatchObject({ status: 'issued' });
  });

  it('keeps asking Charter Center until the certificate is ready, and admins can retry', async () => {
    const m = await createMember(t, { name: 'Pending Student', email: 'pending.student@example.test' });
    await invite(m).expect(200);
    const result = await passExam(m, 2);
    expect(result.certificate).toMatchObject({ status: 'pending', imageUrl: null, postId: null });
    const [row] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id));
    expect(row).toMatchObject({ tries: 1, status: 'pending' });
    expect(row!.lastError).toContain('no certificate');

    // Charter Center now has it (the mock's "pending" rule is on the email): an admin retries.
    await t.db.update(s.users).set({ email: 'ready.student@example.test' }).where(eq(s.users.id, m.id));
    await admin.post(`/admin/exam-certificates/${row!.id}/retry`).expect(200);
    expect((await m.get(`/exams/${exam.id}/certificate`).expect(200)).body).toMatchObject({ status: 'issued' });
    await admin.post(`/admin/exam-certificates/${row!.id}/retry`).expect(409);
  });

  it('gives up after the last retry, and the sweep picks due ones up', async () => {
    const m = await createMember(t, { name: 'Never Ready', email: 'pending.forever@example.test' });
    await invite(m).expect(200);
    await passExam(m, 2);
    const [row] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id));
    await t.db.update(s.examCertificates).set({ tries: 8, nextTryAt: new Date(Date.now() - 1000) }).where(eq(s.examCertificates.id, row!.id));
    await t.app.get(ExamCertificatesService).sweep();
    const [after] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.id, row!.id));
    expect(after).toMatchObject({ status: 'failed', tries: 9 });
  });

  it('exams that don’t share certificates still issue them, without a post', async () => {
    await admin.patch(`/admin/exams/${exam.id}`, { shareCertificates: false }).expect(200);
    const m = await createMember(t, { name: 'Quiet Student' });
    await invite(m).expect(200);
    expect((await passExam(m, 2)).certificate).toMatchObject({ status: 'issued', postId: null });
    await admin.patch(`/admin/exams/${exam.id}`, { shareCertificates: true }).expect(200);
  });

  it('a closed exam stays with those who have it; nobody new gets it', async () => {
    const quiz = (await admin.post('/admin/exams/import', { title: 'Closing Soon', questions: [question('C1', 0)] }).expect(201)).body as AdminExamDetail;
    await admin.patch(`/admin/exams/${quiz.id}`, { status: 'published' }).expect(200);
    const took = await createMember(t, { name: 'Took It' });
    await invite(took, quiz.slug).expect(200);
    const attempt = (await took.post(`/exams/${quiz.id}/attempts`).expect(201)).body as ExamAttemptView;
    await took.post(`/exam-attempts/${attempt.id}/submit`).expect(200);
    await admin.patch(`/admin/exams/${quiz.id}`, { status: 'archived' }).expect(200);
    await took.get(`/exams/${quiz.slug}`).expect(200);
    const late = await createMember(t, { name: 'Too Late' });
    await invite(late, quiz.slug).expect(404);
  });

  it('admins invite by email and see who has the exam, took and passed it', async () => {
    const already = await createMember(t, { name: 'Has An Account', email: 'has.account@example.test' });
    const invited = (await admin
      .post(`/admin/exams/${exam.id}/invites`, {
        emails: ['amina.yusuf@example.test', 'new.person@example.test', 'has.account@example.test', 'nonsense', 'NEW.person@example.test'],
        message: 'Good luck!',
      })
      .expect(200)).body;
    expect(invited).toEqual({ sent: 3, skipped: 0, invalid: ['nonsense'] });
    const mail = await lastEmail(t.db, 'new.person@example.test');
    expect(mail?.textBody).toContain(`/exams/${exam.slug}/join`);
    expect(mail?.textBody).toContain('Good luck!');
    expect(mail?.textBody).toContain('create your free Charter Mission account');

    expect((await admin.post(`/admin/exams/${exam.id}/invites`, { emails: ['new.person@example.test'] }).expect(200)).body).toMatchObject({ sent: 0, skipped: 1 });

    const statuses = async () => Object.fromEntries(((await admin.get(`/admin/exams/${exam.id}/invites`).expect(200)).body as ExamInviteRow[]).map((r) => [r.email, r.status]));
    // An account alone isn't the exam: they have it once they open the link.
    expect(await statuses()).toEqual({ 'amina.yusuf@example.test': 'passed', 'new.person@example.test': 'invited', 'has.account@example.test': 'invited' });
    await invite(already).expect(200);
    expect((await statuses())['has.account@example.test']).toBe('joined');

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
