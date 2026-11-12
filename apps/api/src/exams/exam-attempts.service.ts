import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  EXAM_GRACE_SECONDS,
  type ExamAnswerSaved,
  type ExamAttemptQuestion,
  type ExamAttemptView,
  type ExamResult,
  type SaveExamAnswerInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { examAttempts, examQuestions, examSections, exams } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { LearningAccessService } from '../learning/learning-access.service.js';
import { isUuid } from '../media/uuid-param.js';
import { buildOrder, hasPassed, markAttempt, percentOf } from './exam-marking.js';
import { examBase, reviewOf, sectionsOf, type ExamAttemptRow, type ExamRow } from './exam-views.js';
import { ExamsService, canPreview } from './exams.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';

const START_LIMIT = 30;
const START_WINDOW_SECONDS = 3600;
const SAVE_LIMIT = 900;
const SAVE_WINDOW_SECONDS = 600;

const graceEnd = (expiresAt: Date) => expiresAt.getTime() + EXAM_GRACE_SECONDS * 1000;

/** Taking an exam: start (or resume), save answers as you go, submit, and read the result. */
@Injectable()
export class ExamAttemptsService {
  private readonly logger = new Logger('ExamAttempts');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly examsService: ExamsService,
    private readonly learningAccess: LearningAccessService,
    private readonly limits: RateLimitService,
    private readonly analytics: AnalyticsService,
    private readonly certificates: ExamCertificatesService,
  ) {}

  /** POST /exams/:id/attempts — a new attempt, or the one already in progress. */
  async start(viewer: AuthUser, examId: string): Promise<ExamAttemptView> {
    const exam = await this.examsService.findVisible(viewer, { id: examId });
    if (exam.status === 'archived') throw Errors.conflict('This exam is closed');
    const preview = exam.status === 'draft';
    if (exam.access === 'learning' && !canPreview(viewer)) await this.learningAccess.assertUnlocked(viewer);

    const open = await this.openAttempt(viewer.id, exam.id);
    if (open) {
      if (!this.isOver(open)) return this.view(viewer, open.id);
      await this.finish(open.id, true);
    }
    await this.limits.consume(`exam-start:${viewer.id}`, START_LIMIT, START_WINDOW_SECONDS);

    const questions = await this.db
      .select({ id: examQuestions.id, options: examQuestions.options })
      .from(examQuestions)
      .where(eq(examQuestions.examId, exam.id))
      .orderBy(asc(examQuestions.position), asc(examQuestions.createdAt));
    if (!questions.length) throw Errors.conflict('This exam has no questions yet');

    const [used] = await this.db
      .select({ n: count() })
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.userId, viewer.id), eq(examAttempts.preview, false)));
    if (!preview && exam.maxAttempts !== null && (used?.n ?? 0) >= exam.maxAttempts) {
      throw Errors.conflict(exam.maxAttempts === 1 ? 'You have already taken this exam' : 'You have used all your attempts for this exam');
    }
    const [{ n: all } = { n: 0 }] = await this.db
      .select({ n: count() })
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.userId, viewer.id)));

    const now = new Date();
    const created = await this.db
      .insert(examAttempts)
      .values({
        examId: exam.id,
        userId: viewer.id,
        number: all + 1,
        preview,
        questionOrder: buildOrder(questions, exam),
        startedAt: now,
        expiresAt: exam.timeLimitMinutes ? new Date(now.getTime() + exam.timeLimitMinutes * 60_000) : null,
        passPercent: exam.passPercent,
      })
      // Two tabs starting at once: the partial unique index lets one in, the other resumes it.
      .onConflictDoNothing()
      .returning({ id: examAttempts.id });
    const id = created[0]?.id ?? (await this.openAttempt(viewer.id, exam.id))?.id;
    if (!id) throw Errors.conflict('The exam couldn’t be started. Try again.');
    if (created.length && !preview) this.analytics.track('exam_started', viewer.id, viewer.countryCode, exam.id);
    return this.view(viewer, id);
  }

  /** GET /exam-attempts/:id — own attempts only. Time that has run out is settled here. */
  async view(viewer: AuthUser, attemptId: string): Promise<ExamAttemptView> {
    let attempt = await this.own(viewer.id, attemptId);
    if (attempt.status === 'in_progress' && this.isOver(attempt)) {
      await this.finish(attempt.id, true);
      attempt = await this.own(viewer.id, attemptId);
    }
    const [exam] = await this.db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
    if (!exam) throw Errors.notFound('Exam');
    const submitted = attempt.status === 'submitted';
    // Staff trying out a draft always see the answers, whatever the exam's review setting.
    const showKey = submitted && (reviewOf(exam) === 'full' || attempt.preview);
    const sections = await sectionsOf(this.db, exam.id);
    const questions = submitted && !showKey ? [] : await this.questionsFor(attempt, showKey);

    return {
      id: attempt.id,
      number: attempt.number,
      status: attempt.status as ExamAttemptView['status'],
      preview: attempt.preview,
      exam: {
        id: exam.id,
        slug: exam.slug,
        title: exam.title,
        titleAlt: exam.titleAlt,
        language: examBase(exam).language,
        secondLanguage: examBase(exam).secondLanguage,
        timeLimitMinutes: exam.timeLimitMinutes,
        passPercent: exam.passPercent,
        review: reviewOf(exam),
        credit: exam.credit,
      },
      startedAt: attempt.startedAt.toISOString(),
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
      serverNow: new Date().toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      sections: sections.views,
      questions,
      result: submitted ? await this.result(viewer, exam, attempt) : null,
      awardsCertificate: !!exam.charterCenterCourseId && !attempt.preview,
      certificate: submitted && !attempt.preview && exam.charterCenterCourseId ? await this.certificates.forMember(exam.id, viewer.id) : null,
    };
  }

  /** PUT /exam-attempts/:id/answers — one answer and/or its "review later" flag. */
  async saveAnswer(viewer: AuthUser, attemptId: string, input: SaveExamAnswerInput): Promise<ExamAnswerSaved> {
    const attempt = await this.own(viewer.id, attemptId);
    if (attempt.status !== 'in_progress') throw Errors.conflict('This attempt has already been submitted');
    if (this.isOver(attempt)) {
      await this.finish(attempt.id, true);
      throw Errors.conflict('Time is up. Your answers have been submitted.');
    }
    await this.limits.consume(`exam-save:${viewer.id}`, SAVE_LIMIT, SAVE_WINDOW_SECONDS);
    const entry = attempt.questionOrder.find((e) => e.q === input.questionId.toLowerCase());
    if (!entry) throw Errors.validation({ questionId: 'That question is not part of this attempt' });
    if (input.optionId != null && !entry.o.includes(input.optionId)) {
      throw Errors.validation({ optionId: 'Choose one of the answers shown' });
    }

    const patch: Partial<Record<'answers' | 'flags', ReturnType<typeof sql>>> = {};
    if (input.optionId === null) patch.answers = sql`${examAttempts.answers} - ${entry.q}::text`;
    else if (input.optionId !== undefined) patch.answers = sql`${examAttempts.answers} || ${JSON.stringify({ [entry.q]: input.optionId })}::jsonb`;
    if (input.flagged === true) patch.flags = sql`${examAttempts.flags} || ${JSON.stringify({ [entry.q]: true })}::jsonb`;
    else if (input.flagged === false) patch.flags = sql`${examAttempts.flags} - ${entry.q}::text`;

    const [saved] = await this.db
      .update(examAttempts)
      .set(patch)
      .where(and(eq(examAttempts.id, attempt.id), eq(examAttempts.status, 'in_progress')))
      .returning({ answers: examAttempts.answers });
    if (!saved) throw Errors.conflict('This attempt has already been submitted');
    const inAttempt = new Set(attempt.questionOrder.map((e) => e.q));
    return {
      answered: Object.keys(saved.answers).filter((q) => inAttempt.has(q)).length,
      serverNow: new Date().toISOString(),
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
    };
  }

  /** POST /exam-attempts/:id/submit — marks the attempt. Submitting twice returns the same result. */
  async submit(viewer: AuthUser, attemptId: string): Promise<ExamAttemptView> {
    const attempt = await this.own(viewer.id, attemptId);
    if (attempt.status === 'in_progress') await this.finish(attempt.id, this.isOver(attempt));
    return this.view(viewer, attempt.id);
  }

  /** Marks every attempt of an exam whose time ran out while nobody was looking (admin results). */
  async settleExpired(examId: string): Promise<void> {
    const stale = await this.db
      .select({ id: examAttempts.id })
      .from(examAttempts)
      .where(
        and(
          eq(examAttempts.examId, examId),
          eq(examAttempts.status, 'in_progress'),
          isNotNull(examAttempts.expiresAt),
          lt(examAttempts.expiresAt, new Date(Date.now() - EXAM_GRACE_SECONDS * 1000)),
        ),
      )
      .limit(500);
    for (const row of stale) await this.finish(row.id, true);
  }

  /* ---------- internals ---------- */

  private isOver(attempt: Pick<ExamAttemptRow, 'expiresAt'>): boolean {
    return attempt.expiresAt !== null && Date.now() > graceEnd(attempt.expiresAt);
  }

  private async own(userId: string, attemptId: string): Promise<ExamAttemptRow> {
    if (!isUuid(attemptId)) throw Errors.notFound('Attempt');
    const [row] = await this.db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.id, attemptId.toLowerCase()), eq(examAttempts.userId, userId)))
      .limit(1);
    if (!row) throw Errors.notFound('Attempt');
    return row;
  }

  private async openAttempt(userId: string, examId: string): Promise<ExamAttemptRow | undefined> {
    const [row] = await this.db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, examId), eq(examAttempts.userId, userId), eq(examAttempts.status, 'in_progress')))
      .limit(1);
    return row;
  }

  /** Marks an attempt once: the row is locked, so a submit racing a time-out marks it a single time. */
  private async finish(attemptId: string, timedOut: boolean): Promise<void> {
    const done = await this.db.transaction(async (tx: Tx) => {
      const [attempt] = await tx.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).for('update').limit(1);
      if (!attempt || attempt.status !== 'in_progress') return null;
      const [exam] = await tx.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
      if (!exam) return null;
      const ids = attempt.questionOrder.map((e) => e.q);
      const [questions, sections] = await Promise.all([
        ids.length
          ? tx
              .select({ id: examQuestions.id, sectionId: examQuestions.sectionId, correctOptionId: examQuestions.correctOptionId })
              .from(examQuestions)
              .where(and(eq(examQuestions.examId, exam.id), inArray(examQuestions.id, ids)))
          : Promise.resolve([]),
        tx
          .select({ id: examSections.id, title: examSections.title, titleAlt: examSections.titleAlt })
          .from(examSections)
          .where(eq(examSections.examId, exam.id))
          .orderBy(asc(examSections.position), asc(examSections.createdAt)),
      ]);
      const marked = markAttempt(attempt.questionOrder, new Map(questions.map((q) => [q.id, q])), sections, attempt.answers);
      const now = new Date();
      // Never later than the time limit: late answers were not accepted, so the clock stops there.
      const submittedAt = attempt.expiresAt && now > attempt.expiresAt ? attempt.expiresAt : now;
      await tx
        .update(examAttempts)
        .set({
          status: 'submitted',
          submittedAt,
          timedOut,
          correctCount: marked.correct,
          totalCount: marked.total,
          answeredCount: marked.answered,
          percent: percentOf(marked.correct, marked.total),
          passPercent: exam.passPercent,
          passed: hasPassed(marked.correct, marked.total, exam.passPercent),
          result: { items: marked.items, sections: marked.sections },
        })
        .where(eq(examAttempts.id, attempt.id));
      return { examId: exam.id, userId: attempt.userId, preview: attempt.preview, passed: hasPassed(marked.correct, marked.total, exam.passPercent) };
    });
    if (!done || done.preview) return;
    this.analytics.track('exam_submitted', done.userId, null, done.examId);
    // Exams tied to a Charter Center course: ask for the member's certificate (never blocks the result).
    if (done.passed) {
      await this.certificates.onPassed(done.examId, done.userId, attemptId).catch((err: unknown) => this.logger.warn(`Certificate request for attempt ${attemptId}: ${String(err)}`));
    }
  }

  /** The attempt's questions in its own order; with the answer key only when `showKey`. */
  private async questionsFor(attempt: ExamAttemptRow, showKey: boolean): Promise<ExamAttemptQuestion[]> {
    const ids = attempt.questionOrder.map((e) => e.q);
    if (!ids.length) return [];
    const rows = await this.db.select().from(examQuestions).where(inArray(examQuestions.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const marks = new Map((attempt.result?.items ?? []).map((i) => [i.q, i]));
    const out: ExamAttemptQuestion[] = [];
    for (const entry of attempt.questionOrder) {
      const q = byId.get(entry.q);
      if (!q) continue;
      const mark = marks.get(q.id);
      // After marking, only questions that were marked are shown (the score is about those).
      if (showKey && !mark) continue;
      const options = new Map(q.options.map((o) => [o.id, o]));
      // The order this attempt was given; answers added to the question since go last.
      const ordered = [...entry.o.filter((id) => options.has(id)), ...q.options.map((o) => o.id).filter((id) => !entry.o.includes(id))];
      const selected = attempt.answers[q.id];
      const view: ExamAttemptQuestion = {
        id: q.id,
        sectionId: q.sectionId,
        reference: q.reference,
        tag: q.tag,
        prompt: q.prompt,
        promptAlt: q.promptAlt,
        options: (showKey ? ordered : ordered.filter((id) => entry.o.includes(id))).map((id) => {
          const o = options.get(id)!;
          return { id: o.id, text: o.text, textAlt: o.textAlt };
        }),
        selectedOptionId: selected !== undefined && entry.o.includes(selected) ? selected : null,
        flagged: attempt.flags[q.id] === true,
      };
      if (showKey && mark) {
        view.correctOptionId = mark.answer;
        view.correct = mark.ok;
        view.explanation = q.explanation;
        view.explanationAlt = q.explanationAlt;
      }
      out.push(view);
    }
    return out;
  }

  private async result(viewer: AuthUser, exam: ExamRow, attempt: ExamAttemptRow): Promise<ExamResult> {
    const [used] = await this.db
      .select({ n: count() })
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.userId, viewer.id), eq(examAttempts.preview, false)));
    const preview = exam.status === 'draft';
    const attemptsLeft = exam.maxAttempts === null || preview ? null : Math.max(0, exam.maxAttempts - (used?.n ?? 0));
    const takeable = exam.status === 'published' || (preview && canPreview(viewer));
    const submittedAt = attempt.submittedAt ?? new Date();
    return {
      correct: attempt.correctCount,
      total: attempt.totalCount,
      answered: attempt.answeredCount,
      percent: attempt.percent,
      passPercent: attempt.passPercent,
      passed: attempt.passed,
      timedOut: attempt.timedOut,
      durationSeconds: Math.max(0, Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000)),
      sections: (attempt.result?.sections ?? []).map((s) => ({ ...s, percent: percentOf(s.correct, s.total) })),
      attemptsLeft,
      canRetake: takeable && (attemptsLeft === null || attemptsLeft > 0),
    };
  }
}
