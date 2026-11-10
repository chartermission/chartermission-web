import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { NotificationCategory, NotificationType, NotificationView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { notificationPreferences, notifications, users } from '../db/schema.js';
import { MailService } from '../infra/mail.service.js';
import { renderEmail, webUrl } from '../infra/mail-layout.js';
import { RelationsService } from './relations.service.js';

/** Default channel settings per category (members can change these, CM-NTF-03). */
export const DEFAULT_PREFERENCES: Record<NotificationCategory, { in_app: boolean; email: boolean; push: boolean }> = {
  mentions_replies: { in_app: true, email: true, push: true },
  comments: { in_app: true, email: false, push: true },
  reactions: { in_app: true, email: false, push: false },
  connections: { in_app: true, email: true, push: true },
  follows: { in_app: true, email: false, push: false },
  trending: { in_app: true, email: false, push: false },
  moderation: { in_app: true, email: true, push: true },
  events: { in_app: true, email: true, push: true },
  opportunities: { in_app: true, email: true, push: true },
  digest: { in_app: false, email: false, push: false },
};

export const CATEGORY_OF: Record<NotificationType, NotificationCategory | 'always'> = {
  mention: 'mentions_replies',
  reply_to_comment: 'mentions_replies',
  comment_on_post: 'comments',
  reaction: 'reactions',
  repost: 'reactions',
  follow: 'follows',
  connection_request: 'connections',
  connection_accepted: 'connections',
  trending_followed_topic: 'trending',
  report_outcome: 'moderation',
  moderation_action: 'always',
  appeal_outcome: 'always',
  upload_rejected: 'always',
  answer_accepted: 'mentions_replies',
  help_offered: 'comments',
  scheduled_post_published: 'always',
  scheduled_post_failed: 'always',
  welcome: 'always',
  security: 'always',
  event_registration_confirmed: 'always',
  event_waitlisted: 'always',
  event_waitlist_promoted: 'always',
  event_reminder: 'events',
  event_cancelled: 'always',
  event_updated: 'events',
  event_review_approved: 'always',
  event_review_changes_requested: 'always',
  event_review_rejected: 'always',
  course_link_broken: 'always',
  opportunity_application_received: 'opportunities',
  opportunity_application_updated: 'opportunities',
  page_approved: 'always',
  page_rejected: 'always',
  page_admin_added: 'always',
  verification_approved: 'always',
  verification_declined: 'always',
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  objectType?: string;
  objectId?: string;
  /** Rendered text segments; for batched types the renderer prefixes the actor names. */
  segments: NotificationView['segments'];
  href: string;
  icon: NotificationView['icon'];
  /** Same key within the window updates one notification instead of adding another (CM-NTF-05). */
  dedupeKey: string;
  /** Batch window in minutes; reactions batch per object. Default 15 (spec proposed). */
  windowMinutes?: number;
  /** Optional email copy for categories where the member allows email. */
  email?: { subject: string; heading: string; paragraphs: string[]; buttonLabel: string };
}

/**
 * Creates in-app notifications with de-duplication and batching, honours
 * preferences and blocks, and sends email where allowed. Call it from domain
 * event handlers (workers), never inline in request handlers (spec 4.13).
 */
@Injectable()
export class NotifyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mail: MailService,
    private readonly relations: RelationsService,
  ) {}

  async enabled(userId: string, category: NotificationCategory, channel: 'in_app' | 'email' | 'push') {
    const [row] = await this.db
      .select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.category, category),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);
    return row ? row.enabled : DEFAULT_PREFERENCES[category][channel];
  }

  async notify(input: NotifyInput): Promise<void> {
    if (input.actorId && input.actorId === input.userId) return;
    if (input.actorId && (await this.relations.isBlockedEitherWay(input.userId, input.actorId))) return;
    const [recipient] = await this.db
      .select({ status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!recipient || ['deleted', 'deletion_pending', 'deactivated'].includes(recipient.status)) return;

    const category = CATEGORY_OF[input.type];
    const inApp = category === 'always' || (await this.enabled(input.userId, category, 'in_app'));
    if (inApp) await this.upsert(input, category === 'always' ? 'moderation' : category);

    if (input.email && (category === 'always' || (await this.enabled(input.userId, category, 'email')))) {
      const { text, html } = renderEmail({
        heading: input.email.heading,
        paragraphs: input.email.paragraphs,
        button: { label: input.email.buttonLabel, url: webUrl(input.href) },
        footer: 'You can change which emails you get in Settings → Notifications.',
      });
      await this.mail.send({
        to: recipient.email,
        userId: input.userId,
        template: `notification.${input.type}`,
        subject: input.email.subject,
        text,
        html,
        unsubscribeUrl: webUrl('/settings/notifications'),
      });
    }
  }

  private async upsert(input: NotifyInput, category: string) {
    const windowStart = new Date(Date.now() - (input.windowMinutes ?? 15) * 60_000);
    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.dedupeKey, input.dedupeKey),
          gt(notifications.updatedAt, windowStart),
        ),
      )
      .orderBy(desc(notifications.updatedAt))
      .limit(1);
    const data = { segments: input.segments, href: input.href, icon: input.icon };
    if (existing) {
      const actors = input.actorId
        ? [input.actorId, ...existing.actorIds.filter((a) => a !== input.actorId)].slice(0, 10)
        : existing.actorIds;
      const added = input.actorId && !existing.actorIds.includes(input.actorId) ? 1 : 0;
      await this.db
        .update(notifications)
        .set({ actorIds: actors, actorCount: sql`${notifications.actorCount} + ${added}`, data, readAt: null })
        .where(eq(notifications.id, existing.id));
      return;
    }
    await this.db.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      category,
      actorIds: input.actorId ? [input.actorId] : [],
      actorCount: input.actorId ? 1 : 0,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      data,
      dedupeKey: input.dedupeKey,
    });
  }
}
