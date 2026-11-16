import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminExamCertificate,
  AdminExamCertificatesPage,
  AdminExamCertificatesQuery,
  AdminExamCertificatesSummary,
  ExamCertificateDifference,
  ExamCertificateSettings,
  ReissueExamCertificatesInput,
  ReissueExamCertificatesResult,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { examCertificates, exams, memberProfiles, posts, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { likeContains } from '../learning/courses.service.js';
import { isUuid } from '../media/uuid-param.js';
import { ExamCertificatesService } from './exam-certificates.service.js';

/** Replacements asked for together are spread out by this much each (a few a second). */
const REISSUE_SPACING_MS = 350;

const DIFFERENCES: ExamCertificateDifference[] = ['title', 'issuer', 'dates', 'signature', 'name'];

/** The newest-first sort key of a certificate: when it was issued, else when it was asked for. */
const sortAt = sql`coalesce(${examCertificates.issuedAt}, ${examCertificates.createdAt})`;
const sortKey = sql<string>`to_char(${sortAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The member's name as buildRequest sends it: their profile name, else the start of their email address. */
const currentName = sql`coalesce(nullif(btrim(${memberProfiles.displayName}), ''), split_part(${users.email}, '@', 1))`;

/** A replacement is on its way (asked for, and not given up). */
const replacing = sql`(${examCertificates.replaceRequestedAt} is not null and ${examCertificates.replaceNextTryAt} is not null)`;

/**
 * How each certificate differs from what would be sent to Charter Center now (the exam's current
 * certificate settings and the member's current name), as SQL over exam_certificates.request.
 * Same rules as requestDifferences() in exam-certificates.service.ts. Only meaningful for issued
 * certificates with a request; see `outdated`.
 */
function differenceSql(settings: ExamCertificateSettings): Record<ExamCertificateDifference, SQL<boolean>> {
  const r = examCertificates.request;
  return {
    title: sql<boolean>`((${r}->>'course_title') is distinct from ${settings.title}::text)`,
    issuer: sql<boolean>`((${r}->>'instructor_name') is distinct from ${settings.issuerName}::text)`,
    dates: sql<boolean>`((${r}->>'start_from') is distinct from ${settings.startDate}::text or (${r}->>'start_end') is distinct from ${settings.endDate}::text)`,
    signature: sql<boolean>`(strpos(coalesce(${r}->>'instructor_signature_url', ''), ${settings.signatureFileId}::text) = 0)`,
    name: sql<boolean>`((${r}->>'student_name') is distinct from ${currentName})`,
  };
}

/** Issued certificates that differ from what would be issued now (needs users and member_profiles joined). */
function outdatedSql(settings: ExamCertificateSettings | null): SQL {
  if (!settings) return sql`false`;
  const d = differenceSql(settings);
  return sql`(${examCertificates.status} = 'issued' and ${examCertificates.request} is not null and (${sql.join(
    DIFFERENCES.map((k) => d[k]),
    sql` or `,
  )}))`;
}

type ExamForCertificates = { id: string; certificate: ExamCertificateSettings | null };

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
    if (q.status !== 'all') filters.push(eq(examCertificates.status, q.status));
    if (q.outdated) filters.push(outdatedSql(exam.certificate));
    if (q.q) {
      const pat = likeContains(q.q);
      filters.push(
        or(
          ilike(memberProfiles.displayName, pat),
          ilike(memberProfiles.handle, likeContains(q.q.replace(/^@/, ''))),
          ilike(users.email, pat),
          ilike(examCertificates.externalId, pat),
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
    const now = new Date();
    const [marked] = await this.db
      .update(examCertificates)
      .set({ replaceRequestedAt: now, replaceTries: 0, replaceNextTryAt: now, replaceError: null })
      .where(and(eq(examCertificates.id, row.id), eq(examCertificates.status, 'issued'), sql`not ${replacing}`))
      .returning({ id: examCertificates.id });
    if (!marked) throw Errors.conflict('A new certificate is already on its way');
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
    const [item] = await this.rows(exam, eq(examCertificates.id, row.id), 1);
    return item!.item;
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

  private async exam(id: string): Promise<ExamForCertificates> {
    if (!isUuid(id)) throw Errors.notFound('Exam');
    const [row] = await this.db.select({ id: exams.id, certificate: exams.certificate }).from(exams).where(eq(exams.id, id.toLowerCase())).limit(1);
    if (!row) throw Errors.notFound('Exam');
    return row;
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
      const req = r.c.request;
      const flags: Record<ExamCertificateDifference, boolean> = { title: r.title, issuer: r.issuer, dates: r.dates, signature: r.signature, name: r.name_ };
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
        },
      };
    });
  }

  private async summary(exam: ExamForCertificates): Promise<AdminExamCertificatesSummary> {
    const [row] = await this.db
      .select({
        issued: sql<number>`count(*) filter (where ${examCertificates.status} = 'issued')::int`,
        pending: sql<number>`count(*) filter (where ${examCertificates.status} = 'pending')::int`,
        failed: sql<number>`count(*) filter (where ${examCertificates.status} = 'failed')::int`,
        outdated: sql<number>`count(*) filter (where ${outdatedSql(exam.certificate)})::int`,
        replacing: sql<number>`count(*) filter (where ${examCertificates.status} = 'issued' and ${replacing})::int`,
      })
      .from(examCertificates)
      .innerJoin(users, eq(users.id, examCertificates.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, examCertificates.userId))
      .where(eq(examCertificates.examId, exam.id));
    return row ?? { issued: 0, pending: 0, failed: 0, outdated: 0, replacing: 0 };
  }
}
