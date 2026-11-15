import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';
import { addDays, dayKey, weekdayOf, zonedTime } from '../services/time.js';

/*
 * Demo services and consultations (development and staging only): a few services for demo members
 * (some bookable, some not), their weekly availability, one consultation offered by the Lagos
 * AgriHub page, and a few upcoming bookings. Skipped once any service exists.
 */

type Window = { weekday: number; start: string; end: string };
type DemoService = {
  title: string;
  description: string;
  skills: string[];
  rateNote?: string;
  /** For bookable services: [minutes, mode, location hint, meeting details]. */
  consultation?: [number, 'video' | 'phone' | 'in_person', string, string];
  noticeHours?: number;
  windowDays?: number;
};
type DemoHost = {
  /** Demo member email, or a page slug. */
  member?: string;
  page?: string;
  availability?: { timezone: string; windows: Window[]; bufferMinutes?: number; maxPerDay?: number | null };
  services: DemoService[];
};

const weekdays = (days: number[], start: string, end: string): Window[] => days.map((weekday) => ({ weekday, start, end }));

const HOSTS: DemoHost[] = [
  {
    member: 'kwame@example.com',
    availability: { timezone: 'Africa/Accra', windows: weekdays([1, 2, 3, 4], '10:00', '16:00'), bufferMinutes: 15, maxPerDay: 4 },
    services: [
      {
        title: 'Payments product clinic',
        description:
          'A focused call on your payments or wallet product: pricing, settlement, licensing and launch plans. Bring your current numbers and the one question that keeps you up at night.',
        skills: ['Payments', 'Product management', 'Mobile money'],
        consultation: [30, 'video', 'Google Meet', 'https://meet.google.com/demo-kwame-clinic'],
      },
      {
        title: 'Mobile money interoperability review',
        description:
          'We walk through how your product connects to mobile money operators across Ghana, Nigeria and Kenya, and where cross-border settlement usually breaks.',
        skills: ['Interoperability', 'Cross-border payments'],
        consultation: [60, 'video', 'Google Meet', 'https://meet.google.com/demo-kwame-interop'],
        noticeHours: 24,
      },
      {
        title: 'Fractional product lead',
        description: 'Two days a week leading product for an early-stage fintech: roadmap, hiring the first product team and setting up discovery.',
        skills: ['Product leadership', 'Fintech'],
        rateNote: 'Projects quoted after a first call',
      },
    ],
  },
  {
    member: 'amara@example.com',
    availability: { timezone: 'Africa/Lagos', windows: weekdays([2, 4], '14:00', '18:00'), maxPerDay: 3 },
    services: [
      {
        title: 'Agribusiness export readiness call',
        description:
          'For co-ops and small processors thinking about exporting: certification, buyers in Ghana, Côte d’Ivoire and the UK, and what the first shipment really costs.',
        skills: ['Agribusiness', 'Export', 'AfCFTA'],
        consultation: [45, 'video', 'Zoom', 'https://zoom.example.com/j/demo-amara'],
      },
      {
        title: 'Cold-chain feasibility study',
        description: 'A written study of cold storage options for your produce, with costs per tonne and a site recommendation.',
        skills: ['Cold chain', 'Feasibility'],
        rateNote: 'From ₦450,000 per study',
      },
    ],
  },
  {
    member: 'aisha@example.com',
    availability: { timezone: 'Africa/Lagos', windows: weekdays([1, 3, 5], '09:00', '12:00') },
    services: [
      {
        title: 'Community programme design session',
        description:
          'Planning a community programme or outreach drive? We map who you want to reach, the partners you need and a realistic first three months.',
        skills: ['Community organising', 'Programme design'],
        consultation: [30, 'phone', 'Phone call', '+234 800 000 0000 (demo number)'],
        noticeHours: 6,
      },
    ],
  },
  {
    member: 'owais@example.com',
    availability: {
      timezone: 'Asia/Dubai',
      windows: [...weekdays([1, 2, 3, 4, 5], '10:00', '13:00'), ...weekdays([1, 2, 3, 4], '15:00', '18:00')],
      bufferMinutes: 15,
    },
    services: [
      {
        title: 'DevSecOps and compliance consultation',
        description:
          'A first look at your delivery pipeline and controls against ISO 27001 and your clients’ security questionnaires: what to fix first and what can wait.',
        skills: ['DevSecOps', 'ISO 27001', 'Cloud security'],
        consultation: [30, 'video', 'Microsoft Teams', 'https://teams.example.com/l/demo-owais'],
        windowDays: 45,
      },
      {
        title: 'Google Workspace SSO and device management rollout',
        description: 'Single sign-on, device management and access policies for teams moving to Google Workspace or Microsoft 365, delivered by HyseTech.',
        skills: ['SSO', 'MDM', 'Google Workspace', 'Microsoft 365'],
        rateNote: 'Projects quoted after a first call',
      },
      {
        title: 'AI product discovery workshop',
        description: 'A working session to find where AI can save your team real hours, and what a first pilot would look like in six weeks.',
        skills: ['AI products', 'Automation'],
        consultation: [60, 'video', 'Microsoft Teams', 'https://teams.example.com/l/demo-owais-ai'],
        noticeHours: 24,
      },
    ],
  },
  {
    page: 'lagos-agrihub',
    availability: { timezone: 'Africa/Lagos', windows: weekdays([1, 2, 3, 4, 5], '09:00', '16:00'), maxPerDay: 6 },
    services: [
      {
        title: 'Cold-room booking consultation',
        description:
          'Meet our hub team to plan cold storage for your co-op: crate volumes, pickup days and pricing per tonne at the Ikorodu and Agbara cold rooms.',
        skills: ['Cold storage', 'Logistics'],
        consultation: [30, 'in_person', 'Ikorodu, Lagos', 'Lagos AgriHub cold room, Ikorodu Industrial Estate, Gate 2. Ask for the duty manager.'],
      },
    ],
  },
];

/** [booker email, host (email or page slug), service title, days ahead (at least), note] */
const BOOKINGS: [string, string, string, number, string][] = [
  ['tunde@example.com', 'kwame@example.com', 'Payments product clinic', 3, 'We want to let co-ops pay for cold-room space with mobile money. Which operators should we start with?'],
  ['fatou@example.com', 'owais@example.com', 'DevSecOps and compliance consultation', 4, 'Two of our portfolio companies face ISO 27001 questionnaires from banks this quarter.'],
  ['kwame@example.com', 'lagos-agrihub', 'Cold-room booking consultation', 5, 'Visiting Lagos next week; keen to see the Ikorodu hub.'],
];

export async function seedServices(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.services.id }).from(s.services).limit(1);
  if (existing) return;
  const emails = [...HOSTS.flatMap((h) => (h.member ? [h.member] : [])), ...BOOKINGS.map((b) => b[0])];
  const userRows = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(inArray(sql`lower(${s.users.email})`, emails));
  const userId = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));
  const pageRows = await db.select({ id: s.pages.id, slug: s.pages.slug }).from(s.pages).where(inArray(s.pages.slug, HOSTS.flatMap((h) => (h.page ? [h.page] : []))));
  const pageId = new Map(pageRows.map((p) => [p.slug, p.id]));
  const ownerOf = async (pid: string) =>
    (await db.select({ userId: s.pageAdmins.userId }).from(s.pageAdmins).where(eq(s.pageAdmins.pageId, pid)).limit(1))[0]?.userId ?? null;

  /** host key → { columns, availability, services by title } */
  const seeded = new Map<string, { hostUserId: string | null; hostPageId: string | null; timezone: string; windows: Window[]; services: Map<string, { id: string; minutes: number }> }>();
  for (const h of HOSTS) {
    const hostUserId = h.member ? (userId.get(h.member) ?? ctx.ids[h.member.split('@')[0]!] ?? null) : null;
    const hostPageId = h.page ? (pageId.get(h.page) ?? null) : null;
    if (!hostUserId && !hostPageId) continue;
    const createdBy = hostUserId ?? (await ownerOf(hostPageId!));
    if (h.availability) {
      await db.insert(s.hostAvailability).values({
        hostUserId,
        hostPageId,
        timezone: h.availability.timezone,
        windows: h.availability.windows,
        bufferMinutes: h.availability.bufferMinutes ?? 0,
        maxPerDay: h.availability.maxPerDay ?? null,
        updatedBy: createdBy,
      });
    }
    const byTitle = new Map<string, { id: string; minutes: number }>();
    for (const [position, svc] of h.services.entries()) {
      const c = svc.consultation;
      const [row] = await db
        .insert(s.services)
        .values({
          hostUserId,
          hostPageId,
          title: svc.title,
          description: svc.description,
          skills: svc.skills,
          rateNote: svc.rateNote ?? null,
          bookable: !!c,
          durationMinutes: c?.[0] ?? null,
          mode: c?.[1] ?? null,
          locationHint: c?.[2] ?? null,
          meetingDetails: c?.[3] ?? null,
          noticeHours: svc.noticeHours ?? 12,
          windowDays: svc.windowDays ?? 30,
          position,
          createdBy,
        })
        .returning({ id: s.services.id });
      byTitle.set(svc.title, { id: row!.id, minutes: c?.[0] ?? 30 });
    }
    seeded.set(h.member ?? h.page!, {
      hostUserId,
      hostPageId,
      timezone: h.availability?.timezone ?? 'Africa/Lagos',
      windows: h.availability?.windows ?? [],
      services: byTitle,
    });
  }

  // Upcoming bookings at the start of the host's first working window on or after `days` ahead.
  for (const [bookerEmail, hostKey, title, days, note] of BOOKINGS) {
    const bookerId = userId.get(bookerEmail);
    const host = seeded.get(hostKey);
    const service = host?.services.get(title);
    if (!bookerId || !host || !service || !host.windows.length || bookerId === host.hostUserId) continue;
    let key = addDays(dayKey(new Date(), host.timezone), days);
    let window: Window | undefined;
    for (let i = 0; i < 14; i++) {
      const weekday = weekdayOf(key);
      window = host.windows.filter((w) => w.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start))[0];
      if (window) break;
      key = addDays(key, 1);
    }
    if (!window) continue;
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    const [hh, mm] = window.start.split(':').map(Number) as [number, number];
    const startsAt = zonedTime(host.timezone, y, m, d, hh, mm);
    if (!startsAt) continue;
    await db.insert(s.bookings).values({
      serviceId: service.id,
      hostUserId: host.hostUserId,
      hostPageId: host.hostPageId,
      bookerId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + service.minutes * 60_000),
      note,
    });
  }
}
