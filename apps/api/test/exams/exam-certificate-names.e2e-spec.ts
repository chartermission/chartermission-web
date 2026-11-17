import { and, eq } from 'drizzle-orm';
import type { AdminExamCertificate, AdminExamCertificatesPage, AdminExamDetail, ExamAttemptView, ExamCertificateView, ExamDetail } from '@chartermission/contracts';
import sharp from 'sharp';
import { ExamCertificatesService } from '../../src/exams/exam-certificates.service.js';
import { CHARTER_CENTER_EXAMS_CLIENT, type CertificateRequest, type MockCharterCenterExamsClient } from '../../src/exams/charter-center-exams.client.js';
import { createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { uploadBytes } from '../social/social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

describe('Members confirm the name on their Charter Center certificate', () => {
  let t: TestApp;
  let admin: Member;
  let exam: AdminExamDetail;
  /** What the (mock) Charter Center was sent. */
  const sent: CertificateRequest[] = [];
  const members: Record<'amina' | 'kwame' | 'thandi', Member> = {} as never;

  const list = async (query = '') => (await admin.get(`/admin/exams/${exam.id}/certificates${query}`).expect(200)).body as AdminExamCertificatesPage;
  const certOf = async (m: Member) => (await t.db.select().from(s.examCertificates).where(and(eq(s.examCertificates.userId, m.id), eq(s.examCertificates.examId, exam.id))))[0]!;
  const view = async (m: Member) => (await m.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
  const confirm = (m: Member, name: string) => m.post(`/exams/${exam.id}/certificate/name`, { name });
  const notices = async (m: Member) =>
    (await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, m.id), eq(s.notifications.type, 'exam_certificate_name')))).map((n) => ({
      key: n.dedupeKey,
      text: ((n.data as { segments: { text: string }[] }).segments ?? []).map((x) => x.text).join(''),
      href: (n.data as { href: string }).href,
      icon: (n.data as { icon: string }).icon,
    }));
  const sweep = () => t.app.get(ExamCertificatesService).sweep();

  async function passExam(m: Member): Promise<ExamAttemptView> {
    await m.post(`/exams/${exam.slug}/access`).expect(200);
    const attempt = (await m.post(`/exams/${exam.id}/attempts`).expect(201)).body as ExamAttemptView;
    for (const q of attempt.questions) {
      const optionId = exam.questions.find((k) => k.id === q.id)!.correctOptionId;
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId }).expect(200);
    }
    return (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    const owner = await createMember(t, { name: 'Page Owner' });
    await t.db.insert(s.pages).values({ slug: 'charter-center', name: 'Charter Center', category: 'education', status: 'active', createdBy: owner.id });
    const mock = t.app.get<MockCharterCenterExamsClient>(CHARTER_CENTER_EXAMS_CLIENT);
    const original = mock.certificate.bind(mock);
    mock.certificate = (r) => (sent.push(r), original(r));

    const signature = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const signatureFileId = await uploadBytes(t, admin, { purpose: 'certificate_signature' as 'post_image', fileName: 'signature.png', mime: 'image/png', data: signature });
    await admin.post(`/uploads/${signatureFileId}/complete`).expect(200);

    exam = (await admin.post('/admin/exams', { title: 'PMP Practice Exam', passPercent: 50 }).expect(201)).body as AdminExamDetail;
    await admin
      .post(`/admin/exams/${exam.id}/questions`, { prompt: 'Only question?', options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text })), correctIndex: 0 })
      .expect(201);
    const instructorId = (await admin.post('/admin/exam-instructors', { name: 'Eng. Abdalla Yousif', signatureFileId }).expect(201)).body.id;
    const certificate = { title: 'Project Management Professional', instructorId, startDate: '2026-01-01', endDate: '2026-01-15' };
    exam = (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published', certificate }).expect(200)).body as AdminExamDetail;

    members.amina = await createMember(t, { name: 'Amina Yusuf', email: 'amina.names@example.test' });
    members.kwame = await createMember(t, { name: 'Kwame Mensah', email: 'kwame.names@example.test' });
    members.thandi = await createMember(t, { name: 'Thandi Nkosi', email: 'thandi.names@example.test' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('passing asks the member to confirm their name; nothing is sent to Charter Center until they do', async () => {
    const m = members.amina;
    const passed = await passExam(m);
    expect(passed.result?.passed).toBe(true);
    expect(passed.certificate).toMatchObject({
      status: 'pending',
      name: null,
      certificateId: null,
      nameCheck: { status: 'awaiting', profileName: 'Amina Yusuf', suggestedName: 'Amina Yusuf', proposedName: null, declinedReason: null, replacing: false },
    });
    expect(sent).toHaveLength(0);
    const row = await certOf(m);
    expect(row).toMatchObject({ status: 'pending', request: null, nextTryAt: null, nameStatus: 'awaiting', certificateName: null });
    expect(row.nameRequestedAt).toBeInstanceOf(Date);
    // The Learning page and the exam page show it too.
    expect(((await m.get(`/exams/${exam.slug}`).expect(200)).body as ExamDetail).viewer.certificateName).toBe('awaiting');

    // Asked in a notice and an email.
    expect(await notices(m)).toEqual([{ key: expect.stringContaining(':passed:'), text: 'Confirm the name for your certificate for PMP Practice Exam', href: `/exams/${exam.slug}#certificate`, icon: 'alert' }]);
    const mail = await lastEmail(t.db, 'amina.names@example.test');
    expect(mail?.subject).toBe('Confirm the name on your certificate');
    expect(mail?.textBody).toContain('Congratulations on passing “PMP Practice Exam”. Before Charter Center issues your certificate, check the name we’ll print on it.');
    expect(mail?.textBody).toContain('Your certificate is sent as soon as you confirm.');
    expect(mail?.textBody).toContain(`/exams/${exam.slug}#certificate`);

    // Neither the sweep, a run nor an admin's retry sends it.
    await sweep();
    await t.db.update(s.examCertificates).set({ nextTryAt: new Date(Date.now() - 1000) }).where(eq(s.examCertificates.id, row.id));
    await sweep();
    await t.app.get(ExamCertificatesService).run(row.id);
    expect(sent).toHaveLength(0);
    const retry = await admin.post(`/admin/exam-certificates/${row.id}/retry`).expect(409);
    expect(JSON.stringify(retry.body)).toContain('Waiting for the member to confirm their name');

    // In the console: waiting for the name, not pending.
    const page = await list();
    expect(page.summary).toMatchObject({ pending: 0, awaitingName: 1, nameReview: 0 });
    expect((await list('?status=awaiting_name')).items.map((i) => i.member.id)).toEqual([m.id]);
    expect((await list('?status=pending')).items).toHaveLength(0);
    expect(page.items[0]).toMatchObject({ certificateName: null, nameCheck: { status: 'awaiting', proposedName: null, requestedAt: row.nameRequestedAt!.toISOString(), remindedAt: null, declinedReason: null } });

    // Their profile name (spaces tidied) goes straight through: sent, issued and shared.
    const confirmed = (await confirm(m, '  Amina   Yusuf ').expect(200)).body as ExamCertificateView;
    expect(confirmed).toMatchObject({ status: 'issued', name: 'Amina Yusuf', nameCheck: null, certificateId: expect.stringMatching(/^CC-/), postId: expect.any(String) });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.student_name).toBe('Amina Yusuf');
    expect(await certOf(m)).toMatchObject({ certificateName: 'Amina Yusuf', nameStatus: null, nameConfirmedAt: expect.any(Date) });
    expect((await lastEmail(t.db, 'amina.names@example.test'))?.subject).toBe('Your Charter Center certificate is ready');

    // Nothing left to confirm.
    const again = await confirm(m, 'Amina Yusuf').expect(409);
    expect(JSON.stringify(again.body)).toContain('There’s no name to confirm for this certificate');
  });

  it('another name waits for an admin, and can be changed meanwhile; approved, it is sent with that name', async () => {
    const m = members.kwame;
    await passExam(m);
    const asked = (await confirm(m, 'Kwame A. Mensah').expect(200)).body as ExamCertificateView;
    expect(asked).toMatchObject({ status: 'pending', name: null, nameCheck: { status: 'review', proposedName: 'Kwame A. Mensah', profileName: 'Kwame Mensah', suggestedName: 'Kwame Mensah' } });
    await sweep();
    expect(sent).toHaveLength(1);

    // Changed while in review: still in review.
    const changed = (await confirm(m, 'Kwame Asante Mensah').expect(200)).body as ExamCertificateView;
    expect(changed.nameCheck).toMatchObject({ status: 'review', proposedName: 'Kwame Asante Mensah' });
    expect(((await m.get(`/exams/${exam.slug}`).expect(200)).body as ExamDetail).viewer.certificateName).toBe('review');
    expect(sent).toHaveLength(1);

    expect((await list()).summary).toMatchObject({ pending: 0, awaitingName: 0, nameReview: 1 });
    const inReview = (await list('?status=name_review')).items;
    expect(inReview.map((i) => i.member.id)).toEqual([m.id]);
    expect(inReview[0]!.nameCheck).toMatchObject({ status: 'review', proposedName: 'Kwame Asante Mensah' });
    // Searchable by the name asked for.
    expect((await list('?q=asante')).items.map((i) => i.member.id)).toEqual([m.id]);

    const approved = (await admin.post(`/admin/exam-certificates/${inReview[0]!.id}/name/approve`).expect(200)).body as AdminExamCertificate;
    expect(approved).toMatchObject({ status: 'issued', certificateName: 'Kwame Asante Mensah', nameCheck: null, issuedWith: { studentName: 'Kwame Asante Mensah' }, differences: [] });
    expect(sent.at(-1)!.student_name).toBe('Kwame Asante Mensah');
    expect(await view(m)).toMatchObject({ status: 'issued', name: 'Kwame Asante Mensah', nameCheck: null });
    // Not outdated though it isn't the profile name.
    expect((await list()).summary).toMatchObject({ outdated: 0, nameReview: 0 });
    expect((await list('?q=asante')).items.map((i) => i.member.id)).toEqual([m.id]);

    const twice = await admin.post(`/admin/exam-certificates/${approved.id}/name/approve`).expect(409);
    expect(JSON.stringify(twice.body)).toContain('There’s no name waiting for approval');
    await admin.post(`/admin/exam-certificates/${approved.id}/name/decline`, {}).expect(409);
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificate_name_approved'));
    expect(audit.map((a) => a.targetId)).toContain(approved.id);
  });

  it('a declined name: the member is told why and asked again; going back to their profile name goes straight through', async () => {
    const m = members.thandi;
    await passExam(m);
    const id = (await certOf(m)).id;
    await confirm(m, 'Thandiwe Nkosi').expect(200);
    const declined = (await admin.post(`/admin/exam-certificates/${id}/name/decline`, { reason: '  Please use the name on your ID  ' }).expect(200)).body as AdminExamCertificate;
    expect(declined).toMatchObject({ status: 'pending', certificateName: null, nameCheck: { status: 'awaiting', proposedName: null, declinedReason: 'Please use the name on your ID', remindedAt: null } });
    expect(await view(m)).toMatchObject({ nameCheck: { status: 'awaiting', declinedReason: 'Please use the name on your ID', proposedName: null, suggestedName: 'Thandi Nkosi' } });
    expect(sent.filter((r) => r.student_name.startsWith('Thandi'))).toHaveLength(0);

    const told = await notices(m);
    expect(told).toHaveLength(2);
    expect(told.map((n) => n.text)).toContain('The name you asked for on your certificate for PMP Practice Exam wasn’t approved');
    const mail = await lastEmail(t.db, 'thandi.names@example.test');
    expect(mail?.subject).toBe('Please confirm your name again');
    expect(mail?.textBody).toContain('The name you asked for on your certificate for “PMP Practice Exam” wasn’t approved.');
    expect(mail?.textBody).toContain('Reason: Please use the name on your ID');
    expect(mail?.textBody).toContain('Please confirm your name as it should be printed.');
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificate_name_declined'));
    expect(audit.map((a) => a.after)).toContainEqual({ reason: 'Please use the name on your ID' });

    // Asks for it again, then changes their mind: their profile name is issued at once.
    expect(((await confirm(m, 'Thandiwe Nkosi').expect(200)).body as ExamCertificateView).nameCheck).toMatchObject({ status: 'review', declinedReason: null });
    const done = (await confirm(m, 'Thandi Nkosi').expect(200)).body as ExamCertificateView;
    expect(done).toMatchObject({ status: 'issued', name: 'Thandi Nkosi', nameCheck: null });
    expect(sent.at(-1)!.student_name).toBe('Thandi Nkosi');
    expect(await certOf(m)).toMatchObject({ proposedName: null, nameDeclinedReason: null, nameStatus: null });
  });

  it('admins ask about issued certificates; a different approved name replaces the certificate, the same name changes nothing', async () => {
    const amina = (await list('?q=amina')).items[0]!;
    const before = await view(members.amina);
    const asked = (await admin.post(`/admin/exam-certificates/${amina.id}/ask-name`).expect(200)).body as AdminExamCertificate;
    expect(asked).toMatchObject({ status: 'issued', certificateName: 'Amina Yusuf', nameCheck: { status: 'awaiting', requestedAt: expect.any(String) } });
    expect(await view(members.amina)).toMatchObject({ status: 'issued', name: 'Amina Yusuf', nameCheck: { status: 'awaiting', replacing: true, suggestedName: 'Amina Yusuf' } });
    const mail = await lastEmail(t.db, 'amina.names@example.test');
    expect(mail?.subject).toBe('Check the name on your certificate');
    expect(mail?.textBody).toContain('We’re checking the names on Charter Center certificates for “PMP Practice Exam”. Please confirm your name as it should be printed. If it changes, you’ll get a new certificate.');
    expect((await notices(members.amina)).map((n) => n.text)).toContain('Check the name on your certificate for PMP Practice Exam');
    const twice = await admin.post(`/admin/exam-certificates/${amina.id}/ask-name`).expect(409);
    expect(JSON.stringify(twice.body)).toContain('This member has already been asked to confirm their name');

    // A different name: checked by an admin, then the certificate is replaced with it.
    await confirm(members.amina, 'Amina B. Yusuf').expect(200);
    const count = sent.length;
    const approved = (await admin.post(`/admin/exam-certificates/${amina.id}/name/approve`).expect(200)).body as AdminExamCertificate;
    expect(sent).toHaveLength(count + 1);
    expect(sent.at(-1)!.student_name).toBe('Amina B. Yusuf');
    expect(approved).toMatchObject({ certificateName: 'Amina B. Yusuf', nameCheck: null, replacedCount: 1, replacement: null, differences: [], issuedWith: { studentName: 'Amina B. Yusuf' } });
    expect(approved.certificateId).not.toBe(before.certificateId);
    const after = await view(members.amina);
    expect(after).toMatchObject({ name: 'Amina B. Yusuf', nameCheck: null, certificateId: approved.certificateId, postId: before.postId });
    expect((await lastEmail(t.db, 'amina.names@example.test'))?.subject).toBe('Your Charter Center certificate was updated');

    // A later reissue keeps the confirmed name.
    await admin.post(`/admin/exam-certificates/${amina.id}/reissue`).expect(200);
    expect(sent.at(-1)!.student_name).toBe('Amina B. Yusuf');

    // The same name as printed: nothing to replace.
    const thandi = (await list('?q=thandi')).items[0]!;
    await admin.post(`/admin/exam-certificates/${thandi.id}/ask-name`).expect(200);
    const unchanged = sent.length;
    expect(((await confirm(members.thandi, 'Thandi Nkosi').expect(200)).body as ExamCertificateView).nameCheck).toBeNull();
    expect(sent).toHaveLength(unchanged);
    expect((await list('?q=thandi')).items[0]).toMatchObject({ replacedCount: 0, replacement: null, nameCheck: null });

    // Only issued certificates can be asked about.
    const pending = await createMember(t, { name: 'Not Yet Confirmed' });
    await passExam(pending);
    const res = await admin.post(`/admin/exam-certificates/${(await certOf(pending)).id}/ask-name`).expect(409);
    expect(JSON.stringify(res.body)).toContain('Only issued certificates can be checked');
    await admin.post('/admin/exam-certificates/00000000-0000-4000-8000-000000000000/ask-name').expect(404);
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificate_name_asked'));
    expect(audit.map((a) => a.targetId)).toEqual(expect.arrayContaining([amina.id, thandi.id]));
  });

  it('asks every member with an issued certificate at once, skipping those already asked', async () => {
    // Kwame is asked on his own first.
    const kwame = (await list('?q=kwame')).items[0]!;
    await admin.post(`/admin/exam-certificates/${kwame.id}/ask-name`).expect(200);
    const issued = (await list('?status=issued')).items;
    expect(issued).toHaveLength(3);

    expect((await admin.post(`/admin/exams/${exam.id}/certificates/ask-names`).expect(200)).body).toEqual({ asked: 2 });
    expect((await list('?status=awaiting_name')).items.map((i) => i.member.id).sort()).toEqual(
      [members.amina.id, members.kwame.id, members.thandi.id, (await list('?q=not+yet')).items[0]!.member.id].sort(),
    );
    expect((await list()).summary).toMatchObject({ issued: 3, awaitingName: 4, pending: 0 });
    // Each was told (Kwame only once, when asked on his own).
    for (const m of [members.amina, members.thandi]) {
      expect((await lastEmail(t.db, `${m === members.amina ? 'amina' : 'thandi'}.names@example.test`))?.subject).toBe('Check the name on your certificate');
    }
    expect((await notices(members.kwame)).filter((n) => n.text.startsWith('Check the name'))).toHaveLength(1);

    expect((await admin.post(`/admin/exams/${exam.id}/certificates/ask-names`).expect(200)).body).toEqual({ asked: 0 });
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificate_names_asked'));
    expect(audit.map((a) => a.after)).toEqual(expect.arrayContaining([{ asked: 2 }, { asked: 0 }]));
  });

  it('reminds once, 3 days after asking, those who haven’t confirmed', async () => {
    const back = (days: number) => new Date(Date.now() - days * 24 * 3600_000);
    const kwame = await certOf(members.kwame);
    const thandi = await certOf(members.thandi);
    const late = await createMember(t, { name: 'Late Learner', email: 'late.learner@example.test' });
    await passExam(late);
    const lateRow = await certOf(late);
    await t.db.update(s.examCertificates).set({ nameRequestedAt: back(4) }).where(eq(s.examCertificates.id, kwame.id));
    await t.db.update(s.examCertificates).set({ nameRequestedAt: back(3.1) }).where(eq(s.examCertificates.id, lateRow.id));
    await t.db.update(s.examCertificates).set({ nameRequestedAt: back(1) }).where(eq(s.examCertificates.id, thandi.id));

    await sweep();
    await sweep();
    const reminders = async (m: Member) => (await notices(m)).filter((n) => n.key.includes(':reminder:'));
    expect((await reminders(members.kwame)).map((n) => n.text)).toEqual(['Reminder: Check the name on your certificate for PMP Practice Exam']);
    expect((await reminders(late)).map((n) => n.text)).toEqual(['Reminder: Confirm the name for your certificate for PMP Practice Exam']);
    expect(await reminders(members.thandi)).toEqual([]);
    expect((await lastEmail(t.db, 'kwame.names@example.test'))?.subject).toBe('Reminder: Check the name on your certificate');
    expect((await lastEmail(t.db, 'late.learner@example.test'))?.subject).toBe('Reminder: Confirm the name on your certificate');
    expect((await certOf(members.kwame)).nameRemindedAt).toBeInstanceOf(Date);
    expect((await list('?q=kwame')).items[0]!.nameCheck?.remindedAt).toEqual(expect.any(String));
    expect(sent.filter((r) => r.student_name === 'Late Learner')).toHaveLength(0);

    // Asked again later: reminded again after another 3 days.
    await t.db.update(s.examCertificates).set({ nameStatus: null }).where(eq(s.examCertificates.id, kwame.id));
    await admin.post(`/admin/exam-certificates/${kwame.id}/ask-name`).expect(200);
    await t.db.update(s.examCertificates).set({ nameRequestedAt: back(5) }).where(eq(s.examCertificates.id, kwame.id));
    await sweep();
    expect(await reminders(members.kwame)).toHaveLength(2);
  });

  it('checks the name, and who may confirm it', async () => {
    const m = members.thandi;
    for (const name of ['Am1na', 'x', '', '   ', 'A'.repeat(121), '-Amina', 'Amina <b>']) await confirm(m, name).expect(422);
    await m.post(`/exams/${exam.id}/certificate/name`, {}).expect(422);
    // Letters from any language, hyphens, apostrophes and full stops are fine.
    expect(((await confirm(m, 'Thandi N’kosi-Dlamini Jr.').expect(200)).body as ExamCertificateView).nameCheck).toMatchObject({ status: 'review', proposedName: 'Thandi N’kosi-Dlamini Jr.' });
    expect(((await confirm(m, 'ثاندي نكوسي').expect(200)).body as ExamCertificateView).nameCheck).toMatchObject({ proposedName: 'ثاندي نكوسي' });

    // Has the exam but no certificate: 404; an exam they don't have: 404; signed out: 401.
    const fresh = await createMember(t, { name: 'No Certificate' });
    await fresh.post(`/exams/${exam.slug}/access`).expect(200);
    await confirm(fresh, 'No Certificate').expect(404);
    const outsider = await createMember(t, { name: 'Outsider Person' });
    await confirm(outsider, 'Outsider Person').expect(404);
    await t.http().post(`/api/v1/exams/${exam.id}/certificate/name`).set('X-CM-CSRF', '1').send({ name: 'Anybody' }).expect((r) => expect([401, 403]).toContain(r.status));

    // Members can't use the admin endpoints.
    const id = (await certOf(m)).id;
    for (const path of [`/admin/exam-certificates/${id}/ask-name`, `/admin/exam-certificates/${id}/name/approve`, `/admin/exam-certificates/${id}/name/decline`, `/admin/exams/${exam.id}/certificates/ask-names`]) {
      await m.post(path, {}).expect(403);
      await fresh.post(path, {}).expect(403);
    }
    await admin.post(`/admin/exam-certificates/${id}/name/decline`, { reason: 'x'.repeat(301) }).expect(422);
    await admin.post('/admin/exam-certificates/00000000-0000-4000-8000-000000000000/name/approve').expect(404);
    await admin.post('/admin/exams/00000000-0000-4000-8000-000000000000/certificates/ask-names').expect(404);
  });
});
