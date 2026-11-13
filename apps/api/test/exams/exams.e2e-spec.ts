import { and, eq } from 'drizzle-orm';
import type {
  AdminExamAttempt,
  AdminExamDetail,
  AdminExamSummary,
  ExamAttemptView,
  ExamDetail,
  ExamSummary,
  Page,
} from '@chartermission/contracts';
import { createMember, createTestApp, s, type TestApp } from '../helpers.js';

type Member = Awaited<ReturnType<typeof createMember>>;

const question = (prompt: string, correctIndex: number, extra: Record<string, unknown> = {}) => ({
  prompt,
  promptAlt: `${prompt} (ar)`,
  options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((text) => ({ text, textAlt: `${text} ar` })),
  correctIndex,
  explanation: `Because ${prompt}`,
  ...extra,
});

describe('Exams', () => {
  let t: TestApp;
  let admin: Member;
  let exam: AdminExamDetail;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createMember(t, { name: 'Ada Admin', roles: ['platform_admin'], admin: true });
  });
  afterAll(async () => {
    await t.close();
  });

  const view = async (m: Member, id: string) => (await m.get(`/exam-attempts/${id}`).expect(200)).body as ExamAttemptView;
  const start = async (m: Member, examId: string) => (await m.post(`/exams/${examId}/attempts`).expect(201)).body as ExamAttemptView;
  /** Opens the exam's invitation link: only then can the member see and take it. */
  const invite = async (m: Member, slug: string) => (await m.post(`/exams/${slug}/access`).expect(200)).body as ExamSummary;
  /** Answers every question: the correct option for the first `right` questions, a wrong one for the rest. */
  async function answer(m: Member, attempt: ExamAttemptView, key: AdminExamDetail, right: number) {
    for (const [i, q] of attempt.questions.entries()) {
      const correct = key.questions.find((k) => k.id === q.id)!.correctOptionId;
      const optionId = i < right ? correct : q.options.find((o) => o.id !== correct)!.id;
      await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId }).expect(200);
    }
  }

  it('ships the Charter Center CAPM practice exam as a draft members cannot see', async () => {
    const list = (await admin.get('/admin/exams').expect(200)).body as AdminExamSummary[];
    const capm = list.find((e) => e.slug === 'capm-practice-exam')!;
    expect(capm).toMatchObject({ status: 'draft', questionCount: 50, language: 'en', secondLanguage: 'ar', timeLimitMinutes: 60, passPercent: 70 });
    const detail = (await admin.get(`/admin/exams/${capm.id}`).expect(200)).body as AdminExamDetail;
    expect(detail.sections.map((x) => x.questionCount)).toEqual([18, 8, 10, 14]);
    expect(detail.questions[0]).toMatchObject({ reference: 'ECO 1.1', prompt: 'Which of the following is a project?', promptAlt: 'أي مما يلي يُعد مشروعًا؟' });
    expect(detail.questions[0]!.options.find((o) => o.id === detail.questions[0]!.correctOptionId)!.text).toBe('Building a new training center');
    expect(detail.questions.filter((q) => q.tag === 'Calculation').length).toBe(4);

    const m = await createMember(t, { name: 'Curious Member' });
    expect((await m.get('/exams').expect(200)).body).toEqual([]);
    await m.get('/exams/capm-practice-exam').expect(404);
    await m.post(`/exams/${capm.id}/attempts`).expect(404);
  });

  it('admins build an exam: settings, sections, questions, then publish', async () => {
    const m = await createMember(t, { name: 'Plain Member' });
    const moderator = await createMember(t, { name: 'Mo Moderator', roles: ['moderator'], admin: true });
    await m.get('/admin/exams').expect(403);
    await moderator.get('/admin/exams').expect(403);
    await moderator.post('/admin/exams', { title: 'Nope' }).expect(403);

    await admin.post('/admin/exams', { title: 'x' }).expect(422);
    await admin.post('/admin/exams', { title: 'Same language', language: 'en', secondLanguage: 'en' }).expect(422);
    exam = (await admin.post('/admin/exams', { title: 'Project Basics Quiz', secondLanguage: 'ar', timeLimitMinutes: 30, passPercent: 60, maxAttempts: 2 }).expect(201))
      .body as AdminExamDetail;
    expect(exam).toMatchObject({ slug: 'project-basics-quiz', status: 'draft', questionCount: 0, review: 'full', maxAttempts: 2 });
    // A second exam with the same title gets its own link name.
    const twin = (await admin.post('/admin/exams', { title: 'Project Basics Quiz' }).expect(201)).body as AdminExamDetail;
    expect(twin.slug).toBe('project-basics-quiz-2');
    await admin.delete(`/admin/exams/${twin.id}`).expect(200);

    // Nothing to publish yet.
    expect((await admin.patch(`/admin/exams/${exam.id}`, { status: 'published' }).expect(409)).body.error.message).toMatch(/at least one question/);

    exam = (await admin.put(`/admin/exams/${exam.id}/sections`, { sections: [{ title: 'Part One', titleAlt: 'الجزء الأول' }, { title: 'Part Two' }] }).expect(200))
      .body as AdminExamDetail;
    const [one, two] = exam.sections;
    expect(exam.sections.map((x) => x.title)).toEqual(['Part One', 'Part Two']);

    await admin.post(`/admin/exams/${exam.id}/questions`, { ...question('Q1', 0), options: [{ text: 'Only one' }] }).expect(422);
    await admin.post(`/admin/exams/${exam.id}/questions`, { ...question('Q1', 9) }).expect(422);
    await admin.post(`/admin/exams/${exam.id}/questions`, { ...question('Q1', 0), sectionId: '00000000-0000-4000-8000-000000000000' }).expect(422);
    for (const [prompt, correct, sectionId] of [
      ['Q1', 0, one!.id],
      ['Q2', 1, one!.id],
      ['Q3', 2, two!.id],
      ['Q4', 3, two!.id],
    ] as const) {
      exam = (await admin.post(`/admin/exams/${exam.id}/questions`, { ...question(prompt, correct), sectionId, reference: `REF ${prompt}` }).expect(201)).body as AdminExamDetail;
    }
    exam = (await admin.post(`/admin/exams/${exam.id}/questions`, question('Q5', 0)).expect(201)).body as AdminExamDetail;
    expect(exam.questions.map((q) => q.prompt)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    expect(exam.sections.map((x) => x.questionCount)).toEqual([2, 2]);
    expect(exam.questions[1]!.options.findIndex((o) => o.id === exam.questions[1]!.correctOptionId)).toBe(1);

    // Editing keeps the ids of the answers that stay, so earlier attempts still point at them.
    const q5 = exam.questions[4]!;
    exam = (
      await admin
        .patch(`/admin/exams/${exam.id}/questions/${q5.id}`, {
          ...question('Q5 reworded', 1),
          options: [{ id: q5.options[0]!.id, text: 'Alpha' }, { id: q5.options[1]!.id, text: 'Bravo!' }, { text: 'Echo' }],
        })
        .expect(200)
    ).body as AdminExamDetail;
    const edited = exam.questions[4]!;
    expect(edited.prompt).toBe('Q5 reworded');
    expect(edited.options.map((o) => o.id).slice(0, 2)).toEqual([q5.options[0]!.id, q5.options[1]!.id]);
    expect(edited.options).toHaveLength(3);
    expect(edited.correctOptionId).toBe(q5.options[1]!.id);

    // Reorder: every id, once.
    const ids = exam.questions.map((q) => q.id);
    await admin.put(`/admin/exams/${exam.id}/questions/order`, { ids: ids.slice(1) }).expect(422);
    exam = (await admin.put(`/admin/exams/${exam.id}/questions/order`, { ids: [ids[4], ...ids.slice(0, 4)] }).expect(200)).body as AdminExamDetail;
    expect(exam.questions[0]!.prompt).toBe('Q5 reworded');
    exam = (await admin.put(`/admin/exams/${exam.id}/questions/order`, { ids }).expect(200)).body as AdminExamDetail;

    exam = (await admin.patch(`/admin/exams/${exam.id}`, { status: 'published', description: 'Five quick questions.' }).expect(200)).body as AdminExamDetail;
    expect(exam.status).toBe('published');
    expect(exam.publishedAt).toBeTruthy();
    const actions = (await t.db.select({ a: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.targetId, exam.id))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(['exam.created', 'exam.sections_updated', 'exam.question_added', 'exam.question_updated', 'exam.published']));
  });

  it('a member takes the exam: no answers leak, progress is saved, marking happens on submit', async () => {
    const m = await createMember(t, { name: 'Sami Student' });
    // Published, but not for members who haven't opened its link.
    expect((await m.get('/exams').expect(200)).body).toEqual([]);
    await m.get('/exams/project-basics-quiz').expect(404);
    await invite(m, 'project-basics-quiz');
    const list = (await m.get('/exams').expect(200)).body as ExamSummary[];
    expect(list.map((e) => e.slug)).toEqual(['project-basics-quiz']);
    expect(list[0]).toMatchObject({ questionCount: 5, viewer: { attempts: 0, attemptsLeft: 2, bestPercent: null, inProgressAttemptId: null } });
    const before = (await m.get('/exams/project-basics-quiz').expect(200)).body as ExamDetail;
    expect(before.sections.map((x) => [x.title, x.questionCount])).toEqual([['Part One', 2], ['Part Two', 2]]);

    const started = await m.post(`/exams/${exam.id}/attempts`).expect(201);
    const attempt = started.body as ExamAttemptView;
    expect(attempt).toMatchObject({ status: 'in_progress', number: 1, preview: false, result: null });
    expect(attempt.questions).toHaveLength(5);
    expect(new Date(attempt.expiresAt!).getTime() - new Date(attempt.startedAt).getTime()).toBe(30 * 60_000);
    // The answer key never travels before submitting.
    expect(started.text).not.toMatch(/correctOptionId|explanation|"correct"/);
    expect(attempt.questions[0]).toMatchObject({ prompt: 'Q1', promptAlt: 'Q1 (ar)', reference: 'REF Q1', selectedOptionId: null, flagged: false });

    // Starting again resumes the same attempt.
    expect((await start(m, exam.id)).id).toBe(attempt.id);

    const [q1, q2, q3, q4, q5] = attempt.questions;
    const key = (q: (typeof attempt.questions)[number]) => exam.questions.find((k) => k.id === q.id)!.correctOptionId;
    const wrong = (q: (typeof attempt.questions)[number]) => q.options.find((o) => o.id !== key(q))!.id;
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q1!.id, optionId: 'nope' }).expect(422);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: '00000000-0000-4000-8000-000000000000', optionId: key(q1!) }).expect(422);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q1!.id }).expect(422);
    expect((await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q1!.id, optionId: wrong(q1!) }).expect(200)).body.answered).toBe(1);
    // Changing an answer replaces it; flags are separate.
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q1!.id, optionId: key(q1!) }).expect(200);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q2!.id, optionId: wrong(q2!), flagged: true }).expect(200);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q3!.id, optionId: key(q3!) }).expect(200);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q4!.id, optionId: key(q4!) }).expect(200);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q5!.id, optionId: key(q5!) }).expect(200);
    expect((await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q5!.id, optionId: null }).expect(200)).body.answered).toBe(4);

    const resumed = await view(m, attempt.id);
    expect(resumed.questions.map((q) => q.selectedOptionId)).toEqual([key(q1!), wrong(q2!), key(q3!), key(q4!), null]);
    expect(resumed.questions[1]!.flagged).toBe(true);
    expect((await m.get('/exams').expect(200)).body[0].viewer.inProgressAttemptId).toBe(attempt.id);

    // Somebody else's attempt is not found.
    const other = await createMember(t, { name: 'Nosy Member' });
    await other.get(`/exam-attempts/${attempt.id}`).expect(404);
    await other.post(`/exam-attempts/${attempt.id}/submit`).expect(404);

    const done = (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
    expect(done.status).toBe('submitted');
    expect(done.result).toMatchObject({ correct: 3, total: 5, answered: 4, percent: 60, passPercent: 60, passed: true, timedOut: false, attemptsLeft: 1, canRetake: true });
    expect(done.result!.sections).toEqual([
      { id: exam.sections[0]!.id, title: 'Part One', titleAlt: 'الجزء الأول', correct: 1, total: 2, percent: 50 },
      { id: exam.sections[1]!.id, title: 'Part Two', titleAlt: null, correct: 2, total: 2, percent: 100 },
      { id: null, title: 'Other questions', titleAlt: null, correct: 0, total: 1, percent: 0 },
    ]);
    // Review: the key and explanations are there now.
    expect(done.questions[1]).toMatchObject({ correct: false, correctOptionId: key(q2!), selectedOptionId: wrong(q2!), explanation: 'Because Q2' });
    expect(done.questions[4]).toMatchObject({ correct: false, selectedOptionId: null });
    // Submitting again changes nothing; answers can no longer be saved.
    expect(((await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView).result!.correct).toBe(3);
    await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q1!.id, optionId: wrong(q1!) }).expect(409);

    const after = (await m.get('/exams/project-basics-quiz').expect(200)).body as ExamDetail;
    expect(after.viewer).toMatchObject({ attempts: 1, attemptsLeft: 1, bestPercent: 60, passed: true, inProgressAttemptId: null, lastAttemptId: attempt.id });
    expect(after.attempts[0]).toMatchObject({ id: attempt.id, number: 1, status: 'submitted', correct: 3, total: 5, percent: 60, passed: true });

    // Second and last attempt, then no more.
    const second = await start(m, exam.id);
    expect(second.number).toBe(2);
    await answer(m, second, exam, 1);
    const failed = (await m.post(`/exam-attempts/${second.id}/submit`).expect(200)).body as ExamAttemptView;
    expect(failed.result).toMatchObject({ correct: 1, percent: 20, passed: false, attemptsLeft: 0, canRetake: false });
    expect((await m.post(`/exams/${exam.id}/attempts`).expect(409)).body.error.message).toMatch(/all your attempts/);

    const events = (await t.db.select({ n: s.analyticsEvents.name }).from(s.analyticsEvents).where(eq(s.analyticsEvents.subjectId, exam.id))).map((r) => r.n);
    expect(events.filter((n) => n === 'exam_started').length).toBe(2);
    expect(events.filter((n) => n === 'exam_submitted').length).toBe(2);
  });

  it('keeps the time limit on the server: a late attempt is marked with what was saved', async () => {
    const m = await createMember(t, { name: 'Late Member' });
    await invite(m, exam.slug);
    const attempt = await start(m, exam.id);
    await answer(m, attempt, exam, 5);
    // The 30 minutes ran out a minute ago.
    await t.db.update(s.examAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(s.examAttempts.id, attempt.id));
    const q = attempt.questions[0]!;
    expect((await m.put(`/exam-attempts/${attempt.id}/answers`, { questionId: q.id, optionId: q.options[0]!.id }).expect(409)).body.error.message).toMatch(/Time is up/);
    const done = await view(m, attempt.id);
    expect(done.status).toBe('submitted');
    expect(done.result).toMatchObject({ correct: 5, total: 5, percent: 100, passed: true, timedOut: true });
    expect(done.submittedAt).toBe(new Date(done.expiresAt!).toISOString());

    // An attempt nobody came back to is settled when an admin opens the results.
    const ghost = await createMember(t, { name: 'Ghost Member' });
    await invite(ghost, exam.slug);
    const left = await start(ghost, exam.id);
    await t.db.update(s.examAttempts).set({ expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(s.examAttempts.id, left.id));
    const results = (await admin.get(`/admin/exams/${exam.id}/attempts`).expect(200)).body as Page<AdminExamAttempt>;
    const row = results.items.find((a) => a.id === left.id)!;
    expect(row).toMatchObject({ status: 'submitted', timedOut: true, correct: 0, answered: 0, member: { name: 'Ghost Member', handle: ghost.handle } });
  });

  it('shows admins the results, with search and filters', async () => {
    const all = (await admin.get(`/admin/exams/${exam.id}/attempts`).expect(200)).body as Page<AdminExamAttempt>;
    expect(all.items.length).toBe(4);
    expect(all.items[0]!.member.email).toContain('@example.test');
    const passed = (await admin.get(`/admin/exams/${exam.id}/attempts?result=passed`).expect(200)).body as Page<AdminExamAttempt>;
    expect(passed.items.map((a) => a.member.name).sort()).toEqual(['Late Member', 'Sami Student']);
    const failed = (await admin.get(`/admin/exams/${exam.id}/attempts?result=failed`).expect(200)).body as Page<AdminExamAttempt>;
    expect(failed.items.map((a) => a.member.name).sort()).toEqual(['Ghost Member', 'Sami Student']);
    const found = (await admin.get(`/admin/exams/${exam.id}/attempts?q=sami`).expect(200)).body as Page<AdminExamAttempt>;
    expect(found.items.length).toBe(2);
    const paged = (await admin.get(`/admin/exams/${exam.id}/attempts?limit=3`).expect(200)).body as Page<AdminExamAttempt>;
    expect(paged.items.length).toBe(3);
    const rest = (await admin.get(`/admin/exams/${exam.id}/attempts?limit=3&cursor=${paged.nextCursor}`).expect(200)).body as Page<AdminExamAttempt>;
    expect(rest.items.length).toBe(1);
    expect(rest.nextCursor).toBeNull();

    const summary = ((await admin.get('/admin/exams').expect(200)).body as AdminExamSummary[]).find((e) => e.id === exam.id)!;
    expect(summary.stats).toEqual({ attempts: 4, participants: 3, passedMembers: 2, averagePercent: 45, inProgress: 0 });

    // Taken exams can't be deleted, only archived; an archived exam is closed but results stay readable.
    await admin.delete(`/admin/exams/${exam.id}`).expect(409);
  });

  it('score-only exams give the score without the questions', async () => {
    const quiz = (
      await admin
        .post('/admin/exams/import', {
          title: 'Score Only Check',
          review: 'score_only',
          shuffleQuestions: true,
          shuffleOptions: true,
          sections: [{ title: 'First' }],
          questions: [question('S1', 0, { section: 'First' }), question('S2', 1, { section: 'Second', sectionAlt: 'الثاني' }), question('S3', 2)],
        })
        .expect(201)
    ).body as AdminExamDetail;
    expect(quiz.sections.map((x) => [x.title, x.titleAlt, x.questionCount])).toEqual([['First', null, 1], ['Second', 'الثاني', 1]]);
    await admin.patch(`/admin/exams/${quiz.id}`, { status: 'published' }).expect(200);
    const m = await createMember(t, { name: 'Score Member' });
    await invite(m, quiz.slug);
    const attempt = await start(m, quiz.id);
    expect(attempt.expiresAt).toBeNull();
    expect(attempt.questions.map((q) => q.prompt).sort()).toEqual(['S1', 'S2', 'S3']);
    await answer(m, attempt, quiz, 3);
    const done = (await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView;
    expect(done.result).toMatchObject({ correct: 3, total: 3, percent: 100, passed: true, attemptsLeft: null, canRetake: true });
    expect(done.questions).toEqual([]);

    // More questions can be imported later; they go to the end, into sections matched by title.
    const more = (
      await admin.post(`/admin/exams/${quiz.id}/questions/import`, { questions: [question('S4', 3, { section: 'second' }), question('S5', 0, { section: 'Third' })] }).expect(201)
    ).body as AdminExamDetail;
    expect(more.questions.map((q) => q.prompt)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(more.sections.map((x) => [x.title, x.questionCount])).toEqual([['First', 1], ['Second', 2], ['Third', 1]]);

    // Removing a section keeps its questions; removing a question keeps finished scores.
    const trimmed = (await admin.put(`/admin/exams/${quiz.id}/sections`, { sections: more.sections.slice(0, 2).map((x) => ({ id: x.id, title: x.title })) }).expect(200))
      .body as AdminExamDetail;
    expect(trimmed.questions.find((q) => q.prompt === 'S5')!.sectionId).toBeNull();
    await admin.delete(`/admin/exams/${quiz.id}/questions/${trimmed.questions[0]!.id}`).expect(200);
    expect((await view(m, attempt.id)).result).toMatchObject({ correct: 3, total: 3 });

    const archived = (await admin.patch(`/admin/exams/${quiz.id}`, { status: 'archived' }).expect(200)).body as AdminExamDetail;
    expect(archived.status).toBe('archived');
    expect(((await m.get('/exams').expect(200)).body as ExamSummary[]).map((e) => e.slug)).not.toContain(quiz.slug);
    // The member who took it still reaches the exam page and result; nobody can start it.
    expect(((await m.get(`/exams/${quiz.slug}`).expect(200)).body as ExamDetail).attempts).toHaveLength(1);
    expect((await view(m, attempt.id)).result!.canRetake).toBe(false);
    await m.post(`/exams/${quiz.id}/attempts`).expect(409);
    const stranger = await createMember(t, { name: 'Stranger' });
    await stranger.get(`/exams/${quiz.slug}`).expect(404);
  });

  it('staff try a draft before publishing; previews stay out of the results', async () => {
    const capm = ((await admin.get('/admin/exams').expect(200)).body as AdminExamSummary[]).find((e) => e.slug === 'capm-practice-exam')!;
    const key = (await admin.get(`/admin/exams/${capm.id}`).expect(200)).body as AdminExamDetail;
    const staff = await createMember(t, { name: 'Team Member', roles: ['platform_admin'] });
    expect(((await staff.get('/exams').expect(200)).body as ExamSummary[]).find((e) => e.id === capm.id)).toMatchObject({ status: 'draft' });
    const preview = await start(staff, capm.id);
    expect(preview).toMatchObject({ preview: true, number: 1 });
    expect(preview.questions).toHaveLength(50);
    expect(preview.questions[3]).toMatchObject({ promptAlt: 'قد يتأخر مورد رئيسي في التسليم الشهر القادم. هذا يُعد:' });
    await answer(staff, preview, key, 50);
    const done = (await staff.post(`/exam-attempts/${preview.id}/submit`).expect(200)).body as ExamAttemptView;
    expect(done.result).toMatchObject({ correct: 50, total: 50, percent: 100, passed: true });
    expect(done.result!.sections.map((x) => [x.correct, x.total])).toEqual([[18, 18], [8, 8], [10, 10], [14, 14]]);
    expect(done.questions[0]).toMatchObject({ correct: true, explanation: 'Temporary + unique result → project.', explanationAlt: 'مؤقت وله نتيجة فريدة = مشروع.' });

    const stats = ((await admin.get('/admin/exams').expect(200)).body as AdminExamSummary[]).find((e) => e.id === capm.id)!.stats;
    expect(stats).toEqual({ attempts: 0, participants: 0, passedMembers: 0, averagePercent: null, inProgress: 0 });
    expect(((await admin.get(`/admin/exams/${capm.id}/attempts`).expect(200)).body as Page<AdminExamAttempt>).items).toEqual([]);
    const [events] = await t.db.select({ id: s.analyticsEvents.id }).from(s.analyticsEvents).where(and(eq(s.analyticsEvents.subjectId, capm.id)));
    expect(events).toBeUndefined();

    // Once published, members score it the same way: 35 of 50 is exactly the 70% pass mark.
    await admin.patch(`/admin/exams/${capm.id}`, { status: 'published' }).expect(200);
    const m = await createMember(t, { name: 'CAPM Candidate' });
    await invite(m, capm.slug);
    const attempt = await start(m, capm.id);
    await answer(m, attempt, key, 35);
    const result = ((await m.post(`/exam-attempts/${attempt.id}/submit`).expect(200)).body as ExamAttemptView).result!;
    expect(result).toMatchObject({ correct: 35, total: 50, percent: 70, passed: true });
    expect(result.sections.map((x) => [x.correct, x.total])).toEqual([[18, 18], [8, 8], [9, 10], [0, 14]]);
  });

  it('removes an exam nobody has taken, and never reseeds one an admin removed', async () => {
    const spare = (await admin.post('/admin/exams', { title: 'Throwaway' }).expect(201)).body as AdminExamDetail;
    await admin.delete(`/admin/exams/${spare.id}`).expect(200);
    await admin.get(`/admin/exams/${spare.id}`).expect(404);
    const { seedReference } = await import('../../src/db/seed.js');
    await t.db.delete(s.exams).where(eq(s.exams.slug, 'capm-practice-exam'));
    await seedReference(t.db);
    expect(await t.db.select({ id: s.exams.id }).from(s.exams).where(eq(s.exams.slug, 'capm-practice-exam'))).toEqual([]);
  });
});
