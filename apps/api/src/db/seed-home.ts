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

This is how we think about the economics at GreenGrid Africa, using a typical grid from our portfolio as the worked example. The figures are rounded, but the shape is real.

## A typical grid, in numbers

- 40 kWp of solar and 120 kWh of lithium battery storage
- 130 connections: 115 households and 15 businesses
- About $150,000 installed, or roughly $1,150 per connection
- A design life of twenty years for the panels and wiring, and about ten for the batteries

On a clear day those panels can produce around 180 kWh. The whole game is how much of that you can sell, to whom, and at what time of day.

## Start with the anchor load

Household lighting alone rarely covers the cost of a grid. A grain mill, a cold room or a welding shop running in daylight hours does. We now sign an anchor customer before we size the system.

The arithmetic is blunt. Our 115 households use about 0.25 kWh each per day, roughly 29 kWh in total, and most of it after dark, so all of it has to pass through the battery. Sold at our household tariff, that brings in about $5,800 a year. Running the grid properly costs around $10,000 a year. A households-only grid loses money before you have repaid a single dollar of capex.

Add a grain mill drawing 35 kWh a day, a cold room at 30 kWh and a cluster of welders, tailors and phone-charging kiosks at another 20 kWh, and daily sales rise to about 115 kWh. Most of that new demand runs while the sun is up, straight from the panels, so it barely touches the battery. Utilisation of the solar array goes from about 16% to over 60%.

What we now ask before we commit to a site:

1. Is there a business that already spends money on diesel for daytime work?
2. Will its owner sign a letter of intent with an expected daily load?
3. Can we finance an efficient motor or freezer if their current one wastes power?
4. Are there at least three other enterprises that could grow into the grid within two years?

If the answers are mostly no, we either wait or design a much smaller system. An oversized grid in a village without productive loads is the most expensive mistake in this sector.

## Tariffs people can plan around

Pay-as-you-go keeps collection rates high, but sudden tariff changes destroy trust. We publish a twelve-month tariff on a board in the village and stick to it.

We use two rates. Evening and household energy costs $0.55 per kWh, because it is stored power and the battery is our most expensive component. Daytime energy for registered businesses costs $0.35 per kWh, which is cheaper than the diesel it replaces and encourages people to run machines while the sun is up. Together they bring in about $16,700 a year on our example grid.

A few rules we have learned to follow:

- Announce any change at a community meeting at least three months before it takes effect.
- Show the reason, such as the battery replacement reserve, in plain numbers.
- Keep a small lifeline block for households, so the poorest customers can always afford lighting and phone charging.
- Never cut off a business mid-shift. Send a top-up reminder by SMS when credit drops below two days of typical use.

Collection rates on our pay-as-you-go grids sit above 95%. On the two grids where we once raised prices without enough warning, they fell below 80% for six months.

## Maintenance is a line item

Budget for a local technician from day one. A grid that is down for a week loses the goodwill it took a year to build.

Of the roughly $10,000 a year it costs to run our example grid, the largest single line is a battery replacement reserve of about $4,000. The technician costs about $3,000, the payment platform and remote monitoring about $1,200, and spares and insurance the rest. Skip the reserve and the grid looks profitable for nine years, then fails in the tenth.

We recruit technicians from the village wherever we can and train them for six weeks, often alongside students from a partner training college. Each one gets a spares kit with fuses, breakers, a spare inverter board and meter units, plus a direct line to an engineer in Johannesburg who can read the system remotely. Our target is 98% uptime, and we publish the figure for each grid on the same board as the tariff.

## Grow demand on purpose

A grid's first year sets its revenue for the next five. Demand does not grow on its own just because power arrives; people need equipment, skills and customers before they can use more energy.

What has worked for us:

- Appliance financing. We sell efficient freezers, sewing machines and irrigation pumps on the same pay-as-you-go account as the power, repaid over twelve to eighteen months.
- Daytime incentives. New businesses get their first month of daytime energy at half price, which helps them through the slowest part of starting up.
- Training with the equipment. A welder with a new machine and no training is a safety risk and a bad customer. We run short courses with each appliance we finance.
- A quarterly demand review. The technician walks the village, notes who has added equipment and who is struggling, and we adjust the plan.

On grids where we did all four, daily sales grew by about a quarter in the second year. On grids where we only connected households and waited, they barely moved.

## Making the capital stack work

Even with good loads, an operating surplus of about $6,700 a year will not repay $150,000 of capex on its own. Most of our grids are blended: a capex grant or results-based subsidy covers around 60%, and the surplus services the remaining $60,000 of debt and equity. That is roughly a nine-year payback on a twenty-year asset, a profile infrastructure lenders understand.

Three things make that conversation with funders easier:

1. Signed anchor-load agreements, not projections.
2. Twelve months of metered data from a comparable grid.
3. A maintenance budget that already includes battery replacement.

## The takeaway

The numbers work when the grid helps people earn. Size the system to real daytime demand, price it so people can plan, fund maintenance before you fund expansion, and treat the village tariff board as your most important investor report. Everything else follows.`,
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

The old route went through at least two banks and usually a dollar leg in between: cedis converted to dollars, dollars sent through a correspondent, then converted to naira on arrival. Every hop added a day and a spread. For a trader moving a few thousand dollars of goods a week, that 6% was often the whole margin on the shipment.

Here is what we changed, and what it cost us to change it.

## Pre-fund both sides

Fast settlement is a liquidity problem before it is a technology problem. We hold float in both currencies and rebalance daily, so a payment never waits for a correspondent bank.

When a buyer in Accra pays in cedis, we credit the supplier in Lagos from naira we already hold there. The cross-border movement of money happens later, in bulk, on our schedule rather than the customer's.

How we size and manage the float:

1. Size each side to cover the busiest 36 hours of outbound payments, not the average day.
2. Net flows first. Payments from Ghana to Nigeria are partly offset by payments going the other way, so we only rebalance the difference.
3. Rebalance at a fixed time each morning through two licensed FX partners, so no single partner can hold us up.
4. Set an alert at 40% of target float, and a hard stop at 15%, where new payments queue instead of failing.

The trade-off is cost. Idle float is capital that earns almost nothing, and the exchange rate can move while we hold it. We treat that as the price of the product and build it into our fees rather than hoping it will not happen.

One lesson came straight from the data. Most of our failed transfers used to happen on Friday afternoons, when traders paid suppliers before the weekend and our naira float ran low. We moved our Friday top-ups earlier in the day and the failures all but disappeared.

## Compliance once, not twice

We built one onboarding flow that satisfies both central banks' requirements. Traders verify once and can send in either direction.

In practice that meant mapping the two sets of rules side by side and taking the stricter requirement in every row: identity documents, proof of address, business registration, beneficial ownership and the purpose of payments. We collect each item once, record which rule it satisfies, and refresh it on the shorter of the two review cycles.

It made onboarding slightly longer on day one, about twelve minutes instead of eight. It saved us from re-verifying customers the first time they paid in the opposite direction, which used to take days.

Transaction monitoring follows the same principle: one set of rules, tuned to both markets, reviewed by one team that understands both. When a payment is held for review, the trader is told within fifteen minutes and given a clear reason.

## Tell people where their money is

Most support calls were not about speed but uncertainty. A simple status page for every transfer cut our tickets by half.

Each transfer now shows five steps: received, checked, funded, sent and credited, each with a timestamp. When something is held, the page says why and what the customer can do about it. We send the same updates by SMS for traders who rarely open the app.

What we learned about status design:

- Show the step, not the system. Nobody cares which ledger processed the payment.
- Give an expected time for the next step, and update it if it slips.
- Make the supplier's view as clear as the sender's. Half our calls came from the person waiting for the money.

## What it costs the customer now

A typical payment now costs between 1.2% and 1.8% all-in, including the exchange rate margin, and we show the exact naira amount the supplier will receive before the buyer confirms. Most transfers land within the hour. The slowest are the ones held for compliance checks or sent outside banking hours on the receiving side.

## What still gets stuck

We are not finished. Large one-off payments can still outrun our float on busy days. Some suppliers' banks credit accounts in batches, so the money reaches our partner bank within minutes but sits for hours before the supplier sees it. And every new corridor means building the compliance map again from scratch.

The takeaway for anyone building payments in this region: solve liquidity, compliance and communication, in that order, and the technology becomes the easy part.

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

I have joined, led and declined to join a fair number of syndicates over the years. This guide is what I wish someone had given me before my first one.

## How a syndicate is structured

Most syndicates set up a separate legal vehicle for each deal, often called a special purpose vehicle. Members put money into the vehicle, and the vehicle makes a single investment in the startup. The startup gets one line on its shareholder register instead of forty, which founders and later investors appreciate.

A typical deal looks like this:

- Minimum ticket: often $1,000 to $5,000 per member
- Total raised by the syndicate: $50,000 to $300,000
- The startup's round: usually larger, with the syndicate as one participant alongside funds or local angels
- Time to an outcome: seven to ten years, sometimes longer

That last point matters most. This is not money you can take back out next year for a wedding or a house.

## The lead does the homework

A lead investor finds the deal, negotiates terms and writes a memo. Members read it and decide whether to join. You are trusting the lead's judgement, so look at their record.

A good memo answers five questions clearly: what the company does, why now, why this team, what the terms are and what could go wrong. If the risks section is shorter than a paragraph, treat that as a warning.

When you assess a lead, ask:

1. How many deals have they led, and how long ago did the first one close?
2. Are they putting their own money in, and how much relative to members?
3. How have earlier companies performed, including the ones that failed?
4. Do they know the sector and the market, or are they mostly a deal finder?

A lead who is open about losses is usually more trustworthy than one who only talks about winners.

## Know the costs

Most syndicates charge a carry of 10–20% of profits and sometimes a small admin fee. Ask for both in writing before you commit.

Here is how the fees usually break down:

- Carry: a share of the profit, paid only if the investment returns more than you put in. Typically 10–20%.
- Admin or setup fee: covers legal work and running the vehicle. Often 1–3% of your ticket, sometimes charged once, sometimes yearly.
- Platform fee: some online platforms charge their own fee on top. Check whether it is included in the figures above.
- Annual management fee: less common for deal-by-deal syndicates. If you see one, ask what it pays for.

A worked example. You invest $5,000 and pay a one-off 2% admin fee of $100. Eight years later the company is sold and your stake is worth $20,000. Your profit is $15,000. With a 20% carry, the lead takes $3,000 and you receive $17,000. If the company fails, you lose your $5,000 and the $100 fee, and no carry is paid.

## Questions to ask

- Who is the local co-investor, and what do they bring?
- How will currency risk be handled?
- What information will members receive each year?

A few more are worth adding to your list:

- Are the shares in a holding company abroad or in a local company? This affects exits, tax and currency.
- Does the syndicate have the right to invest in the next round, and will members be asked to put in more?
- How will proceeds from a sale be distributed, and in which currency?
- Who administers the vehicle, and what happens if the lead steps away?

Currency deserves a moment of its own. If the startup earns in naira or cedis and you measure your returns in pounds or dirhams, a strong company can still deliver a weak return after exchange rates move. Many diaspora-backed companies now hold part of their revenue in dollars or sit under a holding company abroad. Neither removes the risk; both change it.

On tax, rules differ between countries of residence. Speak to an adviser where you live before you commit, not after you receive your first distribution.

## Build a portfolio, not a bet

Early-stage investing follows a familiar pattern: most companies return little or nothing, a few return the money, and one or two do very well. If you join one syndicate, you are making a bet. If you join eight to ten over three or four years, you are building a portfolio.

A sensible approach for a first-time angel:

1. Decide a total amount you can afford to lock away for a decade, and do not exceed it.
2. Split it across at least eight deals, with roughly equal tickets.
3. Hold back around a third for follow-on rounds in the companies that do well.
4. Keep a simple spreadsheet of every deal, its terms and every update you receive.

## The takeaway

A syndicate is a way to learn alongside people with more experience, not a shortcut to returns. Choose your lead carefully, get every fee in writing, understand which currency you are really investing in, and spread your money over time.

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

The five counties cover a mix of arid, semi-arid and highland areas, so the patterns below are not the story of one landscape. In total we tagged just over 1,900 budget lines and matched more than 1,400 of them to expenditure reports.

## How we did it

Adaptation spending is rarely labelled as such. A borehole may sit under water services, a drought early-warning system under agriculture, and a tree nursery under environment. So we built our own tagging rules.

1. Collect the approved budget, any supplementary budgets and the expenditure report for each county and each year.
2. Read every development line and tag it as adaptation if its main purpose is to reduce climate risk to people, crops, livestock or infrastructure.
3. Split mixed projects by the share of cost that serves adaptation, and record the assumption.
4. Match each budget line to the spending reported against it in the same financial year.
5. Have a second analyst review a random 20% sample of the tags.

Our two reviewers agreed on nine out of ten tags. Where they disagreed, we took the narrower reading, so the figures below are more likely to understate adaptation spending than to overstate it.

## Most money goes to water

Boreholes, small dams and water storage at health facilities took the largest share. That matches what communities ask for in public participation forums.

Across the five counties and five years, budgeted adaptation money split roughly like this:

- Water supply and storage: 46%
- Agriculture, including small-scale irrigation: 22%
- Drought early warning and livestock support: 12%
- Forestry and land restoration: 9%
- Planning, data and staff capacity: 7%
- Other: 4%

The health-facility line surprised us. Rainwater tanks and storage at clinics and dispensaries made up almost a tenth of all water spending. Facility managers told us that water was the first thing to fail in a dry spell, and the first thing patients noticed.

Small-scale irrigation is the line farmer groups care about most. It was also the most uneven: one county put close to a third of its adaptation budget into irrigation, while another put in less than a tenth.

## Spending lags budgets

On average only six in ten budgeted shillings were spent in the same year. Procurement delays, not lack of money, were the main reason.

The range was wide, from just over 40% in one county to nearly 80% in another. Some patterns stood out:

- Projects added in supplementary budgets late in the year rarely started before the year ended.
- Large contracts such as dams took two or three years to procure and build, but were budgeted as if they would be finished in one.
- Unspent money was usually rolled over, so it was not lost, but projects slipped by a full season or more.

For adaptation, timing matters. A water pan finished after the rains is a water pan that waits another year to fill.

## Maintenance is missing

Almost nothing was set aside to maintain what was built. A borehole without a repair budget is an adaptation project with an expiry date.

Across all five counties, operations and maintenance made up less than 2% of the adaptation budget. Yet when we visited a sample of completed boreholes, around one in four was not working, most often because of a failed pump or a broken solar controller. A repair that costs a small fraction of the original drilling can stay unfunded for months, while the community goes back to walking for water.

## What county teams can do

None of this requires new money. It requires planning the money that already exists a little differently.

1. Ringfence a maintenance share, such as 10% of each year's adaptation budget, for assets already built.
2. Budget large works over several years, with realistic milestones for each year.
3. Start procurement for next year's priority projects before the financial year begins.
4. Publish a simple quarterly progress table for adaptation projects, so communities can see what has started, stalled or finished.
5. Keep an asset register for every borehole, tank and dam, with its location, the date it was built and its last repair.

The asset register is the cheapest of these and the one that unlocks the others. You cannot budget for maintenance on assets you have not counted.

## Reading a county budget yourself

You do not need to be an economist to follow adaptation money in your own county. Three habits will take you a long way.

- Read the expenditure report, not just the budget. The budget is a plan; the expenditure report tells you what happened. Put the two side by side for the same line and the same year.
- Follow a project across years. A dam that appears in three budgets in a row, each time with a smaller amount, is a project that has stalled. A single year's document will never show you that.
- Look for the word maintenance. Search the development and recurrent budgets for operations, repairs and maintenance lines linked to water and irrigation assets. If you cannot find them, ask about them at the next public participation forum.

When you do ask, be specific. A question about a named borehole, its budget line and its current state gets a far better answer than a general question about climate spending. Finance officers we spoke to were, almost without exception, willing to explain the numbers when asked clearly and in good faith.

## The tracker

We have turned this into a simple tracker any county team can use. It is a spreadsheet with three tabs: budget lines with their adaptation tags, spending matched to each line, and the asset register. It takes a finance officer about two days to set up for one year of data, and a few hours each quarter to keep current.

The tracker will not tell a county what to fund. It will show, in one place, what was planned, what was spent and what still works.

## The takeaway

Counties are already putting real money into adaptation, and mostly into the things communities ask for. The gaps are in timing and upkeep. Fix procurement, fund maintenance and publish progress, and the same shillings will go much further.

The chapter will run a session on the tracker next month. Bring your county's budget documents and we will set it up together.`,
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

Our first cold room sat half empty for most of a year. It was well built, well located and properly powered. The problem was not the room; it was the business model around it. Here is what changed when we listened to the 4,000 smallholder farmers we now work with.

## Share the room

One co-op rarely fills a cold room. Three co-ops sharing it did, and our utilisation went from 40% to 85% in a season.

Each of our rooms holds about 20 tonnes, or around 800 crates of 25 kg. A single co-op of 150 tomato and pepper growers might fill a third of that at the peak of harvest, and very little in between. Three co-ops with different crops and slightly different harvest windows keep it busy for most of the year.

Sharing works only with clear rules:

1. Each co-op gets a guaranteed share of space at its peak, agreed before the season.
2. Unused space is released to the others after 48 hours.
3. Every crate is labelled with the co-op, the farmer and the date it came in.
4. One room manager, employed by us, enforces the rules for everyone.

The fourth point matters most. When a co-op ran the room, members of the other co-ops assumed, sometimes rightly, that they were last in line.

## Price per crate, not per month

Farmers pay when they have produce. Charging per crate per day matched their cash flow and filled the room in the harvest weeks.

We charge ₦200 per crate per day, collected when the crate leaves the room, which is when the farmer has just been paid. A farmer who holds ten crates for four days while waiting for a better price pays ₦8,000. If the market price rises even modestly over those days, the storage pays for itself several times over.

For us, the model only works at high utilisation. At 40% full, a room earns too little to cover power and staff. At 85%, it covers its running costs and repays the equipment within about four years. That is why we track utilisation every day and measure success by how full our rooms are, not by how many we own.

## Spoilage, before and after

The question we get most from investors is whether storage actually reduces losses. For tomatoes and peppers that went through our rooms, farmers told us they used to lose roughly a third of their harvest, mostly in the days between picking and sale. With storage, losses fell to under one crate in ten. Leafy greens improved less, because their biggest losses happen in transport rather than storage.

The lesson: cold storage solves one part of the chain. Pair it with crates instead of sacks and a shaded collection point at the farm gate, and the gains are much larger.

## Records open doors

Temperature logs turned out to be as valuable as the cold itself. Export buyers in the UK asked for them before they asked about price.

Each room now has sensors that record temperature and humidity every ten minutes and alert the room manager if either goes out of range. The logs are tied to crate labels, so we can show a buyer exactly how a batch was stored from the day it arrived to the day it left.

Those records help our co-ops in three ways. They speed up certification for export buyers. They help settle disputes about quality. And they give lenders evidence that a co-op's produce holds its value, which makes crop-backed loans easier to arrange.

## What we would do differently

- Sign the co-op agreements before building the room, not after.
- Put the room within 30 minutes of the farms, even if that means a smaller room.
- Budget for backup power from day one. A single long outage can spoil a room's worth of produce.

## The takeaway

Utilisation beats capacity. A smaller room that is 85% full every week does more for farmers, and for the business, than a large one that is half empty.

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

Our first version assumed a connection and cached a little data for the gaps. It failed within a month. A nurse would start a visit, the network would drop and the form would hang. Staff went back to paper, and nobody could blame them. We rebuilt the app around one idea: the network is optional.

## The device is the source of truth

Every record is written locally first and synced later. Nurses never wait for a network to save a patient visit.

Each tablet holds a local database with the records for its health centre: active patients, recent visits, stock levels and referral notes. A typical centre has around 8,000 patient files, which fits comfortably on a low-cost tablet with room to spare.

Some choices that made this work:

1. Store every change as an event with a device ID and a timestamp, instead of overwriting the record.
2. Generate every new record's ID on the device, in a format that two tablets can never both produce.
3. Encrypt the local database and require a PIN after five minutes of inactivity. Tablets do get lost.
4. Keep a rolling local backup on a memory card, so a broken tablet does not mean lost records.

## Sync for expensive, unreliable networks

When a connection appears, the app syncs in small batches. Each batch can resume if the connection drops halfway, so nothing is sent twice and nothing is lost.

A visit record is only a few kilobytes. A busy day of 80 visits comes to around 300 KB, which costs very little even on mobile data. Photos and scanned documents are the exception, so they sync last and only over Wi-Fi unless a clinician marks them urgent.

We also sync in priority order. Referrals and lab requests go first, because another facility is waiting for them. Routine visit notes follow. Stock and reporting data go last.

## Design for conflicts

Two nurses can edit the same file while offline. We merge field by field and flag the rare true conflicts for a human to resolve.

If one nurse updates a patient's phone number and another records their blood pressure, there is no conflict at all: both changes are kept. A true conflict is when two people change the same field to different values, such as two different allergy notes. The app then keeps both versions and asks a senior nurse to choose.

In practice, true conflicts are rare, roughly one in every 2,000 synced edits. Clinical fields are never resolved automatically. Both versions stay visible until a person decides, because a wrong guess in a patient record is worse than a short delay.

## Show sync state simply

One word on every screen: saved, syncing or offline. Staff trust what they can see.

We tried icons, progress bars and detailed sync logs. Nurses ignored all of them. One word in a fixed place, with a matching colour, was the only thing that worked. Behind it, a supervisor screen shows when each tablet last synced, so our support team can call any centre that has been offline for more than three days.

## How we test it

- Every release is tested with the network switched off for a full simulated week.
- We pull the battery mid-save to make sure no record is ever half-written.
- Each new feature has to answer one question before it is built: what happens when there is no connection?

Last year one of our centres went a full week without connectivity and synced every record without a single conflict when it came back online. That was our test suite passing in real life.

## The takeaway

If you are building for low-connectivity settings, start with the offline case and treat the network as a bonus. Store locally, sync in small resumable batches, merge carefully and tell users the state of their data in one word.`,
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

For years the simplest way to send money to someone on another network was to cash out and hand it to an agent on their network. Some operators allowed direct transfers through bilateral agreements, but each link had to be negotiated, built and maintained separately. With five operators, that is ten separate links, each with its own fees and rules.

## What a switch actually does

A national switch replaces all those links with one hub. Every wallet and bank connects once, and the switch handles three jobs:

1. Routing: working out which provider holds the recipient's account, often from just a phone number.
2. Messaging: carrying payment instructions in a common format every provider understands.
3. Settlement: totalling what each provider owes the others and settling the net amounts at set times each day.

The customer sees none of this. They type a number, check the recipient's name and send.

## Switches are arriving

National switches in Ghana, Rwanda and elsewhere now connect wallets and banks. Fees are falling where volumes are high.

Fees remain the hardest part to agree. Operators with most of the market have little reason to make it cheap for their customers to send money to rivals. In some markets a transfer to another network still costs two or three times as much as one on the same network. Where pricing rules are clear and volumes have grown, the gap has narrowed quickly.

Two other details matter more than they sound:

- Name confirmation: showing the recipient's registered name before sending sharply cuts mistaken transfers.
- Reversals: a clear, shared process for returning money sent in error builds trust in cross-network payments.

## Cross-border is next

Regional switches will let a trader in Accra pay a supplier in Lomé from one wallet to another. The rules are being written now.

Cross-border adds currency conversion, two sets of compliance rules and the question of who holds the liquidity. These are the problems we solved for a single corridor at PayBridge, but a regional switch would solve them once for everyone.

## What changes for a small business

For a trader, interoperability is less about technology and more about who they can sell to. A market seller who can only accept payments from one network turns away customers on the others, or asks them to pay cash. Once wallets connect, any customer with a phone can pay any seller.

It also changes how suppliers get paid. A wholesaler can pay a dozen small producers on different networks from one account, with one record of every payment. That record is what lenders look for when a small business asks for working capital. A year of clean, consistent wallet payments can do more for a loan application than a pile of handwritten receipts.

There is a trade-off. As payments become easier to send, they also become easier to send by mistake or under pressure from a scam. Interoperable systems need shared fraud monitoring, so a suspicious pattern spotted by one provider can be stopped by the others.

## What to do now

- If you run a business, ask your provider which networks you can receive from directly, and what each costs the sender.
- If you build products, design for phone-number payments that work across networks, not around a single wallet.
- If you invest, watch the settlement and pricing rules as closely as the technology.

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

We build tools for exporters across West and East Africa, and our first design system was put together quickly, in English, on fast laptops in London. It broke the first time we loaded real product names in Amharic on a mid-range phone. These are the fixes that made the difference.

## Leave room to grow

Labels in some languages run 40% longer than English. Buttons and table headers now wrap instead of truncating.

Specific changes:

- Buttons have a minimum width but no maximum, and their labels can wrap to two lines.
- Table headers wrap, and columns size to their content rather than to fixed widths.
- Every component is tested with a string 40% longer than the English version before it ships.
- We removed ellipses from navigation items entirely. A truncated menu label is a guess the user has to make.

## Pick fonts that cover the scripts

We chose type families with full Ethiopic and Arabic coverage, and tested diacritics at small sizes on cheap screens.

Ethiopic characters carry a lot of detail in each glyph, so our minimum body size for Amharic is one step larger than for Latin text. Yoruba often stacks a dot below a letter and a tone mark above it, so we increased the line height of body text to stop marks colliding with the line above.

Weight matters on low-cost screens too. Thin weights that look elegant on a laptop turn into grey smudges on a cheap phone, so the lightest weight in our product is regular.

## Right to left is not a mirror image

Ajami is written right to left. We made every layout use start and end rather than left and right, so the whole interface flips correctly. Then we found the exceptions: phone numbers, prices and product codes still read left to right, even inside a right-to-left sentence. Icons that point somewhere, such as back arrows, flip; icons that do not, such as a magnifying glass, stay as they are.

## Keep it light

Full fonts for several scripts can add more than a megabyte to a page. For users on prepaid data, that is a real cost. We now:

1. Subset each font to the characters each language actually needs.
2. Load a script's font only when content in that script is on the page.
3. Fall back to good system fonts while custom fonts load, so text is readable immediately.

## Write copy that travels

Some problems start in the English copy itself. We now follow a few rules so that strings translate cleanly:

- Never build a sentence from fragments. A string like "You have" plus a number plus "orders" cannot be reordered for languages with different word order. Each message is one complete string with a placeholder.
- Handle plurals properly. Some languages have more than two plural forms, and some have none.
- Avoid idioms and wordplay in interface text. They rarely survive translation.
- Format dates, numbers and currencies by locale, not by hand.

Translators also get context for every string: where it appears, how much space it has and a screenshot. A two-word button label translated without context is a common source of awkward interfaces.

## Test with real content

Lorem ipsum hides every problem. We seed prototypes with real names, addresses and product descriptions in each language.

We keep a shared library of real strings, collected with permission from our users and reviewed by native speakers. When a designer builds a screen, the library is the default content, not placeholder text. Sorting, search and form validation are tested with the same strings, because a name field that rejects tone marks is a bug.

## The takeaway

Inclusive design starts with the alphabet. Leave room for longer words, choose fonts that cover every script you serve, design for both reading directions and test with real content on real phones.

The tokens are open source if you want to build on them.`,
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
