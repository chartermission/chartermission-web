import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { EXAM_PERMISSIONS, type ExamDetail, type ExamSummary } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { examAttempts, exams } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import type { Permission } from '../core/permissions.js';
import { LearningAccessService } from '../learning/learning-access.service.js';
import { isUuid } from '../media/uuid-param.js';
import { attemptSummary, examBase, questionCounts, reviewOf, sectionsOf, viewerProgress, type ExamRow } from './exam-views.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HISTORY_LIMIT = 30;

/** Staff who build exams can open and try a draft on the member site before publishing it. */
export const canPreview = (user: Pick<AuthUser, 'permissions'>) => user.permissions.has(EXAM_PERMISSIONS.manage as Permission);

/** Exams as members see them: the list, and one exam's page with the member's own attempts. */
@Injectable()
export class ExamsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly learningAccess: LearningAccessService,
  ) {}

  /** GET /exams — published exams, newest first; staff who manage exams also see drafts. */
  async list(viewer: AuthUser): Promise<ExamSummary[]> {
    const rows = await this.db
      .select()
      .from(exams)
      .where(canPreview(viewer) ? inArray(exams.status, ['published', 'draft']) : eq(exams.status, 'published'))
      .orderBy(sql`(${exams.status} = 'published') desc`, desc(exams.publishedAt), desc(exams.createdAt));
    return this.summaries(viewer, rows);
  }

  /** GET /exams/:slug */
  async detail(viewer: AuthUser, slug: string): Promise<ExamDetail> {
    const exam = await this.findVisible(viewer, { slug });
    const [[summary], sections, attempts] = await Promise.all([
      this.summaries(viewer, [exam]),
      sectionsOf(this.db, exam.id),
      this.db
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.userId, viewer.id)))
        .orderBy(desc(examAttempts.startedAt))
        .limit(HISTORY_LIMIT),
    ]);
    return {
      ...summary!,
      review: reviewOf(exam),
      shuffleQuestions: exam.shuffleQuestions,
      credit: exam.credit,
      sections: sections.views.filter((s) => s.questionCount > 0),
      attempts: attempts.map(attemptSummary),
    };
  }

  /**
   * The exam, if this member may see it: published; a draft for staff who manage exams; or an
   * archived exam the member has taken (so their results stay reachable).
   */
  async findVisible(viewer: AuthUser, by: { slug: string } | { id: string }): Promise<ExamRow> {
    let row: ExamRow | undefined;
    if ('slug' in by) {
      const slug = by.slug.toLowerCase();
      if (!SLUG.test(slug)) throw Errors.notFound('Exam');
      [row] = await this.db.select().from(exams).where(eq(exams.slug, slug)).limit(1);
    } else {
      if (!isUuid(by.id)) throw Errors.notFound('Exam');
      [row] = await this.db.select().from(exams).where(eq(exams.id, by.id.toLowerCase())).limit(1);
    }
    if (!row) throw Errors.notFound('Exam');
    if (row.status === 'published') return row;
    if (row.status === 'draft' && canPreview(viewer)) return row;
    if (row.status === 'archived') {
      const [own] = await this.db
        .select({ id: examAttempts.id })
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, row.id), eq(examAttempts.userId, viewer.id)))
        .limit(1);
      if (own) return row;
    }
    throw Errors.notFound('Exam');
  }

  /** Whether an exam that follows the e-learning access rules is still locked for this member. */
  async isLocked(viewer: AuthUser, exam: Pick<ExamRow, 'access' | 'status'>): Promise<boolean> {
    if (exam.access !== 'learning' || canPreview(viewer)) return false;
    return !(await this.learningAccess.forMember(viewer)).unlocked;
  }

  private async summaries(viewer: AuthUser, rows: ExamRow[]): Promise<ExamSummary[]> {
    if (!rows.length) return [];
    const needsAccess = rows.some((r) => r.access === 'learning') && !canPreview(viewer);
    const [counts, progress, access] = await Promise.all([
      questionCounts(
        this.db,
        rows.map((r) => r.id),
      ),
      viewerProgress(this.db, viewer.id, rows),
      needsAccess ? this.learningAccess.forMember(viewer) : Promise.resolve(null),
    ]);
    return rows.map((row) => ({
      ...examBase(row),
      description: row.description,
      descriptionAlt: row.descriptionAlt,
      questionCount: counts.get(row.id) ?? 0,
      locked: row.access === 'learning' && access !== null && !access.unlocked,
      viewer: progress.get(row.id)!,
    }));
  }
}
