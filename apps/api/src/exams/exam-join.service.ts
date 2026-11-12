import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_FIELD_VISIBILITY,
  type ExamJoinCompleted,
  type ExamJoinInfo,
  type ExamJoinStarted,
  type ExamJoinVerified,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { consentRecords, exams, memberProfiles, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { hashIp, sha256 } from '../common/crypto.js';
import { clientIp, type AppRequest } from '../core/auth-context.js';
import { SessionService } from '../core/session.service.js';
import { toneFor } from '../core/members.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { InjectRedis } from '../infra/redis.js';
import { SettingsService } from '../infra/settings.service.js';
import { AuthService, POLICIES, emailKey } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { HandleService } from '../profiles/handles.js';
import { isUniqueViolation } from '../profiles/pg-error.js';
import { MediaService } from '../media/media.service.js';
import { CharterCenterError } from '../learning/charter-center.client.js';
import { CHARTER_CENTER_EXAMS_CLIENT, type CharterCenterExamsClient } from './charter-center-exams.client.js';
import { questionCounts } from './exam-views.js';

/** How long a join stays open between steps. */
const JOIN_TTL_SECONDS = 30 * 60;
const CODE_TRIES = 5;
const CODE_SENDS = 5;
const RESEND_AFTER_SECONDS = 30;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

type JoinState = {
  examId: string;
  slug: string;
  email: string;
  name: string;
  photoUrl: string | null;
  codeHash: string;
  tries: number;
  sends: number;
  lastSentAt: number;
  verified: boolean;
  existing: boolean;
};

const stateKey = (id: string) => `exam-join:${id}`;
const photoKey = (id: string) => `exam-join-photo:${id}`;
const codeHash = (joinId: string, code: string) => sha256(`${joinId}:${code}`);

/** "amina.yusuf@gmail.com" → "a••••••••f@gmail.com" */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${local[0] ?? ''}•@${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(8, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

/**
 * Joining Charter Mission from an exam link with a Charter Center email (spec in contracts/exams.ts,
 * "Joining from Charter Center"). Answers never reveal whether an address already has an account
 * here until the person has proved it is theirs with the emailed code.
 */
@Injectable()
export class ExamJoinService {
  private readonly logger = new Logger('ExamJoin');

  constructor(
    @InjectDb() private readonly db: Db,
    @InjectRedis() private readonly redis: Redis,
    @Inject(CHARTER_CENTER_EXAMS_CLIENT) private readonly charterCenter: CharterCenterExamsClient,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly handles: HandleService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly media: MediaService,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** GET /exam-join/:slug — what the join page shows; published exams only. */
  async info(slug: string): Promise<ExamJoinInfo> {
    const exam = await this.publishedExam(slug);
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
      awardsCertificate: !!exam.charterCenterCourseId,
    };
  }

  /** POST /exam-join/:slug/start — checks the email with Charter Center and emails a code. */
  async start(slug: string, email: string, req: AppRequest): Promise<ExamJoinStarted> {
    const ip = clientIp(req) ?? 'unknown';
    await this.limits.consume(`exam-join:ip:${ip}`, 30, 3600, 'Too many attempts from this network. Try again in a while.');
    await this.limits.consume(`exam-join:email:${emailKey(email)}`, 8, 3600, 'Too many codes for this email. Try again in a while.');
    const exam = await this.publishedExam(slug);

    let student;
    try {
      student = await this.charterCenter.lookupStudent(email);
    } catch (err) {
      this.logger.warn(`Charter Center lookup failed: ${String(err)}`);
      throw Errors.unavailable('We couldn’t reach Charter Center to check your email. Try again in a minute.');
    }
    if (!student) {
      throw Errors.validation({ email: 'We couldn’t find a Charter Center account with this email. Use the email you registered with on Charter Center.' });
    }

    const joinId = randomUUID();
    const existing = !!(await this.liveAccount(email));
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const state: JoinState = {
      examId: exam.id,
      slug: exam.slug,
      email,
      name: student.name,
      photoUrl: student.photoUrl,
      codeHash: codeHash(joinId, code),
      tries: 0,
      sends: 1,
      lastSentAt: Date.now(),
      verified: false,
      existing,
    };
    await this.save(joinId, state);
    await this.sendCode(state, code);
    return { joinId, maskedEmail: maskEmail(email), resendAfter: RESEND_AFTER_SECONDS };
  }

  /** POST /exam-join/resend — a new code (the old one stops working). */
  async resend(joinId: string): Promise<ExamJoinStarted> {
    const state = await this.load(joinId);
    if (state.verified) throw Errors.conflict('Your email is already confirmed');
    const wait = Math.ceil((state.lastSentAt + RESEND_AFTER_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) throw Errors.rateLimited(wait, `You can ask for a new code in ${wait} seconds.`);
    if (state.sends >= CODE_SENDS) throw Errors.rateLimited(JOIN_TTL_SECONDS, 'Too many codes. Start again with your email.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const next = { ...state, codeHash: codeHash(joinId, code), tries: 0, sends: state.sends + 1, lastSentAt: Date.now() };
    await this.save(joinId, next);
    await this.sendCode(next, code);
    return { joinId, maskedEmail: maskEmail(state.email), resendAfter: RESEND_AFTER_SECONDS };
  }

  /** POST /exam-join/verify — the code proves the email; then we can show who Charter Center says it is. */
  async verify(joinId: string, code: string): Promise<ExamJoinVerified> {
    const state = await this.load(joinId);
    if (!state.verified) {
      const given = Buffer.from(codeHash(joinId, code));
      const ok = given.length === Buffer.from(state.codeHash).length && timingSafeEqual(given, Buffer.from(state.codeHash));
      if (!ok) {
        const tries = state.tries + 1;
        if (tries >= CODE_TRIES) {
          await this.redis.del(stateKey(joinId));
          throw Errors.validation({ code: 'Too many wrong codes. Start again with your email.' });
        }
        await this.save(joinId, { ...state, tries });
        throw Errors.validation({ code: 'That code isn’t right. Check the latest email from Charter Mission.' });
      }
      state.verified = true;
      state.existing = !!(await this.liveAccount(state.email));
      await this.save(joinId, state);
    }
    if (state.existing) return { status: 'existing', email: state.email };
    return { status: 'new', name: state.name, photo: await this.photo(joinId, state), email: state.email };
  }

  /** POST /exam-join/complete — makes the account from the Charter Center name and photo and signs in. */
  async complete(joinId: string, password: string, req: AppRequest, res: Response): Promise<ExamJoinCompleted> {
    const state = await this.load(joinId);
    if (!state.verified) throw Errors.validation({ code: 'Confirm your email with the code first' });
    if (state.existing || (await this.liveAccount(state.email))) {
      throw Errors.conflict('You already have a Charter Mission account with this email. Sign in to take the exam.');
    }
    await this.passwords.assertAcceptable(password, { email: state.email, name: state.name });
    const ip = clientIp(req);
    const passwordHash = await this.passwords.hash(password);
    const versions = await this.settings.get('policy_versions');
    const userId = randomUUID();
    const now = new Date();
    let created = false;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(users).values({ id: userId, email: state.email, passwordHash, status: 'active', emailVerifiedAt: now, lastLoginAt: now });
          await tx.insert(memberProfiles).values({
            userId,
            handle: await this.handles.derive(state.name, tx),
            displayName: state.name,
            avatarTone: toneFor(userId),
            fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
          });
          await tx.insert(consentRecords).values(POLICIES.map((policyType) => ({ userId, policyType, policyVersion: versions[policyType], ipHash: hashIp(ip) })));
        });
        created = true;
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_lower_uq')) throw Errors.conflict('You already have a Charter Mission account with this email. Sign in to take the exam.');
        if (!isUniqueViolation(err, 'member_profiles_handle_uq')) throw err;
      }
    }
    if (!created) throw Errors.conflict('Please try again');

    // The Charter Center photo becomes their profile picture. A photo that fails checks is skipped.
    const photo = await this.redis.getBuffer(photoKey(joinId));
    if (photo) {
      try {
        const file = await this.media.ingest(userId, 'avatar', photo, 'charter-center-photo.jpg', { attached: true });
        await this.db.update(memberProfiles).set({ avatarFileId: file.id }).where(eq(memberProfiles.userId, userId));
      } catch (err) {
        this.logger.warn(`Skipped the Charter Center photo for ${userId}: ${String(err)}`);
      }
    }
    await this.redis.del(stateKey(joinId), photoKey(joinId));

    const { token, expiresAt } = await this.sessions.create(userId, 'member', req);
    this.sessions.setCookie(res, 'member', token, expiresAt);
    this.analytics.track('account_registered', userId, null);
    this.analytics.track('exam_joined', userId, null, state.examId);
    await this.audit.record({ actorId: userId, action: 'auth.register', targetType: 'user', targetId: userId, after: { via: 'charter_center_exam', examId: state.examId }, ip });
    await this.events.emit({ type: 'user.registered', userId });
    await this.events.emit({ type: 'user.verified', userId });
    return { next: `/exams/${state.slug}` };
  }

  /* ---------- internals ---------- */

  private async publishedExam(slug: string) {
    const clean = slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(clean)) throw Errors.notFound('Exam');
    const [exam] = await this.db.select().from(exams).where(eq(exams.slug, clean)).limit(1);
    if (!exam || exam.status !== 'published') throw Errors.notFound('Exam');
    return exam;
  }

  private async liveAccount(email: string) {
    const user = await this.auth.findByEmail(email);
    return user && user.status !== 'deleted' ? user : null;
  }

  private async load(joinId: string): Promise<JoinState> {
    const raw = /^[0-9a-f-]{36}$/i.test(joinId) ? await this.redis.get(stateKey(joinId)) : null;
    if (!raw) throw Errors.validation({ code: 'This step has expired. Start again with your email.' });
    return JSON.parse(raw) as JoinState;
  }

  private async save(joinId: string, state: JoinState) {
    await this.redis.set(stateKey(joinId), JSON.stringify(state), 'EX', JOIN_TTL_SECONDS);
  }

  /** The Charter Center photo, fetched once and kept (resized) with the join; null when there is none or it can't be read. */
  private async photo(joinId: string, state: JoinState): Promise<string | null> {
    let data = await this.redis.getBuffer(photoKey(joinId));
    if (!data && state.photoUrl) {
      try {
        const file = await this.charterCenter.download(state.photoUrl, PHOTO_MAX_BYTES);
        data = await sharp(file.data, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate().resize(400, 400, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer();
        await this.redis.set(photoKey(joinId), data, 'EX', JOIN_TTL_SECONDS);
      } catch (err) {
        this.logger.warn(`Couldn’t use the Charter Center photo: ${err instanceof CharterCenterError ? err.message : String(err)}`);
        data = null;
      }
    }
    return data ? `data:image/jpeg;base64,${data.toString('base64')}` : null;
  }

  private async sendCode(state: JoinState, code: string) {
    const [exam] = await this.db.select({ title: exams.title }).from(exams).where(eq(exams.id, state.examId)).limit(1);
    await this.mail.compose({
      to: state.email,
      template: 'exam.join_code',
      subject: `${code} is your Charter Mission code`,
      heading: 'Confirm your email',
      paragraphs: [
        `Enter this code to take your exam${exam ? ` “${exam.title}”` : ''} on Charter Mission:`,
        code,
        'It works for 30 minutes. If you didn’t ask for it, you can ignore this email.',
      ],
      button: { label: 'Back to the exam', url: webUrl(`/exams/${state.slug}/join`) },
      footer: 'You received this email because someone entered this address to take a Charter Center exam on Charter Mission.',
      transactional: true,
    });
  }
}
