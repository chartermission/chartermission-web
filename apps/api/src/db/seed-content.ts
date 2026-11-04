import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { Db } from './client.js';
import * as s from './schema.js';
import { MEMBERS } from './seed-data.js';
import { attachHashtags } from '../posts/hashtags.js';
import { parseHashtags, parseMentions } from '../posts/text-parse.js';
import { computeTrending } from '../topics/trending.js';
import { createStorage } from '../media/storage.js';
import { DAILY_PROMPT_TAG } from '@chartermission/contracts';
import { promptFor } from '../home/prompts.js';
import { ARTICLES, PROMPT_ANSWERS } from './seed-home.js';

/*
 * Demo content for the feed, post detail, topic and trending screens, converted from
 * the web app's placeholder data (apps/web/src/lib/mock-data.ts, mock/posts.ts,
 * mock/topics.ts, mock/compose.ts). Posts are spread over the last 10 days and
 * across authors so the trending computation has a baseline and a spike.
 *
 * Idempotent: if the demo announcement already exists nothing is added
 * (`pnpm db:seed --reset` truncates first and seeds again).
 */

const H = 3600_000;

type Key = (typeof MEMBERS)[number]['key'];
type Kind = 'like' | 'insightful' | 'support';
type LinkPreview = { url: string; domain: string; title: string | null; description: string | null; imageUrl: string | null };

const COUNTRY = Object.fromEntries(MEMBERS.map((m) => [m.key, m.country])) as Record<string, string>;
const HANDLE_TO_KEY = Object.fromEntries(MEMBERS.map((m) => [m.handle, m.key])) as Record<string, string>;

/** Topic descriptions from mock/topics.ts. */
const TOPIC_DESCRIPTIONS: Record<string, string> = {
  afcfta: 'African Continental Free Trade Area — trade policy, cross-border business and the corridors opening up across the continent.',
  africantech: "Startups, engineering teams and the infrastructure powering Africa's technology ecosystem.",
  climateaction: 'Climate policy, adaptation and the people building low-carbon livelihoods across Africa and the diaspora.',
  diasporainvest: 'How the diaspora invests back home — trust, transfers, regulation and the founders making it easier.',
  cleancooking: 'LPG, bioethanol and improved stoves — the business models getting clean cooking into African homes.',
  youthemployment: "Jobs, apprenticeships and skills programmes for Africa's young workforce.",
  agritech: 'Technology for farmers — supply chains, cold storage, inputs and market access.',
  womeninleadership: 'Women leading companies, chapters and initiatives across Africa and the diaspora.',
};

/** Extra posts per hashtag: [author, hours ago, text]. Recent ones (< 24h) drive trending, older ones the baseline. */
const EXTRA: [Key, number, string][] = [
  // #AfCFTA — the spike (6 authors today, 3 older posts).
  ['chinedu', 3, 'Designing the export dashboard for a Lagos co-op this week. Certificates of origin are the hardest UX problem in #AfCFTA trade. #MadeInAfrica'],
  ['thabo', 6, 'Cross-border power trading is the quiet part of #AfCFTA nobody talks about. Southern Africa already does it. #CleanEnergy'],
  ['fatou', 9, 'Dakar to Abidjan by road is still 3 border checks. Digital customs under #AfCFTA cannot come soon enough. #Logistics'],
  ['kwame', 12, 'PayBridge now settles cedi ↔ naira in under an hour. Built for #AfCFTA corridors. #Fintech'],
  ['leila', 3 * 24, 'Reading the new tariff schedules so you don’t have to. Summary thread on #AfCFTA rules next week.'],
  ['amara', 6 * 24, 'Our first shipment to Accra under the #AfCFTA preferential rate cleared in 4 days. Small win, big signal. #AgriTech'],
  ['chinedu', 9 * 24, 'Mapping every #AfCFTA customs form into one flow. Who wants to user-test it?'],
  // #DiasporaInvest — 5 authors today.
  ['fatou', 4, 'Three things I check before backing a diaspora founder: local co-investor, FX plan, and a board that visits. #DiasporaInvest'],
  ['owais', 7, 'From Dubai the transfer fees to Lagos are still ~6%. Collective funds could change that. #DiasporaInvest #Fintech'],
  ['yohannes', 10, 'Our health-tech seed round was 40% diaspora angels. They asked the hardest questions. #DiasporaInvest'],
  ['chinedu', 14, 'London meetup on #DiasporaInvest next month — designers and engineers who want to build back home, come through.'],
  ['kwame', 4 * 24, 'Remittances are not investment. Different products, different trust. #DiasporaInvest'],
  ['fatou', 8 * 24, 'Writing up our diaspora syndicate terms in plain language. #DiasporaInvest #WomenInLeadership'],
  // #CleanCooking — 4 authors today.
  ['wanjiru', 2, 'LPG subsidies vs. bioethanol: we compared 5 counties. Results in the chapter newsletter. #CleanCooking #ClimateAction'],
  ['thabo', 5, 'Prototype stove controller ready for the Nairobi hackathon. Needs field testers. #CleanCooking #CleanTech'],
  ['yohannes', 11, 'Indoor air pollution is a health story first. Clinics see it every day. #CleanCooking'],
  ['amara', 15, 'Our farmers asked for #CleanCooking credit bundled with input loans. Exploring it with a Lagos MFI.'],
  ['wanjiru', 2 * 24, 'Carbon finance for #CleanCooking projects: the methodology changed. Here is what it means for small developers.'],
  // #AfricanTech — 4 authors today, steady baseline.
  ['kwame', 1, 'Hiring a senior backend engineer in Accra or remote. Payments experience a plus. #AfricanTech'],
  ['yohannes', 8, 'Offline-first sync saved our clinic app in Addis. Lessons learned thread. #AfricanTech'],
  ['fatou', 13, 'Fintech funding in West Africa is down, but revenue is up. Read the room. #AfricanTech'],
  ['chinedu', 16, 'Open-sourcing our design tokens for African languages and scripts. #AfricanTech'],
  ['kwame', 2 * 24, 'Uptime is a feature. Our status page is public now. #AfricanTech'],
  ['kwame', 3 * 24, 'What does a good on-call rota look like for a 6-person team? #AfricanTech'],
  ['kwame', 5 * 24, 'USSD still beats apps for our rural users. #AfricanTech'],
  ['yohannes', 4 * 24, 'Hiring our first data engineer. #AfricanTech'],
  ['yohannes', 7 * 24, 'Data residency rules across 5 countries, in one table. #AfricanTech'],
  ['fatou', 6 * 24, 'Investor office hours every Thursday. #AfricanTech'],
  ['chinedu', 8 * 24, 'Accessibility audit of 20 African fintech apps. #AfricanTech'],
  ['chinedu', 9 * 24, 'Design systems for low-bandwidth products. #AfricanTech'],
  ['owais', 10 * 24 - 2, 'Remote teams across Lahore, Dubai and Lagos — what we learned about async work. #AfricanTech'],
  // #YouthEmployment — 4 authors today (incl. the announcement), larger baseline.
  ['amara', 6, 'Hiring 10 agronomy apprentices in Lagos. Paid, with a path to full-time. #YouthEmployment #AgriTech'],
  ['aisha', 10, 'Community tip: tag apprenticeship posts with #YouthEmployment so they show up on the topic page.'],
  ['thabo', 18, 'Solar installer training cohort starts in January in Soweto. #YouthEmployment #CleanEnergy'],
  ...([2, 3, 4, 5, 6, 7, 8, 9, 10, 10] as const).map(
    (d, i) => [(['amara', 'thabo', 'wanjiru', 'kwame', 'fatou'] as Key[])[i % 5]!, d * 24 - i, `Weekly #YouthEmployment roundup ${i + 1}: internships, apprenticeships and fellowships across the network.`] as [Key, number, string],
  ),
  // Below the threshold or baseline only.
  ['thabo', 20, 'Grid-tied vs. off-grid for clinics: a quick cost model. #ClimateAction #CleanEnergy'],
  ['wanjiru', 3 * 24, 'Adaptation finance is still under 10% of climate flows to Africa. #ClimateAction'],
  ['wanjiru', 5 * 24, 'Drafting a county climate budget tracker. #ClimateAction'],
  ['thabo', 7 * 24, 'Load-shedding diaries, week 3. #ClimateAction #CleanEnergy'],
  ['fatou', 4 * 24, 'Women-led funds closed 3x more deals this year. #WomenInLeadership'],
  ['wanjiru', 9 * 24, 'Chapter leads: half of our new organisers are women. Let’s keep it that way. #WomenInLeadership'],
  ['amara', 2 * 24, 'Cold storage utilisation went from 40% to 85% after we shared it between co-ops. #AgriTech #Logistics'],
  ['amara', 8 * 24, 'Soil testing kits for $12. #AgriTech'],
  ['kwame', 7 * 24, 'Mobile money interoperability, explained in one diagram. #Fintech'],
  ['leila', 5 * 24, 'Textile exporters: cumulation rules matter more than tariffs. #TradeAfrica'],
  ['chinedu', 4 * 24, 'Made-in-Lagos furniture brand just landed a UK retailer. #MadeInAfrica'],
];

/** Owais's follows (mock-data.ts followedHashtags + people he follows). */
const ARTICLE_BODY = `Exporters keep asking the same question: does my product qualify for AfCFTA preferences? For textiles the answer depends on three things — where the fabric was made, how much work happened in your country, and whether you can prove it at the border.

I spend most of my week turning legal texts into checklists. This is the textiles checklist, with the reasoning behind each step.

## Start with the product-specific rule

Every product has a tariff heading, and every heading has its own rule of origin. For many garments the rule is about processing: sewing imported fabric together is not enough, and a defined share of the manufacturing has to happen within the continent. Other lines use a value test, which limits how much of the ex-works price can come from non-originating materials.

Before anything else:

1. Confirm the exact tariff heading for each product line with your customs broker.
2. Find the product-specific rule for that heading in the published schedule.
3. Write down, in one sentence, what your factory must do for the product to qualify.

If you cannot write that sentence, stop and get help. Everything else depends on it.

## Cumulation is your friend

Materials from any other AfCFTA state party count as originating, as long as they come with their own certificate. A Moroccan garment maker using Egyptian cotton yarn can treat that yarn as local. Read the cumulation clause twice: it only works when every step in the chain is documented.

In practice, that Moroccan maker weaves the yarn into fabric, then cuts and sews the garments. The yarn counts as originating because the Egyptian supplier provides its own proof of origin, and the weaving, cutting and sewing all happen in Morocco. The finished shirt can then qualify for preferences in, say, Ghana or Kenya, provided each step is on paper.

Cumulation fails most often for a simple reason: the supplier's proof of origin is missing, late or issued for the wrong product. Ask for it with the first order, not the first shipment.

## Mind the tolerance

The tolerance rule lets a small share of non-originating materials through — useful for buttons, zips and labels sourced from outside the continent. Keep it under the threshold for your product line and keep the invoices.

Two common mistakes:

- Calculating the share on the retail price instead of the ex-works price. Always use the ex-works price.
- Forgetting that a new supplier of trims can push you over the threshold. A cheaper zip from outside the continent can cost you the preference on the whole shirt.

Run the calculation for every product line, and run it again whenever you change a supplier or a price.

## The paperwork that trips people up

- A certificate of origin from the competent authority, not a commercial invoice note.
- A supplier declaration for every originating input.
- Records kept for at least five years.

Customs in the importing country can ask for proof long after the goods have cleared. Keep each shipment's file together: the certificate, the supplier declarations, the bill of materials with costs and the production records. A shared folder per shipment, named by invoice number, is enough.

## A pre-shipment checklist

1. Tariff heading confirmed for each product line.
2. Product-specific rule written down and met.
3. Supplier proofs of origin received for every originating input.
4. Tolerance calculated on the ex-works price and within the limit.
5. Certificate of origin issued by the competent authority and checked for errors.
6. Shipment file complete and stored.

Most rejected shipments in the pilot phase failed on documents, not on the rules themselves. Get the paperwork right before the first container and the preferences follow.

#AfCFTA #TradeAfrica`;

const OWAIS_FOLLOWS = {
  members: ['amara', 'kwame', 'wanjiru', 'leila', 'team'] as Key[],
  hashtags: ['africantech', 'climateaction', 'diasporainvest', 'womeninleadership'],
  chapters: ['dubai-diaspora'],
};

export async function seedContent(db: Db, ids: Record<string, string>): Promise<void> {
  const [existing] = await db
    .select({ id: s.posts.id })
    .from(s.posts)
    .where(and(eq(s.posts.authorId, ids.team!), eq(s.posts.kind, 'announcement')))
    .limit(1);
  if (existing) {
    console.log('Demo content already present; skipping (use --reset to reseed).');
    return;
  }
  const now = Date.now();
  const chapterRows = await db.select({ id: s.chapters.id, slug: s.chapters.slug }).from(s.chapters);
  const chapter = (slug: string) => chapterRows.find((c) => c.slug === slug)?.id ?? null;
  const uid = (key: string) => {
    const id = ids[key];
    if (!id) throw new Error(`Unknown demo member ${key}`);
    return id;
  };

  async function mentionIds(text: string) {
    return parseMentions(text)
      .map((h) => HANDLE_TO_KEY[h])
      .filter((k): k is string => !!k)
      .map(uid);
  }

  async function post(
    author: Key,
    body: string,
    agoMs: number,
    opts: {
      kind?: 'standard' | 'announcement';
      chapter?: string;
      link?: LinkPreview;
      visibility?: 'members' | 'public';
      repostOf?: string;
      type?: 'standard' | 'question' | 'celebration' | 'request' | 'article';
      details?: Record<string, unknown>;
    } = {},
  ) {
    const createdAt = new Date(now - agoMs);
    const [p] = await db
      .insert(s.posts)
      .values({
        authorId: uid(author),
        body,
        kind: opts.kind ?? 'standard',
        type: opts.type ?? 'standard',
        details: opts.details ?? null,
        visibility: opts.visibility ?? 'members',
        chapterId: opts.chapter ? chapter(opts.chapter) : null,
        countryCode: COUNTRY[author] ?? null,
        repostOfId: opts.repostOf ?? null,
        linkUrl: opts.link?.url ?? null,
        linkPreview: opts.link ?? null,
        pinnedAt: opts.kind === 'announcement' ? createdAt : null,
        createdAt,
      })
      .returning();
    await attachHashtags(db, p!.id, parseHashtags(body));
    const mentioned = await mentionIds(body);
    if (mentioned.length) {
      await db.insert(s.mentions).values(mentioned.map((userId) => ({ sourceType: 'post', sourceId: p!.id, userId }))).onConflictDoNothing();
    }
    if (opts.repostOf) {
      await db
        .update(s.posts)
        .set({ repostCount: sql`${s.posts.repostCount} + 1` })
        .where(eq(s.posts.id, opts.repostOf));
    }
    return p!.id;
  }

  async function react(targetType: 'post' | 'comment', targetId: string, who: Key, kind: Kind = 'like') {
    await db.insert(s.reactions).values({ targetType, targetId, userId: uid(who), kind });
    if (targetType === 'post') {
      const col = kind === 'like' ? s.posts.likeCount : kind === 'insightful' ? s.posts.insightfulCount : s.posts.supportCount;
      const key = kind === 'like' ? 'likeCount' : kind === 'insightful' ? 'insightfulCount' : 'supportCount';
      await db
        .update(s.posts)
        .set({ reactionCount: sql`${s.posts.reactionCount} + 1`, [key]: sql`${col} + 1` })
        .where(eq(s.posts.id, targetId));
    } else {
      await db
        .update(s.comments)
        .set({ reactionCount: sql`${s.comments.reactionCount} + 1` })
        .where(eq(s.comments.id, targetId));
    }
  }

  async function comment(postId: string, who: Key, body: string, agoMs: number, opts: { parentId?: string; state?: 'hidden' } = {}) {
    const [c] = await db
      .insert(s.comments)
      .values({
        postId,
        parentId: opts.parentId ?? null,
        authorId: uid(who),
        body,
        moderationState: opts.state ?? 'visible',
        createdAt: new Date(now - agoMs),
      })
      .returning();
    await db
      .update(s.posts)
      .set({ commentCount: sql`${s.posts.commentCount} + 1` })
      .where(eq(s.posts.id, postId));
    if (opts.parentId) {
      await db
        .update(s.comments)
        .set({ replyCount: sql`${s.comments.replyCount} + 1` })
        .where(eq(s.comments.id, opts.parentId));
    }
    const mentioned = await mentionIds(body);
    if (mentioned.length) {
      await db.insert(s.mentions).values(mentioned.map((userId) => ({ sourceType: 'comment', sourceId: c!.id, userId }))).onConflictDoNothing();
    }
    return c!.id;
  }

  /* ---------- Feed posts (mock-data.ts feedPosts, mock/topics.ts topicOnlyPosts) ---------- */

  const fellows = await post(
    'team',
    'Applications are open for the first Charter Mission Fellows cohort — 40 fellows across 15 countries, working on initiatives in climate, agritech and youth employment. Apply by 30 November.\n\n#CharterFellows #YouthEmployment',
    20 * H,
    {
      kind: 'announcement',
      visibility: 'public',
      link: {
        url: 'https://chartermission.org/opportunities/charter-mission-fellows-2027',
        domain: 'chartermission.org',
        title: 'Charter Mission Fellows 2027 — call for applications',
        description: 'A 6-month programme pairing fellows with mentors from across Africa and the diaspora.',
        imageUrl: null,
      },
    },
  );

  const kigali = await post(
    'amara',
    [
      'Just back from the AfCFTA trade corridor workshop in Kigali. 3 takeaways for agri exporters:',
      '',
      '1. Certify early — buyers ask for it before they ask for price.',
      '2. Partner across borders — a Ghanaian co-packer halved our lead time.',
      '3. Price in naira AND cedi to avoid surprises at the border.',
      '',
      '#AfCFTA #AgriTech #TradeAfrica',
    ].join('\n'),
    2 * H,
    { chapter: 'lagos' },
  );
  await attachDemoImage(db, kigali, uid('amara'), 'Kigali Convention Centre · AfCFTA corridor workshop');

  const diaspora = await post('kwame', 'Diaspora founders: what is the biggest barrier to investing back home?\n\n#DiasporaInvest #Fintech', 5 * H, {
    chapter: 'accra',
  });
  const [poll] = await db
    .insert(s.polls)
    .values({ postId: diaspora, question: 'Biggest barrier to diaspora investment', closesAt: new Date(now - 5 * H + 72 * H) })
    .returning();
  const options = await db
    .insert(s.pollOptions)
    .values(
      ['Trust in local partners', 'Currency and transfer costs', 'Regulation and paperwork'].map((label, position) => ({
        pollId: poll!.id,
        label,
        position,
      })),
    )
    .returning();
  const votes: [Key, number][] = [
    ['owais', 0], ['fatou', 0], ['leila', 0], ['amara', 0], ['chinedu', 1], ['yohannes', 1], ['thabo', 2],
  ];
  for (const [who, i] of votes) {
    await db.insert(s.pollVotes).values({ pollId: poll!.id, userId: uid(who), optionId: options[i]!.id });
    await db.update(s.pollOptions).set({ voteCount: sql`${s.pollOptions.voteCount} + 1` }).where(eq(s.pollOptions.id, options[i]!.id));
  }
  await db.update(s.polls).set({ totalVotes: votes.length }).where(eq(s.polls.id, poll!.id));

  const cleanCooking = await post(
    'wanjiru',
    'Our Nairobi chapter is hosting a clean-cooking hackathon on 28 November. Looking for 3 more mentors with hardware or carbon-finance experience — reply or DM if you can give a Saturday.\n\n#ClimateAction #NairobiChapter',
    8 * H,
    { chapter: 'nairobi' },
  );

  const rules = await post(
    'leila',
    'New rules-of-origin guidance is out. If you ship textiles between North and West Africa, the cumulation clause is the part to read twice.\n\n#AfCFTA #TradeAfrica',
    4 * H,
    {
      chapter: 'casablanca',
      link: {
        url: 'https://au-afcfta.org',
        domain: 'au-afcfta.org',
        title: 'Rules of origin: updated guidance for exporters',
        description: 'What changes for textiles, agri-processing and automotive parts.',
        imageUrl: null,
      },
    },
  );

  /* ---------- Comments (mock/posts.ts) ---------- */

  const kwameFx = await comment(
    kigali,
    'kwame',
    'Point 3 is so underrated. We lost 6% on one shipment last year purely to FX timing. @amara-okafor did you hedge or just price in both?',
    1 * H,
  );
  const amaraReply = await comment(kigali, 'amara', 'Priced in both and settled within 7 days. Simple, but it worked for our volumes.', 52 * 60_000, {
    parentId: kwameFx,
  });
  const leilaOrigin = await comment(
    kigali,
    'leila',
    'For anyone exporting textiles: the new rules-of-origin guidance changes cumulation. Sharing a summary under #AfCFTA this week.',
    40 * 60_000,
  );
  await comment(kigali, 'chinedu', 'This comment was hidden by a moderator in the demo data.', 30 * 60_000, { state: 'hidden' });
  await comment(kigali, 'thabo', 'Would love to see the cold-chain numbers from Kigali if you have them.', 22 * 60_000);

  const fatouFellows = await comment(fellows, 'fatou', 'Sharing with our Dakar chapter. Is there a stipend for fellows outside their home country?', 20 * H - 10 * 60_000);
  await comment(fellows, 'team', 'Yes — travel and a monthly stipend are covered. Full details are on the application page.', 19 * H, {
    parentId: fatouFellows,
  });
  await comment(fellows, 'yohannes', 'Would health-tech initiatives qualify, or only climate, agritech and #YouthEmployment?', 16 * H);

  const fatouTrust = await comment(diaspora, 'fatou', 'Trust, every time. Local co-investors with a track record change the conversation completely.', 4 * H);
  await comment(diaspora, 'owais', 'Transfer costs are still brutal from the Gulf. Would love to see a #DiasporaInvest corridor comparison.', 3 * H);

  await comment(cleanCooking, 'thabo', 'I can do the 28th — hardware side. @wanjiru-kamau sending you a DM.', 6 * H);
  await comment(rules, 'amara', 'Thank you — this affects our co-packing plans with Ghana. Bookmarking.', 3 * H);

  /* ---------- Reposts ---------- */

  await post('fatou', 'Dakar chapter — this one is for you.', 18 * H, { repostOf: fellows });
  await post('yohannes', '', 15 * H, { repostOf: fellows });
  await post('amara', 'This affects our co-packing plans with Ghana.', 3 * H, { repostOf: rules });
  await post('chinedu', '', 1 * H, { repostOf: kigali });

  /* ---------- Reactions ---------- */

  const postReactions: [string, [Key, Kind][]][] = [
    [fellows, [['owais', 'like'], ['amara', 'support'], ['kwame', 'like'], ['wanjiru', 'like'], ['leila', 'insightful'], ['thabo', 'like'], ['fatou', 'support'], ['yohannes', 'like'], ['chinedu', 'like'], ['aisha', 'like']]],
    [kigali, [['owais', 'insightful'], ['kwame', 'insightful'], ['leila', 'like'], ['thabo', 'like'], ['fatou', 'like'], ['chinedu', 'support'], ['wanjiru', 'like']]],
    [diaspora, [['owais', 'like'], ['fatou', 'insightful'], ['amara', 'like'], ['leila', 'like'], ['chinedu', 'like']]],
    [cleanCooking, [['thabo', 'support'], ['yohannes', 'like'], ['owais', 'like'], ['amara', 'support']]],
    [rules, [['amara', 'insightful'], ['owais', 'insightful'], ['chinedu', 'like'], ['kwame', 'like']]],
  ];
  for (const [id, list] of postReactions) for (const [who, kind] of list) await react('post', id, who, kind);
  for (const [id, who] of [
    [kwameFx, 'amara'], [kwameFx, 'owais'], [kwameFx, 'leila'], [amaraReply, 'kwame'], [leilaOrigin, 'amara'], [fatouTrust, 'kwame'], [fatouTrust, 'owais'],
  ] as [string, Key][]) {
    await react('comment', id, who);
  }

  /* ---------- Bookmarks ---------- */

  for (const [who, id] of [
    ['owais', kigali], ['owais', rules], ['amara', rules],
  ] as [Key, string][]) {
    await db.insert(s.bookmarks).values({ userId: uid(who), targetType: 'post', targetId: id }).onConflictDoNothing();
  }

  /* ---------- Extra posts for topic pages and trending ---------- */

  for (const [author, hoursAgo, body] of EXTRA) await post(author, body, hoursAgo * H);

  /* ---------- Questions, celebrations, requests and an article ---------- */

  const sheaQuestion = await post(
    'chinedu',
    'What is the fastest way to get an export licence for shea butter from Ghana to the EU? Our first buyer wants a sample shipment in January. #TradeAfrica #AgriTech',
    20 * H,
    { type: 'question' },
  );
  const firstAnswer = await comment(sheaQuestion, 'amara', 'Register with GEPA first — the exporter certificate takes about two weeks if your documents are in order.', 19 * H);
  const bestAnswer = await comment(
    sheaQuestion,
    'kwame',
    'Do the GEPA registration and the FDA product listing in parallel, then book the EU phytosanitary inspection with PPRSD. Doing them one after another is what usually adds a month.',
    18 * H,
  );
  await comment(sheaQuestion, 'chinedu', 'This saved us weeks — thank you!', 17 * H, { parentId: bestAnswer });
  await react('comment', bestAnswer, 'amara');
  await react('comment', bestAnswer, 'leila', 'insightful');
  await react('comment', firstAnswer, 'chinedu');
  await db.update(s.posts).set({ acceptedCommentId: bestAnswer }).where(eq(s.posts.id, sheaQuestion));

  const momoQuestion = await post(
    'yohannes',
    'Has anyone integrated M-Pesa and MTN MoMo in one checkout? Which aggregator did you use, and how long did onboarding take? #Fintech',
    7 * H,
    { type: 'question' },
  );
  await comment(momoQuestion, 'fatou', 'We looked at three aggregators last year; happy to share our comparison sheet.', 6 * H);

  const seedRound = await post(
    'thabo',
    'Two years of pilots, 40 village micro-grids and a lot of patient partners. Thank you to everyone in this community who opened doors. #CleanEnergy',
    9 * H,
    { type: 'celebration', details: { category: 'funding', headline: 'GreenGrid Africa closed its $2M seed round', organisation: 'GreenGrid Africa' } },
  );
  for (const who of ['amara', 'kwame', 'wanjiru', 'fatou', 'owais'] as Key[]) await react('post', seedRound, who, 'support');
  await comment(seedRound, 'wanjiru', 'Congratulations Thabo! Well deserved.', 8 * H);

  const newRole = await post(
    'leila',
    'Starting a new chapter: I am joining the AfCFTA Secretariat’s rules-of-origin team. Still very much here for your questions. #AfCFTA',
    30 * H,
    { type: 'celebration', details: { category: 'new_role', headline: 'Joined the AfCFTA Secretariat as Rules of Origin Adviser', organisation: 'AfCFTA Secretariat' } },
  );
  for (const who of ['amara', 'chinedu', 'kwame'] as Key[]) await react('post', newRole, who, 'support');

  const cofounder = await post(
    'amara',
    'Lagos AgriHub is spinning out its cold-chain unit. We have paying customers and a pilot hub; we need someone who has shipped IoT hardware at scale to lead the product. Equity plus salary from day one. #AgriTech',
    4 * H,
    {
      type: 'request',
      details: {
        category: 'cofounder',
        title: 'Technical co-founder for a cold-chain startup',
        skills: ['IoT', 'Embedded systems', 'Logistics', 'Team building'],
        location: 'Lagos, Nigeria',
        remote: true,
      },
    },
  );
  await db.insert(s.postHelpOffers).values([
    { postId: cofounder, userId: uid('kwame'), note: 'Not me, but I know two hardware leads in Accra — happy to introduce.' },
    { postId: cofounder, userId: uid('chinedu'), note: 'I can help with product design for the farmer app.' },
  ]);

  await post(
    'wanjiru',
    'Our Nairobi hackathon still needs mentors with hardware or carbon-finance experience. One Saturday, lunch on us. #CleanCooking #NairobiChapter',
    10 * H,
    {
      type: 'request',
      chapter: 'nairobi',
      details: {
        category: 'volunteers',
        title: 'Mentors for the Clean Cooking Hackathon on 28 November',
        skills: ['Hardware', 'Carbon finance', 'Pitch coaching'],
        location: 'Nairobi, Kenya',
        remote: false,
        closesOn: '2026-11-27',
      },
    },
  );

  const article = await post('leila', ARTICLE_BODY, 26 * H, {
    type: 'article',
    details: {
      title: 'What the new rules of origin mean for textile exporters',
      subtitle: 'Cumulation, tolerance and the paperwork that trips people up',
    },
  });
  await attachDemoImage(db, article, uid('leila'), 'Rules of origin · textiles');
  await db
    .update(s.postAttachments)
    .set({ alt: 'Gradient cover reading “Rules of origin · textiles”' })
    .where(eq(s.postAttachments.postId, article));
  for (const who of ['amara', 'kwame', 'chinedu', 'fatou'] as Key[]) await react('post', article, who, 'insightful');
  await comment(article, 'amara', 'The cumulation section is exactly what we needed for our Ghana co-packer.', 20 * H);

  /* ---------- A draft and a scheduled post for the demo founder account ---------- */

  await db.insert(s.postDrafts).values([
    {
      authorId: uid('owais'),
      status: 'draft',
      payload: {
        type: 'article',
        body: 'Notes from Dubai: what GCC investors ask African founders first.',
        article: { title: 'What GCC investors ask African founders first' },
        attachmentIds: [],
        visibility: 'members',
        kind: 'standard',
      },
    },
    {
      authorId: uid('owais'),
      status: 'scheduled',
      scheduledFor: new Date(now + 26 * H),
      payload: {
        type: 'standard',
        body: 'Reminder: Diaspora Investment Forum registrations close this Friday. #DiasporaInvest',
        attachmentIds: [],
        visibility: 'members',
        kind: 'standard',
      },
    },
  ]);

  /* ---------- Home feed character: articles, daily prompt, new members, chapters ---------- */

  // Avatars for a few members (the rest keep their tone initials), so welcome nudges differ per account.
  for (const [key, initials, colors] of [
    ['amara', 'AO', ['#b4532a', '#f2b36b']],
    ['kwame', 'KM', ['#1f6f50', '#8fd1a5']],
    ['leila', 'LB', ['#244c8f', '#8fb4e8']],
    ['tunde', 'TB', ['#7a4b12', '#e8b75e']],
    ['kofi', 'KA', ['#5b2d7a', '#d29be8']],
  ] as [Key, string, [string, string]][]) {
    const fileId = await storeDemoImage(db, uid(key), 'avatar', initials, { width: 400, height: 400, colors, initials });
    if (fileId) await db.update(s.memberProfiles).set({ avatarFileId: fileId }).where(eq(s.memberProfiles.userId, uid(key)));
  }

  // Chapter follows (the first one followed is a member's main chapter).
  const chapterFollows: [Key, string, number][] = [
    ['amara', 'lagos', 200], ['tunde', 'lagos', 2], ['ngozi', 'lagos', 5], ['aisha', 'abuja', 250],
    ['kwame', 'accra', 180], ['kofi', 'accra', 7], ['wanjiru', 'nairobi', 200], ['zainab', 'nairobi', 9],
    ['thabo', 'johannesburg', 150], ['fatou', 'dakar', 140], ['yohannes', 'addis-ababa', 100],
  ];
  await db
    .insert(s.follows)
    .values(
      chapterFollows.map(([who, slug, daysAgo]) => ({
        followerId: uid(who),
        targetType: 'chapter',
        targetId: chapter(slug)!,
        createdAt: new Date(now - daysAgo * 24 * H),
      })),
    )
    .onConflictDoNothing();

  // New members introduce themselves in their chapters (Tunde has not posted yet: "Share your first update").
  const ngoziHello = await post(
    'ngozi',
    'Hello Lagos chapter! I run paid apprenticeships that place young people in agribusiness and logistics roles. If your company could host an apprentice for six months, I would love to talk. #YouthEmployment',
    22 * H,
    { chapter: 'lagos' },
  );
  for (const who of ['amara', 'kwame', 'tunde', 'aisha'] as Key[]) await react('post', ngoziHello, who, 'support');
  await comment(ngoziHello, 'amara', 'Welcome Ngozi! Lagos AgriHub hosts apprentices every quarter — let’s talk this week.', 20 * H);
  const kofiHello = await post(
    'kofi',
    'Hi everyone, just joined from Kumasi. I develop solar mini-grids for market towns and I am keen to meet anyone working on productive-use financing. #CleanEnergy',
    3 * 24 * H,
    { chapter: 'accra' },
  );
  for (const who of ['thabo', 'kwame'] as Key[]) await react('post', kofiHello, who, 'like');
  await comment(kofiHello, 'thabo', 'Welcome Kofi! Happy to compare notes on tariffs — our village grids use a similar model.', 3 * 24 * H - 2 * H);

  // Today's daily prompt, answered by a few members (placed earlier today in UTC).
  const prompt = promptFor(new Date(now));
  const sinceMidnight = now - Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const answers = PROMPT_ANSWERS[prompt.id] ?? [];
  for (const [i, [who, text]] of answers.entries()) {
    const ago = Math.min([5 * H, 3 * H, 50 * 60_000][i] ?? H, sinceMidnight * [0.8, 0.5, 0.2][i]!);
    const answer = await post(who, `${text}\n\n#${DAILY_PROMPT_TAG}`, ago);
    for (const fan of (['amara', 'leila', 'chinedu'] as Key[]).filter((k) => k !== who).slice(0, 2 - (i % 2))) await react('post', answer, fan, 'like');
  }

  // Articles from several authors over the last month, with covers, so the hub's featured,
  // popular and latest lists all differ.
  for (const a of ARTICLES) {
    const id = await post(a.author, `${a.body.trim()}\n\n${a.tags.map((t) => `#${t}`).join(' ')}`, a.daysAgo * 24 * H, {
      type: 'article',
      details: { title: a.title, subtitle: a.subtitle },
    });
    const fileId = await storeDemoImage(db, uid(a.author), 'post_image', a.cover, { width: 1200, height: 675, colors: a.colors });
    if (fileId) await db.insert(s.postAttachments).values({ postId: id, fileId, kind: 'image', position: 0, alt: a.alt });
    for (const [who, kind] of a.reactions) await react('post', id, who, kind);
    for (const [i, [who, text]] of a.comments.entries()) await comment(id, who, text, a.daysAgo * 24 * H - (i + 1) * 3 * H);
  }

  /* ---------- Hashtag descriptions and follows ---------- */

  for (const [tag, description] of Object.entries(TOPIC_DESCRIPTIONS)) {
    await db.update(s.hashtags).set({ description }).where(eq(s.hashtags.tag, tag));
  }
  const follows: (typeof s.follows.$inferInsert)[] = [
    ...OWAIS_FOLLOWS.members.map((k) => ({ followerId: uid('owais'), targetType: 'member', targetId: uid(k) })),
    ...OWAIS_FOLLOWS.hashtags.map((tag) => ({ followerId: uid('owais'), targetType: 'hashtag', targetId: tag })),
    ...OWAIS_FOLLOWS.chapters.map((slug) => ({ followerId: uid('owais'), targetType: 'chapter', targetId: chapter(slug)! })),
    // A few follows between other members so follower counts are not empty.
    { followerId: uid('amara'), targetType: 'hashtag', targetId: 'afcfta' },
    { followerId: uid('leila'), targetType: 'hashtag', targetId: 'afcfta' },
    { followerId: uid('kwame'), targetType: 'hashtag', targetId: 'africantech' },
    { followerId: uid('wanjiru'), targetType: 'hashtag', targetId: 'cleancooking' },
    { followerId: uid('kwame'), targetType: 'member', targetId: uid('amara') },
    { followerId: uid('fatou'), targetType: 'member', targetId: uid('kwame') },
  ];
  await db.insert(s.follows).values(follows).onConflictDoNothing();
  await db.execute(sql`
    update hashtags h set follower_count = (select count(*) from follows f where f.target_type = 'hashtag' and f.target_id = h.tag)`);

  /* ---------- Trending: demo threshold, then compute once ---------- */

  const [rulesRow] = await db.select().from(s.platformSettings).where(eq(s.platformSettings.key, 'trending_rules')).limit(1);
  const value = { ...(rulesRow?.value as object | undefined), minDistinctAuthors: 3 };
  await db
    .insert(s.platformSettings)
    .values({ key: 'trending_rules', value })
    .onConflictDoUpdate({ target: s.platformSettings.key, set: { value, updatedAt: new Date() } });
  await computeTrending(db);

  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(s.posts)) as [{ n: number }];
  console.log(`Seeded ${n} demo posts, comments, reactions, polls, bookmarks, follows and trending.`);
}

/** A generated placeholder photo for a post (stored clean, members-only). */
async function attachDemoImage(db: Db, postId: string, ownerId: string, label: string) {
  const fileId = await storeDemoImage(db, ownerId, 'post_image', label, { width: 1200, height: 675, colors: ['#0f5c4d', '#d98b2b'] });
  if (fileId) await db.insert(s.postAttachments).values({ postId, fileId, kind: 'image', position: 0 });
}

/**
 * Renders a gradient JPEG (a caption bottom-left, or centred initials for avatars), stores it
 * as a clean file owned by `ownerId` and returns its id (null when image rendering is unavailable).
 */
async function storeDemoImage(
  db: Db,
  ownerId: string,
  purpose: 'post_image' | 'avatar',
  label: string,
  opts: { width: number; height: number; colors: [string, string]; initials?: string },
): Promise<string | null> {
  try {
    const { width, height, colors } = opts;
    const text = (opts.initials ?? label).replace(/[<&>]/g, '');
    const caption = opts.initials
      ? `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.round(height * 0.38)}" fill="#ffffff">${text}</text>`
      : `<text x="60" y="${height - 65}" font-family="sans-serif" font-size="40" fill="#ffffff">${text}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>${caption}</svg>`;
    const data = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
    const storage = createStorage();
    const [file] = await db
      .insert(s.files)
      .values({
        ownerId,
        purpose,
        storageKey: 'pending',
        originalName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image'}.jpg`,
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
    const key = `uploads/${purpose}/${file!.id}`;
    await storage.write(key, data, 'image/jpeg');
    await db.update(s.files).set({ storageKey: key }).where(eq(s.files.id, file!.id));
    return file!.id;
  } catch (err) {
    console.warn(`Skipped a demo image: ${String(err)}`);
    return null;
  }
}
