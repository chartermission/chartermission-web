import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { ExamCertificateDifference, ExamCertificateSettings, ExamCertificateView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import { examCertificates, exams, files, memberProfiles, pages, postAttachments, posts, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { env, isProd } from '../config/env.js';
import { SessionService } from '../core/session.service.js';
import { mediaUrl } from '../core/members.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { QueueService } from '../infra/queue.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { MediaService } from '../media/media.service.js';
import { PostsService } from '../posts/posts.service.js';
import { isUuid } from '../media/uuid-param.js';
import { CHARTER_CENTER_EXAMS_CLIENT, jpegToPdf, type CertificateRequest, type CharterCenterExamsClient } from './charter-center-exams.client.js';

export type CertificateRow = typeof examCertificates.$inferSelect;

export const CERTIFICATE_JOB = 'exam-certificate';
/** Replacing an issued certificate with a new one from Charter Center (see replace()). */
export const REPLACE_JOB = 'exam-certificate-replace';
const SWEEP_JOB = 'exam-certificates-sweep';
/** Waits before asking Charter Center again; after the last one the certificate is marked failed (about two days in all). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000];
/** With the sample (mock) Charter Center on the live site, certificates wait and are checked again this often. */
const MOCK_WAIT_MS = 3600_000;
/** A run that crashed half-way is picked up again by the sweep after this long. */
const CLAIM_MS = 10 * 60_000;
/** An exam without certificate settings: certificates already asked for wait, and are checked again this often. */
const NO_SETTINGS_WAIT_MS = 3600_000;
/** Replacements the sweep picks up at a time (the queue jobs do the rest). */
const REPLACE_SWEEP_BATCH = 100;

/** What a certificate is stored as once Charter Center has sent it. */
interface StoredCertificate {
  externalId: string | null;
  imageFileId: string | null;
  pdfFileId: string | null;
}

/** An old certificate kept in exam_certificates.history when a new one replaces it. */
export interface ReplacedCertificate {
  externalId: string | null;
  imageFileId: string | null;
  pdfFileId: string | null;
  request: Record<string, string> | null;
  issuedAt: string | null;
  replacedAt: string;
}

/**
 * How a request sent to Charter Center differs from what would be sent now: the exam's certificate
 * settings, and (when given) the member's current name. The signature is compared by its file, so
 * a change of the API's public address doesn't make every certificate look outdated.
 * Keep in step with the SQL in AdminExamCertificatesService.
 */
export function requestDifferences(request: CertificateRequest, settings: ExamCertificateSettings, studentName?: string | null): ExamCertificateDifference[] {
  const out: ExamCertificateDifference[] = [];
  if (request.course_title !== settings.title) out.push('title');
  if (request.instructor_name !== settings.issuerName) out.push('issuer');
  if (request.start_from !== settings.startDate || request.start_end !== settings.endDate) out.push('dates');
  if (!(request.instructor_signature_url ?? '').includes(settings.signatureFileId)) out.push('signature');
  if (studentName != null && request.student_name !== studentName) out.push('name');
  return out;
}

/**
 * Public address of an exam's certificate signature (GET /exam-signatures/{fileId}.{ext}): the
 * instructor_signature_url Charter Center is sent. Absolute, and served without signing in.
 */
export function signatureUrl(fileId: string, mime: string | null): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return `${env().API_PUBLIC_URL.replace(/\/$/, '')}/exam-signatures/${fileId}.${ext}`;
}

const run = promisify(execFile);

/** The first page of a PDF as a PNG (poppler's pdftoppm), or null when that isn't possible here. */
export async function renderFirstPage(pdf: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cert-'));
  try {
    await writeFile(path.join(dir, 'in.pdf'), pdf);
    await run('pdftoppm', ['-png', '-r', '144', '-f', '1', '-l', '1', '-singlefile', path.join(dir, 'in.pdf'), path.join(dir, 'page')], { timeout: 30_000 });
    return await readFile(path.join(dir, 'page.png'));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function certificateView(row: CertificateRow, postAlive: boolean): ExamCertificateView {
  return {
    id: row.id,
    status: row.status as ExamCertificateView['status'],
    certificateId: row.externalId,
    imageUrl: row.imageFileId ? mediaUrl(row.imageFileId) : null,
    downloadUrl: row.pdfFileId ? mediaUrl(row.pdfFileId) : null,
    postId: postAlive ? row.postId : null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
  };
}

/**
 * Charter Center certificates, for exams with certificate settings. When a member passes, we send
 * Charter Center their name with the exam's certificate settings (kept in exam_certificates.request;
 * if the exam's settings are corrected before the certificate arrives, the request is rebuilt with
 * them) and get the certificate back. Until it has one we keep asking (RETRY_DELAYS_MS). Once it arrives, the image and PDF are stored here and, when the exam
 * shares certificates, posted as a celebration by the member that every member sees, linked to
 * Charter Center's page.
 *
 * An issued certificate can be replaced (admin console, when the settings were wrong): see replace().
 *
 * On the live site (NODE_ENV=production) the sample Charter Center (CHARTER_CENTER_EXAMS_API=mock)
 * never issues anything: certificates wait as pending until the real API is switched on, so no
 * sample certificate is ever posted to the feed.
 */
@Injectable()
export class ExamCertificatesService implements OnModuleInit {
  private readonly logger = new Logger('ExamCertificates');

  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(CHARTER_CENTER_EXAMS_CLIENT) private readonly charterCenter: CharterCenterExamsClient,
    private readonly queue: QueueService,
    private readonly media: MediaService,
    private readonly postsService: PostsService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly analytics: AnalyticsService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name, data: { id?: string }) => {
      if (name === CERTIFICATE_JOB && data.id) await this.run(data.id);
      if (name === REPLACE_JOB && data.id) await this.replace(data.id);
      if (name === SWEEP_JOB) await this.sweep();
    });
    void this.queue.every('maintenance', SWEEP_JOB, 15 * 60_000).catch((err: unknown) => this.logger.warn(`Could not schedule the certificate sweep: ${String(err)}`));
  }

  /** After a passing attempt is marked: one certificate per member and exam, when the exam awards one. */
  async onPassed(examId: string, userId: string, attemptId: string): Promise<void> {
    const [exam] = await this.db.select({ certificate: exams.certificate }).from(exams).where(eq(exams.id, examId)).limit(1);
    if (!exam?.certificate) return;
    const request = await this.buildRequest(exam.certificate, userId);
    const [row] = await this.db
      .insert(examCertificates)
      .values({ examId, userId, attemptId, request: request ? { ...request } : null, status: 'pending', nextTryAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: examCertificates.id });
    if (row) await this.enqueue(row.id);
  }

  /** What Charter Center is sent: the member's name as on their profile, and the exam's certificate settings. */
  async buildRequest(settings: ExamCertificateSettings, userId: string): Promise<CertificateRequest | null> {
    const [member] = await this.db
      .select({ name: memberProfiles.displayName, email: users.email })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    const [signature] = await this.db.select({ mime: files.mime }).from(files).where(eq(files.id, settings.signatureFileId)).limit(1);
    if (!member) return null;
    return {
      student_name: member.name?.trim() || member.email.split('@')[0]!,
      course_title: settings.title,
      start_from: settings.startDate,
      start_end: settings.endDate,
      instructor_name: settings.issuerName,
      instructor_signature_url: signatureUrl(settings.signatureFileId, signature?.mime ?? null),
    };
  }

  /**
   * GET /exam-signatures/{fileId}.{ext} — a certificate signature, for Charter Center to fetch (no
   * sign-in). Only files uploaded as certificate signatures and saved on an exam.
   */
  async signatureFile(name: string): Promise<{ data: Buffer; mime: string }> {
    const id = /^([0-9a-f-]{36})(?:\.(?:png|jpe?g|webp))?$/i.exec(name)?.[1]?.toLowerCase();
    if (!id || !isUuid(id)) throw Errors.notFound('File');
    const [file] = await this.db.select().from(files).where(eq(files.id, id)).limit(1);
    if (!file || file.purpose !== 'certificate_signature' || file.scanStatus !== 'clean' || !file.attachedAt) throw Errors.notFound('File');
    const data = await this.media.storage.read(file.storageKey);
    if (!data) throw Errors.notFound('File');
    return { data, mime: file.mime };
  }

  /** The member's certificate for an exam, or null. */
  async forMember(examId: string, userId: string): Promise<ExamCertificateView | null> {
    const [row] = await this.db
      .select()
      .from(examCertificates)
      .where(and(eq(examCertificates.examId, examId), eq(examCertificates.userId, userId)))
      .limit(1);
    if (!row) return null;
    return certificateView(row, await this.postAlive(row.postId));
  }

  /**
   * POST /exams/{id}/certificate/post: the member shares their issued certificate on the feed (a
   * public post), whatever the exam's auto-share setting, and again if they deleted the first post.
   */
  async shareForMember(examId: string, viewer: AuthUser): Promise<ExamCertificateView> {
    const [row] = await this.db
      .select()
      .from(examCertificates)
      .where(and(eq(examCertificates.examId, examId), eq(examCertificates.userId, viewer.id)))
      .limit(1);
    if (!row || row.status !== 'issued') throw Errors.conflict('Your certificate isn’t ready yet.');
    if (!(row.imageFileId ?? row.pdfFileId)) throw Errors.conflict('Your certificate isn’t ready yet.');
    if (!(await this.postAlive(row.postId))) {
      // A deleted post keeps its files marked as attached (posts are soft-deleted): free the
      // certificate's own files so the new post can carry them.
      const own = [row.imageFileId, row.pdfFileId].filter((id): id is string => !!id);
      if (row.postId && own.length) await this.db.update(files).set({ attachedAt: null }).where(inArray(files.id, own));
      await this.share(row, { requested: true });
    }
    return this.forMember(examId, viewer.id) as Promise<ExamCertificateView>;
  }

  /** POST /admin/exam-certificates/:id/retry — ask again now (also brings a failed one back). */
  async retry(id: string): Promise<void> {
    if (!isUuid(id)) throw Errors.notFound('Certificate');
    const [row] = await this.db
      .update(examCertificates)
      .set({ status: 'pending', tries: 0, nextTryAt: new Date(), lastError: null })
      .where(and(eq(examCertificates.id, id.toLowerCase()), sql`(${examCertificates.status} <> 'issued' or ${examCertificates.postId} is null)`))
      .returning({ id: examCertificates.id, status: examCertificates.status });
    if (!row) throw Errors.conflict('This certificate is already issued and shared');
    await this.enqueue(row.id);
  }

  /** Certificates whose next try is due (also catches jobs lost from the queue). */
  async sweep(): Promise<void> {
    const due = await this.db
      .select({ id: examCertificates.id })
      .from(examCertificates)
      .where(and(eq(examCertificates.status, 'pending'), lte(examCertificates.nextTryAt, new Date())))
      .limit(200);
    for (const row of due) await this.run(row.id);
    const replacements = await this.db
      .select({ id: examCertificates.id })
      .from(examCertificates)
      .where(and(eq(examCertificates.status, 'issued'), isNotNull(examCertificates.replaceRequestedAt), lte(examCertificates.replaceNextTryAt, new Date())))
      .orderBy(examCertificates.replaceNextTryAt)
      .limit(REPLACE_SWEEP_BATCH);
    for (const row of replacements) await this.replace(row.id);
  }

  /** One try: ask Charter Center, store the files, share the post. Safe to call twice. */
  async run(id: string): Promise<void> {
    // Claim the row so a parallel run (queue + sweep) leaves it alone.
    const [row] = await this.db
      .update(examCertificates)
      .set({ nextTryAt: new Date(Date.now() + CLAIM_MS) })
      .where(and(eq(examCertificates.id, id), eq(examCertificates.status, 'pending'), or(isNull(examCertificates.nextTryAt), lte(examCertificates.nextTryAt, new Date()))))
      .returning();
    if (!row) return;
    const [user] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status === 'deleted') {
      await this.db.update(examCertificates).set({ status: 'failed', lastError: 'The member’s account is gone' }).where(eq(examCertificates.id, row.id));
      return;
    }
    const [exam] = await this.db.select({ certificate: exams.certificate }).from(exams).where(eq(exams.id, row.examId)).limit(1);
    if (!exam) return;
    // Asked for before the exam had certificate settings: wait for them (no try is used up).
    let request = row.request as unknown as CertificateRequest | null;
    if (!request && !row.imageFileId && !row.pdfFileId) {
      request = exam.certificate ? await this.buildRequest(exam.certificate, row.userId) : null;
      if (!request) {
        await this.db
          .update(examCertificates)
          .set({ nextTryAt: new Date(Date.now() + NO_SETTINGS_WAIT_MS), lastError: 'Waiting for the exam’s certificate settings (title, issuer, signature, dates)' })
          .where(eq(examCertificates.id, row.id));
        return;
      }
      await this.db.update(examCertificates).set({ request: { ...request } }).where(eq(examCertificates.id, row.id));
    } else if (request && !row.imageFileId && !row.pdfFileId && exam.certificate && requestDifferences(request, exam.certificate).length) {
      // Not issued yet, and the exam's certificate settings were changed since the member passed:
      // send the current ones, so it isn't issued with settings already corrected.
      const fresh = await this.buildRequest(exam.certificate, row.userId);
      if (fresh) {
        request = fresh;
        await this.db.update(examCertificates).set({ request: { ...request } }).where(eq(examCertificates.id, row.id));
      }
    }
    if (!row.imageFileId && !row.pdfFileId && this.charterCenter.mode === 'mock' && isProd()) {
      await this.db
        .update(examCertificates)
        .set({ nextTryAt: new Date(Date.now() + MOCK_WAIT_MS), lastError: 'Waiting for Charter Center’s certificate API (CHARTER_CENTER_EXAMS_API is not live yet)' })
        .where(eq(examCertificates.id, row.id));
      return;
    }

    try {
      if (!row.imageFileId && !row.pdfFileId) {
        const stored = await this.fetchAndStore(row.userId, request!);
        if (!stored) return await this.later(row, 'Charter Center has no certificate for this member yet');
        await this.db
          .update(examCertificates)
          .set({ status: 'issued', ...stored, issuedAt: new Date(), lastError: null, nextTryAt: null })
          .where(eq(examCertificates.id, row.id));
        Object.assign(row, { status: 'issued', ...stored });
        this.analytics.track('exam_certificate_issued', row.userId, null, row.examId);
        await this.notify(row);
      } else {
        await this.db.update(examCertificates).set({ status: 'issued', nextTryAt: null }).where(eq(examCertificates.id, row.id));
      }
      await this.share(row);
    } catch (err) {
      this.logger.warn(`Certificate ${row.id}: ${String(err)}`);
      if (row.imageFileId || row.pdfFileId) {
        // The certificate is stored; only sharing failed. Keep it issued and note why.
        await this.db.update(examCertificates).set({ status: 'issued', nextTryAt: null, lastError: `Not shared: ${errorText(err)}` }).where(eq(examCertificates.id, row.id));
        return;
      }
      await this.later(row, errorText(err));
    }
  }

  /**
   * Queues the replacement of an issued certificate (already marked with replace_requested_at and
   * a due replace_next_try_at). delayMs spreads many out, so Charter Center isn't asked all at once.
   */
  async enqueueReplacement(id: string, delayMs = 0): Promise<void> {
    await this.queue.add('maintenance', REPLACE_JOB, { id }, { delayMs: delayMs > 0 ? delayMs : undefined, jobId: `exam-certificate-replace-${id}-${Date.now()}` });
  }

  /**
   * One try at replacing an issued certificate: asks Charter Center for a new one built from the
   * exam's current certificate settings and the member's current name. Until it arrives the member
   * keeps the old one. When it does, it takes the old one's place everywhere: the certificate
   * (exam page, download, picture), and the post that shared it (its picture, headline and the old
   * title in its text). The old certificate is kept in history. Safe to call twice.
   */
  async replace(id: string): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .update(examCertificates)
      .set({ replaceNextTryAt: new Date(now.getTime() + CLAIM_MS) })
      .where(
        and(
          eq(examCertificates.id, id),
          eq(examCertificates.status, 'issued'),
          isNotNull(examCertificates.replaceRequestedAt),
          lte(examCertificates.replaceNextTryAt, now),
        ),
      )
      .returning();
    if (!row) return;
    const [user] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status === 'deleted') {
      await this.db.update(examCertificates).set({ replaceNextTryAt: null, replaceError: 'The member’s account is gone' }).where(eq(examCertificates.id, row.id));
      return;
    }
    const [exam] = await this.db.select({ certificate: exams.certificate }).from(exams).where(eq(exams.id, row.examId)).limit(1);
    if (!exam) return;
    const request = exam.certificate ? await this.buildRequest(exam.certificate, row.userId) : null;
    if (!request) {
      await this.db
        .update(examCertificates)
        .set({ replaceNextTryAt: new Date(Date.now() + NO_SETTINGS_WAIT_MS), replaceError: 'Waiting for the exam’s certificate settings (title, issuer, signature, dates)' })
        .where(eq(examCertificates.id, row.id));
      return;
    }
    // Never replace a real certificate with a sample one on the live site.
    if (this.charterCenter.mode === 'mock' && isProd()) {
      await this.db
        .update(examCertificates)
        .set({
          replaceNextTryAt: new Date(Date.now() + MOCK_WAIT_MS),
          replaceError: 'Waiting for Charter Center’s certificate API (CHARTER_CENTER_EXAMS_API is not live yet): sample certificates don’t replace real ones',
        })
        .where(eq(examCertificates.id, row.id));
      return;
    }

    let stored: StoredCertificate | null;
    try {
      stored = await this.fetchAndStore(row.userId, request);
    } catch (err) {
      this.logger.warn(`Certificate ${row.id} (replacement): ${String(err)}`);
      return await this.laterReplace(row, errorText(err));
    }
    if (!stored) return await this.laterReplace(row, 'Charter Center has no certificate for this member yet');

    const replacedAt = new Date();
    const old: ReplacedCertificate = {
      externalId: row.externalId,
      imageFileId: row.imageFileId,
      pdfFileId: row.pdfFileId,
      request: row.request,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      replacedAt: replacedAt.toISOString(),
    };
    try {
      const done = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(examCertificates)
          .set({
            ...stored,
            request: { ...request },
            issuedAt: replacedAt,
            history: sql`${examCertificates.history} || ${JSON.stringify([old])}::jsonb`,
            replaceRequestedAt: null,
            replaceTries: 0,
            replaceNextTryAt: null,
            replaceError: null,
            lastError: null,
          })
          .where(
            and(
              eq(examCertificates.id, row.id),
              eq(examCertificates.status, 'issued'),
              // Still the certificate this try started from.
              sql`${examCertificates.imageFileId} is not distinct from ${row.imageFileId}::uuid`,
              sql`${examCertificates.pdfFileId} is not distinct from ${row.pdfFileId}::uuid`,
            ),
          )
          .returning({ id: examCertificates.id });
        if (!updated) return false;
        if (row.postId) await this.replaceOnPost(tx, row.postId, old, stored, request);
        return true;
      });
      if (!done) return;
    } catch (err) {
      this.logger.warn(`Certificate ${row.id} (replacement): ${String(err)}`);
      return await this.laterReplace(row, errorText(err));
    }
    await this.notifyReplaced(row).catch((err: unknown) => this.logger.warn(`Certificate ${row.id}: replacement email not sent: ${String(err)}`));
  }

  /** The page certificate posts are linked to and listed on: the setting, else a page named Charter Center. */
  async certificatePage(): Promise<{ id: string; slug: string; name: string } | null> {
    const { pageId } = await this.settings.get('exam_certificates');
    const chosen = pageId
      ? await this.db.select({ id: pages.id, slug: pages.slug, name: pages.name }).from(pages).where(and(eq(pages.id, pageId), eq(pages.status, 'active'))).limit(1)
      : await this.db
          .select({ id: pages.id, slug: pages.slug, name: pages.name })
          .from(pages)
          .where(and(eq(pages.status, 'active'), or(inArray(sql`lower(${pages.slug})`, ['charter-center', 'chartercenter']), ilike(pages.name, 'charter center'))))
          .orderBy(sql`${pages.official} desc`, pages.createdAt)
          .limit(1);
    return chosen[0] ?? null;
  }

  /* ---------- internals ---------- */

  private async enqueue(id: string) {
    // Tests run queues inline: the try happens right away and retries wait for sweep().
    await this.queue.add('maintenance', CERTIFICATE_JOB, { id }, { jobId: `exam-certificate-${id}-${Date.now()}` });
  }

  /**
   * Asks Charter Center for the certificate and stores both a picture (for the page and the feed)
   * and a PDF (to download), whichever Charter Center sent. Null when it has none yet.
   * The picture is left unattached for the post that shares it; the PDF is attached to a post only
   * when there is no picture to show.
   */
  private async fetchAndStore(userId: string, request: CertificateRequest): Promise<StoredCertificate | null> {
    const cert = await this.charterCenter.certificate(request);
    if (!cert) return null;
    const image = cert.image ?? (cert.pdf ? await renderFirstPage(cert.pdf) : null);
    const picture = image
      ? await sharp(image, { failOn: 'error', limitInputPixels: 80_000_000 })
          .rotate()
          .flatten({ background: '#ffffff' })
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
      : null;
    const pdf = cert.pdf ?? (picture ? jpegToPdf(picture.data, picture.info.width, picture.info.height) : null);
    const name = `certificate${cert.certificateId ? `-${cert.certificateId.replace(/[^\w.-]+/g, '-')}` : ''}`;
    const imageFile = picture ? await this.media.ingest(userId, 'post_image', picture.data, `${name}.jpg`) : null;
    const pdfFile = pdf ? await this.media.ingest(userId, 'post_document', pdf, `${name}.pdf`, { attached: !!imageFile }) : null;
    return { externalId: cert.certificateId, imageFileId: imageFile?.id ?? null, pdfFileId: pdfFile?.id ?? null };
  }

  /**
   * The certificate post, when it is still there: the new certificate's files take the old ones'
   * places (same position), the "Certification" headline and the text get the new course title
   * (only where the old title appears as it was). A post the member deleted is left alone.
   */
  private async replaceOnPost(tx: Tx, postId: string, old: ReplacedCertificate, next: StoredCertificate, request: CertificateRequest) {
    const [post] = await tx
      .select({ id: posts.id, body: posts.body, type: posts.type, details: posts.details, deletedAt: posts.deletedAt })
      .from(posts)
      .where(eq(posts.id, postId))
      .for('update')
      .limit(1);
    if (!post || post.deletedAt) return;
    const oldFiles = [old.imageFileId, old.pdfFileId].filter((f): f is string => !!f);
    const attached = oldFiles.length
      ? await tx
          .select()
          .from(postAttachments)
          .where(and(eq(postAttachments.postId, post.id), inArray(postAttachments.fileId, oldFiles)))
      : [];
    const alt = `Charter Center certificate: ${request.course_title}`.slice(0, 250);
    const swaps: (typeof postAttachments.$inferInsert)[] = [];
    for (const a of attached) {
      const fileId = a.fileId === old.imageFileId ? (next.imageFileId ?? next.pdfFileId) : (next.pdfFileId ?? next.imageFileId);
      if (!fileId || swaps.some((x) => x.fileId === fileId)) continue;
      const image = fileId === next.imageFileId;
      swaps.push({ postId: post.id, fileId, kind: image ? 'image' : 'document', position: a.position, alt: image ? alt : null });
    }
    if (attached.length) {
      await tx.delete(postAttachments).where(and(eq(postAttachments.postId, post.id), inArray(postAttachments.fileId, attached.map((a) => a.fileId))));
    }
    if (swaps.length) {
      await tx.insert(postAttachments).values(swaps);
      await tx
        .update(files)
        .set({ attachedAt: new Date() })
        .where(and(inArray(files.id, swaps.map((x) => x.fileId)), isNull(files.attachedAt)));
    }

    const oldTitle = old.request?.course_title ?? '';
    const newTitle = request.course_title;
    const retitle = (text: string) => (oldTitle && oldTitle !== newTitle && text.includes(oldTitle) ? text.split(oldTitle).join(newTitle) : text);
    const patch: Partial<typeof posts.$inferInsert> = {};
    const body = retitle(post.body);
    if (body !== post.body) patch.body = body;
    const details = post.details as { headline?: unknown } | null;
    if (post.type === 'celebration' && details && typeof details.headline === 'string') {
      // The headline was the old title (clipped to 120 when posted): it becomes the new one.
      const headline = details.headline === oldTitle.slice(0, 120) ? newTitle : retitle(details.headline);
      if (headline.slice(0, 120) !== details.headline) patch.details = { ...details, headline: headline.slice(0, 120) };
    }
    if (Object.keys(patch).length) await tx.update(posts).set(patch).where(eq(posts.id, post.id));
  }

  /** A replacement that didn't come: try again later, or stop after the last delay (the admin can ask again). */
  private async laterReplace(row: CertificateRow, reason: string) {
    const tries = row.replaceTries + 1;
    const delay = RETRY_DELAYS_MS[tries - 1];
    if (delay === undefined) {
      await this.db.update(examCertificates).set({ replaceTries: tries, replaceNextTryAt: null, replaceError: reason }).where(eq(examCertificates.id, row.id));
      return;
    }
    await this.db
      .update(examCertificates)
      .set({ replaceTries: tries, replaceNextTryAt: new Date(Date.now() + delay), replaceError: reason })
      .where(eq(examCertificates.id, row.id));
    if (!this.queue.inline) await this.queue.add('maintenance', REPLACE_JOB, { id: row.id }, { delayMs: delay + 1000, jobId: `exam-certificate-replace-${row.id}-${tries}` });
  }

  /** Not there yet, or Charter Center didn't answer: try again later, or give up after the last delay. */
  private async later(row: CertificateRow, reason: string) {
    const tries = row.tries + 1;
    const delay = RETRY_DELAYS_MS[tries - 1];
    if (delay === undefined) {
      await this.db.update(examCertificates).set({ status: 'failed', tries, nextTryAt: null, lastError: reason }).where(eq(examCertificates.id, row.id));
      return;
    }
    await this.db
      .update(examCertificates)
      .set({ tries, nextTryAt: new Date(Date.now() + delay), lastError: reason })
      .where(eq(examCertificates.id, row.id));
    if (!this.queue.inline) await this.queue.add('maintenance', CERTIFICATE_JOB, { id: row.id }, { delayMs: delay + 1000, jobId: `exam-certificate-${row.id}-${tries}` });
  }

  /** Posts the certificate as the member: a "Certification" celebration everyone sees, linked to Charter Center's page. */
  private async share(row: CertificateRow, opts: { requested?: boolean } = {}) {
    if (row.postId && (await this.postAlive(row.postId))) return;
    // The member deleted the automatic post: only post it again when they ask (shareForMember).
    if (row.postId && !opts.requested) return;
    const [exam] = await this.db.select().from(exams).where(eq(exams.id, row.examId)).limit(1);
    const attachment = row.imageFileId ?? row.pdfFileId;
    if (!exam || !attachment) return;
    if (!exam.shareCertificates && !opts.requested) return;
    const author = await this.sessions.userById(row.userId);
    if (!author) return;
    const subject = (row.request as unknown as CertificateRequest | null)?.course_title || exam.certificate?.title || exam.title;
    const page = await this.certificatePage();
    const post = await this.postsService.create(author, {
      type: 'celebration',
      body: `I passed “${exam.title}” on Charter Mission and earned my certificate from Charter Center. 🎓\n\n#CharterCenter`,
      attachmentIds: [attachment],
      altTexts: row.imageFileId ? { [row.imageFileId]: `Charter Center certificate: ${subject}`.slice(0, 250) } : {},
      visibility: 'public',
      kind: 'standard',
      celebration: { category: 'certification', headline: subject.slice(0, 120), organisation: page?.name ?? 'Charter Center' },
    });
    await this.db.update(posts).set({ broadcast: true, aboutPageId: page?.id ?? null }).where(eq(posts.id, post.id));
    await this.db.update(examCertificates).set({ postId: post.id }).where(eq(examCertificates.id, row.id));
  }

  private async postAlive(postId: string | null): Promise<boolean> {
    if (!postId) return false;
    const [p] = await this.db.select({ deletedAt: posts.deletedAt }).from(posts).where(eq(posts.id, postId)).limit(1);
    return !!p && !p.deletedAt;
  }

  private async notify(row: CertificateRow) {
    const [exam] = await this.db.select({ title: exams.title, slug: exams.slug }).from(exams).where(eq(exams.id, row.examId)).limit(1);
    const [user] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!exam || !user) return;
    await this.mail.compose({
      to: user.email,
      userId: row.userId,
      template: 'exam.certificate_ready',
      subject: 'Your Charter Center certificate is ready',
      heading: 'Your certificate is ready',
      paragraphs: [`Congratulations on passing “${exam.title}”. Your certificate from Charter Center is on Charter Mission now: download it, and see it on your profile.`],
      button: { label: 'See my certificate', url: webUrl(`/exams/${exam.slug}`) },
      transactional: true,
    });
  }

  private async notifyReplaced(row: CertificateRow) {
    const [exam] = await this.db.select({ title: exams.title, slug: exams.slug }).from(exams).where(eq(exams.id, row.examId)).limit(1);
    const [user] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!exam || !user) return;
    await this.mail.compose({
      to: user.email,
      userId: row.userId,
      template: 'exam.certificate_replaced',
      subject: 'Your Charter Center certificate was updated',
      heading: 'Your certificate was updated',
      paragraphs: [
        `The details on your Charter Center certificate for “${exam.title}” were corrected, and Charter Center issued you a new one.`,
        'It replaces the old certificate on Charter Mission, including in the post that shared it. If you downloaded the old one, download the new one.',
      ],
      button: { label: 'See my certificate', url: webUrl(`/exams/${exam.slug}`) },
      transactional: true,
    });
  }
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 300);
}
