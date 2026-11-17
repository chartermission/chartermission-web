import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminExamCertificate,
  AdminExamCertificatesPage,
  AdminExamCertificatesQuery,
  AdminExamCertificatesSummary,
  AskCertificateNamesResult,
  DeclineCertificateNameInput,
  ExamCertificateDifference,
  ReissueExamCertificatesInput,
  ReissueExamCertificatesResult,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { CertificateRequest } from './charter-center-exams.client.js';
import { examCertificates, examInstructors, exams, memberProfiles, posts, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { likeContains } from '../learning/courses.service.js';
import { isUuid } from '../media/uuid-param.js';
import { ExamCertificatesService, replacingSql as replacing, type CertificateRow } from './exam-certificates.service.js';
import { instructorOfExam, storedCertificate, type CertificateTerms } from './exam-instructors.js';

/** Replacements asked for together are spread out by this much each (a few a second). */
const REISSUE_SPACING_MS = 350;

const DIFFERENCES: ExamCertificateDifference[] = ['title', 'issuer', 'dates', 'hours', 'signature', 'name'];

/** The newest-first sort key of a certificate: when it was issued, else when it was asked for. */
const sortAt = sql`coalesce(${examCertificates.issuedAt}, ${examCertificates.createdAt})`;
const sortKey = sql<string>`to_char(${sortAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The name as buildRequest sends it: the name the member confirmed for the certificate, else their
 * profile name, else the start of their email address.
 */
const currentName = sql`coalesce(${examCertificates.certificateName}, nullif(btrim(${memberProfiles.displayName}), ''), split_part(${users.email}, '@', 1))`;

/** Waiting only for the member's name doesn't count as pending (see awaiting_name). */
const pendingSql = sql`(${examCertificates.status} = 'pending' and ${examCertificates.nameStatus} is null)`;

/**
 * How each certificate differs from what would be sent to Charter Center now (the exam's current
 * certificate settings with its instructor's current name and signature, and the member's current
 * name), as SQL over exam_certificates.request. Same rules as requestDifferences() in
 * exam-certificates.service.ts. Only meaningful for issued certificates with a request; see `outdated`.
 */
function differenceSql(settings: CertificateTerms): Record<ExamCertificateDifference, SQL<boolean>> {
  const r = examCertificates.request;
  return {
    title: sql<boolean>`((${r}->>'course_title') is distinct from ${settings.title}::text)`,
    issuer: sql<boolean>`((${r}->>'instructor_name') is distinct from ${settings.issuerName}::text)`,
    dates: sql<boolean>`((${r}->>'start_from') is distinct from ${settings.startDate}::text or (${r}->>'start_end') is distinct from ${settings.endDate}::text)`,
    hours: sql<boolean>`((${r}->>'exam_hours')::numeric is distinct from ${settings.hours ?? null}::numeric)`,
    signature: sql<boolean>`(strpos(coalesce(${r}->>'instructor_signature_url', ''), ${settings.signatureFileId}::text) = 0)`,
    name: sql<boolean>`((${r}->>'student_name') is distinct from ${currentName})`,
  };
}

/** Issued certificates that differ from what would be issued now (needs users and member_profiles joined). */
function outdatedSql(settings: CertificateTerms | null): SQL {
  if (!settings) return sql`false`;
  const d = differenceSql(settings);
  return sql`(${examCertificates.status} = 'issued' and ${examCertificates.request} is not null and (${sql.join(
    DIFFERENCES.map((k) => d[k]),
    sql` or `,
  )}))`;
}

/** certificate: the exam's settings with the signer resolved (null: no settings, or nobody to sign them). */
type ExamForCertificates = { id: string; certificate: CertificateTerms | null };

/**
 * Admin console: an exam's issued certificates, and replacing them when the certificate settings
 * were wrong (see ExamCertificatesService.replace for what a replacement does).
 */
@Injectable()
export class AdminExamCertificatesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly certificates: ExamCertificatesService,
  ) {}

  /** GET /admin/exams/:id/certificates — newest first; the summary counts the whole exam. */
  async list(examId: string, q: AdminExamCertificatesQuery): Promise<AdminExamCertificatesPage> {
    const exam = await this.exam(examId);
    const filters: (SQL | undefined)[] = [eq(examCertificates.examId, exam.id)];
    if (q.status === 'pending') filters.push(pendingSql);
    else if (q.status === 'awaiting_name') filters.push(eq(examCertificates.nameStatus, 'awaiting'));
    else if (q.status === 'name_review') filters.push(eq(examCertificates.nameStatus, 'review'));
    else if (q.status !== 'all') filters.push(eq(examCertificates.status, q.status));
    if (q.outdated) filters.push(outdatedSql(exam.certificate));
    if (q.q) {
      const pat = likeContains(q.q);
      filters.push(
        or(
          ilike(memberProfiles.displayName, pat),
          ilike(memberProfiles.handle, likeContains(q.q.replace(/^@/, ''))),
          ilike(users.email, pat),
          ilike(examCertificates.externalId, pat),
          ilike(examCertificates.certificateName, pat),
          ilike(examCertificates.proposedName, pat),
        ),
      );
    }
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (c) {
      if (typeof c.t !== 'string' || Number.isNaN(Date.parse(c.t)) || !isUuid(c.id)) throw Errors.badRequest('Invalid cursor');
      filters.push(sql`(${sortAt}, ${examCertificates.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
    }
    const [rows, summary] = await Promise.all([this.rows(exam, and(...filters)!, q.limit + 1), this.summary(exam)]);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.item.id }));
    return { items: page.items.map((r) => r.item), nextCursor: page.nextCursor, summary };
  }

  /** POST /admin/exam-certificates/:id/reissue — replace one issued certificate. */
  async reissueOne(ctx: AuthContext, id: string, ip?: string): Promise<AdminExamCertificate> {
    if (!isUuid(id)) throw Errors.notFound('Certificate');
    const [row] = await this.db.select().from(examCertificates).where(eq(examCertificates.id, id.toLowerCase())).limit(1);
    if (!row) throw Errors.notFound('Certificate');
    if (row.status !== 'issued') throw Errors.conflict('Only issued certificates can be replaced');
    if (row.replaceRequestedAt && row.replaceNextTryAt) throw Errors.conflict('A new certificate is already on its way');
    const exam = await this.exam(row.examId);
    if (!exam.certificate) throw Errors.conflict('This exam has no certificate settings');
    if (!(await this.certificates.markReplacement(row.id))) throw Errors.conflict('A new certificate is already on its way');
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificate_reissued',
      targetType: 'exam_certificate',
      targetId: row.id,
      before: { certificateId: row.externalId, request: row.request },
      after: { examId: row.examId },
      ip,
    });
    await this.certificates.enqueueReplacement(row.id);
    return this.item(exam, row.id);
  }

  /** POST /admin/exam-certificates/:id/ask-name — ask the member to confirm the name on their issued certificate. */
  async askName(ctx: AuthContext, id: string, ip?: string): Promise<AdminExamCertificate> {
    const row = await this.row(id);
    if (row.status !== 'issued') throw Errors.conflict('Only issued certificates can be checked');
    if (row.nameStatus) throw Errors.conflict('This member has already been asked to confirm their name');
    const now = new Date();
    const [marked] = await this.db
      .update(examCertificates)
      .set({ nameStatus: 'awaiting', nameRequestedAt: now, nameRemindedAt: null, nameDeclinedReason: null, proposedName: null })
      .where(and(eq(examCertificates.id, row.id), eq(examCertificates.status, 'issued'), isNull(examCertificates.nameStatus)))
      .returning({ id: examCertificates.id });
    if (!marked) throw Errors.conflict('This member has already been asked to confirm their name');
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificate_name_asked',
      targetType: 'exam_certificate',
      targetId: row.id,
      after: { examId: row.examId },
      ip,
    });
    await this.certificates.enqueueNameNotice(row.id, 'asked', now);
    return this.item(await this.exam(row.examId), row.id);
  }

  /**
   * POST /admin/exams/:id/certificates/ask-names — ask every member with an issued certificate for
   * the exam (and not already asked) to confirm their name. One UPDATE; the notices go out from a job.
   */
  async askNames(ctx: AuthContext, examId: string, ip?: string): Promise<AskCertificateNamesResult> {
    const exam = await this.exam(examId);
    const now = new Date();
    const marked = await this.db
      .update(examCertificates)
      .set({ nameStatus: 'awaiting', nameRequestedAt: now, nameRemindedAt: null, nameDeclinedReason: null, proposedName: null })
      .where(and(eq(examCertificates.examId, exam.id), eq(examCertificates.status, 'issued'), isNull(examCertificates.nameStatus)))
      .returning({ id: examCertificates.id });
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificate_names_asked',
      targetType: 'exam',
      targetId: exam.id,
      after: { asked: marked.length },
      ip,
    });
    if (marked.length) await this.certificates.enqueueNameNotices(exam.id, now);
    return { asked: marked.length };
  }

  /** POST /admin/exam-certificates/:id/name/approve — the name the member asked for is printed. */
  async approveName(ctx: AuthContext, id: string, ip?: string): Promise<AdminExamCertificate> {
    const row = await this.row(id);
    if (row.nameStatus !== 'review' || !row.proposedName) throw Errors.conflict('There’s no name waiting for approval');
    const settled = await this.certificates.settleName(row.id, row.proposedName, 'review');
    if (!settled) throw Errors.conflict('There’s no name waiting for approval');
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificate_name_approved',
      targetType: 'exam_certificate',
      targetId: row.id,
      before: { certificateName: row.certificateName },
      after: { certificateName: settled.certificateName },
      ip,
    });
    await this.certificates.proceed(settled);
    return this.item(await this.exam(row.examId), row.id);
  }

  /** POST /admin/exam-certificates/:id/name/decline — the member is asked to confirm their name again, with the reason. */
  async declineName(ctx: AuthContext, id: string, input: DeclineCertificateNameInput, ip?: string): Promise<AdminExamCertificate> {
    const row = await this.row(id);
    if (row.nameStatus !== 'review') throw Errors.conflict('There’s no name waiting for approval');
    const reason = input.reason?.trim() || null;
    const now = new Date();
    const [declined] = await this.db
      .update(examCertificates)
      .set({ nameStatus: 'awaiting', proposedName: null, nameDeclinedReason: reason, nameRequestedAt: now, nameRemindedAt: null })
      .where(and(eq(examCertificates.id, row.id), eq(examCertificates.nameStatus, 'review')))
      .returning({ id: examCertificates.id });
    if (!declined) throw Errors.conflict('There’s no name waiting for approval');
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificate_name_declined',
      targetType: 'exam_certificate',
      targetId: row.id,
      before: { proposedName: row.proposedName },
      after: { reason },
      ip,
    });
    await this.certificates.enqueueNameNotice(row.id, 'declined', now);
    return this.item(await this.exam(row.examId), row.id);
  }

  /** POST /admin/exams/:id/certificates/reissue — replace the outdated (or all) issued certificates, spread out. */
  async reissueMany(ctx: AuthContext, examId: string, input: ReissueExamCertificatesInput, ip?: string): Promise<ReissueExamCertificatesResult> {
    const exam = await this.exam(examId);
    if (!exam.certificate) throw Errors.conflict('This exam has no certificate settings');
    const picked = await this.db
      .select({ id: examCertificates.id })
      .from(examCertificates)
      .innerJoin(users, eq(users.id, examCertificates.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, examCertificates.userId))
      .where(
        and(
          eq(examCertificates.examId, exam.id),
          eq(examCertificates.status, 'issued'),
          sql`not ${replacing}`,
          input.scope === 'outdated' ? outdatedSql(exam.certificate) : undefined,
        ),
      )
      .orderBy(sortAt, examCertificates.id);
    let queued: { id: string; at: Date }[] = [];
    if (picked.length) {
      // Each one's first try is spaced out (the sweep keeps to it too). Tests run queues inline: no spacing.
      const spacing = this.queue.inline ? 0 : REISSUE_SPACING_MS;
      const ids = `{${picked.map((p) => p.id).join(',')}}`;
      const now = new Date();
      const marked = await this.db
        .update(examCertificates)
        .set({
          replaceRequestedAt: now,
          replaceTries: 0,
          replaceNextTryAt: sql`${now.toISOString()}::timestamptz + (array_position(${ids}::uuid[], ${examCertificates.id}) - 1) * ${spacing}::int * interval '1 millisecond'`,
          replaceError: null,
        })
        .where(and(sql`${examCertificates.id} = any(${ids}::uuid[])`, eq(examCertificates.status, 'issued'), sql`not ${replacing}`))
        .returning({ id: examCertificates.id, at: examCertificates.replaceNextTryAt });
      queued = marked.map((m) => ({ id: m.id, at: m.at ?? now })).sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'exam.certificates_reissued',
      targetType: 'exam',
      targetId: exam.id,
      after: { scope: input.scope, queued: queued.length },
      ip,
    });
    for (const q of queued) {
      const wait = q.at.getTime() - Date.now();
      await this.certificates.enqueueReplacement(q.id, wait > 0 ? wait + 1000 : 0);
    }
    return { queued: queued.length };
  }

  /* ---------- internals ---------- */

  private async row(id: string): Promise<CertificateRow> {
    if (!isUuid(id)) throw Errors.notFound('Certificate');
    const [row] = await this.db.select().from(examCertificates).where(eq(examCertificates.id, id.toLowerCase())).limit(1);
    if (!row) throw Errors.notFound('Certificate');
    return row;
  }

  private async item(exam: ExamForCertificates, id: string): Promise<AdminExamCertificate> {
    const [item] = await this.rows(exam, eq(examCertificates.id, id), 1);
    return item!.item;
  }

  private async exam(id: string): Promise<ExamForCertificates> {
    if (!isUuid(id)) throw Errors.notFound('Exam');
    // The signer is the instructor's current name and signature (settings saved before instructors: the old keys).
    const [row] = await this.db
      .select({
        id: exams.id,
        certificate: exams.certificate,
        issuerName: sql<string | null>`coalesce(${examInstructors.name}, ${exams.certificate}->>'issuerName')`,
        signatureFileId: sql<string | null>`coalesce(${examInstructors.signatureFileId}::text, ${exams.certificate}->>'signatureFileId')`,
      })
      .from(exams)
      .leftJoin(examInstructors, instructorOfExam)
      .where(eq(exams.id, id.toLowerCase()))
      .limit(1);
    if (!row) throw Errors.notFound('Exam');
    const stored = storedCertificate(row.certificate);
    return {
      id: row.id,
      certificate:
        stored && row.issuerName && row.signatureFileId
          ? { title: stored.title, startDate: stored.startDate, endDate: stored.endDate, hours: stored.hours ?? null, issuerName: row.issuerName, signatureFileId: row.signatureFileId }
          : null,
    };
  }

  private async rows(exam: ExamForCertificates, where: SQL, limit: number): Promise<{ t: string; item: AdminExamCertificate }[]> {
    const d = exam.certificate ? differenceSql(exam.certificate) : null;
    const no = sql<boolean>`false`;
    const rows = await this.db
      .select({
        c: {
          id: examCertificates.id,
          userId: examCertificates.userId,
          status: examCertificates.status,
          externalId: examCertificates.externalId,
          request: examCertificates.request,
          imageFileId: examCertificates.imageFileId,
          pdfFileId: examCertificates.pdfFileId,
          issuedAt: examCertificates.issuedAt,
          lastError: examCertificates.lastError,
          replaceRequestedAt: examCertificates.replaceRequestedAt,
          replaceTries: examCertificates.replaceTries,
          replaceError: examCertificates.replaceError,
          replaceNextTryAt: examCertificates.replaceNextTryAt,
          certificateName: examCertificates.certificateName,
          nameStatus: examCertificates.nameStatus,
          proposedName: examCertificates.proposedName,
          nameDeclinedReason: examCertificates.nameDeclinedReason,
          nameRequestedAt: examCertificates.nameRequestedAt,
          nameRemindedAt: examCertificates.nameRemindedAt,
          createdAt: examCertificates.createdAt,
        },
        replacedCount: sql<number>`jsonb_array_length(${examCertificates.history})::int`,
        t: sortKey,
        email: users.email,
        name: memberProfiles.displayName,
        handle: memberProfiles.handle,
        avatarFileId: memberProfiles.avatarFileId,
        livePostId: posts.id,
        title: d?.title ?? no,
        issuer: d?.issuer ?? no,
        dates: d?.dates ?? no,
        hours: d?.hours ?? no,
        signature: d?.signature ?? no,
        name_: d?.name ?? no,
      })
      .from(examCertificates)
      .innerJoin(users, eq(users.id, examCertificates.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, examCertificates.userId))
      .leftJoin(posts, and(eq(posts.id, examCertificates.postId), isNull(posts.deletedAt)))
      .where(where)
      .orderBy(desc(sortAt), desc(examCertificates.id))
      .limit(limit);
    return rows.map((r) => {
      const req = r.c.request as Partial<CertificateRequest> | null;
      const flags: Record<ExamCertificateDifference, boolean> = { title: r.title, issuer: r.issuer, dates: r.dates, hours: r.hours, signature: r.signature, name: r.name_ };
      const differences = r.c.status === 'issued' && req && d ? DIFFERENCES.filter((k) => flags[k]) : [];
      return {
        t: r.t,
        item: {
          id: r.c.id,
          member: { id: r.c.userId, name: r.name ?? '', handle: r.handle ?? '', email: r.email, avatarUrl: mediaUrl(r.avatarFileId) },
          status: r.c.status as AdminExamCertificate['status'],
          certificateId: r.c.externalId,
          issuedWith: req
            ? {
                studentName: req.student_name ?? '',
                courseTitle: req.course_title ?? '',
                issuerName: req.instructor_name ?? '',
                startDate: req.start_from ?? '',
                endDate: req.start_end ?? '',
                hours: typeof req.exam_hours === 'number' ? req.exam_hours : null,
              }
            : null,
          differences,
          imageUrl: mediaUrl(r.c.imageFileId),
          downloadUrl: mediaUrl(r.c.pdfFileId),
          postId: r.livePostId,
          issuedAt: r.c.issuedAt?.toISOString() ?? null,
          replacement: r.c.replaceRequestedAt
            ? { requestedAt: r.c.replaceRequestedAt.toISOString(), tries: r.c.replaceTries, lastError: r.c.replaceError, gaveUp: !r.c.replaceNextTryAt }
            : null,
          replacedCount: r.replacedCount,
          lastError: r.c.lastError,
          certificateName: r.c.certificateName,
          nameCheck:
            r.c.nameStatus === 'awaiting' || r.c.nameStatus === 'review'
              ? {
                  status: r.c.nameStatus,
                  proposedName: r.c.nameStatus === 'review' ? r.c.proposedName : null,
                  requestedAt: (r.c.nameRequestedAt ?? r.c.createdAt).toISOString(),
                  remindedAt: r.c.nameRemindedAt?.toISOString() ?? null,
                  declinedReason: r.c.nameStatus === 'awaiting' ? r.c.nameDeclinedReason : null,
                }
              : null,
        },
      };
    });
  }

  private async summary(exam: ExamForCertificates): Promise<AdminExamCertificatesSummary> {
    const [row] = await this.db
      .select({
        issued: sql<number>`count(*) filter (where ${examCertificates.status} = 'issued')::int`,
        pending: sql<number>`count(*) filter (where ${pendingSql})::int`,
        failed: sql<number>`count(*) filter (where ${examCertificates.status} = 'failed')::int`,
        outdated: sql<number>`count(*) filter (where ${outdatedSql(exam.certificate)})::int`,
        replacing: sql<number>`count(*) filter (where ${examCertificates.status} = 'issued' and ${replacing})::int`,
        awaitingName: sql<number>`count(*) filter (where ${examCertificates.nameStatus} = 'awaiting')::int`,
        nameReview: sql<number>`count(*) filter (where ${examCertificates.nameStatus} = 'review')::int`,
      })
      .from(examCertificates)
      .innerJoin(users, eq(users.id, examCertificates.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, examCertificates.userId))
      .where(eq(examCertificates.examId, exam.id));
    return row ?? { issued: 0, pending: 0, failed: 0, outdated: 0, replacing: 0, awaitingName: 0, nameReview: 0 };
  }
}
