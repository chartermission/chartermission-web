import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Demo groups (development seed only, never the production bootstrap): two run by members (one public,
 * one private), two by pages and two by chapters (one private). Each has members, a few posts, and
 * between them a pending join request, an invitation, a post waiting for approval and a private post.
 */

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

type DemoGroup = {
  slug: string;
  name: string;
  tagline: string;
  about: string;
  rules?: string;
  visibility: 'public' | 'private';
  owner: string;
  ownerType: 'member' | 'page' | 'chapter';
  page?: string;
  chapter?: string;
  country?: string;
  hashtags: string[];
  joinQuestion?: string;
  postApproval?: boolean;
  featured?: boolean;
  admins?: string[];
  moderators?: string[];
  members: string[];
  pending?: { member: string; answer: string | null }[];
  invited?: { member: string; by: string }[];
  posts: { author: string; body: string; daysAgo: number; waiting?: boolean }[];
};

const GROUPS: DemoGroup[] = [
  {
    slug: 'fintech-builders',
    name: 'Fintech Builders',
    tagline: 'Payments, lending and mobile money across the continent',
    about: 'For people building or investing in African fintech: product, compliance, partnerships and fundraising. Share what worked, ask what didn’t.',
    rules: 'Be specific and kind.\nNo token or trading promotions.\nAsk before sharing someone’s deck.',
    visibility: 'public',
    owner: 'kwame',
    ownerType: 'member',
    hashtags: ['Fintech', 'Payments'],
    featured: true,
    admins: ['fatou'],
    members: ['amara', 'chinedu', 'leila', 'owais', 'tunde'],
    invited: [{ member: 'yohannes', by: 'kwame' }],
    posts: [
      { author: 'kwame', body: 'Mobile money interoperability between Ghana and Côte d’Ivoire is finally live for small exporters. What is your settlement time looking like? #Fintech', daysAgo: 1 },
      { author: 'fatou', body: 'Office hours this Thursday for founders raising a first round. Drop a line here with your stage and sector and I will share a slot. #Fintech', daysAgo: 3 },
      { author: 'chinedu', body: 'Design question: how do you show FX fees up front without scaring people off? Screens welcome. #Payments', daysAgo: 4 },
      { author: 'leila', body: 'Rules of origin checklists now cover payment service agreements under AfCFTA. Happy to walk anyone through it.', daysAgo: 6 },
    ],
  },
  {
    slug: 'women-founders-circle',
    name: 'Women Founders Circle',
    tagline: 'A private space for women leading companies',
    about: 'A closed circle for women founders and CEOs to talk candidly about hiring, fundraising and leading. What is shared here stays here.',
    rules: 'What is said in the circle stays in the circle.\nNo selling.',
    visibility: 'private',
    owner: 'fatou',
    ownerType: 'member',
    hashtags: ['WomenInLeadership'],
    joinQuestion: 'What are you building, and what would you like from the circle?',
    postApproval: true,
    moderators: ['wanjiru'],
    members: ['amara', 'aisha', 'ngozi'],
    pending: [{ member: 'zainab', answer: 'I run a maternal health data start-up in Nairobi and would love peers to talk fundraising with.' }],
    posts: [
      { author: 'fatou', body: 'Welcome to the circle. Introduce yourself: what you are building, and one thing you want help with this quarter.', daysAgo: 5 },
      { author: 'amara', body: 'Our seed round closed last week. Happy to share the terms sheet we negotiated and what I would do differently. Private to this group.', daysAgo: 2 },
      { author: 'ngozi', body: 'Anyone found a good way to say no to unpaid speaking invitations without burning bridges?', daysAgo: 1 },
      { author: 'aisha', body: 'Looking for a mentor who has scaled a social enterprise past 50 staff. Coffee is on me.', daysAgo: 0, waiting: true },
    ],
  },
  {
    slug: 'lagos-agrihub-growers',
    name: 'AgriHub Growers Network',
    tagline: 'Co-ops and growers using Lagos AgriHub cold rooms',
    about: 'Run by Lagos AgriHub for the co-operatives and growers who book our cold rooms: slot news, prices at the port and questions for our agronomists.',
    visibility: 'public',
    owner: 'amara',
    ownerType: 'page',
    page: 'lagos-agrihub',
    country: 'NG',
    hashtags: ['AgriTech', 'ColdChain'],
    admins: ['tunde'],
    members: ['ngozi', 'kofi', 'aisha'],
    posts: [
      { author: 'amara', body: 'Ikorodu cold room slots for December are open. Book by the crate from the app or reply here. #ColdChain', daysAgo: 1 },
      { author: 'tunde', body: 'Reminder: pre-cool tomatoes to 12°C before loading. It doubles shelf life on the way to Apapa. #AgriTech', daysAgo: 2 },
      { author: 'ngozi', body: 'Two apprentices from our youth programme are looking for placements with co-ops in Epe. Any takers?', daysAgo: 3 },
      { author: 'kofi', body: 'How are co-ops here paying for shared solar on the cold rooms? Pay-as-you-go or upfront?', daysAgo: 5 },
    ],
  },
  {
    slug: 'paybridge-exporters',
    name: 'PayBridge Exporters',
    tagline: 'Exporters settling across borders with PayBridge',
    about: 'A group run by PayBridge for exporters using cross-border settlement: product updates, corridor news and questions for the team.',
    visibility: 'public',
    owner: 'kwame',
    ownerType: 'page',
    page: 'paybridge',
    country: 'GH',
    hashtags: ['AfCFTA', 'Fintech'],
    members: ['leila', 'amara', 'fatou'],
    posts: [
      { author: 'kwame', body: 'Cedi to naira settlement now clears in under an hour on weekdays. Tell us your corridor and we will share the cut-off times. #AfCFTA', daysAgo: 1 },
      { author: 'leila', body: 'For anyone exporting shea butter: the new certificate of origin template is accepted at Aflao now.', daysAgo: 3 },
      { author: 'amara', body: 'Settlement for our Abidjan buyers took 50 minutes yesterday. Big change from last year.', daysAgo: 4 },
      { author: 'fatou', body: 'Which corridors should PayBridge open next? Senegal to Mali has my vote. #Fintech', daysAgo: 6 },
    ],
  },
  {
    slug: 'nigeria-chapter-volunteers',
    name: 'Nigeria Chapter Volunteers',
    tagline: 'People helping run Nigeria Chapter meetups',
    about: 'The Nigeria Chapter team’s group for volunteers: meetup planning, venues and who is doing what.',
    visibility: 'public',
    owner: 'amara',
    ownerType: 'chapter',
    chapter: 'nigeria',
    country: 'NG',
    hashtags: ['Chapters', 'Volunteering'],
    moderators: ['aisha'],
    members: ['tunde', 'ngozi', 'owais'],
    posts: [
      { author: 'amara', body: 'December meetup: we need two people on registration and one on photos. Reply if you can help. #Volunteering', daysAgo: 1 },
      { author: 'aisha', body: 'Venue shortlist for January: Yaba tech hub or the Ikoyi library hall. Votes?', daysAgo: 2 },
      { author: 'tunde', body: 'I can bring the projector and the extension leads again.', daysAgo: 2 },
      { author: 'ngozi', body: 'Photos from last month’s meetup are in the shared folder. Thank you all. #Chapters', daysAgo: 7 },
    ],
  },
  {
    slug: 'kenya-chapter-organisers',
    name: 'Kenya Chapter Organisers',
    tagline: 'The Kenya Chapter’s organising team',
    about: 'A private group for the people organising the Kenya Chapter: plans, budgets and partner conversations before they are public.',
    visibility: 'private',
    owner: 'wanjiru',
    ownerType: 'chapter',
    chapter: 'kenya',
    country: 'KE',
    hashtags: ['Chapters'],
    joinQuestion: 'How would you like to help the Kenya Chapter?',
    members: ['yohannes', 'thabo'],
    invited: [{ member: 'zainab', by: 'wanjiru' }],
    posts: [
      { author: 'wanjiru', body: 'Draft budget for the Nairobi clean-cooking meetup is up. Please check the venue line before Friday.', daysAgo: 1 },
      { author: 'yohannes', body: 'The health-tech partners are in for a joint session in February. Keeping this here until they announce it.', daysAgo: 3 },
      { author: 'thabo', body: 'I can run a short solar installers’ workshop on the second day if there is room.', daysAgo: 4 },
      { author: 'wanjiru', body: 'Minutes from this week’s call: roles for the March event and a first list of speakers.', daysAgo: 6 },
    ],
  },
];

/** Gives `userId` a chapter team role scoped to the chapter, unless they already hold it. */
async function chapterRole(db: Db, userId: string, roleKey: string, chapterId: string) {
  const [role] = await db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, roleKey)).limit(1);
  if (!role) return;
  await db.insert(s.userRoles).values({ userId, roleId: role.id, scopeType: 'chapter', scopeId: chapterId }).onConflictDoNothing();
}

export async function seedGroups(db: Db, ctx: SeedContext) {
  const id = (key: string) => ctx.ids[key];
  const existing = await db.select({ slug: s.groups.slug }).from(s.groups).where(inArray(s.groups.slug, GROUPS.map((g) => g.slug)));
  const done = new Set(existing.map((g) => g.slug));
  const pageRows = await db.select({ id: s.pages.id, slug: s.pages.slug }).from(s.pages);
  const pageIds = Object.fromEntries(pageRows.map((p) => [p.slug, p.id]));

  for (const g of GROUPS) {
    const owner = id(g.owner);
    if (done.has(g.slug) || !owner) continue;
    const pageId = g.page ? pageIds[g.page] : undefined;
    const chapterId = g.chapter ? ctx.chapters[g.chapter] : undefined;
    if ((g.ownerType === 'page' && !pageId) || (g.ownerType === 'chapter' && !chapterId)) continue;
    // The chapter's team runs its groups: make sure the demo owner is on it.
    if (g.ownerType === 'chapter') await chapterRole(db, owner, 'chapter_lead', chapterId!);

    const [row] = await db
      .insert(s.groups)
      .values({
        slug: g.slug,
        name: g.name,
        tagline: g.tagline,
        about: g.about,
        rules: g.rules ?? null,
        visibility: g.visibility,
        ownerType: g.ownerType,
        pageId: g.ownerType === 'page' ? pageId! : null,
        chapterId: g.ownerType === 'chapter' ? chapterId! : null,
        postApproval: g.postApproval ?? false,
        joinQuestion: g.joinQuestion ?? null,
        countryCode: g.country ?? null,
        hashtags: g.hashtags,
        featuredAt: g.featured ? ago(2) : null,
        createdBy: owner,
        createdAt: ago(30),
      })
      .returning({ id: s.groups.id });
    const groupId = row!.id;

    const members: (typeof s.groupMembers.$inferInsert)[] = [{ groupId, userId: owner, role: 'owner', status: 'active', joinedAt: ago(30) }];
    const add = (key: string, role: 'admin' | 'moderator' | 'member', daysAgo: number) => {
      const userId = id(key);
      if (userId && !members.some((m) => m.userId === userId)) members.push({ groupId, userId, role, status: 'active', joinedAt: ago(daysAgo) });
    };
    for (const key of g.admins ?? []) add(key, 'admin', 25);
    for (const key of g.moderators ?? []) add(key, 'moderator', 20);
    g.members.forEach((key, i) => add(key, 'member', 18 - i));
    for (const p of g.pending ?? []) {
      const userId = id(p.member);
      if (userId) members.push({ groupId, userId, role: 'member', status: 'pending', requestAnswer: p.answer, createdAt: ago(1) });
    }
    for (const inv of g.invited ?? []) {
      const userId = id(inv.member);
      if (userId) members.push({ groupId, userId, role: 'member', status: 'invited', invitedBy: id(inv.by) ?? owner, createdAt: ago(1) });
    }
    await db.insert(s.groupMembers).values(members).onConflictDoNothing();

    for (const p of g.posts) {
      const authorId = id(p.author);
      if (!authorId) continue;
      await db.insert(s.posts).values({
        authorId,
        groupId,
        body: p.body,
        // A private group's posts are for its members only.
        visibility: g.visibility === 'private' ? 'group' : 'members',
        countryCode: g.country ?? null,
        status: p.waiting ? 'in_review' : 'published',
        groupReview: p.waiting ? 'pending' : g.postApproval ? 'approved' : null,
        createdAt: ago(p.daysAgo, 2),
      });
    }

    await db.execute(sql`update ${s.groups} set
      member_count = (select count(*)::int from ${s.groupMembers} m where m.group_id = ${groupId} and m.status = 'active'),
      post_count = (select count(*)::int from ${s.posts} p where p.group_id = ${groupId} and p.deleted_at is null and p.status = 'published'),
      last_post_at = (select max(p.created_at) from ${s.posts} p where p.group_id = ${groupId} and p.deleted_at is null and p.status = 'published')
      where id = ${groupId}`);
  }
}
