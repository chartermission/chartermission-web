import { hash } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { DEFAULT_FIELD_VISIBILITY } from '@chartermission/contracts';
import type { Db } from './client.js';
import * as s from './schema.js';
import { DEMO_PASSWORD, type SeedContext } from './seed-data.js';
import { encrypt } from '../common/crypto.js';
import { createStorage } from '../media/storage.js';
import { zonedMidnight, dayKey } from '../events/event-util.js';

/**
 * Demo events (called from seed.ts after members, chapters and feed content; event categories are
 * reference data seeded by seedReference). Idempotent: skips when the demo events exist.
 *
 * What the demo accounts see:
 *  - amara@ (event_host, chapter_lead of Lagos): registered for the Diaspora Investment Forum, the
 *    AfCFTA workshop and the Export Readiness Q&A starting in ~2 hours (join link visible); hosts the
 *    Nigeria chapter's events (Women in Leadership Circle, Founders Breakfast, past Demo Day with
 *    attendance marked) and has a draft.
 *  - kwame@ (event_host): hosts Founders' Office Hours (published), one event pending review
 *    (admin queue) and one with changes requested.
 *  - leila@: number 1 on the waitlist of the full Clean Cooking Hackathon (capacity 20).
 *  - owais@ / team@ (admins): review queue, featured Diaspora Investment Forum, a cancelled event.
 */

type Fmt = 'online' | 'in_person' | 'hybrid';
type Reg = { key: string; status: 'registered' | 'waitlisted' | 'cancelled' | 'attended' };

interface DemoEvent {
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  format: Fmt;
  host: { member: string } | { chapter: string };
  createdBy: string;
  tz: string;
  /** Local start: days from today in tz, and HH:MM; or an exact instant. */
  start: { days: number; at: string } | Date;
  minutes: number;
  venue?: { name: string; address?: string; city: string; country: string; mapUrl?: string };
  online?: { platform: string; url: string };
  capacity?: number | null;
  waitlist?: boolean;
  external?: string;
  deadlineDaysBefore?: number;
  status: 'draft' | 'pending_review' | 'changes_requested' | 'published' | 'archived';
  reviewNote?: string;
  submitNote?: string;
  submittedDaysAgo?: number;
  featured?: boolean;
  cancel?: string;
  speakers?: { name: string; title?: string; organisation?: string; member?: string }[];
  agenda?: { offset: number; minutes?: number; title: string; description?: string; speakers?: string[] }[];
  registrations?: Reg[];
  cover?: [string, string];
}

/** Extra attendees so the full hackathon really has 20 seats taken (they are ordinary members). */
const ATTENDEES: [string, string, string, string, string][] = [
  ['efua', 'Efua Boateng', 'efua-boateng', 'GH', 'Accra'],
  ['baraka', 'Baraka Otieno', 'baraka-otieno', 'KE', 'Nairobi'],
  ['amina', 'Amina Yusuf', 'amina-yusuf', 'NG', 'Kano'],
  ['moses', 'Moses Kiprono', 'moses-kiprono', 'KE', 'Eldoret'],
  ['adaeze', 'Adaeze Nwosu', 'adaeze-nwosu', 'NG', 'Enugu'],
  ['halima', 'Halima Said', 'halima-said', 'KE', 'Mombasa'],
  ['kojo', 'Kojo Owusu', 'kojo-owusu', 'GH', 'Kumasi'],
  ['wambui', 'Wambui Njeri', 'wambui-njeri', 'KE', 'Nairobi'],
  ['sefa', 'Sefa Antwi', 'sefa-antwi', 'GH', 'Takoradi'],
  ['juma', 'Juma Mwangi', 'juma-mwangi', 'KE', 'Nakuru'],
  ['nia', 'Nia Wekesa', 'nia-wekesa', 'KE', 'Kisumu'],
];

function localStart(tz: string, days: number, at: string): Date {
  const today = dayKey(new Date(), tz);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d + days));
  const midnight = zonedMidnight(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
  const [hh, mm] = at.split(':').map(Number) as [number, number];
  return new Date(midnight.getTime() + (hh * 60 + mm) * 60_000);
}

const regs = (keys: string[], status: Reg['status'] = 'registered'): Reg[] => keys.map((key) => ({ key, status }));

const HACKATHON_SEATS = ['wanjiru', 'zainab', 'chinedu', 'kofi', 'fatou', 'ngozi', 'tunde', 'kwame', 'amara', ...ATTENDEES.map((a) => a[0])];

function demoEvents(now: Date): DemoEvent[] {
  const soon = new Date(Math.ceil((now.getTime() + 2 * 3_600_000) / 300_000) * 300_000);
  return [
    {
      slug: 'diaspora-investment-forum-2026',
      title: 'Diaspora Investment Forum 2026',
      summary: 'Founders, investors and policymakers on making it easier to invest back home. Keynotes, deal rooms and chapter meet-ups.',
      description:
        'The Diaspora Investment Forum brings together founders, angel investors, fund managers and policymakers from across Africa and the diaspora for a day on one question: how do we make it easier to invest back home?\n\n## What to expect\n\nMorning keynotes on remittance-backed funds and diaspora bonds, an afternoon of curated deal rooms, and chapter meet-ups to close the day.\n\n## Who should come\n\nFounders raising pre-seed to Series A, diaspora professionals who want to invest, and anyone working on investment policy.',
      category: 'Conference',
      format: 'hybrid',
      host: { chapter: 'ghana' },
      createdBy: 'team',
      tz: 'Africa/Accra',
      start: { days: 15, at: '14:00' },
      minutes: 300,
      venue: { name: 'Kempinski Hotel Gold Coast City', address: 'Gamel Abdul Nasser Avenue', city: 'Accra', country: 'GH', mapUrl: 'https://maps.google.com/?q=Kempinski+Accra' },
      online: { platform: 'YouTube Live', url: 'https://youtube.com/live/diaspora-forum-2026' },
      capacity: 400,
      status: 'published',
      featured: true,
      speakers: [
        { name: 'Fatou Diallo', title: 'Partner', organisation: 'Sahel Ventures', member: 'fatou' },
        { name: 'Kwame Mensah', title: 'Product Lead', organisation: 'PayBridge', member: 'kwame' },
        { name: 'Dr. Ama Owusu-Ansah', title: 'Director of Investment Policy', organisation: 'Ghana Investment Promotion Centre' },
      ],
      agenda: [
        { offset: 0, minutes: 30, title: 'Welcome and opening keynote', speakers: ['Dr. Ama Owusu-Ansah'] },
        { offset: 30, minutes: 60, title: 'Panel: diaspora capital beyond remittances', speakers: ['Fatou Diallo', 'Kwame Mensah'] },
        { offset: 105, minutes: 120, title: 'Deal rooms', description: 'Twelve founders pitch to small investor groups.' },
        { offset: 240, minutes: 60, title: 'Chapter meet-ups and networking' },
      ],
      registrations: regs(['amara', 'kwame', 'fatou', 'chinedu', 'kofi', 'efua', 'sefa', 'kojo']),
      cover: ['#047942', '#E31A20'],
    },
    {
      slug: 'founders-office-hours-fundraising-2027',
      title: 'Founders’ Office Hours: Fundraising in 2027',
      summary: 'Bring your deck and your questions. Small-group office hours on raising your first round in a tighter market.',
      description:
        'Kwame hosts an hour of open office hours for early-stage founders. Come with your deck, your data room questions or your term sheet worries.\n\nWe’ll split into small groups of eight so everyone gets time.',
      category: 'Webinar',
      format: 'online',
      host: { member: 'kwame' },
      createdBy: 'kwame',
      tz: 'Africa/Nairobi',
      start: { days: 18, at: '17:00' },
      minutes: 90,
      online: { platform: 'Zoom', url: 'https://zoom.us/j/81234567890?pwd=office-hours' },
      capacity: 150,
      status: 'published',
      submittedDaysAgo: 6,
      speakers: [{ name: 'Kwame Mensah', title: 'Product Lead', organisation: 'PayBridge', member: 'kwame' }],
      registrations: regs(['tunde', 'zainab', 'yohannes', 'ngozi']),
      cover: ['#0f5c4d', '#d98b2b'],
    },
    {
      slug: 'clean-cooking-hackathon',
      title: 'Clean Cooking Hackathon',
      summary: 'Two days building tools that help households switch to clean cooking. Teams of four, mentors on site, prizes for the best prototypes.',
      description:
        'Over 70% of households in East Africa still cook with charcoal or firewood. Join engineers, designers and policy people for two days of building.\n\n## Tracks\n\nPay-as-you-go financing, LPG distribution logistics and household air-quality data.\n\n## Practical details\n\nLunch is provided both days. Bring a laptop. Teams form on the morning of day one.',
      category: 'Hackathon',
      format: 'in_person',
      host: { chapter: 'kenya' },
      createdBy: 'team',
      tz: 'Africa/Nairobi',
      start: { days: 22, at: '09:00' },
      minutes: 32 * 60,
      venue: { name: 'iHub Nairobi', address: 'Senteu Plaza, Galana Road, Kilimani', city: 'Nairobi', country: 'KE' },
      capacity: 20,
      waitlist: true,
      deadlineDaysBefore: 2,
      status: 'published',
      speakers: [
        { name: 'Wanjiru Kamau', title: 'Climate Policy Analyst', member: 'wanjiru' },
        { name: 'Zainab Abdi', title: 'Health data scientist', member: 'zainab' },
      ],
      agenda: [
        { offset: 0, minutes: 60, title: 'Kick-off and team formation', speakers: ['Wanjiru Kamau'] },
        { offset: 60, minutes: 420, title: 'Build, day one' },
        { offset: 24 * 60, minutes: 360, title: 'Build, day two' },
        { offset: 30 * 60, minutes: 120, title: 'Demos and judging', speakers: ['Zainab Abdi'] },
      ],
      registrations: [...regs(HACKATHON_SEATS), ...regs(['leila', 'thabo', 'yohannes'], 'waitlisted')],
      cover: ['#1f6f8b', '#99d98c'],
    },
    {
      slug: 'women-in-leadership-circle',
      title: 'Women in Leadership Circle',
      summary: 'An evening with women leading companies, funds and public institutions across West Africa. Panel, then small-group circles.',
      description:
        'A candid conversation about leadership, from first management role to the boardroom. After the panel we break into small circles, in the room and online.',
      category: 'Panel',
      format: 'hybrid',
      host: { chapter: 'nigeria' },
      createdBy: 'amara',
      tz: 'Africa/Lagos',
      start: { days: 27, at: '18:00' },
      minutes: 150,
      venue: { name: 'The Civic Centre', address: 'Ozumba Mbadiwe Avenue, Victoria Island', city: 'Lagos', country: 'NG' },
      online: { platform: 'Google Meet', url: 'https://meet.google.com/wlc-lagos-2026' },
      capacity: 120,
      status: 'published',
      submittedDaysAgo: 9,
      speakers: [
        { name: 'Amara Okafor', title: 'Founder', organisation: 'Lagos AgriHub', member: 'amara' },
        { name: 'Ngozi Adebayo', title: 'Youth employment programme lead', member: 'ngozi' },
        { name: 'Fatou Diallo', title: 'Partner', organisation: 'Sahel Ventures', member: 'fatou' },
      ],
      agenda: [
        { offset: 0, minutes: 15, title: 'Welcome' },
        { offset: 15, minutes: 60, title: 'Panel: leading through growth', speakers: ['Amara Okafor', 'Ngozi Adebayo', 'Fatou Diallo'] },
        { offset: 90, minutes: 60, title: 'Leadership circles' },
      ],
      registrations: regs(['ngozi', 'zainab', 'adaeze', 'amina', 'fatou']),
      cover: ['#7b2d5b', '#f2a65a'],
    },
    {
      slug: 'afcfta-rules-of-origin-explained',
      title: 'AfCFTA Rules of Origin Explained',
      summary: 'A practical walkthrough of AfCFTA rules of origin for exporters: what qualifies, the paperwork, and the mistakes that cost you the tariff cut.',
      description:
        'Leila Benali turns the rules of origin annex into a checklist you can use. Bring a product you export (or want to) and we’ll work through it together.\n\n## You’ll leave with\n\nA one-page checklist, sample certificates of origin and a list of the national contact points.',
      category: 'Workshop',
      format: 'online',
      host: { member: 'team' },
      createdBy: 'team',
      tz: 'Europe/London',
      start: { days: 29, at: '12:00' },
      minutes: 90,
      online: { platform: 'Zoom', url: 'https://zoom.us/j/89876543210?pwd=afcfta-roo' },
      capacity: 500,
      status: 'published',
      speakers: [{ name: 'Leila Benali', title: 'Trade Economist', member: 'leila' }],
      agenda: [
        { offset: 0, minutes: 40, title: 'How rules of origin work', speakers: ['Leila Benali'] },
        { offset: 40, minutes: 30, title: 'Worked examples from your products', speakers: ['Leila Benali'] },
        { offset: 70, minutes: 20, title: 'Questions' },
      ],
      registrations: regs(['amara', 'tunde', 'kofi', 'thabo', 'chinedu', 'kojo']),
      cover: ['#3a506b', '#5bc0be'],
    },
    {
      slug: 'lagos-founders-breakfast',
      title: 'Lagos Founders Breakfast',
      summary: 'Coffee, akara and honest conversation with Lagos founders. Informal, small and early — done by 10.',
      description: 'A monthly breakfast for founders in the Nigeria chapter. No talks, no slides: just a table and good company.',
      category: 'Meet-up',
      format: 'in_person',
      host: { chapter: 'nigeria' },
      createdBy: 'amara',
      tz: 'Africa/Lagos',
      start: { days: 9, at: '08:00' },
      minutes: 120,
      venue: { name: 'Bogobiri House', address: '9 Maitama Sule Street, Ikoyi', city: 'Lagos', country: 'NG' },
      capacity: 30,
      status: 'published',
      submittedDaysAgo: 12,
      registrations: regs(['tunde', 'ngozi', 'adaeze', 'amina']),
    },
    {
      slug: 'learning-sprint-data-for-development',
      title: 'Learning Sprint: Data for Development',
      summary: 'A four-week guided sprint on Charter Center. Registration happens on Charter Center itself.',
      description: 'Weekly live sessions plus self-paced lessons on using public data for development work. Registration and course access are on Charter Center.',
      category: 'Training',
      format: 'online',
      host: { member: 'team' },
      createdBy: 'team',
      tz: 'Europe/London',
      start: { days: 36, at: '10:00' },
      minutes: 120,
      online: { platform: 'Charter Center', url: 'https://chartercenter.org/live/data-for-development' },
      external: 'https://chartercenter.org/sprints/data-for-development',
      status: 'published',
      cover: ['#264653', '#e9c46a'],
    },
    {
      slug: 'export-readiness-clinic-live-qa',
      title: 'Export Readiness Clinic: Live Q&A',
      summary: 'Bring your export questions: certification, buyers, logistics. A live Q&A with the Charter Mission trade team.',
      description: 'An hour of live questions and answers on getting export-ready. Registered members see the join link on this page.',
      category: 'Webinar',
      format: 'online',
      host: { member: 'team' },
      createdBy: 'team',
      tz: 'Africa/Lagos',
      start: soon,
      minutes: 60,
      online: { platform: 'Google Meet', url: 'https://meet.google.com/erc-live-qa' },
      capacity: 200,
      status: 'published',
      speakers: [{ name: 'Leila Benali', title: 'Trade Economist', member: 'leila' }],
      registrations: regs(['amara', 'tunde', 'kofi']),
    },
    {
      slug: 'lagos-agritech-demo-day',
      title: 'Lagos AgriTech Demo Day',
      summary: 'Eight agritech start-ups from the Nigeria chapter demoed to buyers, cooperatives and investors.',
      description:
        'Eight start-ups working on cold storage, input financing and farm-gate pricing presented to an audience of buyers, cooperatives and investors.\n\n## Recording\n\nSlides from each team are available from the chapter page.',
      category: 'Conference',
      format: 'in_person',
      host: { chapter: 'nigeria' },
      createdBy: 'amara',
      tz: 'Africa/Lagos',
      start: { days: -20, at: '10:00' },
      minutes: 240,
      venue: { name: 'Co-Creation Hub', address: '294 Herbert Macaulay Way, Yaba', city: 'Lagos', country: 'NG' },
      capacity: 80,
      status: 'archived',
      submittedDaysAgo: 40,
      speakers: [{ name: 'Amara Okafor', title: 'Founder', organisation: 'Lagos AgriHub', member: 'amara' }],
      agenda: [
        { offset: 0, minutes: 30, title: 'Opening', speakers: ['Amara Okafor'] },
        { offset: 30, minutes: 150, title: 'Demos' },
        { offset: 180, minutes: 60, title: 'Buyer meetings' },
      ],
      registrations: [...regs(['kwame', 'tunde', 'ngozi', 'adaeze'], 'attended'), ...regs(['kofi', 'amina'])],
      cover: ['#386641', '#a7c957'],
    },
    {
      slug: 'nairobi-climate-finance-roundtable',
      title: 'Nairobi Climate Finance Roundtable',
      summary: 'County officials, funders and project developers on getting adaptation finance to the counties that need it.',
      description: 'A roundtable on county-level adaptation finance in Kenya: what is flowing, what is stuck, and what would unblock it.',
      category: 'Panel',
      format: 'hybrid',
      host: { chapter: 'kenya' },
      createdBy: 'team',
      tz: 'Africa/Nairobi',
      start: { days: -5, at: '15:00' },
      minutes: 120,
      venue: { name: 'Strathmore University', address: 'Ole Sangale Road', city: 'Nairobi', country: 'KE' },
      online: { platform: 'Zoom', url: 'https://zoom.us/j/80000000001' },
      capacity: 60,
      status: 'published',
      speakers: [{ name: 'Wanjiru Kamau', title: 'Climate Policy Analyst', member: 'wanjiru' }],
      agenda: [
        { offset: 0, minutes: 60, title: 'Where adaptation finance goes today', speakers: ['Wanjiru Kamau'] },
        { offset: 60, minutes: 60, title: 'Open discussion' },
      ],
      registrations: regs(['wanjiru', 'zainab', 'baraka', 'halima']),
    },
    {
      slug: 'diaspora-remittances-webinar',
      title: 'Diaspora Remittances: Cheaper, Faster, Safer',
      summary: 'What’s changed in sending money home: new corridors, mobile money interoperability and the cost of a £200 transfer.',
      description: 'A webinar on the cost and speed of remittances into West and East Africa, with a look at what mobile money interoperability changes.',
      category: 'Webinar',
      format: 'online',
      host: { member: 'team' },
      createdBy: 'team',
      tz: 'Europe/London',
      start: { days: -40, at: '18:00' },
      minutes: 60,
      online: { platform: 'Zoom', url: 'https://zoom.us/j/80000000002' },
      status: 'archived',
      speakers: [{ name: 'Kwame Mensah', title: 'Product Lead', organisation: 'PayBridge', member: 'kwame' }],
      registrations: regs(['chinedu', 'amara', 'fatou']),
    },
    {
      slug: 'mobile-money-interoperability-clinic',
      title: 'Mobile Money Interoperability Clinic',
      summary: 'A hands-on clinic for fintech teams integrating with GhIPSS and M-Pesa APIs: sandboxes, settlement and the gotchas.',
      description: 'Bring your integration questions. We’ll walk through sandbox set-up, settlement timing and reconciliation, then open the floor.',
      category: 'Workshop',
      format: 'online',
      host: { member: 'kwame' },
      createdBy: 'kwame',
      tz: 'Africa/Accra',
      start: { days: 33, at: '16:00' },
      minutes: 120,
      online: { platform: 'Google Meet', url: 'https://meet.google.com/mmi-clinic' },
      capacity: 60,
      status: 'pending_review',
      submittedDaysAgo: 3,
      submitNote: 'Second run of the clinic — the first one filled up in a day.',
      speakers: [{ name: 'Kwame Mensah', title: 'Product Lead', organisation: 'PayBridge', member: 'kwame' }],
      agenda: [
        { offset: 0, minutes: 45, title: 'Sandboxes and test credentials' },
        { offset: 45, minutes: 45, title: 'Settlement and reconciliation' },
        { offset: 90, minutes: 30, title: 'Your questions' },
      ],
    },
    {
      slug: 'accra-fintech-meet-up',
      title: 'Accra Fintech Meet-up',
      summary: 'Drinks and short lightning talks from Accra’s fintech builders.',
      description: 'Lightning talks, then drinks.',
      category: 'Meet-up',
      format: 'in_person',
      host: { member: 'kwame' },
      createdBy: 'kwame',
      tz: 'Africa/Accra',
      start: { days: 40, at: '18:30' },
      minutes: 150,
      venue: { name: 'Impact Hub Accra', city: 'Accra', country: 'GH' },
      capacity: 50,
      status: 'changes_requested',
      submittedDaysAgo: 5,
      reviewNote: 'Please add the venue address and a short agenda of the lightning talks before we list this.',
    },
    {
      slug: 'accra-trade-policy-breakfast',
      title: 'Accra Trade Policy Breakfast',
      summary: 'Breakfast briefing on the new ECOWAS trade measures with the Ghana chapter.',
      description: 'A short briefing over breakfast on the latest ECOWAS trade measures and what they mean for exporters.',
      category: 'Networking',
      format: 'in_person',
      host: { chapter: 'ghana' },
      createdBy: 'team',
      tz: 'Africa/Accra',
      start: { days: 12, at: '07:30' },
      minutes: 90,
      venue: { name: 'Movenpick Ambassador Hotel', address: 'Independence Avenue', city: 'Accra', country: 'GH' },
      capacity: 40,
      status: 'published',
      cancel: 'The venue is no longer available that morning. We’ll announce a new date soon.',
      registrations: regs(['kofi', 'leila', 'efua']),
    },
    {
      slug: 'lagos-chapter-volunteer-onboarding',
      title: 'Nigeria Chapter Volunteer Onboarding',
      summary: 'Welcome session for new Nigeria chapter volunteers: how the chapter runs and where you can help.',
      description: 'Draft — agenda to follow.',
      category: 'Training',
      format: 'online',
      host: { chapter: 'nigeria' },
      createdBy: 'amara',
      tz: 'Africa/Lagos',
      start: { days: 45, at: '17:00' },
      minutes: 60,
      online: { platform: 'Google Meet', url: 'https://meet.google.com/lagos-volunteers' },
      capacity: 40,
      status: 'draft',
    },
  ];
}

async function demoCover(db: Db, ownerId: string, label: string, colors: [string, string]): Promise<string | null> {
  try {
    const width = 1200;
    const height = 630;
    const text = label.replace(/[<&>]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
      <text x="60" y="${height - 70}" font-family="sans-serif" font-weight="700" font-size="48" fill="#ffffff">${text}</text></svg>`;
    const data = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
    const [file] = await db
      .insert(s.files)
      .values({
        ownerId,
        purpose: 'event_cover',
        storageKey: 'pending',
        originalName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`,
        declaredMime: 'image/jpeg',
        mime: 'image/jpeg',
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        width,
        height,
        scanStatus: 'clean',
        attachedAt: new Date(),
      })
      .returning();
    const key = `uploads/event_cover/${file!.id}`;
    await createStorage().write(key, data, 'image/jpeg');
    await db.update(s.files).set({ storageKey: key }).where(eq(s.files.id, file!.id));
    return file!.id;
  } catch (err) {
    console.warn(`Skipped an event cover: ${String(err)}`);
    return null;
  }
}

async function seedAttendees(db: Db): Promise<Record<string, string>> {
  const passwordHash = await hash(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const [key, name, handle, country, city] of ATTENDEES) {
    const email = `${key}@example.com`;
    const joinedAt = new Date(Date.now() - (60 + ATTENDEES.findIndex((a) => a[0] === key) * 9) * 86_400_000);
    const [u] = await db
      .insert(s.users)
      .values({ email, passwordHash, status: 'active', emailVerifiedAt: joinedAt, createdAt: joinedAt })
      .onConflictDoNothing()
      .returning({ id: s.users.id });
    const id = u?.id ?? (await db.select({ id: s.users.id }).from(s.users).where(sql`lower(email) = ${email}`))[0]!.id;
    ids[key] = id;
    await db
      .insert(s.memberProfiles)
      .values({
        userId: id,
        handle,
        displayName: name,
        headline: 'Member',
        countryCode: country,
        city,
        fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
        onboardingStep: 4,
        onboardingCompletedAt: joinedAt,
        createdAt: joinedAt,
      })
      .onConflictDoNothing();
  }
  return ids;
}

async function grantRole(db: Db, userId: string, roleKey: string, scope?: { type: string; id: string }) {
  const [role] = await db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, roleKey)).limit(1);
  if (!role) return;
  const existing = await db
    .select({ id: s.userRoles.id })
    .from(s.userRoles)
    .where(
      and(
        eq(s.userRoles.userId, userId),
        eq(s.userRoles.roleId, role.id),
        scope ? and(eq(s.userRoles.scopeType, scope.type), eq(s.userRoles.scopeId, scope.id)) : sql`${s.userRoles.scopeType} is null`,
      ),
    )
    .limit(1);
  if (existing.length) return;
  await db.insert(s.userRoles).values({ userId, roleId: role.id, scopeType: scope?.type ?? null, scopeId: scope?.id ?? null });
}

export async function seedEvents(db: Db, ctx: SeedContext): Promise<void> {
  const ids = ctx.ids;
  if (!ids.amara || !ids.kwame || !ids.team) return;
  await grantRole(db, ids.amara, 'event_host');
  await grantRole(db, ids.kwame, 'event_host');
  if (ctx.chapters.lagos) await grantRole(db, ids.amara, 'chapter_lead', { type: 'chapter', id: ctx.chapters.lagos });

  const [existing] = await db.select({ id: s.events.id }).from(s.events).where(eq(s.events.slug, 'diaspora-investment-forum-2026')).limit(1);
  if (existing) return;

  const people = { ...ids, ...(await seedAttendees(db)) };
  const categories = new Map((await db.select().from(s.eventCategories)).map((c) => [c.name, c.id]));
  const now = new Date();
  const reviewer = ids.moderator ?? ids.platformAdmin ?? ids.team;
  let count = 0;

  for (const e of demoEvents(now)) {
    const startsAt = e.start instanceof Date ? e.start : localStart(e.tz, e.start.days, e.start.at);
    const endsAt = new Date(startsAt.getTime() + e.minutes * 60_000);
    const creator = people[e.createdBy]!;
    const chapterId = 'chapter' in e.host ? ctx.chapters[e.host.chapter] : undefined;
    const chapterCountry = chapterId ? (await db.select({ cc: s.chapters.countryCode }).from(s.chapters).where(eq(s.chapters.id, chapterId)))[0]?.cc : null;
    const submittedAt = e.submittedDaysAgo !== undefined ? new Date(now.getTime() - e.submittedDaysAgo * 86_400_000) : e.status === 'draft' ? null : new Date(startsAt.getTime() - 30 * 86_400_000);
    const live = e.status === 'published' || e.status === 'archived';
    const coverFileId = e.cover ? await demoCover(db, creator, e.title, e.cover) : null;
    const [row] = await db
      .insert(s.events)
      .values({
        slug: e.slug,
        title: e.title,
        summary: e.summary,
        description: e.description,
        categoryId: categories.get(e.category) ?? null,
        format: e.format,
        status: e.status,
        hostType: chapterId ? 'chapter' : 'member',
        hostMemberId: chapterId ? null : people[(e.host as { member: string }).member]!,
        hostChapterId: chapterId ?? null,
        startsAt,
        endsAt,
        timezone: e.tz,
        venueName: e.venue?.name ?? null,
        venueAddress: e.venue?.address ?? null,
        venueCity: e.venue?.city ?? null,
        venueMapUrl: e.venue?.mapUrl ?? null,
        countryCode: e.venue?.country ?? chapterCountry ?? null,
        onlinePlatform: e.online?.platform ?? null,
        onlineUrlEnc: e.online ? encrypt(e.online.url) : null,
        registrationMode: e.external ? 'external' : 'internal',
        externalUrl: e.external ?? null,
        capacity: e.external ? null : (e.capacity ?? null),
        waitlistEnabled: e.waitlist ?? true,
        registrationDeadline: e.deadlineDaysBefore ? new Date(startsAt.getTime() - e.deadlineDaysBefore * 86_400_000) : null,
        agenda: (e.agenda ?? []).map((a) => ({
          startsAt: new Date(startsAt.getTime() + a.offset * 60_000).toISOString(),
          endsAt: a.minutes ? new Date(startsAt.getTime() + (a.offset + a.minutes) * 60_000).toISOString() : null,
          title: a.title,
          description: a.description ?? null,
          speakerNames: a.speakers ?? [],
        })),
        coverFileId,
        featured: !!e.featured,
        featuredAt: e.featured ? now : null,
        submittedAt,
        submitNote: e.submitNote ?? null,
        reviewedAt: e.reviewNote || (live && e.createdBy !== 'team') ? new Date((submittedAt ?? now).getTime() + 86_400_000) : null,
        reviewedBy: e.reviewNote || (live && e.createdBy !== 'team') ? reviewer : null,
        reviewNote: e.reviewNote ?? null,
        publishedAt: live ? (submittedAt ?? now) : null,
        cancelledAt: e.cancel ? new Date(now.getTime() - 86_400_000) : null,
        cancelReason: e.cancel ?? null,
        cancelledBy: e.cancel ? creator : null,
        createdBy: creator,
        createdAt: new Date((submittedAt ?? now).getTime() - 2 * 86_400_000),
      })
      .returning({ id: s.events.id });
    const eventId = row!.id;
    if (e.speakers?.length) {
      await db.insert(s.eventSpeakers).values(
        e.speakers.map((sp, position) => ({
          eventId,
          position,
          name: sp.name,
          title: sp.title ?? null,
          organisation: sp.organisation ?? null,
          memberId: sp.member ? (people[sp.member] ?? null) : null,
        })),
      );
    }
    let position = 0;
    let seats = 0;
    let waiting = 0;
    for (const [i, r] of (e.registrations ?? []).entries()) {
      const userId = people[r.key];
      if (!userId) continue;
      const registeredAt = new Date(Math.min(now.getTime(), startsAt.getTime()) - (20 - i) * 3_600_000 - 3 * 86_400_000);
      if (r.status === 'waitlisted') position++;
      await db.insert(s.eventRegistrations).values({
        eventId,
        userId,
        status: r.status,
        position: r.status === 'waitlisted' ? position : null,
        registeredAt,
        attendedAt: r.status === 'attended' ? new Date(startsAt.getTime() + 15 * 60_000) : null,
      });
      if (r.status === 'registered' || r.status === 'attended') seats++;
      if (r.status === 'waitlisted') waiting++;
    }
    await db.update(s.events).set({ registeredCount: seats, waitlistCount: waiting }).where(eq(s.events.id, eventId));
    count++;
  }
  console.log(`Seeded ${count} demo events`);
}
