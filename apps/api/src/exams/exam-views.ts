import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type {
  ExamAttemptSummary,
  ExamLanguage,
  ExamReview,
  ExamSection,
  ExamStatus,
  ExamViewerProgress,
} from '@chartermission/contracts';
import type { Db, Tx } from '../db/client.js';
import { examAttempts, examQuestions, examSections, exams } from '../db/schema.js';

export type ExamRow = typeof exams.$inferSelect;
export type ExamSectionRow = typeof examSections.$inferSelect;
export type ExamQuestionRow = typeof examQuestions.$inferSelect;
export type ExamAttemptRow = typeof examAttempts.$inferSelect;

/** The columns of an exam every view shares, typed as the contracts expect. */
export function examBase(row: ExamRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleAlt: row.titleAlt,
    language: row.language as ExamLanguage,
    secondLanguage: row.secondLanguage as ExamLanguage | null,
    status: row.status as ExamStatus,
    timeLimitMinutes: row.timeLimitMinutes,
    passPercent: row.passPercent,
    maxAttempts: row.maxAttempts,
  };
}

export const reviewOf = (row: ExamRow) => row.review as ExamReview;

/** Questions per exam. */
export async function questionCounts(db: Db | Tx, examIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!examIds.length) return map;
  const rows = await db
    .select({ examId: examQuestions.examId, n: count() })
    .from(examQuestions)
    .where(inArray(examQuestions.examId, examIds))
    .groupBy(examQuestions.examId);
  for (const r of rows) map.set(r.examId, r.n);
  return map;
}

/** An exam's sections in order, each with how many questions it holds. */
export async function sectionsOf(db: Db | Tx, examId: string): Promise<{ rows: ExamSectionRow[]; views: ExamSection[] }> {
  const [rows, counts] = await Promise.all([
    db.select().from(examSections).where(eq(examSections.examId, examId)).orderBy(asc(examSections.position), asc(examSections.createdAt)),
    db
      .select({ sectionId: examQuestions.sectionId, n: count() })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId))
      .groupBy(examQuestions.sectionId),
  ]);
  const byId = new Map(counts.map((c) => [c.sectionId, c.n]));
  return { rows, views: rows.map((r) => ({ id: r.id, title: r.title, titleAlt: r.titleAlt, questionCount: byId.get(r.id) ?? 0 })) };
}

export function attemptSummary(row: ExamAttemptRow): ExamAttemptSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as ExamAttemptSummary['status'],
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    correct: row.correctCount,
    total: row.totalCount,
    percent: row.percent,
    passed: row.passed,
    timedOut: row.timedOut,
    durationSeconds: row.submittedAt ? Math.max(0, Math.round((row.submittedAt.getTime() - row.startedAt.getTime()) / 1000)) : null,
  };
}

const NO_PROGRESS: ExamViewerProgress = { attempts: 0, attemptsLeft: null, bestPercent: null, passed: false, inProgressAttemptId: null, lastAttemptId: null };

/**
 * A member's progress on each exam. Attempts made while trying out a draft (preview) show in the
 * member's own history but never count towards the attempt limit.
 */
export async function viewerProgress(db: Db | Tx, userId: string, list: Pick<ExamRow, 'id' | 'maxAttempts' | 'status'>[]): Promise<Map<string, ExamViewerProgress>> {
  const map = new Map<string, ExamViewerProgress>();
  if (!list.length) return map;
  const rows = await db
    .select({
      examId: examAttempts.examId,
      finished: sql<number>`count(*) filter (where ${examAttempts.status} = 'submitted')::int`,
      counted: sql<number>`count(*) filter (where ${examAttempts.status} = 'submitted' and not ${examAttempts.preview})::int`,
      best: sql<number | null>`max(${examAttempts.percent}) filter (where ${examAttempts.status} = 'submitted')`,
      passed: sql<boolean>`coalesce(bool_or(${examAttempts.passed}) filter (where ${examAttempts.status} = 'submitted'), false)`,
      open: sql<string | null>`(array_agg(${examAttempts.id}) filter (where ${examAttempts.status} = 'in_progress'))[1]`,
      last: sql<string | null>`(array_agg(${examAttempts.id} order by ${examAttempts.submittedAt} desc) filter (where ${examAttempts.status} = 'submitted'))[1]`,
    })
    .from(examAttempts)
    .where(
      and(
        eq(examAttempts.userId, userId),
        inArray(
          examAttempts.examId,
          list.map((e) => e.id),
        ),
      ),
    )
    .groupBy(examAttempts.examId);
  const byExam = new Map(rows.map((r) => [r.examId, r]));
  for (const exam of list) {
    const r = byExam.get(exam.id);
    if (!r) {
      map.set(exam.id, { ...NO_PROGRESS, attemptsLeft: exam.status === 'draft' ? null : exam.maxAttempts });
      continue;
    }
    map.set(exam.id, {
      attempts: r.finished,
      attemptsLeft: exam.maxAttempts === null || exam.status === 'draft' ? null : Math.max(0, exam.maxAttempts - r.counted),
      bestPercent: r.best === null ? null : Number(r.best),
      passed: r.passed,
      inProgressAttemptId: r.open,
      lastAttemptId: r.last,
    });
  }
  return map;
}
