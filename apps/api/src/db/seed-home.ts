/**
 * Demo content for the home feed's character (articles hub, daily prompt). Used by seed-content.ts.
 * Member keys refer to seed-data.ts MEMBERS.
 */

type Kind = 'like' | 'insightful' | 'support';

export type SeedArticle = {
  author: string;
  title: string;
  subtitle: string;
  daysAgo: number;
  tags: string[];
  /** Cover image text and alt text. */
  cover: string;
  alt: string;
  colors: [string, string];
  reactions: [string, Kind][];
  comments: [string, string][];
  body: string;
};

export const ARTICLES: SeedArticle[] = [
  {
    author: 'thabo',
    title: 'The economics of a village micro-grid',
    subtitle: 'Capex, tariffs and the productive-use loads that make the numbers work',
    daysAgo: 2,
    tags: ['CleanEnergy', 'ClimateAction'],
    cover: 'Village micro-grids',
    alt: 'Gradient cover reading “Village micro-grids”',
    colors: ['#14532d', '#f59e0b'],
    reactions: [['kofi', 'insightful'], ['wanjiru', 'like'], ['amara', 'like']],
    comments: [['kofi', 'The section on anchor loads matches what we see in Ashanti market towns. Grain mills change everything.']],
    body: `After forty village micro-grids, the question I get most is simple: does the money work? It can, but only if you design for income, not just for light.

## Start with the anchor load

Household lighting alone rarely covers the cost of a grid. A grain mill, a cold room or a welding shop running in daylight hours does. We now sign an anchor customer before we size the system.

## Tariffs people can plan around

Pay-as-you-go keeps collection rates high, but sudden tariff changes destroy trust. We publish a twelve-month tariff on a board in the village and stick to it.

## Maintenance is a line item

Budget for a local technician from day one. A grid that is down for a week loses the goodwill it took a year to build.

The numbers work when the grid helps people earn. Everything else follows.`,
  },
  {
    author: 'kwame',
    title: 'Settling cedi to naira in under an hour: what we learned',
    subtitle: 'Liquidity, compliance and the unglamorous work behind fast cross-border payments',
    daysAgo: 3,
    tags: ['Fintech', 'AfCFTA'],
    cover: 'Cedi ↔ naira in an hour',
    alt: 'Gradient cover reading “Cedi to naira in an hour”',
    colors: ['#0f3d5c', '#34d399'],
    reactions: [['fatou', 'insightful'], ['amara', 'like'], ['leila', 'insightful'], ['owais', 'like'], ['chinedu', 'like'], ['tunde', 'like']],
    comments: [
      ['fatou', 'The liquidity pre-funding point is the one investors underestimate most. Great write-up.'],
      ['amara', 'This is exactly what our Accra buyers needed. Our last payment landed in 40 minutes.'],
    ],
    body: `A year ago a payment from an Accra buyer to a Lagos supplier took three days and lost up to 6% on the way. Today PayBridge settles most of them in under an hour. None of it was magic.

## Pre-fund both sides

Fast settlement is a liquidity problem before it is a technology problem. We hold float in both currencies and rebalance daily, so a payment never waits for a correspondent bank.

## Compliance once, not twice

We built one onboarding flow that satisfies both central banks' requirements. Traders verify once and can send in either direction.

## Tell people where their money is

Most support calls were not about speed but uncertainty. A simple status page for every transfer cut our tickets by half.

If you trade across West African borders, I would love to hear where your payments still get stuck.`,
  },
  {
    author: 'fatou',
    title: 'A plain-language guide to diaspora investment syndicates',
    subtitle: 'How pooled angel money works, what it costs and what to ask before you join',
    daysAgo: 6,
    tags: ['DiasporaInvest', 'WomenInLeadership'],
    cover: 'Diaspora syndicates, explained',
    alt: 'Gradient cover reading “Diaspora syndicates, explained”',
    colors: ['#6b2142', '#fbbf24'],
    reactions: [['owais', 'insightful'], ['chinedu', 'like'], ['yohannes', 'insightful'], ['kwame', 'like'], ['ngozi', 'like']],
    comments: [['owais', 'Sharing this with our Dubai group. The fees table alone will save people a lot of confusion.']],
    body: `Many people in the diaspora want to invest back home but do not want to pick startups alone. Syndicates pool money from many angels behind one lead investor. Here is how they work.

## The lead does the homework

A lead investor finds the deal, negotiates terms and writes a memo. Members read it and decide whether to join. You are trusting the lead's judgement, so look at their record.

## Know the costs

Most syndicates charge a carry of 10–20% of profits and sometimes a small admin fee. Ask for both in writing before you commit.

## Questions to ask

- Who is the local co-investor, and what do they bring?
- How will currency risk be handled?
- What information will members receive each year?

Start small, learn how it works, and invest more as you build trust.`,
  },
  {
    author: 'wanjiru',
    title: 'Where adaptation finance actually goes in Kenyan counties',
    subtitle: 'We followed the money through five county budgets',
    daysAgo: 9,
    tags: ['ClimateAction', 'AdaptationFinance'],
    cover: 'Following adaptation finance',
    alt: 'Gradient cover reading “Following adaptation finance”',
    colors: ['#134e4a', '#60a5fa'],
    reactions: [
      ['thabo', 'insightful'], ['zainab', 'insightful'], ['leila', 'like'], ['amara', 'insightful'], ['kofi', 'like'],
      ['fatou', 'like'], ['yohannes', 'insightful'], ['chinedu', 'like'], ['kwame', 'like'],
    ],
    comments: [
      ['zainab', 'The health-facility water storage line was a surprise. Would love the county breakdown.'],
      ['thabo', 'Same pattern in South Africa: the money arrives, the maintenance budget does not.'],
      ['leila', 'Clear and useful. Would you publish the tracker template?'],
      ['amara', 'Sharing with our farmer groups — the irrigation numbers matter to them.'],
    ],
    body: `Climate adaptation is now a line in every county budget. But where does the money end up? We read five years of budgets and expenditure reports from five counties to find out.

## Most money goes to water

Boreholes, small dams and water storage at health facilities took the largest share. That matches what communities ask for in public participation forums.

## Spending lags budgets

On average only six in ten budgeted shillings were spent in the same year. Procurement delays, not lack of money, were the main reason.

## Maintenance is missing

Almost nothing was set aside to maintain what was built. A borehole without a repair budget is an adaptation project with an expiry date.

We have turned this into a simple tracker any county team can use. The chapter will run a session on it next month.`,
  },
  {
    author: 'amara',
    title: 'What 4,000 smallholder farmers taught us about cold storage',
    subtitle: 'Shared cold rooms, pay-per-crate pricing and why utilisation beats capacity',
    daysAgo: 14,
    tags: ['AgriTech', 'Logistics'],
    cover: 'Cold storage, shared',
    alt: 'Gradient cover reading “Cold storage, shared”',
    colors: ['#0c4a6e', '#a3e635'],
    reactions: [['kwame', 'insightful'], ['tunde', 'insightful'], ['leila', 'like'], ['thabo', 'like'], ['fatou', 'support'], ['ngozi', 'like'], ['owais', 'like'], ['wanjiru', 'like']],
    comments: [
      ['tunde', 'Pay-per-crate is the model we are testing in Ogun too. Utilisation is everything.'],
      ['kwame', 'Would love to see the numbers on spoilage before and after.'],
      ['leila', 'The export-readiness angle is underrated: cold chain records help with certification.'],
    ],
    body: `When we started Lagos AgriHub we thought farmers needed more cold storage. They needed cold storage they could afford to use.

## Share the room

One co-op rarely fills a cold room. Three co-ops sharing it did, and our utilisation went from 40% to 85% in a season.

## Price per crate, not per month

Farmers pay when they have produce. Charging per crate per day matched their cash flow and filled the room in the harvest weeks.

## Records open doors

Temperature logs turned out to be as valuable as the cold itself. Export buyers in the UK asked for them before they asked about price.

We are now opening the model to other operators. If you run storage near a farming cluster, let's talk.`,
  },
  {
    author: 'yohannes',
    title: 'Offline-first: building clinic software for patchy connectivity',
    subtitle: 'Sync, conflicts and the design choices that kept 60 health centres running',
    daysAgo: 20,
    tags: ['AfricanTech', 'HealthTech'],
    cover: 'Offline-first clinics',
    alt: 'Gradient cover reading “Offline-first clinics”',
    colors: ['#312e81', '#f472b6'],
    reactions: [['chinedu', 'insightful'], ['zainab', 'like'], ['kwame', 'like'], ['fatou', 'like']],
    comments: [
      ['zainab', 'Conflict-free merges on patient records are hard. Thanks for sharing the approach.'],
      ['chinedu', 'The “show sync state in one word” principle is going straight into our design system.'],
    ],
    body: `Our clinic records app works in 60 health centres across Ethiopia. Most of them lose connectivity every day. Building offline-first was not a feature; it was the product.

## The device is the source of truth

Every record is written locally first and synced later. Nurses never wait for a network to save a patient visit.

## Design for conflicts

Two nurses can edit the same file while offline. We merge field by field and flag the rare true conflicts for a human to resolve.

## Show sync state simply

One word on every screen: saved, syncing or offline. Staff trust what they can see.

If you are building for low-connectivity settings, start with the offline case and treat the network as a bonus.`,
  },
  {
    author: 'kwame',
    title: 'Mobile money interoperability, explained',
    subtitle: 'Why sending between wallets is still hard, and what is changing',
    daysAgo: 24,
    tags: ['Fintech', 'AfricanTech'],
    cover: 'Wallet to wallet',
    alt: 'Gradient cover reading “Wallet to wallet”',
    colors: ['#3f1d0b', '#fb923c'],
    reactions: [['fatou', 'like'], ['yohannes', 'like']],
    comments: [['fatou', 'Bookmarking for our next portfolio review.']],
    body: `Sending money between two mobile wallets in the same country should be easy. In many markets it still is not. Here is why.

## Every operator is an island

Wallets were built as closed systems. Connecting them needs a shared switch, agreed fees and a way to settle at the end of the day.

## Switches are arriving

National switches in Ghana, Rwanda and elsewhere now connect wallets and banks. Fees are falling where volumes are high.

## Cross-border is next

Regional switches will let a trader in Accra pay a supplier in Lomé from one wallet to another. The rules are being written now.

Interoperability is plumbing, but plumbing decides who can trade.`,
  },
  {
    author: 'chinedu',
    title: 'Designing for African languages and scripts',
    subtitle: 'Notes from building a design system that handles Ge’ez, Ajami and tone marks',
    daysAgo: 27,
    tags: ['AfricanTech', 'Design'],
    cover: 'Type for every script',
    alt: 'Gradient cover reading “Type for every script”',
    colors: ['#1e293b', '#22d3ee'],
    reactions: [['yohannes', 'insightful'], ['leila', 'like'], ['zainab', 'like']],
    comments: [['yohannes', 'Thank you for including Ge’ez. Most kits break on our clinic forms.']],
    body: `Most design systems are tested in English. Our users read Amharic, Hausa in Ajami script, Yoruba with tone marks and French. Here is what we changed.

## Leave room to grow

Labels in some languages run 40% longer than English. Buttons and table headers now wrap instead of truncating.

## Pick fonts that cover the scripts

We chose type families with full Ethiopic and Arabic coverage, and tested diacritics at small sizes on cheap screens.

## Test with real content

Lorem ipsum hides every problem. We seed prototypes with real names, addresses and product descriptions in each language.

Inclusive design starts with the alphabet. The tokens are open source if you want to build on them.`,
  },
];

/** Sample #DailyPrompt answers per prompt id (src/home/prompts.ts): [member key, text]. */
export const PROMPT_ANSWERS: Record<string, [string, string][]> = {
  'first-break': [
    ['kwame', 'My first manager at a bank in Accra let me rebuild the remittance form after I complained about it in a meeting. She saw that I cared more about the customer than the process.'],
    ['ngozi', 'A school principal who hired me to run the careers office at 22. She said I asked better questions than applicants twice my age.'],
  ],
  'skill-this-year': [
    ['zainab', 'SQL window functions. Sounds small, but it cut our monthly maternal health report from two days to an afternoon.'],
    ['fatou', 'Writing one-page investment memos. Fitting the thesis on a page made every partner meeting shorter and sharper.'],
  ],
  'local-problem': [
    ['kofi', 'Market traders in Kumasi lose hours to unreliable power for their freezers. Shared solar cold boxes at the market entrance would pay for themselves in a season.'],
    ['chinedu', 'Bus route information in Lagos. Half the routes have no published map. A volunteer-run open map and some printed QR codes would go a long way.'],
  ],
  'mentor-advice': [
    ['thabo', '“Price the maintenance before you price the panels.” I ignored it on our first micro-grid and paid for it in year two.'],
    ['leila', '“Write for the customs officer, not the minister.” It took me five years to understand that clarity beats importance.'],
  ],
  'small-win': [
    ['wanjiru', 'A county finance officer emailed to say our budget tracker is now the template for next year. Nobody will ever see it, and that is fine.'],
    ['yohannes', 'One of our clinics went a full week offline and synced every record without a single conflict. Quiet engineering wins are the best kind.'],
  ],
  'cross-border': [
    ['kwame', 'A shared KYC check between mobile money operators. Re-verifying the same trader in every country is the slowest part of our onboarding.'],
    ['fatou', 'Harmonised company registration documents. Every new market means another notary, another translation and another month.'],
  ],
  'founder-mistake': [
    ['yohannes', 'We built a beautiful dashboard before asking nurses what they needed. They needed a faster way to find a patient file.'],
    ['thabo', 'Hiring for speed instead of fit in year one. We had replaced half the team within 18 months.'],
  ],
  'climate-practice': [
    ['wanjiru', 'A school in Machakos switched its kitchen to briquettes made from coffee husks from a co-op down the road. Cheaper fuel, cleaner air for the cooks and a new income line for the co-op.'],
    ['kofi', 'Pay-as-you-go solar freezers for fish sellers at Kumasi central market. They pay per day from what they sell, and nothing spoils by noon any more.'],
    ['zainab', 'Our county hospital put solar water heaters on the maternity wing. The savings now pay for two extra midwife shifts a month.'],
  ],
  'learning-resource': [
    ['chinedu', '“The Mom Test” by Rob Fitzpatrick. It changed how I run user interviews more than any design book.'],
    ['fatou', 'Founder interview podcasts from the continent. Years of honest conversations about what failed, free to listen to.'],
    ['zainab', 'The free statistics courses from a local university’s open learning site. Practical, and full of examples from public health.'],
  ],
  'chapter-idea': [
    ['ngozi', 'A Saturday CV clinic where members review apprentices’ CVs one-to-one. Two hours, real impact.'],
    ['wanjiru', 'A field visit to a clean-cooking factory with a chai debrief afterwards. People learn more on a shop floor than from slides.'],
  ],
  'hire-for': [
    ['kwame', 'How they talk about a project that failed. If they can explain what they would do differently, I am interested.'],
    ['thabo', 'Curiosity about the customer. Our best installer asks every household how they actually use power.'],
  ],
  'unsung-sector': [
    ['leila', 'Testing and certification labs. Without accredited labs, exporters cannot prove their products meet standards, whatever the tariff says.'],
    ['kofi', 'Maintenance technicians. We celebrate installations, but the people who keep systems running are the real infrastructure.'],
  ],
  'teach-in-an-hour': [
    ['zainab', 'How to clean a messy spreadsheet before you analyse it. Most bad decisions start with bad columns.'],
    ['leila', 'How to read a certificate of origin. One hour, and you will never miss a tariff preference again.'],
  ],
  'tool-you-love': [
    ['chinedu', 'A shared decisions log. Every big product decision gets one line and the reason. It ends so many repeat debates.'],
    ['yohannes', 'No meetings on Friday mornings. It is where all our hardest bugs get fixed.'],
  ],
  'young-self': [
    ['fatou', 'Ask for the introduction. People are far more willing to help than you think.'],
    ['ngozi', 'Your network is the people you help, not just the people you meet.'],
  ],
  'diaspora-bridge': [
    ['chinedu', 'One pro-bono design sprint a year for a startup back in Lagos. It keeps me honest about the real constraints.'],
    ['fatou', 'Investing small amounts alongside local angels. You learn the market through their eyes.'],
  ],
  'education-access': [
    ['ngozi', 'Paid apprenticeships during the final school year. When families see income, students stay in school.'],
    ['zainab', 'Reliable sanitary products in schools. In some counties it is one of the biggest attendance factors for girls.'],
  ],
  'proud-collab': [
    ['thabo', 'Our micro-grid project with a Soweto training college. Their students installed 12 systems and five now work with us.'],
    ['kwame', 'A joint settlement pilot with a Lagos bank. It worked because both teams shared one dashboard and one weekly call.'],
  ],
  'trade-route': [
    ['leila', 'Argan oil from women-run cooperatives in Morocco. The quality is world-class and the story deserves to be told properly.'],
    ['kofi', 'Ghanaian shea butter. Much of it still leaves as raw nuts; the processed product is where the value is.'],
  ],
  resilience: [
    ['yohannes', 'Visiting a clinic. Ten minutes watching a nurse find a record in seconds resets my motivation for a month.'],
    ['wanjiru', 'A long walk and a list of three things that moved forward, however small.'],
  ],
  'data-decision': [
    ['zainab', 'A chart showing most missed antenatal visits happened during planting season. The county moved its outreach days and attendance rose.'],
    ['kwame', 'Seeing that most failed transfers happened on Friday afternoons. We moved our liquidity top-ups and the failures disappeared.'],
  ],
  'local-hero': [
    ['ngozi', 'Mama Tola in Yaba, who has trained over 200 young tailors in her shop for free. She deserves every award going.'],
    ['thabo', 'Sipho, the electrician in our village pilot, who fixes anything with patience and a smile.'],
  ],
  'funding-lesson': [
    ['fatou', 'Grants have hidden costs: reporting takes time. Budget for it the way you budget for staff.'],
    ['yohannes', 'Raise before you need to. Our hardest round was the one we started with four months of runway.'],
  ],
  'five-years': [
    ['kofi', 'Every market town in Ghana with reliable power. We are starting with ten towns and a financing model banks understand.'],
    ['leila', 'Exporters filing certificates of origin online in minutes. I am drafting the checklists those systems will need.'],
  ],
  'question-for-network': [
    ['chinedu', 'Who has tested payment flows with first-time smartphone users? I would love to compare notes.'],
    ['kofi', 'Has anyone financed productive-use appliances alongside mini-grids? Looking for models that worked.'],
  ],
  'rest-ritual': [
    ['wanjiru', 'Sunday market, no phone, and cooking for friends.'],
    ['kwame', 'Football on Saturday mornings with the same group for ten years. No work talk allowed.'],
  ],
  'language-work': [
    ['leila', 'Switching between Arabic, French and English in one meeting makes me a better translator of ideas, not just words.'],
    ['zainab', 'Speaking Swahili with clinic staff and English with funders taught me that the same data needs two stories.'],
  ],
  'first-customer': [
    ['kwame', 'A cocoa exporter who was tired of waiting three days for payments. We onboarded him over WhatsApp.'],
    ['kofi', 'A cold-store owner at Kejetia market who agreed to be our test site in exchange for a year of free power.'],
  ],
  'open-door': [
    ['fatou', 'Two founder introductions to investors in Dakar this month. Message me if you are raising for a fintech.'],
    ['thabo', 'A site visit to our micro-grids for anyone curious about a career in energy.'],
  ],
  'celebrate-team': [
    ['yohannes', 'Our support lead Hiwot, who answered every clinic call during last month’s outage and still found time to train new staff.'],
    ['ngozi', 'The mentors of our first apprentice cohort, who gave up their Saturdays for six months.'],
  ],
};
