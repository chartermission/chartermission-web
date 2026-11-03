import { and, eq } from 'drizzle-orm';
import { SessionService, COOKIE_NAMES } from '../../src/core/session.service.js';
import { client, s, type TestApp } from '../helpers.js';

/* Content is inserted directly: the posts/feed endpoints belong to another workstream. */

export async function insertPost(t: TestApp, authorId: string, body = 'A post about #AfCFTA and trade corridors') {
  const [p] = await t.db.insert(s.posts).values({ authorId, body }).returning();
  return p!;
}

export async function insertComment(t: TestApp, postId: string, authorId: string, body = 'A comment on the post') {
  const [c] = await t.db.insert(s.comments).values({ postId, authorId, body }).returning();
  return c!;
}

export async function insertHashtag(t: TestApp, display: string) {
  const [h] = await t.db.insert(s.hashtags).values({ tag: display.toLowerCase(), display }).returning();
  return h!;
}

export async function notificationsFor(t: TestApp, userId: string, type?: string) {
  return t.db
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), type ? eq(s.notifications.type, type) : undefined));
}

/** Text of a notification's segments, joined. */
export const textOf = (n: { data: Record<string, unknown> }) =>
  ((n.data.segments as { text: string }[] | undefined) ?? []).map((x) => x.text).join('');

/** A fresh signed-in client for an existing user (e.g. after their sessions were revoked). */
export async function signInAgain(
  t: TestApp,
  userId: string,
  audience: 'member' | 'admin' = 'member',
  mfaVerified = false,
) {
  const sessions = t.app.get(SessionService);
  const { token } = await sessions.create(
    userId,
    audience,
    { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any,
    {
      mfaVerified,
    },
  );
  const c = client(t, audience);
  c.agent.jar.setCookie(`${COOKIE_NAMES[audience]}=${token}; Path=/`, '127.0.0.1');
  return c;
}

export const REASON = 'Breaks the scams policy: asks members to send money';
