import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { ExamCertificateView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { courses, examCertificates, exams, pages, posts, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
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
import { CHARTER_CENTER_EXAMS_CLIENT, type CharterCenterExamsClient } from './charter-center-exams.client.js';

export type CertificateRow = typeof examCertificates.$inferSelect;

export const CERTIFICATE_JOB = 'exam-certificate';
const SWEEP_JOB = 'exam-certificates-sweep';
/** Waits before asking Charter Center again; after the last one the certificate is marked failed (about two days in all). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000];
/** A run that crashed half-way is picked up again by the sweep after this long. */
const CLAIM_MS = 10 * 60_000;
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PDF_MAX_BYTES = 10 * 1024 * 1024;

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
 * Charter Center certificates for exams that name a course. When a member passes, we ask Charter
 * Center for their certificate (their email and the course id). Until it has one we keep asking
 * (RETRY_DELAYS_MS). Once it arrives, the image and PDF are stored here and, when the exam shares
 * certificates, posted as a celebration by the member that every member sees, linked to Charter
 * Center's page.
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
      if (name === SWEEP_JOB) await this.sweep();
    });
    void this.queue.every('maintenance', SWEEP_JOB, 15 * 60_000).catch((err: unknown) => this.logger.warn(`Could not schedule the certificate sweep: ${String(err)}`));
  }

  /** After a passing attempt is marked: one certificate per member and exam. */
  async onPassed(examId: string, userId: string, attemptId: string): Promise<void> {
    const [exam] = await this.db.select({ courseId: exams.charterCenterCourseId }).from(exams).where(eq(exams.id, examId)).limit(1);
    if (!exam?.courseId) return;
    const [row] = await this.db
      .insert(examCertificates)
      .values({ examId, userId, attemptId, courseId: exam.courseId, status: 'pending', nextTryAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: examCertificates.id });
    if (row) await this.enqueue(row.id);
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
    const [user] = await this.db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status === 'deleted') {
      await this.db.update(examCertificates).set({ status: 'failed', lastError: 'The member’s account is gone' }).where(eq(examCertificates.id, row.id));
      return;
    }

    try {
      if (!row.imageFileId) {
        const cert = await this.charterCenter.certificate(user.email.toLowerCase(), row.courseId);
        if (!cert) return await this.later(row, 'Charter Center has no certificate for this member and course yet');
        const image = await this.charterCenter.download(cert.imageUrl, IMAGE_MAX_BYTES);
        const pdf = await this.charterCenter.download(cert.pdfUrl, PDF_MAX_BYTES);
        // Large PNG scans become a sharp JPEG that fits the post image limit.
        const picture = await sharp(image.data, { failOn: 'error', limitInputPixels: 80_000_000 })
          .rotate()
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        const imageFile = await this.media.ingest(row.userId, 'post_image', picture, 'certificate.jpg');
        const pdfFile = await this.media.ingest(row.userId, 'post_document', pdf.data, `certificate-${cert.certificateId}.pdf`, { attached: true });
        await this.db
          .update(examCertificates)
          .set({ status: 'issued', externalId: cert.certificateId, imageFileId: imageFile.id, pdfFileId: pdfFile.id, issuedAt: new Date(), lastError: null, nextTryAt: null })
          .where(eq(examCertificates.id, row.id));
        Object.assign(row, { status: 'issued', externalId: cert.certificateId, imageFileId: imageFile.id, pdfFileId: pdfFile.id });
        this.analytics.track('exam_certificate_issued', row.userId, null, row.examId);
        await this.notify(row);
      } else {
        await this.db.update(examCertificates).set({ status: 'issued', nextTryAt: null }).where(eq(examCertificates.id, row.id));
      }
      await this.share(row);
    } catch (err) {
      this.logger.warn(`Certificate ${row.id}: ${String(err)}`);
      if (row.imageFileId) {
        // The certificate is stored; only sharing failed. Keep it issued and note why.
        await this.db.update(examCertificates).set({ status: 'issued', nextTryAt: null, lastError: `Not shared: ${errorText(err)}` }).where(eq(examCertificates.id, row.id));
        return;
      }
      await this.later(row, errorText(err));
    }
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
  private async share(row: CertificateRow) {
    if (row.postId && (await this.postAlive(row.postId))) return;
    if (row.postId) return; // The member deleted the post: don't post it again.
    const [exam] = await this.db.select().from(exams).where(eq(exams.id, row.examId)).limit(1);
    if (!exam?.shareCertificates || !row.imageFileId) return;
    const author = await this.sessions.userById(row.userId);
    if (!author) return;
    const [course] = await this.db.select({ title: courses.title }).from(courses).where(eq(courses.externalId, row.courseId)).limit(1);
    const subject = course?.title ?? exam.title;
    const page = await this.certificatePage();
    const post = await this.postsService.create(author, {
      type: 'celebration',
      body: `I passed “${exam.title}” on Charter Mission and earned my certificate from Charter Center. 🎓\n\n#CharterCenter`,
      attachmentIds: [row.imageFileId],
      altTexts: { [row.imageFileId]: `Charter Center certificate: ${subject}`.slice(0, 250) },
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
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 300);
}
