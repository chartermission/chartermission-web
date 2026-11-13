import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { EXAM_PERMISSIONS, type ExamDetail, type ExamJoinInfo, type ExamSummary } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { examAccess, examAttempts, exams } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import type { Permission } from '../core/permissions.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { isUuid } from '../media/uuid-param.js';
import { ExamCertificatesService } from './exam-certificates.service.js';
import { attemptSummary, examBase, questionCounts, reviewOf, sectionsOf, viewerProgress, type ExamRow } from './exam-views.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const HISTORY_LIMIT = 30;

/** Staff who build exams can open and try a draft on the member site before publishing it. */
export const canPreview = (user: Pick<AuthUser, 'permissions'>) => user.permissions.has(EXAM_PERMISSIONS.manage as Permission);

/**
 * Exams as members see them. Exams are by invitation: opening an exam's link while signed in
 * (claim) gives the member that exam for good (exam_access), and only then can they see and take
 * it. Staff who manage exams see them all.
 */
@Injectable()
export class ExamsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly certificates: ExamCertificatesService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** GET /exams — the viewer's open exams, newest first (closed ones stay reachable by link); staff see every exam, drafts included. */
  async list(viewer: AuthUser): Promise<ExamSummary[]> {
    const staff = canPreview(viewer);
    const given = this.db.select({ id: examAccess.examId }).from(examAccess).where(eq(examAccess.userId, viewer.id));
    const rows = await this.db
      .select()
      .from(exams)
      .where(
        staff
          ? inArray(exams.status, ['published', 'draft'])
          : and(inArray(exams.id, given), eq(exams.status, 'published')),
      )
      .orderBy(sql`(${exams.status} = 'published') desc`, desc(exams.publishedAt), desc(exams.createdAt));
    return this.summaries(viewer, rows);
  }

  /** POST /exams/:slug/access — the invitation link: gives the viewer this published exam. */
  async claim(viewer: AuthUser, slug: string): Promise<ExamSummary> {
    const exam = await this.bySlug(slug);
    if (!exam || (exam.status !== 'published' && !(exam.status === 'draft' && canPreview(viewer)))) {
      // An archived exam stays with the members who already have it; nobody new gets it.
      if (exam?.status === 'archived' && (await this.hasAccess(viewer.id, exam.id))) return (await this.summaries(viewer, [exam]))[0]!;
      throw Errors.notFound('Exam');
    }
    if (exam.status === 'published') {
      const [added] = await this.db.insert(examAccess).values({ examId: exam.id, userId: viewer.id }).onConflictDoNothing().returning({ examId: examAccess.examId });
      if (added) this.analytics.track('exam_joined', viewer.id, viewer.countryCode, exam.id);
    }
    return (await this.summaries(viewer, [exam]))[0]!;
  }

  /** GET /exam-join/:slug — the exam as its invitation page shows it before signing in (published only). */
  async joinInfo(slug: string): Promise<ExamJoinInfo> {
    const exam = await this.bySlug(slug);
    if (!exam || exam.status !== 'published') throw Errors.notFound('Exam');
    const count = (await questionCounts(this.db, [exam.id])).get(exam.id) ?? 0;
    return {
      slug: exam.slug,
      title: exam.title,
      titleAlt: exam.titleAlt,
      language: exam.language as ExamJoinInfo['language'],
      secondLanguage: exam.secondLanguage as ExamJoinInfo['secondLanguage'],
      questionCount: count,
      timeLimitMinutes: exam.timeLimitMinutes,
      passPercent: exam.passPercent,
    };
  }

  /** GET /exams/:slug */
  async detail(viewer: AuthUser, slug: string): Promise<ExamDetail> {
    const exam = await this.findVisible(viewer, { slug });
    const [[summary], sections, attempts, certificate] = await Promise.all([
      this.summaries(viewer, [exam]),
      sectionsOf(this.db, exam.id),
      this.db
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.userId, viewer.id)))
        .orderBy(desc(examAttempts.startedAt))
        .limit(HISTORY_LIMIT),
      this.certificates.forMember(exam.id, viewer.id),
    ]);
    return {
      ...summary!,
      review: reviewOf(exam),
      shuffleQuestions: exam.shuffleQuestions,
      credit: exam.credit,
      sections: sections.views.filter((s) => s.questionCount > 0),
      attempts: attempts.map(attemptSummary),
      certificate,
    };
  }

  /** GET /exams/:id/certificate — the member's own certificate for this exam (polled while pending). */
  async certificate(viewer: AuthUser, examId: string) {
    const exam = await this.findVisible(viewer, { id: examId });
    return this.certificates.forMember(exam.id, viewer.id);
  }

  /**
   * The exam, if this member may see it: published and given to them; a draft or any exam for staff
   * who manage exams; or an archived exam the member has taken (so their results stay reachable).
   */
  async findVisible(viewer: AuthUser, by: { slug: string } | { id: string }): Promise<ExamRow> {
    let row: ExamRow | undefined;
    if ('slug' in by) row = await this.bySlug(by.slug);
    else if (isUuid(by.id)) [row] = await this.db.select().from(exams).where(eq(exams.id, by.id.toLowerCase())).limit(1);
    if (!row) throw Errors.notFound('Exam');
    if (canPreview(viewer) && row.status !== 'archived') return row;
    if (row.status === 'published' && (await this.hasAccess(viewer.id, row.id))) return row;
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

  private async bySlug(raw: string): Promise<ExamRow | undefined> {
    const slug = raw.toLowerCase();
    if (!SLUG.test(slug)) return undefined;
    const [row] = await this.db.select().from(exams).where(eq(exams.slug, slug)).limit(1);
    return row;
  }

  private async hasAccess(userId: string, examId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ examId: examAccess.examId })
      .from(examAccess)
      .where(and(eq(examAccess.examId, examId), eq(examAccess.userId, userId)))
      .limit(1);
    return !!row;
  }

  private async summaries(viewer: AuthUser, rows: ExamRow[]): Promise<ExamSummary[]> {
    if (!rows.length) return [];
    const [counts, progress] = await Promise.all([
      questionCounts(
        this.db,
        rows.map((r) => r.id),
      ),
      viewerProgress(this.db, viewer.id, rows),
    ]);
    return rows.map((row) => ({
      ...examBase(row),
      description: row.description,
      descriptionAlt: row.descriptionAlt,
      questionCount: counts.get(row.id) ?? 0,
      viewer: progress.get(row.id)!,
    }));
  }
}
