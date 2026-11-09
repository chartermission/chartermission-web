import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

const DAY = 86_400_000;
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** About text for each chapter page (edited later by its Ambassadors). */
const CHAPTER_ABOUT: Record<string, string> = {
  nigeria:
    'The Nigeria Chapter brings together founders, farmers, engineers and policy people across Lagos, Abuja and beyond. We meet monthly, run a cold-chain working group with ColdLink NG and Lagos AgriHub, and host open office hours for first-time founders.',
  ghana: 'Builders in Accra, Kumasi and Tamale working on payments, energy and agribusiness. Monthly meetups and a pay-as-you-go energy reading group.',
  kenya: 'Nairobi-based and growing in Mombasa and Kisumu. Our clean-cooking and health-data working groups meet every other Thursday.',
  'south-africa': 'Johannesburg and Cape Town members working on energy access, mining tech and township enterprise.',
  senegal: 'Dakar’s fintech and creative-industry community. Founder breakfasts on the first Friday of each month.',
  ethiopia: 'Addis Ababa members building in health, logistics and agriculture. New chapter: come and help shape it.',
  morocco: 'Casablanca and Rabat members focused on trade, AfCFTA readiness and manufacturing.',
  'united-kingdom': 'The UK diaspora chapter: London, Manchester and Birmingham members who invest, mentor and build with the continent.',
  uae: 'Dubai and Abu Dhabi diaspora members connecting Gulf capital and trade routes with African founders.',
};

type Listing = {
  key: string;
  poster: string;
  type: string;
  title: string;
  organisation: string;
  summary: string;
  description: string;
  remoteMode: 'remote' | 'in_person' | 'hybrid';
  country: string | null;
  city: string | null;
  sector: string | null;
  deadlineInDays: number | null;
  compensation: string | null;
  moreInfoUrl?: string;
  postedDaysAgo: number;
  status?: 'open' | 'closed';
};

const LISTINGS: Listing[] = [
  {
    key: 'designer',
    poster: 'kwame',
    type: 'employment',
    title: 'Product Designer, Cross-border Payments',
    organisation: 'PayBridge',
    summary: 'Design the merchant checkout and settlement flows used by small exporters across West Africa.',
    description:
      'PayBridge moves money for 3,000+ small exporters between Ghana, Nigeria and Côte d’Ivoire. You will own the end-to-end design of merchant onboarding, checkout and settlement, working with two engineers in Accra and one in Lagos.\n\nYou might be a fit if you have shipped mobile-first products for low-bandwidth users, enjoy talking to customers every week, and can explain a design decision in one sentence.\n\nWe hire on skills, not degrees. Include two or three pieces of work you are proud of in your note.',
    remoteMode: 'hybrid',
    country: 'GH',
    city: 'Accra',
    sector: 'Finance & fintech',
    deadlineInDays: 5,
    compensation: '$38k–52k + equity',
    postedDaysAgo: 9,
  },
  {
    key: 'fellowship',
    poster: 'fatou',
    type: 'fellowship',
    title: 'Women in Fintech Founders Fellowship 2027',
    organisation: 'Teranga Ventures',
    summary: 'A six-month programme with $25k non-dilutive funding for women-led fintech startups in West Africa.',
    description:
      'Ten founders join a six-month programme with $25,000 in non-dilutive funding, weekly office hours with operators, and a demo day in Dakar.\n\nEligibility: a woman founder or co-founder, an operating fintech product with paying users, and a team based in West Africa.\n\nIn your note, tell us what you are building, your traction so far, and what you would do with the funding.',
    remoteMode: 'remote',
    country: null,
    city: null,
    sector: 'Finance & fintech',
    deadlineInDays: 24,
    compensation: '$25k grant',
    moreInfoUrl: 'https://example.com/teranga-fellowship',
    postedDaysAgo: 6,
  },
  {
    key: 'coldchain',
    poster: 'tunde',
    type: 'employment',
    title: 'Operations Lead, Shared Cold Rooms',
    organisation: 'ColdLink NG',
    summary: 'Run day-to-day operations for our first three shared cold rooms serving farmer co-ops in Ogun State.',
    description:
      'We are opening three shared cold rooms for farmer co-operatives. You will hire and lead a team of eight, manage uptime and energy costs, and work with co-op leaders on scheduling.\n\nExperience running warehouses, cold chain or field operations matters more than titles. You will be based in Abeokuta with regular travel to Lagos.',
    remoteMode: 'in_person',
    country: 'NG',
    city: 'Abeokuta',
    sector: 'Agriculture & food',
    deadlineInDays: 18,
    compensation: '₦1.2m–1.6m / month',
    postedDaysAgo: 2,
  },
  {
    key: 'grant',
    poster: 'thabo',
    type: 'grant',
    title: 'Mini-grid Productive-Use Grants',
    organisation: 'GreenGrid Africa',
    summary: 'Grants of up to $15k for businesses that will use solar mini-grid power for milling, cooling or welding.',
    description:
      'We are funding equipment for businesses connected to solar mini-grids in South Africa, Ghana and Kenya: grain mills, cold storage, welding and more.\n\nGrants cover up to 70% of equipment costs, to a maximum of $15,000. Tell us about your business, the equipment you need and how many people it would serve.',
    remoteMode: 'remote',
    country: null,
    city: null,
    sector: 'Climate & energy',
    deadlineInDays: 40,
    compensation: 'Up to $15k',
    postedDaysAgo: 12,
  },
  {
    key: 'datasci',
    poster: 'zainab',
    type: 'internship',
    title: 'Health Data Science Intern',
    organisation: 'Afya Insights',
    summary: 'A paid three-month internship building maternal health dashboards with county health teams.',
    description:
      'Work alongside our data team cleaning clinic data and building dashboards that county health teams use every week. You will learn SQL, Python and how to present data to non-technical decision makers.\n\nOpen to final-year students and recent graduates in Kenya.',
    remoteMode: 'hybrid',
    country: 'KE',
    city: 'Nairobi',
    sector: 'Health',
    deadlineInDays: 12,
    compensation: 'KES 45,000 / month',
    postedDaysAgo: 4,
  },
  {
    key: 'mentors',
    poster: 'ngozi',
    type: 'volunteering',
    title: 'Volunteer Mentors for Agribusiness Apprentices',
    organisation: 'Lagos Youth Apprenticeships',
    summary: 'Mentor two apprentices for an hour a fortnight as they start their first agribusiness roles.',
    description:
      'Our apprentices are 18–24 and starting paid roles in agribusiness and logistics. Mentors meet them online for an hour every two weeks for six months.\n\nNo formal mentoring experience needed: curiosity and reliability matter most.',
    remoteMode: 'remote',
    country: null,
    city: null,
    sector: 'Education',
    deadlineInDays: null,
    compensation: null,
    postedDaysAgo: 15,
  },
  {
    key: 'tradecall',
    poster: 'leila',
    type: 'call_for_proposals',
    title: 'Call for Partners: AfCFTA Rules-of-Origin Clinics',
    organisation: 'Casablanca Trade Lab',
    summary: 'We are looking for chambers, hubs and associations to co-host free rules-of-origin clinics for exporters.',
    description:
      'We run half-day clinics that walk exporters through AfCFTA rules of origin with real paperwork. We are looking for partners in five countries to host clinics in 2027: you provide the room and the audience, we bring the trainers and materials.',
    remoteMode: 'hybrid',
    country: 'MA',
    city: 'Casablanca',
    sector: 'Trade & logistics',
    deadlineInDays: 30,
    compensation: null,
    postedDaysAgo: 20,
  },
  {
    key: 'closed',
    poster: 'amara',
    type: 'employment',
    title: 'Field Agronomist (Ogun & Oyo)',
    organisation: 'Lagos AgriHub',
    summary: 'Support 400 smallholder farmers with soil testing and post-harvest handling.',
    description: 'Visit partner farms weekly, run soil tests, train farmers on post-harvest handling and log results in our app. Motorbike provided.',
    remoteMode: 'in_person',
    country: 'NG',
    city: 'Ibadan',
    sector: 'Agriculture & food',
    deadlineInDays: 10,
    compensation: '₦650k / month',
    postedDaysAgo: 30,
    status: 'closed',
  },
];

/** [listing, applicant, status, note, daysAgo] */
const APPLICATIONS: [string, string, 'submitted' | 'shortlisted' | 'accepted' | 'declined', string, number][] = [
  ['designer', 'chinedu', 'shortlisted', 'I design tools for African exporters in London and have shipped two low-bandwidth checkout flows. Happy to share case studies.', 6],
  ['designer', 'owais', 'submitted', 'I run a software design studio in Dubai and have led payments UX for two fintechs. Open to relocating to Accra part-time.', 3],
  ['designer', 'yohannes', 'declined', 'I built the offline-first UI for our clinic app and would love to bring that experience to payments.', 8],
  ['fellowship', 'amara', 'submitted', 'Lagos AgriHub is adding embedded payments for farmers selling to cold rooms. 4,000 farmers, ₦40m monthly volume.', 2],
  ['coldchain', 'ngozi', 'submitted', 'I place apprentices in logistics roles and know the co-ops in Ogun well. I would love to talk about this role.', 1],
  ['grant', 'kofi', 'accepted', 'Our Kumasi mini-grid serves 120 shops; we need a grain mill and two chest freezers for the market co-op.', 9],
  ['datasci', 'wanjiru', 'submitted', 'I analyse county adaptation budgets and would like to move into health data. Strong in Excel and learning Python.', 2],
  ['mentors', 'aisha', 'accepted', 'I organise community programmes in Abuja and can mentor two apprentices online.', 10],
  ['closed', 'tunde', 'shortlisted', 'Five years running reefer fleets in Ogun; I know the post-harvest side well.', 25],
];

/**
 * Chapter pages (About text and pinned posts) and Opportunities (listings, applications, a
 * reported scam listing). Runs after content, events and ambassadors.
 */
export async function seedChaptersAndOpportunities(db: Db, ctx: SeedContext) {
  const id = (key: string) => ctx.ids[key];

  for (const [slug, about] of Object.entries(CHAPTER_ABOUT)) {
    if (ctx.chapters[slug]) await db.update(s.chapters).set({ about }).where(eq(s.chapters.id, ctx.chapters[slug]!));
  }

  // Pins: the newest posts shared in Nigeria and Kenya, pinned by their Ambassadors (or the platform team).
  for (const [slug, by, count] of [['nigeria', 'amara', 2], ['kenya', 'platformAdmin', 1]] as const) {
    const chapter = ctx.chapters[slug];
    if (!chapter) continue;
    const rows = await db
      .select({ id: s.posts.id })
      .from(s.posts)
      .where(and(eq(s.posts.chapterId, chapter), eq(s.posts.status, 'published'), eq(s.posts.moderationState, 'visible'), isNull(s.posts.deletedAt)))
      .orderBy(desc(s.posts.createdAt))
      .limit(count);
    if (rows.length) await db.insert(s.chapterPins).values(rows.map((r) => ({ chapterId: chapter, postId: r.id, pinnedBy: id(by) ?? null }))).onConflictDoNothing();
  }

  const sectorRows = await db.select({ id: s.sectors.id, name: s.sectors.name }).from(s.sectors);
  const sectorId = (name: string | null) => (name ? (sectorRows.find((r) => r.name === name)?.id ?? null) : null);
  const listingIds: Record<string, string> = {};
  for (const l of LISTINGS) {
    const poster = id(l.poster);
    if (!poster) continue;
    const created = ago(l.postedDaysAgo);
    const [row] = await db
      .insert(s.opportunities)
      .values({
        slug: `${l.title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '')}-${l.key.slice(0, 6).padEnd(6, '0')}`,
        posterId: poster,
        type: l.type,
        title: l.title,
        organisation: l.organisation,
        summary: l.summary,
        description: l.description,
        remoteMode: l.remoteMode,
        countryCode: l.country,
        city: l.city,
        sectorId: sectorId(l.sector),
        deadline: l.deadlineInDays === null ? null : isoIn(l.deadlineInDays),
        compensation: l.compensation,
        moreInfoUrl: l.moreInfoUrl ?? null,
        status: l.status ?? 'open',
        closedAt: l.status === 'closed' ? ago(3) : null,
        createdAt: created,
        updatedAt: created,
      })
      .onConflictDoNothing()
      .returning({ id: s.opportunities.id });
    if (row) listingIds[l.key] = row.id;
  }

  for (const [listing, applicant, status, note, daysAgo] of APPLICATIONS) {
    const opportunityId = listingIds[listing];
    const applicantId = id(applicant);
    if (!opportunityId || !applicantId) continue;
    await db
      .insert(s.opportunityApplications)
      .values({ opportunityId, applicantId, note, status, decidedAt: status === 'submitted' ? null : ago(Math.max(0, daysAgo - 1)), createdAt: ago(daysAgo), updatedAt: ago(Math.max(0, daysAgo - 1)) })
      .onConflictDoNothing();
  }
  const ids = Object.values(listingIds);
  if (ids.length) {
    await db
      .update(s.opportunities)
      .set({
        applicationCount: sql`(select count(*)::int from ${s.opportunityApplications} a where a.opportunity_id = ${s.opportunities.id} and a.status <> 'withdrawn')`,
      })
      .where(inArray(s.opportunities.id, ids));
  }

  // Saved listings for the main demo member.
  const owais = id('owais');
  if (owais) {
    const saved = ['fellowship', 'grant'].map((k) => listingIds[k]).filter((x): x is string => !!x);
    if (saved.length) await db.insert(s.bookmarks).values(saved.map((targetId) => ({ userId: owais, targetType: 'opportunity', targetId }))).onConflictDoNothing();
  }

  // A scam listing from the spammer account, reported twice: it waits in the moderation queue.
  const spammer = id('spammer');
  if (spammer) {
    const [scam] = await db
      .insert(s.opportunities)
      .values({
        slug: 'remote-data-entry-earn-500-daily-scam00',
        posterId: spammer,
        type: 'employment',
        title: 'Remote Data Entry: Earn $500 Daily',
        organisation: 'Easy Profits Hub',
        summary: 'No experience needed! Pay a small registration fee to start earning today.',
        description: 'Work from your phone. Pay the $30 registration fee by crypto to unlock your account and start earning $500 per day guaranteed.',
        remoteMode: 'remote',
        createdAt: ago(1),
        updatedAt: ago(1),
      })
      .onConflictDoNothing()
      .returning({ id: s.opportunities.id });
    if (scam) {
      const reports: (typeof s.contentReports.$inferInsert)[] = [];
      if (id('kwame')) reports.push({ reporterId: id('kwame')!, targetType: 'opportunity', targetId: scam.id, targetUserId: spammer, reasonCode: 'scam', detail: 'Asks applicants to pay a registration fee in crypto.', priority: 'high', createdAt: new Date(Date.now() - 5 * 3600_000) });
      if (id('chinedu')) reports.push({ reporterId: id('chinedu')!, targetType: 'opportunity', targetId: scam.id, targetUserId: spammer, reasonCode: 'spam', priority: 'high', createdAt: new Date(Date.now() - 2 * 3600_000) });
      if (reports.length) await db.insert(s.contentReports).values(reports);
    }
  }
}
