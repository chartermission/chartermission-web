import type { NotificationCategory } from '@chartermission/contracts';
import { env } from '../config/env.js';
import { hmac, safeEqual } from '../common/crypto.js';
import { webUrl } from '../infra/mail-layout.js';

/**
 * One-click unsubscribe links in bulk emails: a signed {u: userId, c: category} payload (HMAC with APP_SECRET).
 * They don't expire: an old email's link keeps working, and all it can do is turn that email category off.
 */
type Payload = { u: string; c: NotificationCategory };

export function unsubscribeToken(userId: string, category: NotificationCategory = 'announcements'): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, c: category } satisfies Payload)).toString('base64url');
  return `${payload}.${hmac(`unsubscribe:${payload}`)}`;
}

export function verifyUnsubscribeToken(token: string): Payload | null {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(`unsubscribe:${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Payload>;
    if (typeof data.u !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.u) || data.c !== 'announcements') return null;
    return { u: data.u, c: data.c };
  } catch {
    return null;
  }
}

/** The page on the member site the visible link opens (it asks before unsubscribing; link scanners open it too). */
export const unsubscribePageUrl = (token: string) => webUrl(`/unsubscribe?t=${encodeURIComponent(token)}`);

/** The List-Unsubscribe header target: mail apps POST here directly (RFC 8058 one-click). */
export const unsubscribeOneClickUrl = (token: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}/notifications/unsubscribe?t=${encodeURIComponent(token)}`;
