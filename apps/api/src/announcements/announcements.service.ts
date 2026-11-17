import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type {
  AnnouncementAudience,
  AnnouncementAudienceCount,
  AnnouncementAudienceInput,
  AnnouncementInput,
  AnnouncementsPage,
  AnnouncementsQuery,
  AnnouncementView,
  MemberRef,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { announcementRecipients, announcements, notificationPreferences, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { AuditService } from '../infra/audit.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { QueueService } from '../infra/queue.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { InjectRedis } from '../infra/redis.js';
import { env } from '../config/env.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PushService } from '../push/push.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { unsubscribeOneClickUrl, unsubscribePageUrl, unsubscribeToken } from '../notifications/unsubscribe-token.js';
import { AUDIENCE_FROM, audienceWhere, emailConfirmedSql, optedOutSql } from './audience.js';
import { MessagingSettingsService, NO_SENDER_MESSAGE } from './messaging-settings.service.js';

type AnnouncementRow = typeof announcements.$inferSelect;
type RecipientRow = typeof announcementRecipients.$inferSelect;
type Pending = { userId: string; email: string; emailVerifiedAt: Date | null; status: string; isOfficial: boolean };

export const BATCH_JOB = 'announcement-batch';
const SWEEP_JOB = 'announcement-sweep';
/** Pause between batches, so a large send doesn't crowd out everything else on the queues. */
const BATCH_PAUSE_MS = 2000;
const LOCK_SECONDS = 300;

/**
 * Bulk messages from Charter Mission (admin console → Messages; contracts announcements.ts). Sending resolves the
 * audience once into announcement_recipients, then a queue job works through them in batches (re-enqueueing
 * itself), so a send survives restarts: a sweep every few minutes picks up any send still in progress.
 */
@Injectable()
export class AnnouncementsService implements OnModuleInit {
  private readonly logger = new Logger('Announcements');
  /** Recipients per batch (tests make it small). */
  batchSize = Number(process.env.ANNOUNCEMENT_BATCH_SIZE) || 200;

  constructor(
    @InjectDb() private readonly db: Db,
    @InjectRedis() private readonly redis: Redis,
    private readonly members: MembersService,
    private readonly notify: NotifyService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly queue: QueueService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
    private readonly settings: MessagingSettingsService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name, data: { id?: string }) => {
      if (name === BATCH_JOB && data.id) await this.runBatch(data.id);
      if (name === SWEEP_JOB) await this.sweep();
    });
    if (!this.queue.inline) {
      void this.queue.every('maintenance', SWEEP_JOB, 5 * 60_000).catch((err: unknown) => this.logger.warn(`Could not schedule the announcement sweep: ${String(err)}`));
      // Sends cut short by a restart carry on soon after start, without waiting for the first sweep.
      void this.queue
        .add('maintenance', SWEEP_JOB, {}, { delayMs: 15_000, jobId: `announcement-sweep-boot-${Date.now()}` })
        .catch((err: unknown) => this.logger.warn(`Could not queue the announcement sweep: ${String(err)}`));
    }
  }

  /* ============================ Drafts ============================ */

  /** GET /admin/announcements — newest first. "sent" lists everything that left the drafts. */
  async list(q: AnnouncementsQuery): Promise<AnnouncementsPage> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = sql<string>`to_char(${announcements.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({ row: announcements, ts })
      .from(announcements)
      .where(
        and(
          q.status === 'draft' ? eq(announcements.status, 'draft') : q.status === 'sent' ? ne(announcements.status, 'draft') : undefined,
          c ? sql`(${announcements.createdAt}, ${announcements.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(q.limit + 1);
    const more = rows.length > q.limit;
    const page = more ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return { items: await this.views(page.map((r) => r.row)), nextCursor: more && last ? encodeCursor({ t: last.ts, id: last.row.id }) : null };
  }

  async view(id: string): Promise<AnnouncementView> {
    return (await this.views([await this.row(id)]))[0]!;
  }

  async create(ctx: AuthContext, input: AnnouncementInput, ip?: string): Promise<AnnouncementView> {
    const [row] = await this.db
      .insert(announcements)
      .values({ ...fields(input), createdBy: ctx.user.id })
      .returning();
    await this.audit.record({ actorId: ctx.user.id, action: 'announcement.created', targetType: 'announcement', targetId: row!.id, after: auditFields(row!), ip });
    return this.view(row!.id);
  }

  async update(ctx: AuthContext, id: string, input: AnnouncementInput, ip?: string): Promise<AnnouncementView> {
    const before = await this.row(id);
    if (before.status !== 'draft') throw Errors.conflict('Only drafts can be edited');
    const [row] = await this.db
      .update(announcements)
      .set(fields(input))
      .where(and(eq(announcements.id, id), eq(announcements.status, 'draft')))
      .returning();
    if (!row) throw Errors.conflict('Only drafts can be edited');
    await this.audit.record({ actorId: ctx.user.id, action: 'announcement.updated', targetType: 'announcement', targetId: id, before: auditFields(before), after: auditFields(row), ip });
    return this.view(id);
  }

  async remove(ctx: AuthContext, id: string, ip?: string): Promise<void> {
    const before = await this.row(id);
    if (before.status !== 'draft') throw Errors.conflict('Only drafts can be deleted');
    await this.db.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.status, 'draft')));
    await this.audit.record({ actorId: ctx.user.id, action: 'announcement.deleted', targetType: 'announcement', targetId: id, before: auditFields(before), ip });
  }

  /* ============================ Audience ============================ */

  /** POST /admin/announcements/audience — the live count while composing. */
  async audienceCount(input: AnnouncementAudienceInput): Promise<AnnouncementAudienceCount> {
    const where = audienceWhere(input.audience);
    const result = await this.db.execute<{ members: number; emailable: number; opted_out: number }>(sql`
      select count(*)::int as members,
        count(*) filter (where ${emailConfirmedSql} and (${input.important} or not ${optedOutSql}))::int as emailable,
        count(*) filter (where ${optedOutSql})::int as opted_out
      from ${AUDIENCE_FROM} where ${where}`);
    const sample = await this.db.execute<{ id: string }>(sql`select ${users.id} as id from ${AUDIENCE_FROM} where ${where} order by ${users.createdAt} desc limit 5`);
    const refs = await this.members.refs(sample.rows.map((r) => r.id));
    const counts = result.rows[0];
    return {
      members: counts?.members ?? 0,
      emailable: counts?.emailable ?? 0,
      optedOut: counts?.opted_out ?? 0,
      sample: sample.rows.map((r) => refs.get(r.id)).filter((r): r is MemberRef => !!r),
    };
  }

  /* ============================ Sending ============================ */

  /** POST /admin/announcements/{id}/send — resolves the audience now, then delivery runs in the background. */
  async send(ctx: AuthContext, id: string, ip?: string): Promise<AnnouncementView> {
    const a = await this.row(id);
    if (a.status !== 'draft') throw Errors.conflict('This message has already been sent');
    if (a.channels.message) await this.settings.requireSender();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(announcements)
        .set({ status: 'sending', queuedAt: now, sentBy: ctx.user.id, lastError: null })
        .where(and(eq(announcements.id, id), eq(announcements.status, 'draft')))
        .returning({ id: announcements.id });
      if (!claimed) throw Errors.conflict('This message has already been sent');
      const inserted = await tx.execute(sql`
        insert into ${announcementRecipients} (announcement_id, user_id)
        select ${id}::uuid, ${users.id} from ${AUDIENCE_FROM} where ${audienceWhere(a.audience as AnnouncementAudience)}
        on conflict do nothing`);
      const n = inserted.rowCount ?? 0;
      if (!n) throw Errors.conflict('No members match this audience');
      await tx.update(announcements).set({ recipientCount: n }).where(eq(announcements.id, id));
    });
    const sent = await this.row(id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'announcement.sent',
      targetType: 'announcement',
      targetId: id,
      after: { ...auditFields(sent), recipients: sent.recipientCount },
      ip,
    });
    await this.enqueue(id);
    return this.view(id);
  }

  /** POST /admin/announcements/{id}/cancel — stops before the next batch; members already reached keep it. */
  async cancel(ctx: AuthContext, id: string, ip?: string): Promise<AnnouncementView> {
    await this.row(id);
    const [row] = await this.db
      .update(announcements)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(announcements.id, id), eq(announcements.status, 'sending')))
      .returning();
    if (!row) throw Errors.conflict('Only a message that is still being sent can be stopped');
    await this.recount(id);
    await this.audit.record({ actorId: ctx.user.id, action: 'announcement.cancelled', targetType: 'announcement', targetId: id, ip });
    return this.view(id);
  }

  /** POST /admin/announcements/{id}/test — to the signed-in admin only, by email and/or notification, marked [Test]. */
  async test(ctx: AuthContext, id: string, ip?: string): Promise<AnnouncementView> {
    const a = await this.row(id);
    if (!a.channels.email && !a.channels.notification) throw Errors.conflict('Tests are sent by email or notification. Turn one of them on to send a test.');
    await this.limits.consume(`announcement-test:${ctx.user.id}`, 30, 3600, 'You can send 30 tests an hour.');
    const [me] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const test = { ...a, subject: `[Test] ${a.subject}` };
    if (a.channels.email && me) await this.sendEmail(test, ctx.user.id, me.email);
    if (a.channels.notification) await this.sendNotification(test, ctx.user.id, this.notificationHref(a, null), `announcement-test:${a.id}`);
    await this.audit.record({ actorId: ctx.user.id, action: 'announcement.tested', targetType: 'announcement', targetId: id, ip });
    return this.view(id);
  }

  private async enqueue(id: string, delayMs?: number) {
    await this.queue.add('maintenance', BATCH_JOB, { id }, { delayMs, jobId: `announcement-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  }

  /** Every few minutes (and soon after start): carry on with sends still in progress. */
  async sweep(): Promise<void> {
    const rows = await this.db.select({ id: announcements.id }).from(announcements).where(eq(announcements.status, 'sending'));
    for (const r of rows) await this.enqueue(r.id);
  }

  /**
   * One batch of a send. A Redis lock keeps two workers off the same send: a job that can't take it leaves (the holder
   * queues the next batch), so duplicate jobs from the sweep die out on their own.
   */
  async runBatch(id: string): Promise<void> {
    const lockKey = `lock:announcement:${id}`;
    if ((await this.redis.set(lockKey, '1', 'EX', LOCK_SECONDS, 'NX')) !== 'OK') return;
    let more = false;
    try {
      const [a] = await this.db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
      if (!a || a.status !== 'sending') return;
      const pending = await this.db
        .select({ userId: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, status: users.status, isOfficial: users.isOfficial })
        .from(announcementRecipients)
        .innerJoin(users, eq(users.id, announcementRecipients.userId))
        .where(and(eq(announcementRecipients.announcementId, id), isNull(announcementRecipients.doneAt)))
        .limit(this.batchSize);
      if (pending.length) {
        const senderId = a.channels.message ? await this.settings.effectiveSenderId() : null;
        const optedOut = await this.optedOut(pending.map((p) => p.userId));
        for (const r of pending) await this.deliverTo(a, r, senderId, optedOut);
        await this.recount(id);
      }
      const [left] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(announcementRecipients)
        .where(and(eq(announcementRecipients.announcementId, id), isNull(announcementRecipients.doneAt)));
      if (left?.n) more = true;
      else {
        await this.db
          .update(announcements)
          .set({ status: sql`case when ${announcements.failedCount} >= ${announcements.recipientCount} and ${announcements.recipientCount} > 0 then 'failed' else 'sent' end`, finishedAt: new Date() })
          .where(and(eq(announcements.id, id), eq(announcements.status, 'sending')));
      }
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
    if (more) await this.enqueue(id, BATCH_PAUSE_MS);
  }

  /** One member, through each chosen channel. A failure is kept on their row and the send carries on. */
  private async deliverTo(a: AnnouncementRow, r: Pending, senderId: string | null, optedOut: Set<string>) {
    const done: Partial<RecipientRow> = {};
    try {
      // Closed, suspended or since-official accounts get nothing.
      if (['active', 'unverified'].includes(r.status) && !r.isOfficial) {
        let conversationId: string | null = null;
        if (a.channels.message) {
          if (!senderId) throw new Error(NO_SENDER_MESSAGE);
          const conversation = await this.messages.officialConversation(senderId, r.userId);
          conversationId = conversation.id;
          // One email and one notification per announcement: the message's own ones are left out when those channels are on.
          await this.messages.sendOfficial(conversation, {
            body: messageBody(a),
            staffId: null,
            announcementId: a.id,
            quiet: { notification: a.channels.notification, email: a.channels.email },
          });
          done.messagedAt = new Date();
        }
        if (a.channels.email) {
          if (!r.emailVerifiedAt) done.emailSkipped = 'unconfirmed';
          else if (!a.important && optedOut.has(r.userId)) done.emailSkipped = 'opted_out';
          else {
            await this.sendEmail(a, r.userId, r.email);
            done.emailedAt = new Date();
          }
        }
        if (a.channels.notification) {
          if (await this.sendNotification(a, r.userId, this.notificationHref(a, conversationId), `announcement:${a.id}`)) done.notifiedAt = new Date();
        }
      }
      await this.db
        .update(announcementRecipients)
        .set({ ...done, doneAt: new Date() })
        .where(and(eq(announcementRecipients.announcementId, a.id), eq(announcementRecipients.userId, r.userId)));
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      this.logger.warn(`announcement ${a.id} to ${r.userId} failed: ${message}`);
      await this.db
        .update(announcementRecipients)
        .set({ ...done, error: message, doneAt: new Date(), ...(a.channels.email && !done.emailedAt && !done.emailSkipped ? { emailSkipped: 'failed' } : {}) })
        .where(and(eq(announcementRecipients.announcementId, a.id), eq(announcementRecipients.userId, r.userId)));
      await this.db.update(announcements).set({ lastError: message }).where(eq(announcements.id, a.id));
    }
  }

  private async sendEmail(a: Pick<AnnouncementRow, 'subject' | 'body' | 'linkUrl' | 'linkLabel' | 'important'>, userId: string, email: string) {
    const token = unsubscribeToken(userId, 'announcements');
    const settingsLink = { label: 'Notification settings', url: webUrl('/settings/notifications') };
    await this.mail.compose({
      to: email,
      userId,
      template: 'announcement',
      verbatim: true,
      subject: a.subject,
      heading: a.subject,
      paragraphs: paragraphs(a.body),
      button: a.linkUrl ? { label: a.linkLabel || 'Open link', url: a.linkUrl, translate: !a.linkLabel } : undefined,
      footer: a.important
        ? 'This is an important service notice from Charter Mission, so it was sent even if you turned announcement emails off.'
        : 'You’re getting this email because you’re a member of Charter Mission and announcement emails are on.',
      footerLinks: a.important ? [settingsLink] : [{ label: 'Unsubscribe from these emails', url: unsubscribePageUrl(token) }, settingsLink],
      // Important notices carry no unsubscribe header: they aren't optional.
      unsubscribeUrl: a.important ? undefined : unsubscribeOneClickUrl(token),
    });
  }

  /** The in-app notification (and a push where the member allows it). Returns whether it shows in their list. */
  private async sendNotification(a: Pick<AnnouncementRow, 'id' | 'subject' | 'body' | 'important'>, userId: string, href: string, dedupeKey: string): Promise<boolean> {
    const inApp = a.important || (await this.notify.enabled(userId, 'announcements', 'in_app'));
    await this.notify.notify({
      userId,
      type: 'announcement',
      objectType: 'announcement',
      objectId: a.id,
      segments: [{ text: a.subject, strong: true }],
      href,
      icon: 'alert',
      dedupeKey,
      forceInApp: a.important,
    });
    if (a.important || (await this.notify.enabled(userId, 'announcements', 'push'))) {
      await this.push.send(userId, { title: a.subject, body: excerpt(a.body), href, tag: `announcement-${a.id}` }).catch(() => undefined);
    }
    return inApp;
  }

  /**
   * Where the notification opens: the official conversation when the message went there too; otherwise the link
   * (a path when it's on the member site, else the full address), or the notifications page.
   */
  private notificationHref(a: Pick<AnnouncementRow, 'linkUrl'>, conversationId: string | null): string {
    if (conversationId) return `/messages/${conversationId}`;
    if (a.linkUrl) {
      const site = env().WEB_URL.replace(/\/$/, '');
      if (a.linkUrl === site || a.linkUrl.startsWith(`${site}/`)) return a.linkUrl.slice(site.length) || '/';
      return a.linkUrl;
    }
    return '/notifications';
  }

  private async optedOut(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.db
      .select({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, userIds),
          eq(notificationPreferences.category, 'announcements'),
          eq(notificationPreferences.channel, 'email'),
          eq(notificationPreferences.enabled, false),
        ),
      );
    return new Set(rows.map((r) => r.userId));
  }

  /** Counters from the recipient rows, so they stay right however often a batch is retried. */
  private async recount(id: string) {
    await this.db.execute(sql`
      update ${announcements} set
        emailed_count = s.emailed, messaged_count = s.messaged, notified_count = s.notified,
        opted_out_count = s.opted_out, failed_count = s.failed, updated_at = now()
      from (
        select count(*) filter (where emailed_at is not null)::int as emailed,
          count(*) filter (where messaged_at is not null)::int as messaged,
          count(*) filter (where notified_at is not null)::int as notified,
          count(*) filter (where email_skipped = 'opted_out')::int as opted_out,
          count(*) filter (where error is not null)::int as failed
        from ${announcementRecipients} where announcement_id = ${id}::uuid
      ) s
      where ${announcements.id} = ${id}::uuid`);
  }

  private async row(id: string): Promise<AnnouncementRow> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    if (!row) throw Errors.notFound('That message');
    return row;
  }

  private async views(rows: AnnouncementRow[]): Promise<AnnouncementView[]> {
    if (!rows.length) return [];
    const ids = rows.filter((r) => r.status !== 'draft').map((r) => r.id);
    const [remaining, refs] = await Promise.all([
      ids.length
        ? this.db
            .select({ id: announcementRecipients.announcementId, n: sql<number>`count(*)::int` })
            .from(announcementRecipients)
            .where(and(inArray(announcementRecipients.announcementId, ids), isNull(announcementRecipients.doneAt)))
            .groupBy(announcementRecipients.announcementId)
        : Promise.resolve([]),
      this.members.refs(rows.flatMap((r) => [r.createdBy, r.sentBy]).filter((x): x is string => !!x)),
    ]);
    const left = new Map(remaining.map((r) => [r.id, r.n]));
    const person = (id: string | null) => {
      const ref = id ? refs.get(id) : undefined;
      return ref ? { id: ref.id, name: ref.name } : null;
    };
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      linkUrl: r.linkUrl,
      linkLabel: r.linkLabel,
      channels: { email: !!r.channels.email, message: !!r.channels.message, notification: !!r.channels.notification },
      audience: r.audience as AnnouncementAudience,
      important: r.important,
      status: r.status as AnnouncementView['status'],
      counts: {
        recipients: r.recipientCount,
        emailed: r.emailedCount,
        messaged: r.messagedCount,
        notified: r.notifiedCount,
        optedOut: r.optedOutCount,
        failed: r.failedCount,
        remaining: left.get(r.id) ?? 0,
      },
      lastError: r.lastError,
      createdBy: person(r.createdBy),
      sentBy: person(r.sentBy),
      createdAt: r.createdAt.toISOString(),
      queuedAt: r.queuedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    }));
  }
}

function fields(input: AnnouncementInput) {
  const linkUrl = input.linkUrl?.trim() || null;
  return {
    subject: input.subject,
    body: input.body,
    linkUrl,
    linkLabel: linkUrl ? input.linkLabel?.trim() || null : null,
    channels: { email: input.channels.email, message: input.channels.message, notification: input.channels.notification },
    audience: input.audience as Record<string, unknown>,
    important: input.important ?? false,
  };
}

/** What the audit log keeps: never the message body. */
function auditFields(row: AnnouncementRow) {
  return { subject: row.subject, channels: row.channels, audience: row.audience, important: row.important, linkUrl: row.linkUrl };
}

/** Blank lines separate paragraphs. */
function paragraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The message in the official conversation: the subject, the text and the link. */
function messageBody(a: Pick<AnnouncementRow, 'subject' | 'body' | 'linkUrl' | 'linkLabel'>): string {
  const link = a.linkUrl ? (a.linkLabel ? `${a.linkLabel}: ${a.linkUrl}` : a.linkUrl) : null;
  return [a.subject, a.body, link].filter(Boolean).join('\n\n');
}

function excerpt(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}
