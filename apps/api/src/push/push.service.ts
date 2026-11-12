import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { PushSubscriptionInput } from '@chartermission/contracts';
import { env } from '../config/env.js';
import { InjectDb, type Db } from '../db/db.module.js';
import { pushSubscriptions } from '../db/schema.js';
import { webUrl } from '../infra/mail-layout.js';

export type PushPayload = {
  title: string;
  body: string;
  /** Path on the member site, opened when the notification is tapped. */
  href: string;
  /** Notifications with the same tag replace each other (one per conversation). */
  tag?: string;
};

/** A member can keep this many browsers subscribed; the oldest is dropped beyond it. */
const MAX_SUBSCRIPTIONS = 10;

/**
 * Web Push: notifications on phones and computers while Charter Mission isn't open. Needs
 * VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; without them every call is a no-op.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private configured = false;

  constructor(@InjectDb() private readonly db: Db) {
    const e = env();
    if (e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY) {
      try {
        webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
        this.configured = true;
      } catch (err) {
        this.logger.error(`Web Push is off: the VAPID keys are invalid (${String(err)})`);
      }
    }
  }

  publicKey(): string | null {
    return this.configured ? env().VAPID_PUBLIC_KEY! : null;
  }

  async subscribe(userId: string, input: PushSubscriptionInput, userAgent?: string): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
      });
    const rows = await this.db.select({ id: pushSubscriptions.id, createdAt: pushSubscriptions.createdAt }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    if (rows.length > MAX_SUBSCRIPTIONS) {
      const oldest = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, rows.length - MAX_SUBSCRIPTIONS);
      for (const row of oldest) await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    }
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  /** Sends to every browser the member subscribed; drops subscriptions the browser has revoked. */
  async send(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subs = await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    const body = JSON.stringify({ ...payload, url: webUrl(payload.href) });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 24 * 3600, urgency: 'high' });
          await this.db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          else this.logger.warn(`push to ${userId} failed: ${String(err)}`);
        }
      }),
    );
  }
}
