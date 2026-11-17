import { readFile } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import type {
  AdminExamCertificate,
  AdminExamCertificatesPage,
  AdminExamDetail,
  ExamAttemptView,
  ExamCertificateView,
  ExamInstructor,
  ExamInstructorList,
  ExamInstructorSaved,
} from '@chartermission/contracts';
import sharp from 'sharp';
import { CHARTER_CENTER_EXAMS_CLIENT, MockCharterCenterExamsClient, type CertificateRequest } from '../../src/exams/charter-center-exams.client.js';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';
import { uploadBytes } from '../social/social-helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const question = (prompt: string, correctIndex: number) => ({
  prompt,
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text })),
  correctIndex,
});

describe('Exam instructors: who signs Charter Center certificates', () => {
  let t: TestApp;
  let admin: Member;
  /** What the (mock) Charter Center was sent. */
  const sent: CertificateRequest[] = [];

  const signature = async (colour: string) => {
    const data = await sharp({ create: { width: 300, height: 100, channels: 4, background: colour } }).png().toBuffer();
    const id = await uploadBytes(t, admin, { purpose: 'certificate_signature' as 'post_image', fileName: 'signature.png', mime: 'image/png', data });
    await admin.post(`/uploads/${id}/complete`).expect(200);
    return id;
  };
  const instructors = async (query = '') => ((await admin.get(`/admin/exam-instructors${query}`).expect(200)).body as ExamInstructorList).items;
  const certificate = (instructorId: string, title = 'PMP Exam Prep') => ({ title, instructorId, startDate: '2026-01-01', endDate: '2026-01-15' });

  async function publishedExam(title: string, instructorId: string): Promise<AdminExamDetail> {
    const exam = (await admin.post('/admin/exams', { title, passPercent: 50 }).expect(201)).body as AdminExamDetail;
    await admin.post(`/admin/exams/${exam.id}/questions`, question('Only question?', 0)).expect(201);
    return (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published', certificate: certificate(instructorId, title) }).expect(200)).body as AdminExamDetail;
  }

  async function pass(m: Member, exam: AdminExamDetail): Promise<ExamCertificateView> {
    await m.post(`/exams/${exam.slug}/access`).expect(200);
    const attempt = (await m.post(`/exams/${exam.id}/attempts`).expect(201)).body as ExamAttemptView;
    for (const q of attempt.questions) {
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId: exam.questions.find((k) => k.id === q.id)!.correctOptionId }).expect(200);
    }
    const view = (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
    return (await m.post(`/exams/${exam.id}/certificate/name`, { name: view.certificate!.nameCheck!.profileName }).expect(200)).body as ExamCertificateView;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
    const owner = await createMember(t, { name: 'Page Owner' });
    await t.db.insert(s.pages).values({ slug: 'charter-center', name: 'Charter Center', category: 'education', status: 'active', createdBy: owner.id });
    const mock = t.app.get<MockCharterCenterExamsClient>(CHARTER_CENTER_EXAMS_CLIENT);
    const original = mock.certificate.bind(mock);
    mock.certificate = (r) => (sent.push(r), original(r));
  });
  afterAll(async () => {
    await t.close();
  });

  it('adds, lists and edits instructors (exam.manage only), checking the name and the signature', async () => {
    const mod = await createMember(t, { roles: ['moderator'], admin: true });
    await mod.get('/admin/exam-instructors').expect(403);
    const sig = await signature('#000000');
    await mod.post('/admin/exam-instructors', { name: 'Someone', signatureFileId: sig }).expect(403);

    const bad = async (body: object) => (await admin.post('/admin/exam-instructors', body).expect(422)).body.error.fields as Record<string, string>;
    expect(await bad({ name: ' A ', signatureFileId: sig })).toEqual({ name: 'Write the instructor’s name' });
    expect(await bad({ name: 'Eng. Abdalla Yousif' })).toEqual({ signatureFileId: 'Upload the instructor’s signature' });
    expect(await bad({ name: 'x'.repeat(121), signatureFileId: 'nope' })).toEqual({ name: 'At most 120 characters', signatureFileId: 'Upload the instructor’s signature' });
    // An upload that isn't a certificate signature, or a file that doesn't exist.
    const photo = await uploadBytes(t, admin, { purpose: 'post_image', fileName: 'x.png', mime: 'image/png', data: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer() });
    await admin.post(`/uploads/${photo}/complete`).expect(200);
    expect(await bad({ name: 'Eng. Abdalla Yousif', signatureFileId: photo })).toEqual({ signatureFileId: 'Upload the instructor’s signature again' });
    expect(await bad({ name: 'Eng. Abdalla Yousif', signatureFileId: '00000000-0000-4000-8000-000000000000' })).toEqual({ signatureFileId: 'Upload the instructor’s signature again' });

    const created = (await admin.post('/admin/exam-instructors', { name: '  Eng. Abdalla Yousif ', signatureFileId: sig.toUpperCase() }).expect(201)).body as ExamInstructor;
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Eng. Abdalla Yousif',
      signatureFileId: sig,
      signatureUrl: expect.stringMatching(new RegExp(`/exam-signatures/${sig}\\.png$`)),
      archived: false,
      examCount: 0,
      createdAt: expect.any(String),
    });
    // The signature is now served to Charter Center without signing in.
    expect((await t.http().get(new URL(created.signatureUrl!).pathname).expect(200)).headers['content-type']).toBe('image/png');
    expect((await instructors()).map((i) => i.id)).toContain(created.id);

    const renamed = (await admin.patch(`/admin/exam-instructors/${created.id}`, { name: 'Eng. Abdalla M. Yousif' }).expect(200)).body as ExamInstructorSaved;
    expect(renamed).toMatchObject({ name: 'Eng. Abdalla M. Yousif', signatureFileId: sig, affectedExams: 0 });
    await admin.patch(`/admin/exam-instructors/${created.id}`, {}).expect(422);
    await admin.patch(`/admin/exam-instructors/${created.id}`, { signatureFileId: photo }).expect(422);
    await admin.patch('/admin/exam-instructors/00000000-0000-4000-8000-000000000000', { name: 'Nobody Here' }).expect(404);
    await admin.patch('/admin/exam-instructors/not-an-id', { name: 'Nobody Here' }).expect(404);

    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, created.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['exam.instructor_created', 'exam.instructor_updated']));
    expect(audit.find((a) => a.action === 'exam.instructor_updated')).toMatchObject({ before: { name: 'Eng. Abdalla Yousif' }, after: { name: 'Eng. Abdalla M. Yousif' } });
  });

  it('archives and restores; exams can’t newly pick an archived or unknown instructor, and keep the one they have', async () => {
    const kept = (await admin.post('/admin/exam-instructors', { name: 'Dr. Kept Signer', signatureFileId: await signature('#112233') }).expect(201)).body as ExamInstructor;
    const exam = await publishedExam('Archive Rules Exam', kept.id);
    expect(exam.certificate).toMatchObject({ instructorId: kept.id, instructor: { id: kept.id, name: 'Dr. Kept Signer', archived: false }, issuerName: 'Dr. Kept Signer' });

    const archived = (await admin.post(`/admin/exam-instructors/${kept.id}/archive`).expect(200)).body as ExamInstructor;
    expect(archived).toMatchObject({ archived: true, examCount: 1 });
    // Archiving twice changes nothing.
    await admin.post(`/admin/exam-instructors/${kept.id}/archive`).expect(200);
    expect((await instructors()).map((i) => i.id)).not.toContain(kept.id);
    const all = await instructors('?includeArchived=true');
    expect(all.map((i) => i.id)).toContain(kept.id);
    // Active ones first.
    expect(all.findIndex((i) => i.archived)).toBeGreaterThan(all.findLastIndex((i) => !i.archived));

    // The exam that has it keeps it (and can save other changes).
    const saved = (await admin.patch(`/admin/exams/${exam.id}`, { certificate: certificate(kept.id, 'Archive Rules Exam, corrected') }).expect(200)).body as AdminExamDetail;
    expect(saved.certificate).toMatchObject({ title: 'Archive Rules Exam, corrected', instructor: { id: kept.id, archived: true } });
    // Other exams can't pick it.
    const other = (await admin.post('/admin/exams', { title: 'Another Exam' }).expect(201)).body as AdminExamDetail;
    const refused = await admin.patch(`/admin/exams/${other.id}`, { certificate: certificate(kept.id) }).expect(422);
    expect(refused.body.error.fields).toEqual({ 'certificate.instructorId': 'This instructor is archived. Choose another, or restore them under Instructors.' });
    await admin.post('/admin/exams', { title: 'Yet Another Exam', certificate: certificate(kept.id) }).expect(422);
    // Unknown instructors.
    await admin.patch(`/admin/exams/${other.id}`, { certificate: certificate('00000000-0000-4000-8000-000000000000') }).expect(404);
    await admin.patch(`/admin/exams/${other.id}`, { certificate: certificate('nope') }).expect(422);

    await admin.post(`/admin/exam-instructors/${kept.id}/restore`).expect(200);
    await admin.patch(`/admin/exams/${other.id}`, { certificate: certificate(kept.id) }).expect(200);
    expect((await instructors()).find((i) => i.id === kept.id)).toMatchObject({ archived: false, examCount: 2 });
    await admin.post('/admin/exam-instructors/00000000-0000-4000-8000-000000000000/archive').expect(404);

    const actions = (await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, kept.id))).map((a) => a.action);
    expect(actions.filter((a) => a === 'exam.instructor_archived')).toHaveLength(1);
    expect(actions).toContain('exam.instructor_restored');
  });

  it('deletes only an instructor no exam uses', async () => {
    const used = (await admin.post('/admin/exam-instructors', { name: 'Used Signer', signatureFileId: await signature('#445566') }).expect(201)).body as ExamInstructor;
    const exam = (await admin.post('/admin/exams', { title: 'Delete Rules Exam', certificate: certificate(used.id) }).expect(201)).body as AdminExamDetail;
    const conflict = await admin.delete(`/admin/exam-instructors/${used.id}`).expect(409);
    expect(conflict.body.error.message).toBe('An exam uses this instructor. Choose another instructor for it, or archive this one instead.');
    // Once the exam stops awarding certificates, it can go.
    await admin.patch(`/admin/exams/${exam.id}`, { certificate: null }).expect(200);
    await admin.delete(`/admin/exam-instructors/${used.id}`).expect(200);
    expect((await instructors('?includeArchived=true')).map((i) => i.id)).not.toContain(used.id);
    await admin.delete(`/admin/exam-instructors/${used.id}`).expect(404);
    expect((await t.db.select().from(s.auditLog).where(eq(s.auditLog.targetId, used.id))).map((a) => a.action)).toContain('exam.instructor_deleted');
  });

  it('sends the instructor’s current name and signature; editing them marks issued certificates outdated on every exam using them', async () => {
    const firstSig = await signature('#000001');
    const signer = (await admin.post('/admin/exam-instructors', { name: 'Prof. Ngozi Eze', signatureFileId: firstSig }).expect(201)).body as ExamInstructor;
    const examA = await publishedExam('Signer Exam A', signer.id);
    const examB = await publishedExam('Signer Exam B', signer.id);

    const m = await createMember(t, { name: 'Halima Bello' });
    const issued = await pass(m, examA);
    expect(issued.status).toBe('issued');
    expect(sent.at(-1)).toMatchObject({ student_name: 'Halima Bello', course_title: 'Signer Exam A', instructor_name: 'Prof. Ngozi Eze', instructor_signature_url: signer.signatureUrl });
    expect((await pass(m, examB)).status).toBe('issued');

    const list = async (exam: AdminExamDetail) => (await admin.get(`/admin/exams/${exam.id}/certificates`).expect(200)).body as AdminExamCertificatesPage;
    expect((await list(examA)).items[0]!.differences).toEqual([]);

    // A new signature: both exams' certificates are outdated ('signature'), and the response says how many exams.
    const secondSig = await signature('#000002');
    const saved = (await admin.patch(`/admin/exam-instructors/${signer.id}`, { signatureFileId: secondSig }).expect(200)).body as ExamInstructorSaved;
    expect(saved).toMatchObject({ signatureFileId: secondSig, examCount: 2, affectedExams: 2 });
    for (const exam of [examA, examB]) {
      const page = await list(exam);
      expect(page.items[0]!.differences).toEqual(['signature']);
      expect(page.summary.outdated).toBe(1);
      expect((await list(exam)).items.map((i) => i.id)).toEqual((await admin.get(`/admin/exams/${exam.id}/certificates?outdated=true`).expect(200)).body.items.map((i: AdminExamCertificate) => i.id));
    }
    const detail = (await admin.get(`/admin/exams/${examA.id}`).expect(200)).body as AdminExamDetail;
    expect(detail.certificate).toMatchObject({ issuerName: 'Prof. Ngozi Eze', signatureFileId: secondSig, signatureUrl: saved.signatureUrl });

    // A new name too: 'issuer' as well. Saving the same values again changes nothing.
    await admin.patch(`/admin/exam-instructors/${signer.id}`, { name: 'Prof. Ngozi A. Eze' }).expect(200);
    expect((await list(examA)).items[0]!.differences).toEqual(['issuer', 'signature']);
    expect(((await admin.patch(`/admin/exam-instructors/${signer.id}`, { name: 'Prof. Ngozi A. Eze', signatureFileId: secondSig }).expect(200)).body as ExamInstructorSaved).affectedExams).toBe(0);

    // Replacing sends the instructor's current name and signature.
    const replaced = (await admin.post(`/admin/exam-certificates/${issued.id}/reissue`).expect(200)).body as AdminExamCertificate;
    expect(replaced).toMatchObject({ differences: [], replacedCount: 1, issuedWith: { issuerName: 'Prof. Ngozi A. Eze' } });
    expect(sent.at(-1)).toMatchObject({ instructor_name: 'Prof. Ngozi A. Eze', instructor_signature_url: saved.signatureUrl });
    expect((await list(examB)).items[0]!.differences).toEqual(['issuer', 'signature']);
  });

  it('migration 0029: exams saved with a signer get an instructor; without one, the old keys still sign', async () => {
    const sigA = await signature('#0000aa');
    const sigB = await signature('#0000bb');
    const old = (issuerName: string, signatureFileId: string) =>
      ({ title: 'Old Style Certificate', issuerName, signatureFileId, startDate: '2026-01-01', endDate: '2026-01-15' }) as never;
    const inserted = await t.db
      .insert(s.exams)
      .values([
        { slug: 'old-style-1', title: 'Old Style 1', certificate: old('Eng. Old Signer', sigA), createdBy: admin.id },
        { slug: 'old-style-2', title: 'Old Style 2', certificate: old('Eng. Old Signer', sigA), createdBy: admin.id },
        { slug: 'old-style-3', title: 'Old Style 3', certificate: old('Dr. Other Signer', sigB), createdBy: admin.id },
      ])
      .returning({ id: s.exams.id });
    const [one, two, three] = inserted.map((r) => r.id) as [string, string, string];

    // Before the backfill: no instructor, but the settings still name who signs.
    const before = (await admin.get(`/admin/exams/${one}`).expect(200)).body as AdminExamDetail;
    expect(before.certificate).toMatchObject({ instructorId: null, instructor: null, issuerName: 'Eng. Old Signer', signatureFileId: sigA, signatureUrl: expect.stringContaining(sigA) });

    // The backfill statements of the migration (the last two).
    const migration = await readFile(new URL('../../drizzle/0029_instructors_messaging.sql', import.meta.url), 'utf8');
    const statements = migration
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean);
    const backfill = statements.slice(-2);
    expect(backfill[0]).toMatch(/^-- One instructor per distinct signer[\s\S]*INSERT INTO "exam_instructors"/);
    expect(backfill[1]).toMatch(/^UPDATE "exams" e/);
    for (const statement of backfill) await t.db.execute(sql.raw(statement));

    const exams = await t.db.select({ id: s.exams.id, certificate: s.exams.certificate }).from(s.exams);
    const instructorOf = (id: string) => (exams.find((e) => e.id === id)!.certificate as { instructorId?: string }).instructorId;
    expect(instructorOf(one)).toBeTruthy();
    expect(instructorOf(two)).toBe(instructorOf(one));
    expect(instructorOf(three)).not.toBe(instructorOf(one));
    const all = await instructors();
    expect(all.find((i) => i.id === instructorOf(one))).toMatchObject({ name: 'Eng. Old Signer', signatureFileId: sigA, examCount: 2 });
    expect(all.find((i) => i.id === instructorOf(three))).toMatchObject({ name: 'Dr. Other Signer', signatureFileId: sigB, examCount: 1 });

    const after = (await admin.get(`/admin/exams/${two}`).expect(200)).body as AdminExamDetail;
    expect(after.certificate).toMatchObject({ instructorId: instructorOf(two), instructor: { name: 'Eng. Old Signer', archived: false }, issuerName: 'Eng. Old Signer' });
    // The old keys are left in place, but the instructor wins once it's edited.
    await admin.patch(`/admin/exam-instructors/${instructorOf(two)}`, { name: 'Eng. Renamed Signer' }).expect(200);
    expect(((await admin.get(`/admin/exams/${two}`).expect(200)).body as AdminExamDetail).certificate?.issuerName).toBe('Eng. Renamed Signer');
  });
});
