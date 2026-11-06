import { eq } from 'drizzle-orm';
import { encrypt } from '../../src/common/crypto.js';
import { createMember, s, type TestApp } from '../helpers.js';

export type Member = Awaited<ReturnType<typeof createMember>>;

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const JOIN_URL = 'https://zoom.us/j/123456789?pwd=secret-join';

/** A valid CreateEventInput (online, internal registration) starting `days` from now. */
export function eventInput(overrides: Record<string, unknown> = {}, days = 10) {
  const start = new Date(Date.now() + days * DAY);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * HOUR);
  return {
    title: 'Founders’ Office Hours',
    summary: 'Small-group office hours on raising a first round.',
    description: 'Bring your deck.',
    format: 'online',
    host: { type: 'member' },
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    timezone: 'Africa/Lagos',
    online: { platform: 'Zoom', url: JOIN_URL },
    capacity: 50,
    ...overrides,
  };
}

export async function chapterId(t: TestApp, slug = 'lagos') {
  const [c] = await t.db.select().from(s.chapters).where(eq(s.chapters.slug, slug));
  return c!.id;
}

export async function grantChapterLead(t: TestApp, userId: string, chapter: string) {
  const [role] = await t.db.select().from(s.roles).where(eq(s.roles.key, 'chapter_lead'));
  await t.db.insert(s.userRoles).values({ userId, roleId: role!.id, scopeType: 'chapter', scopeId: chapter });
}

/** Creates and publishes an event through the API as a staff member with event.publish. */
export async function publishedEvent(staff: Member, overrides: Record<string, unknown> = {}, days = 10) {
  const created = await staff.post('/events', eventInput(overrides, days)).expect(201);
  const res = await staff.post(`/events/${created.body.id}/submit`, {}).expect(200);
  return res.body as { id: string; slug: string; status: string };
}

/**
 * Inserts a published event directly (for times the API would refuse, e.g. already started).
 * Online by default, with the JOIN_URL link.
 */
export async function insertEvent(
  t: TestApp,
  createdBy: string,
  opts: { startsAt: Date; endsAt?: Date; capacity?: number | null; status?: string; deadline?: Date | null; waitlist?: boolean; slug?: string } ,
) {
  const [row] = await t.db
    .insert(s.events)
    .values({
      slug: opts.slug ?? `inserted-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Inserted event',
      summary: 'An event inserted for a test.',
      format: 'online',
      status: opts.status ?? 'published',
      hostType: 'member',
      hostMemberId: createdBy,
      startsAt: opts.startsAt,
      endsAt: opts.endsAt ?? new Date(opts.startsAt.getTime() + 2 * HOUR),
      timezone: 'Africa/Lagos',
      onlinePlatform: 'Zoom',
      onlineUrlEnc: encrypt(JOIN_URL),
      capacity: opts.capacity === undefined ? 10 : opts.capacity,
      waitlistEnabled: opts.waitlist ?? true,
      registrationDeadline: opts.deadline ?? null,
      publishedAt: new Date(),
      createdBy,
    })
    .returning();
  return row!;
}

/** Adds a registration row directly and keeps the event counters right. */
export async function insertRegistration(t: TestApp, eventId: string, userId: string, status = 'registered') {
  await t.db.insert(s.eventRegistrations).values({ eventId, userId, status });
  const [ev] = await t.db.select().from(s.events).where(eq(s.events.id, eventId));
  await t.db
    .update(s.events)
    .set({ registeredCount: ev!.registeredCount + (status === 'registered' || status === 'attended' ? 1 : 0) })
    .where(eq(s.events.id, eventId));
}

/** Analytics is fire-and-forget: poll briefly for the row count. */
export async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    v = await fn();
  }
  return v;
}
