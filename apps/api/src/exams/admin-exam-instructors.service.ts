import { Injectable } from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  ExamInstructor,
  ExamInstructorInput,
  ExamInstructorList,
  ExamInstructorSaved,
  ExamInstructorsQuery,
  Ok,
  UpdateExamInstructorInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { examInstructors, files } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { isUuid } from '../media/uuid-param.js';
import { instructorExamCount, signatureUrl, useSignatureFile } from './exam-instructors.js';

type InstructorRow = typeof examInstructors.$inferSelect;

/**
 * Admin console: the instructors who sign Charter Center certificates, reused across exams.
 * Editing one changes what every exam using it sends from then on; certificates already issued
 * then show as outdated on each exam's Certificates tab, where they can be replaced.
 */
@Injectable()
export class AdminExamInstructorsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** GET /admin/exam-instructors — active first, then by name. */
  async list(q: ExamInstructorsQuery): Promise<ExamInstructorList> {
    const rows = await this.select(q.includeArchived ? undefined : isNull(examInstructors.archivedAt));
    return { items: rows };
  }

  /** POST /admin/exam-instructors */
  async create(ctx: AuthContext, input: ExamInstructorInput, ip?: string): Promise<ExamInstructor> {
    const id = await this.db.transaction(async (tx) => {
      await useSignatureFile(tx, input.signatureFileId);
      const [row] = (await tx
        .insert(examInstructors)
        .values({ name: input.name, signatureFileId: input.signatureFileId, createdBy: ctx.user.id })
        .returning()) as [InstructorRow];
      await this.audit.record(
        { actorId: ctx.user.id, action: 'exam.instructor_created', targetType: 'exam_instructor', targetId: row.id, after: { name: row.name, signatureFileId: row.signatureFileId }, ip },
        tx,
      );
      return row.id;
    });
    return this.one(id);
  }

  /**
   * PATCH /admin/exam-instructors/:id — the name and/or signature. Every exam using the instructor
   * sends the new ones from now on (affectedExams); their issued certificates become outdated.
   */
  async update(ctx: AuthContext, rawId: string, input: UpdateExamInstructorInput, ip?: string): Promise<ExamInstructorSaved> {
    const id = this.uuid(rawId);
    const changed = await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(examInstructors).where(eq(examInstructors.id, id)).for('update').limit(1);
      if (!before) throw Errors.notFound('That instructor');
      const patch: Partial<typeof examInstructors.$inferInsert> = {};
      if (input.name !== undefined && input.name !== before.name) patch.name = input.name;
      if (input.signatureFileId !== undefined && input.signatureFileId !== before.signatureFileId) {
        await useSignatureFile(tx, input.signatureFileId);
        patch.signatureFileId = input.signatureFileId;
      }
      if (!Object.keys(patch).length) return false;
      await tx.update(examInstructors).set(patch).where(eq(examInstructors.id, id));
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'exam.instructor_updated',
          targetType: 'exam_instructor',
          targetId: id,
          before: Object.fromEntries(keys.map((k) => [k, before[k as keyof InstructorRow]])),
          after: patch,
          ip,
        },
        tx,
      );
      return true;
    });
    const view = await this.one(id);
    return { ...view, affectedExams: changed ? view.examCount : 0 };
  }

  /** POST /admin/exam-instructors/:id/archive — hidden from the instructor picker; exams using it keep it. */
  async archive(ctx: AuthContext, rawId: string, ip?: string): Promise<ExamInstructor> {
    return this.setArchived(ctx, rawId, true, ip);
  }

  /** POST /admin/exam-instructors/:id/restore */
  async restore(ctx: AuthContext, rawId: string, ip?: string): Promise<ExamInstructor> {
    return this.setArchived(ctx, rawId, false, ip);
  }

  /** DELETE /admin/exam-instructors/:id — only one no exam uses; the rest are archived. */
  async remove(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = this.uuid(rawId);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ name: examInstructors.name, signatureFileId: examInstructors.signatureFileId })
        .from(examInstructors)
        .where(eq(examInstructors.id, id))
        .for('update')
        .limit(1);
      if (!row) throw Errors.notFound('That instructor');
      // Exams saving this instructor take a share lock on it (AdminExamsService.assertInstructor), so none slips in now.
      const [{ examCount }] = (await tx.select({ examCount: instructorExamCount }).from(examInstructors).where(eq(examInstructors.id, id))) as [{ examCount: number }];
      if (examCount > 0)
        throw Errors.conflict(
          examCount === 1
            ? 'An exam uses this instructor. Choose another instructor for it, or archive this one instead.'
            : `${examCount} exams use this instructor. Choose another instructor for them, or archive this one instead.`,
        );
      await tx.delete(examInstructors).where(eq(examInstructors.id, id));
      await this.audit.record(
        { actorId: ctx.user.id, action: 'exam.instructor_deleted', targetType: 'exam_instructor', targetId: id, before: { name: row.name, signatureFileId: row.signatureFileId }, ip },
        tx,
      );
    });
    return { ok: true };
  }

  /* ---------- internals ---------- */

  private async setArchived(ctx: AuthContext, rawId: string, archived: boolean, ip?: string): Promise<ExamInstructor> {
    const id = this.uuid(rawId);
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(examInstructors).where(eq(examInstructors.id, id)).for('update').limit(1);
      if (!before) throw Errors.notFound('That instructor');
      if (!!before.archivedAt === archived) return;
      await tx
        .update(examInstructors)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(examInstructors.id, id));
      await this.audit.record(
        { actorId: ctx.user.id, action: archived ? 'exam.instructor_archived' : 'exam.instructor_restored', targetType: 'exam_instructor', targetId: id, after: { name: before.name }, ip },
        tx,
      );
    });
    return this.one(id);
  }

  private async one(id: string, db: Db | Tx = this.db): Promise<ExamInstructor> {
    const [row] = await this.select(eq(examInstructors.id, id), db);
    if (!row) throw Errors.notFound('That instructor');
    return row;
  }

  private async select(where: ReturnType<typeof eq> | undefined, db: Db | Tx = this.db): Promise<ExamInstructor[]> {
    const rows = await db
      .select({
        row: examInstructors,
        examCount: instructorExamCount,
        mime: files.mime,
        scanStatus: files.scanStatus,
      })
      .from(examInstructors)
      .leftJoin(files, eq(files.id, examInstructors.signatureFileId))
      .where(where)
      .orderBy(sql`(${examInstructors.archivedAt} is not null) asc`, asc(sql`lower(${examInstructors.name})`), asc(examInstructors.createdAt));
    return rows.map((r) => ({
      id: r.row.id,
      name: r.row.name,
      signatureFileId: r.row.signatureFileId,
      signatureUrl: r.scanStatus === 'clean' ? signatureUrl(r.row.signatureFileId, r.mime) : null,
      archived: !!r.row.archivedAt,
      examCount: r.examCount,
      createdAt: r.row.createdAt.toISOString(),
    }));
  }

  private uuid(value: string): string {
    if (!isUuid(value)) throw Errors.notFound('That instructor');
    return value.toLowerCase();
  }
}
