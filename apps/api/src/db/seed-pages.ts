import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';
import { pseudonym } from '../common/crypto.js';

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

type DemoPage = {
  slug: string;
  name: string;
  tagline: string;
  about: string;
  category: string;
  website: string;
  country: string;
  city: string;
  owner: string;
  admins?: string[];
  status?: 'active' | 'pending';
  verified?: boolean;
  official?: boolean;
  followers: string[];
  posts: { body: string; daysAgo: number }[];
};

const PAGES: DemoPage[] = [
  {
    slug: 'charter-mission-updates',
    name: 'Charter Mission',
    tagline: 'News and announcements from the Charter Mission team',
    about:
      'The official page of Charter Mission: platform news, programme launches, chapter milestones and calls for Ambassadors. Follow to keep up with what the community is building across the continent and the diaspora.',
    category: 'organisation',
    website: 'https://chartermission.com',
    country: 'AE',
    city: 'Dubai',
    owner: 'superAdmin',
    admins: ['platformAdmin'],
    verified: true,
    official: true,
    followers: ['amara', 'kwame', 'wanjiru', 'leila', 'thabo', 'fatou', 'yohannes', 'chinedu', 'owais', 'aisha', 'tunde', 'ngozi'],
    posts: [
      { body: 'Pages are here. Organisations, companies and initiatives can now have a home on Charter Mission: follow the ones you care about and their updates arrive in your feed. #CharterMission', daysAgo: 1 },
      { body: 'Chapters are now open for every African country and for diaspora communities. Find yours under Chapters, follow it, and say hello. #Chapters', daysAgo: 6 },
    ],
  },
  {
    slug: 'lagos-agrihub',
    name: 'Lagos AgriHub',
    tagline: 'Cold storage and export links for 4,000+ smallholder farmers',
    about:
      'Lagos AgriHub connects smallholder farmers to shared cold rooms, aggregation points and export buyers in Ghana, Côte d’Ivoire and the UK. We publish what we learn about cold chain, co-operative finance and getting produce through the port.',
    category: 'company',
    website: 'https://example.com/lagos-agrihub',
    country: 'NG',
    city: 'Lagos',
    owner: 'amara',
    admins: ['tunde'],
    verified: true,
    followers: ['kwame', 'tunde', 'ngozi', 'leila', 'aisha', 'fatou', 'owais'],
    posts: [
      { body: 'Our third shared cold room opens in Ikorodu next month: 40 tonnes of capacity, booked by the crate. Co-ops in Lagos East, talk to us about a slot. #ColdChain #AgriTech', daysAgo: 2 },
      { body: 'We are hiring two field agronomists for the 2027 season. Yoruba and Hausa speakers especially welcome. Details under Opportunities. #Hiring #Agriculture', daysAgo: 9 },
    ],
  },
  {
    slug: 'paybridge',
    name: 'PayBridge',
    tagline: 'Cross-border settlement for small exporters',
    about: 'PayBridge settles cross-border payments for small exporters in West and East Africa, with mobile money in and local currency out.',
    category: 'company',
    website: 'https://example.com/paybridge',
    country: 'GH',
    city: 'Accra',
    owner: 'kwame',
    followers: ['amara', 'fatou', 'leila', 'chinedu'],
    posts: [{ body: 'Cedi to naira settlement now clears in under an hour on weekdays. Thank you to the exporters who tested with us through October. #Fintech #AfCFTA', daysAgo: 4 }],
  },
  {
    slug: 'greengrid-africa',
    name: 'GreenGrid Africa',
    tagline: 'Solar micro-grids for villages and clinics',
    about: 'We design and install solar micro-grids for villages and clinics in South Africa and Lesotho, and train young installers along the way.',
    category: 'company',
    website: 'https://example.com/greengrid',
    country: 'ZA',
    city: 'Johannesburg',
    owner: 'thabo',
    status: 'pending',
    followers: [],
    posts: [],
  },
];

/** Demo pages with posts and followers, two verification requests and view counts for recent posts. */
export async function seedPages(db: Db, ctx: SeedContext) {
  const [existing] = await db.select({ id: s.pages.id }).from(s.pages).limit(1);
  if (existing) return;
  const id = (key: string) => ctx.ids[key];

  const pageIds: Record<string, string> = {};
  for (const p of PAGES) {
    const owner = id(p.owner);
    if (!owner) continue;
    const [row] = await db
      .insert(s.pages)
      .values({
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        about: p.about,
        category: p.category,
        website: p.website,
        countryCode: p.country,
        city: p.city,
        status: p.status ?? 'active',
        verifiedAt: p.verified ? ago(30) : null,
        official: p.official ?? false,
        createdBy: owner,
        createdAt: ago(40),
      })
      .returning({ id: s.pages.id });
    pageIds[p.slug] = row!.id;
    await db.insert(s.pageAdmins).values([
      { pageId: row!.id, userId: owner, role: 'owner' },
      ...(p.admins ?? []).flatMap((key) => (id(key) ? [{ pageId: row!.id, userId: id(key)!, role: 'admin' }] : [])),
    ]);
    const followers = p.followers.flatMap((key) => (id(key) ? [{ followerId: id(key)!, targetType: 'page', targetId: row!.id, createdAt: ago(Math.floor(Math.random() * 30)) }] : []));
    if (followers.length) await db.insert(s.follows).values(followers).onConflictDoNothing();
    for (const post of p.posts) {
      await db.insert(s.posts).values({ authorId: owner, pageId: row!.id, body: post.body, countryCode: p.country, createdAt: ago(post.daysAgo, 3) });
    }
  }

  // Verification queue: one member and one page waiting for review.
  const requests: (typeof s.verificationRequests.$inferInsert)[] = [];
  if (id('wanjiru')) {
    requests.push({
      subjectType: 'member',
      userId: id('wanjiru')!,
      category: 'individual',
      legalName: 'Wanjiru Kamau',
      statement:
        'I am a climate policy analyst in Nairobi and co-organise the Kenya chapter’s clean-cooking work. I publish county adaptation budgets here and members often ask whether the account is really me.',
      links: ['https://example.org/people/wanjiru-kamau', 'https://example.com/in/wanjiru-kamau'],
      createdAt: ago(2),
    });
  }
  if (id('kwame') && pageIds.paybridge) {
    requests.push({
      subjectType: 'page',
      userId: id('kwame')!,
      pageId: pageIds.paybridge,
      category: 'organisation',
      legalName: 'PayBridge Technologies Ltd',
      statement: 'PayBridge is a licensed payment service provider registered in Ghana. This page is run by our product team and we would like members to know it is the official one.',
      links: ['https://example.com/paybridge', 'https://example.com/registry/paybridge'],
      createdAt: ago(1),
    });
  }
  if (requests.length) await db.insert(s.verificationRequests).values(requests);

  // Views for recent posts, so post analytics has something to show in the demo.
  const recent = await db
    .select({ id: s.posts.id, authorId: s.posts.authorId, pageId: s.posts.pageId, createdAt: s.posts.createdAt })
    .from(s.posts)
    .where(and(isNull(s.posts.deletedAt), isNull(s.posts.repostOfId), eq(s.posts.status, 'published')))
    .orderBy(desc(s.posts.createdAt))
    .limit(60);
  const members = await db
    .select({ id: s.users.id, country: s.memberProfiles.countryCode })
    .from(s.users)
    .innerJoin(s.memberProfiles, eq(s.memberProfiles.userId, s.users.id))
    .where(eq(s.users.status, 'active'));
  const connected = await db.select({ a: s.connections.requesterId, b: s.connections.addresseeId }).from(s.connections).where(eq(s.connections.status, 'accepted'));
  const followed = await db.select({ follower: s.follows.followerId, type: s.follows.targetType, target: s.follows.targetId }).from(s.follows);
  const isConnected = (a: string, b: string) => connected.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  const isFollowing = (a: string, type: string, target: string) => followed.some((f) => f.follower === a && f.type === type && f.target === target);

  // A small deterministic generator, so the demo numbers are the same on every reset.
  let seed = 20261110;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const today = Math.floor(Date.now() / DAY);

  for (const post of recent) {
    const days = new Map<string, { impressions: number; viewers: number }>();
    const rows: (typeof s.postViews.$inferInsert)[] = [];
    const ageDays = Math.max(0, today - Math.floor(post.createdAt.getTime() / DAY));
    for (const m of members) {
      if (m.id === post.authorId) continue;
      const near = post.pageId ? isFollowing(m.id, 'page', post.pageId) : isConnected(m.id, post.authorId) || isFollowing(m.id, 'member', post.authorId);
      if (random() > (near ? 0.92 : 0.55)) continue;
      const views = 1 + Math.floor(random() * (near ? 4 : 2));
      // Most views land in the first two days after posting.
      const firstOffset = Math.min(ageDays, Math.floor(random() * random() * 4));
      const firstDay = new Date((today - ageDays + firstOffset) * DAY);
      rows.push({
        postId: post.id,
        viewerKey: pseudonym(m.id),
        countryCode: m.country,
        audience: post.pageId ? (near ? 'follower' : 'other') : isConnected(m.id, post.authorId) ? 'connection' : near ? 'follower' : 'other',
        views,
        lastSeenAt: firstDay,
        createdAt: firstDay,
      });
      for (let v = 0; v < views; v++) {
        const offset = Math.min(ageDays, firstOffset + (v === 0 ? 0 : Math.floor(random() * 5)));
        const key = new Date((today - ageDays + offset) * DAY).toISOString().slice(0, 10);
        const day = days.get(key) ?? { impressions: 0, viewers: 0 };
        day.impressions += 1;
        if (v === 0) day.viewers += 1;
        days.set(key, day);
      }
    }
    if (rows.length) await db.insert(s.postViews).values(rows).onConflictDoNothing();
    if (days.size) {
      await db
        .insert(s.postViewDays)
        .values([...days].map(([day, d]) => ({ postId: post.id, day, impressions: d.impressions, viewers: d.viewers })))
        .onConflictDoNothing();
    }
  }
}
