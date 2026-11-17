import { eq } from 'drizzle-orm';
import type {
  AdminExamCertificate,
  AdminExamCertificatesPage,
  AdminExamDetail,
  ExamAttemptView,
  ExamCertificateView,
  PostView,
} from '@chartermission/contracts';
import sharp from 'sharp';
import { ExamCertificatesService } from '../../src/exams/exam-certificates.service.js';
import { CHARTER_CENTER_EXAMS_CLIENT, MockCharterCenterExamsClient } from '../../src/exams/charter-center-exams.client.js';
import { createMember, createTestApp, lastEmail, s, type TestApp } from '../helpers.js';
import { uploadBytes } from '../social/social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const question = (prompt: string, correctIndex: number) => ({
  prompt,
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text })),
  correctIndex,
});

/** The misspelt title the certificates were first issued with, and the corrected one. */
const OLD_TITLE = 'Project Managment Professional';
const NEW_TITLE = 'Project Management Professional';

describe('Replacing issued exam certificates', () => {
  let t: TestApp;
  let admin: Member;
  let exam: AdminExamDetail;
  let signatureFileId: string;
  let instructorId: string;
  let mock: MockCharterCenterExamsClient;
  const members: Record<'first' | 'second' | 'third' | 'pending', Member> = {} as never;
  const before: Record<string, ExamCertificateView> = {};

  const CERTIFICATE = (title = OLD_TITLE) => ({ title, instructorId, startDate: '2026-01-01', endDate: '2026-01-15' });
  const path = (url: string) => new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  const list = async (query = '') => (await admin.get(`/admin/exams/${exam.id}/certificates${query}`).expect(200)).body as AdminExamCertificatesPage;
  const certOf = async (m: Member) => (await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.userId, m.id)))[0]!;

  async function passExam(m: Member): Promise<ExamAttemptView> {
    await m.post(`/exams/${exam.slug}/access`).expect(200);
    const attempt = (await m.post(`/exams/${exam.id}/attempts`).expect(201)).body as ExamAttemptView;
    for (const q of attempt.questions) {
      const optionId = exam.questions.find((k) => k.id === q.id)!.correctOptionId;
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId }).expect(200);
    }
    const view = (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
    // Nothing is sent until the member confirms their name: they confirm their profile name.
    expect(view.certificate).toMatchObject({ status: 'pending', nameCheck: { status: 'awaiting' } });
    const certificate = (await m.post(`/exams/${exam.id}/certificate/name`, { name: view.certificate!.nameCheck!.profileName }).expect(200)).body as ExamCertificateView;
    return { ...view, certificate };
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    const owner = await createMember(t, { name: 'Page Owner' });
    await t.db.insert(s.pages).values({ slug: 'charter-center', name: 'Charter Center', category: 'education', status: 'active', createdBy: owner.id });
    mock = t.app.get<MockCharterCenterExamsClient>(CHARTER_CENTER_EXAMS_CLIENT);

    const signature = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    signatureFileId = await uploadBytes(t, admin, { purpose: 'certificate_signature' as 'post_image', fileName: 'signature.png', mime: 'image/png', data: signature });
    await admin.post(`/uploads/${signatureFileId}/complete`).expect(200);
    instructorId = (await admin.post('/admin/exam-instructors', { name: 'Eng. Abdalla Yousif', signatureFileId }).expect(201)).body.id;

    // The exam is named like its (misspelt) course, so the certificate posts' text has the old title.
    exam = (await admin.post('/admin/exams', { title: OLD_TITLE, passPercent: 50 }).expect(201)).body as AdminExamDetail;
    await admin.post(`/admin/exams/${exam.id}/questions`, question('Only question?', 0)).expect(201);
    exam = (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published', certificate: CERTIFICATE() }).expect(200)).body as AdminExamDetail;

    for (const [key, name] of [['first', 'Amina Yusuf'], ['second', 'Kwame Mensah'], ['third', 'Thandi Nkosi'], ['pending', 'Pending Person']] as const) {
      members[key] = await createMember(t, { name, email: `${key}.member@example.test` });
      const cert = (await passExam(members[key])).certificate!;
      before[key] = cert;
    }
    expect(before.first).toMatchObject({ status: 'issued', postId: expect.any(String) });
    expect(before.pending).toMatchObject({ status: 'pending' });

    // The admin corrects the title.
    await admin.patch(`/admin/exams/${exam.id}`, { certificate: CERTIFICATE(NEW_TITLE) }).expect(200);
  });
  afterAll(async () => {
    await t.close();
  });

  it('lists the exam’s certificates with what they were issued with and how they differ', async () => {
    const page = await list();
    expect(page.summary).toEqual({ issued: 3, pending: 1, failed: 0, outdated: 3, replacing: 0, awaitingName: 0, nameReview: 0 });
    expect(page.items).toHaveLength(4);
    const first = page.items.find((i) => i.member.id === members.first.id)!;
    expect(first).toMatchObject({
      id: before.first!.id,
      status: 'issued',
      certificateId: before.first!.certificateId,
      member: { name: 'Amina Yusuf', email: 'first.member@example.test' },
      issuedWith: { studentName: 'Amina Yusuf', courseTitle: OLD_TITLE, issuerName: 'Eng. Abdalla Yousif', startDate: '2026-01-01', endDate: '2026-01-15' },
      differences: ['title'],
      imageUrl: before.first!.imageUrl,
      downloadUrl: before.first!.downloadUrl,
      postId: before.first!.postId,
      replacement: null,
      replacedCount: 0,
    });
    // Pending ones will be issued with the current settings anyway.
    expect(page.items.find((i) => i.member.id === members.pending.id)).toMatchObject({ status: 'pending', differences: [], certificateId: null });

    // Filters, search (name, email, certificate number) and pages.
    expect((await list('?outdated=true')).items.map((i) => i.member.id).sort()).toEqual([members.first.id, members.second.id, members.third.id].sort());
    expect((await list('?status=pending')).items.map((i) => i.member.id)).toEqual([members.pending.id]);
    expect((await list('?q=kwame')).items.map((i) => i.member.id)).toEqual([members.second.id]);
    expect((await list('?q=third.member')).items.map((i) => i.member.id)).toEqual([members.third.id]);
    expect((await list(`?q=${before.first!.certificateId}`)).items.map((i) => i.member.id)).toEqual([members.first.id]);
    const one = await list('?limit=3');
    expect(one.items).toHaveLength(3);
    expect(one.nextCursor).toBeTruthy();
    const two = await list(`?limit=3&cursor=${one.nextCursor}`);
    expect(two.items).toHaveLength(1);
    expect(two.nextCursor).toBeNull();
    expect(new Set([...one.items, ...two.items].map((i) => i.id)).size).toBe(4);
    // Same summary on every page.
    expect(two.summary).toEqual(page.summary);
    await admin.get(`/admin/exams/${exam.id}/certificates?cursor=nonsense`).expect(400);

    // A certificate issued before members confirmed their names (no certificate name): a change of
    // profile name makes it outdated too. (A confirmed name is what's printed, whatever the profile says.)
    await t.db.update(s.examCertificates).set({ certificateName: null }).where(eq(s.examCertificates.userId, members.third.id));
    await t.db.update(s.memberProfiles).set({ displayName: 'Thandi N. Nkosi' }).where(eq(s.memberProfiles.userId, members.third.id));
    expect((await list('?q=thandi')).items[0]!.differences).toEqual(['title', 'name']);
  });

  it('a pending certificate is sent with the corrected settings when it is next asked for', async () => {
    const row = await certOf(members.pending);
    expect(row.request?.course_title).toBe(OLD_TITLE);
    await t.db.update(s.examCertificates).set({ nextTryAt: new Date(Date.now() - 1000) }).where(eq(s.examCertificates.id, row.id));
    await t.app.get(ExamCertificatesService).run(row.id);
    const after = await certOf(members.pending);
    expect(after).toMatchObject({ status: 'pending', tries: 2 });
    expect(after.request).toMatchObject({ course_title: NEW_TITLE, student_name: 'Pending Person' });
  });

  it('replaces one certificate everywhere: the member’s certificate, the post and its text', async () => {
    const replaced = (await admin.post(`/admin/exam-certificates/${before.first!.id}/reissue`).expect(200)).body as AdminExamCertificate;
    expect(replaced).toMatchObject({ id: before.first!.id, status: 'issued', differences: [], replacement: null, replacedCount: 1, issuedWith: { courseTitle: NEW_TITLE } });
    expect(replaced.certificateId).toMatch(/^CC-\d{4}-\d{6}$/);
    expect(replaced.certificateId).not.toBe(before.first!.certificateId);
    expect(replaced.imageUrl).not.toBe(before.first!.imageUrl);
    expect(replaced.downloadUrl).not.toBe(before.first!.downloadUrl);

    const row = await certOf(members.first);
    expect(row.history).toHaveLength(1);
    expect(row.history[0]).toMatchObject({ externalId: before.first!.certificateId, request: expect.objectContaining({ course_title: OLD_TITLE }), replacedAt: expect.any(String) });
    expect(row).toMatchObject({ replaceRequestedAt: null, replaceNextTryAt: null, replaceTries: 0, replaceError: null });

    // The member's exam page and account.
    const m = members.first;
    const view = (await m.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
    expect(view).toMatchObject({ certificateId: replaced.certificateId, imageUrl: replaced.imageUrl, downloadUrl: replaced.downloadUrl, postId: before.first!.postId });
    expect((await m.get(path(view.downloadUrl!)).expect(200)).headers['content-type']).toBe('application/pdf');

    // The post: the new picture in the old one's place, the corrected headline and text.
    const post = (await m.get(`/posts/${view.postId}`).expect(200)).body as PostView;
    expect(post.attachments).toHaveLength(1);
    expect(post.attachments[0]).toMatchObject({ kind: 'image', url: replaced.imageUrl, alt: `Charter Center certificate: ${NEW_TITLE}` });
    expect(post.celebration).toMatchObject({ category: 'certification', headline: NEW_TITLE, organisation: 'Charter Center' });
    expect(post.body).toContain(`“${NEW_TITLE}”`);
    expect(post.body).not.toContain(OLD_TITLE);

    // Visitors without an account see the new picture; the old one is no longer on a public post.
    await t.http().get(`/api/v1${path(replaced.imageUrl!)}`).expect((r) => expect([200, 302]).toContain(r.status));
    await t.http().get(`/api/v1${path(before.first!.imageUrl!)}`).expect(401);

    const mail = await lastEmail(t.db, 'first.member@example.test');
    expect(mail?.subject).toBe('Your Charter Center certificate was updated');
    expect(mail?.textBody).toContain(`/exams/${exam.slug}`);

    expect((await list()).summary).toMatchObject({ issued: 3, outdated: 2, replacing: 0 });
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificate_reissued'));
    expect(audit.map((a) => a.targetId)).toContain(before.first!.id);
  });

  it('only issued certificates can be replaced', async () => {
    const res = await admin.post(`/admin/exam-certificates/${before.pending!.id}/reissue`).expect(409);
    expect(JSON.stringify(res.body)).toContain('Only issued certificates can be replaced');
    await admin.post('/admin/exam-certificates/00000000-0000-4000-8000-000000000000/reissue').expect(404);
  });

  it('keeps trying when Charter Center has no new certificate, then gives up; it can be asked again', async () => {
    const original = mock.certificate.bind(mock);
    mock.certificate = async () => null;
    const id = before.second!.id;
    const asked = (await admin.post(`/admin/exam-certificates/${id}/reissue`).expect(200)).body as AdminExamCertificate;
    // The old certificate stays until the new one arrives.
    expect(asked).toMatchObject({ certificateId: before.second!.certificateId, differences: ['title'], replacedCount: 0 });
    expect(asked.replacement).toMatchObject({ tries: 1, gaveUp: false, lastError: expect.stringContaining('no certificate') });
    expect((await list()).summary).toMatchObject({ replacing: 1 });

    // Already on its way.
    const twice = await admin.post(`/admin/exam-certificates/${id}/reissue`).expect(409);
    expect(JSON.stringify(twice.body)).toContain('already on its way');

    // Charter Center fails too: after the last retry it stops, and says why.
    mock.certificate = async () => {
      throw new Error('Charter Center answered 502');
    };
    await t.db.update(s.examCertificates).set({ replaceTries: 8, replaceNextTryAt: new Date(Date.now() - 1000) }).where(eq(s.examCertificates.id, id));
    await t.app.get(ExamCertificatesService).sweep();
    const row = await certOf(members.second);
    expect(row).toMatchObject({ status: 'issued', replaceTries: 9, replaceNextTryAt: null, externalId: before.second!.certificateId });
    expect(row.replaceRequestedAt).toBeTruthy();
    expect(row.replaceError).toContain('502');
    const gaveUp = (await list('?q=kwame')).items[0]!;
    expect(gaveUp.replacement).toMatchObject({ tries: 9, gaveUp: true, lastError: expect.stringContaining('502') });
    expect((await list()).summary).toMatchObject({ replacing: 0, outdated: 2 });

    // Asked again, with Charter Center back: replaced.
    mock.certificate = original;
    const again = (await admin.post(`/admin/exam-certificates/${id}/reissue`).expect(200)).body as AdminExamCertificate;
    expect(again).toMatchObject({ replacement: null, replacedCount: 1, differences: [] });
    expect(again.certificateId).not.toBe(before.second!.certificateId);
  });

  it('replaces the rest at once; a post the member deleted is left alone', async () => {
    // The third member deleted their certificate post.
    const third = members.third;
    await third.delete(`/posts/${before.third!.postId}`).expect((r) => expect([200, 204]).toContain(r.status));
    const deletedBefore = await t.db.select().from(s.postAttachments).where(eq(s.postAttachments.postId, before.third!.postId!));

    expect((await admin.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'outdated' }).expect(200)).body).toEqual({ queued: 1 });
    const page = await list();
    expect(page.summary).toEqual({ issued: 3, pending: 1, failed: 0, outdated: 0, replacing: 0, awaitingName: 0, nameReview: 0 });
    const item = page.items.find((i) => i.member.id === third.id)!;
    expect(item).toMatchObject({ differences: [], replacedCount: 1, postId: null, issuedWith: { studentName: 'Thandi N. Nkosi', courseTitle: NEW_TITLE } });
    expect(await t.db.select().from(s.postAttachments).where(eq(s.postAttachments.postId, before.third!.postId!))).toEqual(deletedBefore);
    // Sharing again posts the new certificate.
    const shared = (await third.post(`/exams/${exam.id}/certificate/post`).expect(200)).body as ExamCertificateView;
    const post = (await third.get(`/posts/${shared.postId}`).expect(200)).body as PostView;
    expect(post.attachments[0]?.url).toBe(item.imageUrl);
    expect(post.celebration?.headline).toBe(NEW_TITLE);

    // Nothing outdated left; "all" replaces every issued one.
    expect((await admin.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'outdated' }).expect(200)).body).toEqual({ queued: 0 });
    expect((await admin.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'all' }).expect(200)).body).toEqual({ queued: 3 });
    expect((await certOf(members.first)).history).toHaveLength(2);
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'exam.certificates_reissued'));
    expect(audit.map((a) => a.after)).toEqual(expect.arrayContaining([{ scope: 'outdated', queued: 1 }, { scope: 'all', queued: 3 }]));

    await admin.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'everything' }).expect(422);
  });

  it('a renamed exam: its certificate keeps its own title, and a replacement puts the new name in the post', async () => {
    const renamed = 'PMP Exam Prep 2026';
    const exam2 = (await admin.patch(`/admin/exams/${exam.id}`, { title: renamed }).expect(200)).body as AdminExamDetail;
    // Renaming the exam doesn't touch the title on the certificate, so nothing is outdated.
    expect(exam2.certificate?.title).toBe(NEW_TITLE);
    expect((await list()).summary.outdated).toBe(0);

    await admin.post(`/admin/exam-certificates/${before.first!.id}/reissue`).expect(200);
    await t.app.get(ExamCertificatesService).sweep();
    const view = (await members.first!.get(`/exams/${exam.id}/certificate`).expect(200)).body as ExamCertificateView;
    const post = (await members.first!.get(`/posts/${view.postId}`).expect(200)).body as PostView;
    expect(post.body.startsWith(`I passed “${renamed}” on Charter Mission`)).toBe(true);
    expect(post.celebration?.headline).toBe(NEW_TITLE);
  });

  it('sends the study hours as exam_hours; adding or changing them makes certificates outdated', async () => {
    await admin.patch(`/admin/exams/${exam.id}`, { certificate: { ...CERTIFICATE(NEW_TITLE), hours: 1.25 } }).expect(422);
    await admin.patch(`/admin/exams/${exam.id}`, { certificate: { ...CERTIFICATE(NEW_TITLE), hours: 0 } }).expect(422);
    const saved = (await admin.patch(`/admin/exams/${exam.id}`, { certificate: { ...CERTIFICATE(NEW_TITLE), hours: 35 } }).expect(200)).body as AdminExamDetail;
    expect(saved.certificate?.hours).toBe(35);

    const row = (await list()).items.find((i) => i.member.id === members.first.id)!;
    expect(row.issuedWith?.hours).toBeNull();
    expect(row.differences).toEqual(['hours']);

    await admin.post(`/admin/exam-certificates/${row.id}/reissue`).expect(200);
    await t.app.get(ExamCertificatesService).sweep();
    const [cert] = await t.db.select().from(s.examCertificates).where(eq(s.examCertificates.id, row.id));
    expect(cert!.request).toMatchObject({ course_title: NEW_TITLE, exam_hours: 35 });
    const after = (await list()).items.find((i) => i.member.id === members.first.id)!;
    expect(after.issuedWith?.hours).toBe(35);
    expect(after.differences).toEqual([]);

    // Taking the hours off: sent as null, and certificates issued with hours are outdated again.
    const cleared = (await admin.patch(`/admin/exams/${exam.id}`, { certificate: { ...CERTIFICATE(NEW_TITLE), hours: null } }).expect(200)).body as AdminExamDetail;
    expect(cleared.certificate?.hours).toBeNull();
    expect((await list()).items.find((i) => i.member.id === members.first.id)!.differences).toEqual(['hours']);
  });

  it('needs certificate settings, and is for admins with exam.manage only', async () => {
    const plain = await createMember(t, { name: 'Not Staff' });
    await plain.get(`/admin/exams/${exam.id}/certificates`).expect(403);
    await plain.post(`/admin/exam-certificates/${before.first!.id}/reissue`).expect(403);
    await plain.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'all' }).expect(403);
    await members.first.post(`/admin/exam-certificates/${before.first!.id}/reissue`).expect(403);

    await admin.patch(`/admin/exams/${exam.id}`, { certificate: null }).expect(200);
    const res = await admin.post(`/admin/exams/${exam.id}/certificates/reissue`, { scope: 'all' }).expect(409);
    expect(JSON.stringify(res.body)).toContain('This exam has no certificate settings');
    await admin.post(`/admin/exam-certificates/${before.first!.id}/reissue`).expect(409);
    // Without settings nothing counts as outdated.
    expect((await list()).summary.outdated).toBe(0);
    await admin.get('/admin/exams/00000000-0000-4000-8000-000000000000/certificates').expect(404);
  });
});
