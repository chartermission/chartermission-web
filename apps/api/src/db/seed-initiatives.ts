import { eq, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Demo initiatives (development and staging only): one hosted by a page, one by a chapter and the
 * rest by members, with roles, milestones, a team, a pending join request and a few updates.
 * Skipped once any initiative exists.
 */

type Seed = {
  slug: string;
  title: string;
  sector: string;
  country: string;
  status: string;
  host: { page?: string; chapter?: string };
  lead: string;
  summary: string;
  description: string;
  roles: { title: string; description: string; skills: string[] }[];
  /** [title, note, done] */
  milestones: [string, string, boolean][];
  team: [string, string, boolean?][];
  updates: { by: string; body: string; daysAgo: number }[];
  followers: string[];
  request?: { by: string; note: string };
};

const SEEDS: Seed[] = [
  {
    slug: 'farm-to-port-lagos',
    title: 'Farm-to-Port Lagos',
    sector: 'Agriculture & food',
    country: 'NG',
    status: 'recruiting',
    host: { page: 'lagos-agrihub' },
    lead: 'amara',
    summary: 'Cold-chain hubs that move smallholder produce from farm gate to Lagos ports in under 48 hours.',
    description:
      'Cold-chain hubs that move smallholder produce from farm gate to Lagos ports in under 48 hours — cutting post-harvest loss and opening export markets under AfCFTA.\n\nWe start with one hub in Agbara and a single corridor from Ogun and Oyo farms to Apapa, then add corridors as the numbers prove out.',
    roles: [
      { title: 'Cold-chain logistics lead', description: 'Design routes and hub schedules for the pilot corridor. ~6 hrs/week.', skills: ['Logistics', 'Ops'] },
      { title: 'Export compliance advisor', description: 'Help growers meet EU and AfCFTA certification. ~3 hrs/week.', skills: ['Trade', 'Certification'] },
      { title: 'Data volunteer', description: 'Build the loss-tracking dashboard. Remote. ~4 hrs/week.', skills: ['SQL', 'Dashboards'] },
    ],
    milestones: [
      ['Partner farms signed', '40 farms across Ogun and Oyo', true],
      ['Hub site secured', 'Agbara industrial estate', true],
      ['Pilot hub live', 'First produce shipped in 31 hours', true],
      ['Second corridor', 'Ibadan → Apapa', false],
      ['Export certification', 'EU GlobalG.A.P. for 12 farms', false],
      ['Scale to 3 hubs', 'Target Q3 2027', false],
    ],
    team: [
      ['chinedu', 'Product & design · London'],
      ['thabo', 'Solar cold rooms · Johannesburg', true],
      ['leila', 'Trade advisor · Casablanca'],
    ],
    updates: [
      { by: 'amara', body: 'Milestone 3 done ✅ Our first refrigerated truck reached Apapa in 31 hours with zero spoilage. Thank you to everyone who made this happen. #FarmToPort #AfCFTA', daysAgo: 3 },
      { by: 'amara', body: 'We’re looking for a cold-chain logistics lead for the Ibadan corridor. If you’ve planned routes for perishables, ask to join. #AgriTech', daysAgo: 9 },
    ],
    followers: ['kwame', 'fatou', 'owais'],
    request: { by: 'tunde', note: 'I ran cold-chain routes for a dairy co-op in Ibadan for four years and can help plan the second corridor.' },
  },
  {
    slug: 'clean-cooking-nairobi',
    title: 'Clean Cooking Nairobi',
    sector: 'Climate & energy',
    country: 'KE',
    status: 'active',
    host: { chapter: 'kenya' },
    lead: 'wanjiru',
    summary: 'Replacing charcoal stoves with LPG and ethanol in 5,000 Nairobi households, financed by carbon credits.',
    description:
      'Replacing charcoal stoves with LPG and ethanol in 5,000 Nairobi households. Families pay as they cook, and verified carbon credits cover the cost of the stoves.',
    roles: [
      { title: 'Carbon-finance analyst', description: 'Model credit issuance and buyer pricing. ~4 hrs/week.', skills: ['Carbon markets', 'Excel'] },
      { title: 'Hardware mentor', description: 'Advise on stove maintenance and spare parts. ~2 hrs/week.', skills: ['Hardware'] },
    ],
    milestones: [
      ['Supplier partnerships', 'Two LPG distributors signed', true],
      ['Pay-as-you-cook pilot', '500 homes in Kibera', true],
      ['Carbon credits verified', 'First issuance', true],
      ['3,200 homes reached', 'Kibera, Mathare and Kawangware', false],
      ['5,000 homes', 'Target Mar 2027', false],
    ],
    team: [['kofi', 'Energy access · Accra'], ['zainab', 'Household survey lead · Nairobi']],
    updates: [{ by: 'wanjiru', body: '3,000 homes and counting. Our latest survey shows families saving about a fifth of their monthly fuel spend. #CleanCooking', daysAgo: 5 }],
    followers: ['thabo', 'amara'],
  },
  {
    slug: 'code-kumasi',
    title: 'Code Kumasi',
    sector: 'Education',
    country: 'GH',
    status: 'recruiting',
    host: {},
    lead: 'kwame',
    summary: 'Free weekend coding bootcamps for secondary-school girls in Kumasi, with diaspora mentors.',
    description: 'Free weekend coding bootcamps for secondary-school girls in Kumasi. Diaspora engineers mentor each student online through a 12-week Python track.',
    roles: [
      { title: 'Online mentor', description: 'Meet one student weekly for 12 weeks. Remote. ~1 hr/week.', skills: ['Python', 'Mentoring'] },
      { title: 'Weekend instructor', description: 'Teach Saturday sessions in Kumasi. ~4 hrs/week.', skills: ['Teaching', 'Python'] },
    ],
    milestones: [
      ['Curriculum drafted', '12-week Python track', true],
      ['Venue and laptops', 'KNUST partnership', false],
      ['First cohort', '40 students', false],
      ['Demo day', 'Target Apr 2027', false],
    ],
    team: [['ngozi', 'Programme design · Lagos']],
    updates: [],
    followers: ['chinedu'],
  },
  {
    slug: 'rules-of-origin-toolkit',
    title: 'Rules of Origin Toolkit',
    sector: 'Trade & logistics',
    country: 'MA',
    status: 'completed',
    host: {},
    lead: 'leila',
    summary: 'A plain-language guide to AfCFTA rules of origin for first-time exporters, in English, French and Arabic.',
    description: 'A plain-language guide to AfCFTA rules of origin for first-time exporters, published free in English, French and Arabic.',
    roles: [],
    milestones: [
      ['Research', 'Interviews with 30 exporters', true],
      ['English draft', '', true],
      ['French and Arabic editions', '', true],
      ['Published', 'Free download', true],
    ],
    team: [['fatou', 'Editor · Dakar']],
    updates: [{ by: 'leila', body: 'The toolkit is out in all three languages. Thank you to the 30 exporters who shared their experience. #AfCFTA #Trade', daysAgo: 40 }],
    followers: ['amara', 'kwame'],
  },
];

export async function seedInitiatives(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.initiatives.id }).from(s.initiatives).limit(1);
  if (existing) return;
  const id = (key: string) => ctx.ids[key];
  const sectorRows = await db.select({ id: s.sectors.id, name: s.sectors.name }).from(s.sectors);
  const sectorId = new Map(sectorRows.map((r) => [r.name, r.id]));
  const pageRows = await db.select({ id: s.pages.id, slug: s.pages.slug }).from(s.pages).where(inArray(s.pages.slug, SEEDS.map((x) => x.host.page ?? '').filter(Boolean)));
  const pageId = new Map(pageRows.map((p) => [p.slug, p.id]));
  const day = 86_400_000;

  for (const [n, seed] of SEEDS.entries()) {
    const lead = id(seed.lead);
    if (!lead) continue;
    const hostPageId = seed.host.page ? pageId.get(seed.host.page) : undefined;
    const hostChapterId = seed.host.chapter ? ctx.chapters[seed.host.chapter] : undefined;
    const hostType = hostPageId ? 'page' : hostChapterId ? 'chapter' : 'member';
    const updatedAt = new Date(Date.now() - n * day);
    const [row] = await db
      .insert(s.initiatives)
      .values({
        slug: seed.slug,
        title: seed.title,
        summary: seed.summary,
        description: seed.description,
        sectorId: sectorId.get(seed.sector) ?? null,
        countryCode: seed.country,
        status: seed.status,
        hostType,
        hostPageId: hostPageId ?? null,
        hostChapterId: hostChapterId ?? null,
        leadId: lead,
        followerCount: seed.followers.filter(id).length,
        createdAt: new Date(Date.now() - (60 + n * 10) * day),
        updatedAt,
      })
      .returning({ id: s.initiatives.id });
    const initiativeId = row!.id;
    await db.insert(s.initiativeMembers).values([
      { initiativeId, userId: lead, role: 'Initiative lead', organiser: true },
      ...seed.team.filter(([key]) => id(key)).map(([key, role, organiser]) => ({ initiativeId, userId: id(key)!, role, organiser: !!organiser })),
    ]);
    const roles = seed.roles.length
      ? await db
          .insert(s.initiativeRoles)
          .values(seed.roles.map((r, position) => ({ ...r, initiativeId, position })))
          .returning({ id: s.initiativeRoles.id })
      : [];
    if (seed.milestones.length) {
      await db.insert(s.initiativeMilestones).values(
        seed.milestones.map(([title, note, done], position) => ({
          initiativeId,
          title,
          note: note || null,
          doneAt: done ? new Date(Date.now() - (seed.milestones.length - position) * 30 * day) : null,
          position,
        })),
      );
    }
    const followers = seed.followers.map(id).filter((x): x is string => !!x);
    if (followers.length) {
      await db.insert(s.follows).values(followers.map((followerId) => ({ followerId, targetType: 'initiative', targetId: initiativeId }))).onConflictDoNothing();
    }
    for (const u of seed.updates) {
      const author = id(u.by);
      if (!author) continue;
      const [profile] = await db.select({ countryCode: s.memberProfiles.countryCode }).from(s.memberProfiles).where(eq(s.memberProfiles.userId, author));
      const createdAt = new Date(Date.now() - u.daysAgo * day);
      await db.insert(s.posts).values({ authorId: author, body: u.body, visibility: 'public', countryCode: profile?.countryCode ?? null, initiativeId, createdAt, updatedAt: createdAt });
    }
    if (seed.request && id(seed.request.by)) {
      await db.insert(s.initiativeJoinRequests).values({ initiativeId, userId: id(seed.request.by)!, roleId: roles[0]?.id ?? null, note: seed.request.note });
    }
  }
}
