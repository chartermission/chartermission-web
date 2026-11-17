import { eq, sql } from 'drizzle-orm';
import type { ExamCertificateSettings, ExamCertificateSettingsView } from '@chartermission/contracts';
import type { Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { examInstructors, exams, files } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { env } from '../config/env.js';

/*
 * Instructors sign Charter Center certificates (migration 0029). An exam's certificate settings
 * name one (certificate.instructorId); what is printed is the instructor's name and signature as
 * they are when each certificate is sent. Settings saved before instructors existed carry the
 * signer directly (issuerName, signatureFileId): the migration gave each of those exams an
 * instructor and left the old keys in place, which are used only when no instructor is found.
 */

/** exams.certificate as stored: today's settings, possibly with the keys of settings saved before instructors. */
export type StoredExamCertificate = Omit<ExamCertificateSettings, 'instructorId'> & {
  instructorId?: string | null;
  /** Before instructors (migration 0029): the signer's name and signature, on the exam itself. */
  issuerName?: string;
  signatureFileId?: string;
};

/** What a certificate is built from: the exam's settings with its instructor's current name and signature. */
export type CertificateTerms = {
  title: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  issuerName: string;
  signatureFileId: string;
};

export type ResolvedExamCertificate = CertificateTerms & {
  hours: number | null;
  instructorId: string | null;
  instructor: { id: string; name: string; archived: boolean } | null;
  signatureMime: string | null;
  /** The signature upload passed the scan (it is served only then). */
  signatureClean: boolean;
};

/**
 * Public address of a certificate signature (GET /exam-signatures/{fileId}.{ext}): the
 * instructor_signature_url Charter Center is sent. Absolute, and served without signing in.
 */
export function signatureUrl(fileId: string, mime: string | null): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return `${env().API_PUBLIC_URL.replace(/\/$/, '')}/exam-signatures/${fileId}.${ext}`;
}

export const storedCertificate = (value: unknown): StoredExamCertificate | null => (value ? (value as StoredExamCertificate) : null);

/** The instructor an exam's certificate settings name (join condition; compared as text, so a bad id matches nothing). */
export const instructorOfExam = sql`${examInstructors.id}::text = (${exams.certificate}->>'instructorId')`;

/**
 * Exams whose certificate settings name the instructor (any status). The outer column is written
 * out in full: drizzle leaves the table name off columns of a query without joins.
 */
export const instructorExamCount = sql<number>`(select count(*)::int from ${exams} ie where ie.certificate->>'instructorId' = "exam_instructors"."id"::text)`;

/**
 * The exam's certificate settings with the signer resolved: its instructor's current name and
 * signature, or (settings saved before instructors) the ones stored on the exam. Null when there
 * are no settings, or nobody to sign them (an instructor that no longer exists and no old keys).
 */
export async function resolveCertificate(db: Db | Tx, value: unknown): Promise<ResolvedExamCertificate | null> {
  const stored = storedCertificate(value);
  if (!stored) return null;
  let instructor: ResolvedExamCertificate['instructor'] = null;
  let issuerName = stored.issuerName ?? null;
  let signatureFileId = stored.signatureFileId ?? null;
  if (stored.instructorId) {
    const [row] = await db
      .select({ id: examInstructors.id, name: examInstructors.name, signatureFileId: examInstructors.signatureFileId, archivedAt: examInstructors.archivedAt })
      .from(examInstructors)
      .where(sql`${examInstructors.id}::text = ${stored.instructorId}`)
      .limit(1);
    if (row) {
      instructor = { id: row.id, name: row.name, archived: !!row.archivedAt };
      issuerName = row.name;
      signatureFileId = row.signatureFileId;
    }
  }
  if (!issuerName || !signatureFileId) return null;
  const [file] = await db.select({ mime: files.mime, scanStatus: files.scanStatus }).from(files).where(eq(files.id, signatureFileId)).limit(1);
  return {
    title: stored.title,
    startDate: stored.startDate,
    endDate: stored.endDate,
    hours: stored.hours ?? null,
    instructorId: instructor?.id ?? null,
    instructor,
    issuerName,
    signatureFileId,
    signatureMime: file?.mime ?? null,
    signatureClean: file?.scanStatus === 'clean',
  };
}

/** The settings as the console shows them (signer resolved); falls back to the stored keys when nobody can sign. */
export function certificateSettingsView(value: unknown, resolved: ResolvedExamCertificate | null): ExamCertificateSettingsView | null {
  const stored = storedCertificate(value);
  if (!stored) return null;
  const url = resolved?.signatureClean ? signatureUrl(resolved.signatureFileId, resolved.signatureMime) : null;
  return {
    title: stored.title,
    instructorId: resolved?.instructorId ?? stored.instructorId ?? null,
    instructor: resolved?.instructor ? { ...resolved.instructor, signatureUrl: url } : null,
    issuerName: resolved?.issuerName ?? stored.issuerName ?? '',
    signatureFileId: resolved?.signatureFileId ?? stored.signatureFileId ?? null,
    signatureUrl: url,
    startDate: stored.startDate,
    endDate: stored.endDate,
    hours: stored.hours ?? null,
  };
}

/**
 * A certificate signature uploaded in the console (purpose certificate_signature, checked clean).
 * Marked attached so it is kept; it is served publicly from GET /exam-signatures/{id}.
 */
export async function useSignatureFile(db: Db | Tx, fileId: string, field = 'signatureFileId'): Promise<void> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId.toLowerCase())).limit(1);
  if (!file || file.purpose !== 'certificate_signature') throw Errors.validation({ [field]: 'Upload the instructor’s signature again' });
  if (file.scanStatus !== 'clean') throw Errors.validation({ [field]: 'The signature is still being checked. Try again in a moment.' });
  if (!file.attachedAt) await db.update(files).set({ attachedAt: new Date() }).where(eq(files.id, file.id));
}
