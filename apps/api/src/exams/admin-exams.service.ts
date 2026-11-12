import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  EXAM_MAX_QUESTIONS,
  type AdminExamAttempt,
  type AdminExamAttemptsQuery,
  type AdminExamDetail,
  type AdminExamStats,
  type AdminExamSummary,
  type ExamImportInput,
  type ExamQuestionInput,
  type ExamQuestionOrderInput,
  type ExamQuestionsImportInput,
  type ExamSectionsInput,
  type ExamSettingsInput,
  type ExamInviteRow,
  type ExamsAdminSettings,
  type Ok,
  type Page,
  type SendExamInvitesInput,
  type SendExamInvitesResult,
  type UpdateExamInput,
  type UpdateExamsSettingsInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { courses, examAttempts, examCertificates, examInvites, examQuestions, examSections, exams, memberProfiles, pages, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { SettingsService } from '../infra/settings.service.js';
import { likeContains } from '../learning/courses.service.js';
import { isUuid } from '../media/uuid-param.js';
import { ensureSections, importExam, insertExam, insertQuestions, questionColumns } from './exam-store.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';
import { CHARTER_CENTER_EXAMS_CLIENT, type CharterCenterExamsClient } from './charter-center-exams.client.js';
import { attemptSummary, examBase, questionCounts, reviewOf, sectionsOf, type ExamQuestionRow, type ExamRow } from './exam-views.js';

const tsKey = (col: typeof examAttempts.startedAt) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The same address isn't emailed again sooner than this. */
const INVITE_AGAIN_AFTER_MS = 10 * 60_000;

const NO_STATS: AdminExamStats = { attempts: 0, participants: 0, passedMembers: 0, averagePercent: null, inProgress: 0 };

/** Admin console: build exams (settings, sections, questions, import), publish them and read the results. */
@Injectable()
export class AdminExamsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly attempts: ExamAttemptsService,
    private readonly certificates: ExamCertificatesService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    @Inject(CHARTER_CENTER_EXAMS_CLIENT) private readonly charterCenter: CharterCenterExamsClient,
  ) {}

  /** GET /admin/exams — drafts and published first, then archived; most recently changed first. */
  async list(): Promise<AdminExamSummary[]> {
    const rows = await this.db
      .select()
      .from(exams)
      .orderBy(sql`(${exams.status} = 'archived') asc`, desc(exams.updatedAt));
    const ids = rows.map((r) => r.id);
    const [counts, stats] = await Promise.all([questionCounts(this.db, ids), this.stats(ids)]);
    return rows.map((r) => this.summary(r, counts.get(r.id) ?? 0, stats.get(r.id) ?? NO_STATS));
  }

  /** GET /admin/exams/:id */
  async detail(id: string, db: Db | Tx = this.db): Promise<AdminExamDetail> {
    const exam = await this.find(id, db);
    const [sections, questions, stats, course] = await Promise.all([
      sectionsOf(db, exam.id),
      db.select().from(examQuestions).where(eq(examQuestions.examId, exam.id)).orderBy(asc(examQuestions.position), asc(examQuestions.createdAt)),
      this.stats([exam.id]),
      exam.charterCenterCourseId
        ? db.select({ title: courses.title, slug: courses.slug }).from(courses).where(eq(courses.externalId, exam.charterCenterCourseId)).limit(1)
        : Promise.resolve([]),
    ]);
    return {
      ...this.summary(exam, questions.length, stats.get(exam.id) ?? NO_STATS),
      description: exam.description,
      descriptionAlt: exam.descriptionAlt,
      shuffleQuestions: exam.shuffleQuestions,
      shuffleOptions: exam.shuffleOptions,
      review: reviewOf(exam),
      credit: exam.credit,
      shareCertificates: exam.shareCertificates,
      charterCenterCourse: course[0] ?? null,
      sections: sections.views,
      questions: questions.map(questionView),
    };
  }

  /** POST /admin/exams — a new draft. */
  async create(ctx: AuthContext, input: ExamSettingsInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await insertExam(this.db, input, ctx.user.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'exam.created', targetType: 'exam', targetId: exam.id, after: { title: exam.title, slug: exam.slug }, ip });
    return this.detail(exam.id);
  }

  /** POST /admin/exams/import — a draft with its sections and questions, all or nothing. */
  async import(ctx: AuthContext, input: ExamImportInput, ip?: string): Promise<AdminExamDetail> {
    const id = await this.db.transaction(async (tx) => {
      const exam = await importExam(tx, input, ctx.user.id);
      await this.audit.record(
        { actorId: ctx.user.id, action: 'exam.imported', targetType: 'exam', targetId: exam.id, after: { title: exam.title, slug: exam.slug, questions: input.questions.length }, ip },
        tx,
      );
      return exam.id;
    });
    return this.detail(id);
  }

  /** PATCH /admin/exams/:id — settings and status. Publishing needs at least one question. */
  async update(ctx: AuthContext, id: string, input: UpdateExamInput, ip?: string): Promise<AdminExamDetail> {
    const examId = await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(exams).where(eq(exams.id, this.uuid(id))).for('update').limit(1);
      if (!before) throw Errors.notFound('Exam');
      const { status, ...settings } = input;
      const patch: Partial<typeof exams.$inferInsert> = {};
      for (const [key, value] of Object.entries(settings) as [keyof typeof settings, unknown][]) {
        if (value === undefined) continue;
        const next = typeof value === 'string' && value === '' && key !== 'description' ? null : value;
        if (next !== before[key]) (patch as Record<string, unknown>)[key] = next;
      }
      const language = patch.language ?? before.language;
      const second = patch.secondLanguage !== undefined ? patch.secondLanguage : before.secondLanguage;
      if (second && second === language) throw Errors.validation({ secondLanguage: 'Choose a second language different from the first' });

      let action = 'exam.updated';
      if (status && status !== before.status) {
        if (status === 'published') {
          const count = (await questionCounts(tx, [before.id])).get(before.id) ?? 0;
          if (!count) throw Errors.conflict('Add at least one question before publishing');
          patch.publishedAt = before.publishedAt ?? new Date();
          action = 'exam.published';
        } else action = status === 'archived' ? 'exam.archived' : 'exam.unpublished';
        patch.status = status;
      }
      if (!Object.keys(patch).length) return before.id;
      await tx.update(exams).set(patch).where(eq(exams.id, before.id));
      const changed = Object.keys(patch).filter((k) => k !== 'publishedAt');
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action,
          targetType: 'exam',
          targetId: before.id,
          before: { title: before.title, ...Object.fromEntries(changed.map((k) => [k, before[k as keyof ExamRow]])) },
          after: Object.fromEntries(changed.map((k) => [k, patch[k as keyof typeof patch]])),
          ip,
        },
        tx,
      );
      return before.id;
    });
    return this.detail(examId);
  }

  /** DELETE /admin/exams/:id — only an exam no member has taken; the rest are archived to keep results. */
  async remove(ctx: AuthContext, id: string, ip?: string): Promise<Ok> {
    const exam = await this.find(id);
    const [taken] = await this.db
      .select({ id: examAttempts.id })
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.preview, false)))
      .limit(1);
    if (taken) throw Errors.conflict('Members have taken this exam. Archive it instead, so their results are kept.');
    await this.db.transaction(async (tx) => {
      await tx.delete(exams).where(eq(exams.id, exam.id));
      await this.audit.record({ actorId: ctx.user.id, action: 'exam.deleted', targetType: 'exam', targetId: exam.id, before: { title: exam.title, slug: exam.slug }, ip }, tx);
    });
    return { ok: true };
  }

  /** PUT /admin/exams/:id/sections — the whole list in order; sections left out are removed. */
  async setSections(ctx: AuthContext, id: string, input: ExamSectionsInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    await this.db.transaction(async (tx) => {
      const existing = await tx.select().from(examSections).where(eq(examSections.examId, exam.id));
      const known = new Set(existing.map((s) => s.id));
      const kept = new Set<string>();
      for (const [position, s] of input.sections.entries()) {
        if (s.id) {
          if (!known.has(s.id.toLowerCase())) throw Errors.validation({ sections: 'One of the sections no longer exists. Reload and try again.' });
          kept.add(s.id.toLowerCase());
          await tx.update(examSections).set({ title: s.title, titleAlt: s.titleAlt, position }).where(eq(examSections.id, s.id.toLowerCase()));
        } else {
          await tx.insert(examSections).values({ examId: exam.id, title: s.title, titleAlt: s.titleAlt, position });
        }
      }
      const gone = existing.filter((s) => !kept.has(s.id)).map((s) => s.id);
      if (gone.length) await tx.delete(examSections).where(inArray(examSections.id, gone));
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'exam.sections_updated',
          targetType: 'exam',
          targetId: exam.id,
          before: { sections: existing.sort((a, b) => a.position - b.position).map((s) => s.title) },
          after: { sections: input.sections.map((s) => s.title) },
          ip,
        },
        tx,
      );
    });
    return this.detail(exam.id);
  }

  /** POST /admin/exams/:id/questions — added at the end. */
  async addQuestion(ctx: AuthContext, id: string, input: ExamQuestionInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    await this.db.transaction(async (tx) => {
      const { n, next } = await this.tail(tx, exam.id);
      if (n >= EXAM_MAX_QUESTIONS) throw Errors.conflict(`An exam can have up to ${EXAM_MAX_QUESTIONS} questions`);
      await this.assertSection(tx, exam.id, input.sectionId);
      const [row] = await tx
        .insert(examQuestions)
        .values({ examId: exam.id, sectionId: input.sectionId, position: next, ...questionColumns(input) })
        .returning({ id: examQuestions.id });
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record({ actorId: ctx.user.id, action: 'exam.question_added', targetType: 'exam', targetId: exam.id, after: { questionId: row!.id, prompt: input.prompt }, ip }, tx);
    });
    return this.detail(exam.id);
  }

  /** PATCH /admin/exams/:id/questions/:qid — answers keep their ids, so earlier attempts still point at them. */
  async updateQuestion(ctx: AuthContext, id: string, questionId: string, input: ExamQuestionInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(examQuestions)
        .where(and(eq(examQuestions.id, this.uuid(questionId, 'Question')), eq(examQuestions.examId, exam.id)))
        .for('update')
        .limit(1);
      if (!before) throw Errors.notFound('Question');
      await this.assertSection(tx, exam.id, input.sectionId);
      const columns = questionColumns(input, before.options);
      await tx.update(examQuestions).set({ sectionId: input.sectionId, ...columns }).where(eq(examQuestions.id, before.id));
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'exam.question_updated',
          targetType: 'exam',
          targetId: exam.id,
          before: { questionId: before.id, prompt: before.prompt, correct: before.options.find((o) => o.id === before.correctOptionId)?.text ?? null },
          after: { prompt: columns.prompt, correct: columns.options.find((o) => o.id === columns.correctOptionId)?.text ?? null },
          ip,
        },
        tx,
      );
    });
    return this.detail(exam.id);
  }

  /** DELETE /admin/exams/:id/questions/:qid — finished attempts keep the score they got. */
  async removeQuestion(ctx: AuthContext, id: string, questionId: string, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(examQuestions)
        .where(and(eq(examQuestions.id, this.uuid(questionId, 'Question')), eq(examQuestions.examId, exam.id)))
        .returning({ id: examQuestions.id, prompt: examQuestions.prompt });
      if (!gone) throw Errors.notFound('Question');
      if (exam.status === 'published' && !((await questionCounts(tx, [exam.id])).get(exam.id) ?? 0)) {
        throw Errors.conflict('A published exam needs at least one question. Unpublish it first.');
      }
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record({ actorId: ctx.user.id, action: 'exam.question_removed', targetType: 'exam', targetId: exam.id, before: { questionId: gone.id, prompt: gone.prompt }, ip }, tx);
    });
    return this.detail(exam.id);
  }

  /** PUT /admin/exams/:id/questions/order — every question of the exam, in the new order. */
  async reorder(ctx: AuthContext, id: string, input: ExamQuestionOrderInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    const ids = input.ids.map((x) => x.toLowerCase());
    await this.db.transaction(async (tx) => {
      const rows = await tx.select({ id: examQuestions.id }).from(examQuestions).where(eq(examQuestions.examId, exam.id)).for('update');
      const own = new Set(rows.map((r) => r.id));
      if (new Set(ids).size !== ids.length || ids.length !== own.size || ids.some((x) => !own.has(x))) {
        throw Errors.validation({ ids: 'The questions have changed. Reload and try again.' });
      }
      for (const [position, questionId] of ids.entries()) await tx.update(examQuestions).set({ position }).where(eq(examQuestions.id, questionId));
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record({ actorId: ctx.user.id, action: 'exam.questions_reordered', targetType: 'exam', targetId: exam.id, ip }, tx);
    });
    return this.detail(exam.id);
  }

  /** POST /admin/exams/:id/questions/import — adds the questions at the end, all or nothing. */
  async importQuestions(ctx: AuthContext, id: string, input: ExamQuestionsImportInput, ip?: string): Promise<AdminExamDetail> {
    const exam = await this.find(id);
    await this.db.transaction(async (tx) => {
      const { n, next } = await this.tail(tx, exam.id);
      if (n + input.questions.length > EXAM_MAX_QUESTIONS) throw Errors.conflict(`An exam can have up to ${EXAM_MAX_QUESTIONS} questions`);
      const sectionIds = await ensureSections(tx, exam.id, input.questions);
      await insertQuestions(tx, exam.id, input.questions, sectionIds, next);
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, exam.id));
      await this.audit.record({ actorId: ctx.user.id, action: 'exam.questions_imported', targetType: 'exam', targetId: exam.id, after: { questions: input.questions.length }, ip }, tx);
    });
    return this.detail(exam.id);
  }

  /** GET /admin/exams/:id/attempts — members' attempts, newest first (staff previews left out). */
  async attemptList(id: string, q: AdminExamAttemptsQuery): Promise<Page<AdminExamAttempt>> {
    const exam = await this.find(id);
    await this.attempts.settleExpired(exam.id);
    const filters: (SQL | undefined)[] = [eq(examAttempts.examId, exam.id), eq(examAttempts.preview, false)];
    if (q.result === 'in_progress') filters.push(eq(examAttempts.status, 'in_progress'));
    else if (q.result !== 'all') filters.push(eq(examAttempts.status, 'submitted'), eq(examAttempts.passed, q.result === 'passed'));
    if (q.q) {
      const pat = likeContains(q.q);
      filters.push(or(ilike(memberProfiles.displayName, pat), ilike(memberProfiles.handle, likeContains(q.q.replace(/^@/, ''))), ilike(users.email, pat)));
    }
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c) {
      if (typeof c.t !== 'string' || !isUuid(c.id)) throw Errors.badRequest('Invalid cursor');
      filters.push(sql`(${examAttempts.startedAt}, ${examAttempts.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({
        attempt: examAttempts,
        t: tsKey(examAttempts.startedAt),
        email: users.email,
        name: memberProfiles.displayName,
        handle: memberProfiles.handle,
        avatarFileId: memberProfiles.avatarFileId,
        countryCode: memberProfiles.countryCode,
        certificate: { id: examCertificates.id, status: examCertificates.status, lastError: examCertificates.lastError },
      })
      .from(examAttempts)
      .innerJoin(users, eq(users.id, examAttempts.userId))
      .innerJoin(memberProfiles, eq(memberProfiles.userId, examAttempts.userId))
      .leftJoin(examCertificates, eq(examCertificates.attemptId, examAttempts.id))
      .where(and(...filters))
      .orderBy(desc(examAttempts.startedAt), desc(examAttempts.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.attempt.id }));
    return {
      items: page.items.map((r) => ({
        ...attemptSummary(r.attempt),
        answered: r.attempt.status === 'submitted' ? r.attempt.answeredCount : Object.keys(r.attempt.answers).length,
        total: r.attempt.status === 'submitted' ? r.attempt.totalCount : r.attempt.questionOrder.length,
        member: { id: r.attempt.userId, name: r.name, handle: r.handle, email: r.email, avatarUrl: mediaUrl(r.avatarFileId), countryCode: r.countryCode },
        certificate: r.certificate?.id
          ? { id: r.certificate.id, status: r.certificate.status as 'pending' | 'issued' | 'failed', lastError: r.certificate.lastError }
          : null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** POST /admin/exams/:id/invites — emails the exam's join link (published exams only). */
  async sendInvites(ctx: AuthContext, id: string, input: SendExamInvitesInput, ip?: string): Promise<SendExamInvitesResult> {
    const exam = await this.find(id);
    if (exam.status !== 'published') throw Errors.conflict('Publish the exam before inviting members');
    const invalid: string[] = [];
    const wanted = new Set<string>();
    for (const raw of input.emails) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      if (!EMAIL.test(email)) invalid.push(raw);
      else wanted.add(email);
    }
    if (!wanted.size) return { sent: 0, skipped: 0, invalid };
    const recent = new Date(Date.now() - INVITE_AGAIN_AFTER_MS);
    const known = await this.db
      .select({ email: examInvites.email, lastSentAt: examInvites.lastSentAt })
      .from(examInvites)
      .where(and(eq(examInvites.examId, exam.id), inArray(examInvites.email, [...wanted])));
    const skip = new Set(known.filter((k) => k.lastSentAt > recent).map((k) => k.email.toLowerCase()));
    const link = webUrl(`/exams/${exam.slug}/join`);
    let sent = 0;
    for (const email of wanted) {
      if (skip.has(email)) continue;
      await this.db
        .insert(examInvites)
        .values({ examId: exam.id, email, invitedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [examInvites.examId, examInvites.email],
          set: { sends: sql`${examInvites.sends} + 1`, lastSentAt: new Date(), invitedBy: ctx.user.id, updatedAt: new Date() },
        });
      await this.mail.compose({
        to: email,
        template: 'exam.invite',
        subject: `You’re invited to take “${exam.title}” on Charter Mission`,
        heading: 'Take your exam on Charter Mission',
        paragraphs: [
          `Charter Center invites you to take the exam “${exam.title}” on Charter Mission.`,
          ...(input.message ? [input.message] : []),
          'Use the email address of your Charter Center account. Your Charter Mission account is made from it in a minute, and you go straight to the exam.',
        ],
        button: { label: 'Take the exam', url: link },
        transactional: true,
      });
      sent++;
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'exam.invites_sent', targetType: 'exam', targetId: exam.id, after: { sent, skipped: skip.size }, ip });
    return { sent, skipped: skip.size, invalid };
  }

  /** GET /admin/exams/:id/invites — who was invited, and how far each got. */
  async inviteList(id: string): Promise<ExamInviteRow[]> {
    const exam = await this.find(id);
    const rows = await this.db
      .select({
        email: examInvites.email,
        sends: examInvites.sends,
        firstSentAt: examInvites.createdAt,
        lastSentAt: examInvites.lastSentAt,
        userId: users.id,
        took: sql<boolean>`exists (select 1 from ${examAttempts} a where a.exam_id = ${exam.id} and a.user_id = ${users.id} and a.status = 'submitted' and not a.preview)`,
        passed: sql<boolean>`exists (select 1 from ${examAttempts} a where a.exam_id = ${exam.id} and a.user_id = ${users.id} and a.passed and not a.preview)`,
      })
      .from(examInvites)
      .leftJoin(users, and(eq(sql`lower(${users.email})`, examInvites.email), sql`${users.status} <> 'deleted'`))
      .where(eq(examInvites.examId, exam.id))
      .orderBy(desc(examInvites.lastSentAt))
      .limit(2000);
    return rows.map((r) => ({
      email: r.email,
      status: !r.userId ? 'invited' : r.passed ? 'passed' : r.took ? 'took' : 'joined',
      sends: r.sends,
      firstSentAt: r.firstSentAt.toISOString(),
      lastSentAt: r.lastSentAt.toISOString(),
    }));
  }

  /** POST /admin/exam-certificates/:id/retry */
  async retryCertificate(ctx: AuthContext, id: string, ip?: string): Promise<Ok> {
    await this.certificates.retry(id);
    await this.audit.record({ actorId: ctx.user.id, action: 'exam.certificate_retried', targetType: 'exam_certificate', targetId: id.toLowerCase(), ip });
    return { ok: true };
  }

  /** GET /admin/exams-settings */
  async examsSettings(): Promise<ExamsAdminSettings> {
    return { charterCenterMode: this.charterCenter.mode, certificatePage: await this.certificates.certificatePage() };
  }

  /** PUT /admin/exams-settings */
  async updateExamsSettings(ctx: AuthContext, input: UpdateExamsSettingsInput, ip?: string): Promise<ExamsAdminSettings> {
    let pageId: string | null = null;
    if (input.certificatePageSlug) {
      const slug = input.certificatePageSlug.replace(/^.*\/pages\//, '').replace(/[/?#].*$/, '');
      const [page] = await this.db.select({ id: pages.id }).from(pages).where(and(eq(sql`lower(${pages.slug})`, slug), eq(pages.status, 'active'))).limit(1);
      if (!page) throw Errors.validation({ certificatePageSlug: 'No live page has that link name' });
      pageId = page.id;
    }
    await this.settings.set('exam_certificates', { pageId }, ctx.user.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'exam.settings_updated', targetType: 'setting', targetId: 'exam_certificates', after: { pageId }, ip });
    return this.examsSettings();
  }

  /* ---------- internals ---------- */

  private uuid(value: string, what = 'Exam'): string {
    if (!isUuid(value)) throw Errors.notFound(what);
    return value.toLowerCase();
  }

  private async find(id: string, db: Db | Tx = this.db): Promise<ExamRow> {
    const [row] = await db.select().from(exams).where(eq(exams.id, this.uuid(id))).limit(1);
    if (!row) throw Errors.notFound('Exam');
    return row;
  }

  private summary(row: ExamRow, questionCount: number, stats: AdminExamStats): AdminExamSummary {
    return { ...examBase(row), charterCenterCourseId: row.charterCenterCourseId, questionCount, stats, publishedAt: row.publishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
  }

  private async stats(examIds: string[]): Promise<Map<string, AdminExamStats>> {
    const map = new Map<string, AdminExamStats>();
    if (!examIds.length) return map;
    const done = sql`${examAttempts.status} = 'submitted'`;
    const rows = await this.db
      .select({
        examId: examAttempts.examId,
        attempts: sql<number>`count(*) filter (where ${done})::int`,
        participants: sql<number>`count(distinct ${examAttempts.userId}) filter (where ${done})::int`,
        passedMembers: sql<number>`count(distinct ${examAttempts.userId}) filter (where ${done} and ${examAttempts.passed})::int`,
        average: sql<string | null>`round(avg(${examAttempts.percent}) filter (where ${done}))`,
        inProgress: sql<number>`count(*) filter (where ${examAttempts.status} = 'in_progress')::int`,
      })
      .from(examAttempts)
      .where(and(inArray(examAttempts.examId, examIds), eq(examAttempts.preview, false)))
      .groupBy(examAttempts.examId);
    for (const r of rows) {
      map.set(r.examId, {
        attempts: r.attempts,
        participants: r.participants,
        passedMembers: r.passedMembers,
        averagePercent: r.average === null ? null : Number(r.average),
        inProgress: r.inProgress,
      });
    }
    return map;
  }

  /** How many questions the exam has, and the position for the next one. */
  private async tail(tx: Tx, examId: string): Promise<{ n: number; next: number }> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${examQuestions.position}) + 1, 0)::int` })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId));
    return row ?? { n: 0, next: 0 };
  }

  private async assertSection(tx: Tx, examId: string, sectionId: string | null): Promise<void> {
    if (!sectionId) return;
    const [row] = await tx
      .select({ id: examSections.id })
      .from(examSections)
      .where(and(eq(examSections.id, sectionId.toLowerCase()), eq(examSections.examId, examId)))
      .limit(1);
    if (!row) throw Errors.validation({ sectionId: 'That section no longer exists' });
  }
}

function questionView(row: ExamQuestionRow): AdminExamDetail['questions'][number] {
  return {
    id: row.id,
    sectionId: row.sectionId,
    reference: row.reference,
    tag: row.tag,
    prompt: row.prompt,
    promptAlt: row.promptAlt,
    options: row.options,
    correctOptionId: row.correctOptionId,
    explanation: row.explanation,
    explanationAlt: row.explanationAlt,
  };
}
