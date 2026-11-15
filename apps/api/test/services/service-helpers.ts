import type { ServiceView, SlotsView } from '@chartermission/contracts';
import { createMember, s, type TestApp } from '../helpers.js';

export type Member = Awaited<ReturnType<typeof createMember>>;

export const consultation = (extra: Record<string, unknown> = {}) => ({
  title: 'Fintech product clinic',
  description: 'A 30-minute call on your payments product: pricing, compliance and launch plans.',
  skills: ['Payments', 'Product', 'payments'],
  rateNote: 'Projects quoted after a first call',
  bookable: true,
  durationMinutes: 30,
  mode: 'video',
  locationHint: 'Google Meet',
  meetingDetails: 'https://meet.example.com/kwame-clinic',
  noticeHours: 0,
  windowDays: 30,
  ...extra,
});

export const listing = (extra: Record<string, unknown> = {}) => ({
  title: 'Market-entry research',
  description: 'Desk and field research for companies entering West African markets.',
  skills: ['Research'],
  ...extra,
});

/** Every day, all day, in a UTC+0 zone without DST: slots every 30 minutes. */
export const allDay = (extra: Record<string, unknown> = {}) => ({
  timezone: 'Africa/Abidjan',
  windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '00:00', end: '23:59' })),
  ...extra,
});

export async function createService(m: Member, body: Record<string, unknown> = consultation()): Promise<ServiceView> {
  const res = await m.post('/services', body);
  if (res.status !== 201) throw new Error(`create service: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as ServiceView;
}

/** The first open slot from `daysAhead` days on, as the viewer sees it. */
export async function firstSlot(m: Member, serviceId: string, daysAhead = 2, index = 0): Promise<string> {
  const from = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const view = (await m.get(`/services/${serviceId}/slots?from=${from}&days=3&tz=UTC`).expect(200)).body as SlotsView;
  const slot = view.days.flatMap((d) => d.slots)[index];
  if (!slot) throw new Error(`no slot: ${JSON.stringify(view)}`);
  return slot.startsAt;
}

export async function makePage(t: TestApp, owner: Member, slug: string, admins: Member[] = [], status = 'active') {
  const [page] = await t.db.insert(s.pages).values({ slug, name: slug.replace(/-/g, ' '), status, createdBy: owner.id, countryCode: 'GH' }).returning();
  await t.db.insert(s.pageAdmins).values([{ pageId: page!.id, userId: owner.id, role: 'owner' }, ...admins.map((a) => ({ pageId: page!.id, userId: a.id, role: 'admin' }))]);
  return page!;
}
