/*
 * Hashtag topic placeholder content (Figma "Web / Hashtag topic page", node 9:496).
 * Keys are lower-case tags, as used in /topics/[tag] URLs.
 */
import type { AvatarTone } from "@chartermission/ui";
import { feedPosts, trendingTopics, type FeedPost } from "@/lib/mock-data";

export type Topic = {
  tag: string;
  description: string;
  badge?: string;
  posts: string;
  followers?: string;
  growth?: string;
  /** Posts per day for the last 7 days, oldest first; the last bar is today. */
  activity: number[];
  related: string[];
  contributors: { name: string; handle: string; posts: number; tone: AvatarTone }[];
  opportunities: { title: string; meta: string; slug: string }[];
};

export const topics: Record<string, Topic> = {
  afcfta: {
    tag: "AfCFTA",
    badge: "#1 in Africa today",
    description:
      "African Continental Free Trade Area — trade policy, cross-border business and the corridors opening up across the continent.",
    posts: "12,408",
    followers: "3,210",
    growth: "+312%",
    activity: [18, 22, 20, 26, 31, 38, 56],
    related: ["TradeAfrica", "AgriTech", "Logistics", "Fintech", "MadeInAfrica"],
    contributors: [
      { name: "Leila Benali", handle: "leila-benali", posts: 42, tone: "info" },
      { name: "Amara Okafor", handle: "amara-okafor", posts: 31, tone: "accent" },
      { name: "Chinedu Eze", handle: "chinedu-eze", posts: 24, tone: "success" },
    ],
    opportunities: [
      { title: "Trade Policy Fellow", meta: "Afreximbank-style programme · Cairo · Closes 20 Nov", slug: "trade-policy-fellow" },
      { title: "Export Readiness Grant", meta: "SME fund · 12 countries · Closes 5 Dec", slug: "export-readiness-grant" },
    ],
  },
  africantech: {
    tag: "AfricanTech",
    badge: "#4 in Tech today",
    description: "Startups, engineering teams and the infrastructure powering Africa's technology ecosystem.",
    posts: "3,870",
    followers: "8,904",
    growth: "+64%",
    activity: [30, 34, 29, 36, 38, 41, 52],
    related: ["Fintech", "AgriTech", "YouthEmployment", "DiasporaInvest"],
    contributors: [
      { name: "Kwame Mensah", handle: "kwame-mensah", posts: 27, tone: "success" },
      { name: "Yohannes Tesfaye", handle: "yohannes-tesfaye", posts: 19, tone: "info" },
      { name: "Fatou Diallo", handle: "fatou-diallo", posts: 14, tone: "accent" },
    ],
    opportunities: [
      { title: "Senior Backend Engineer", meta: "PayBridge · Accra or remote · Closes 30 Nov", slug: "paybridge-senior-backend-engineer" },
    ],
  },
  climateaction: {
    tag: "ClimateAction",
    description: "Climate policy, adaptation and the people building low-carbon livelihoods across Africa and the diaspora.",
    posts: "5,214",
    followers: "6,120",
    growth: "+41%",
    activity: [22, 25, 24, 27, 26, 33, 40],
    related: ["CleanCooking", "AgriTech", "NairobiChapter"],
    contributors: [
      { name: "Wanjiru Kamau", handle: "wanjiru-kamau", posts: 33, tone: "info" },
      { name: "Thabo Nkosi", handle: "thabo-nkosi", posts: 21, tone: "warning" },
    ],
    opportunities: [{ title: "Climate Adaptation Grant", meta: "East Africa · Closes 12 Dec", slug: "climate-adaptation-grant" }],
  },
  diasporainvest: {
    tag: "DiasporaInvest",
    badge: "#2 in Business today",
    description: "How the diaspora invests back home — trust, transfers, regulation and the founders making it easier.",
    posts: "1,906",
    followers: "2,488",
    growth: "+184%",
    activity: [12, 14, 13, 16, 19, 24, 44],
    related: ["Fintech", "AfricanTech", "AfCFTA"],
    contributors: [
      { name: "Kwame Mensah", handle: "kwame-mensah", posts: 18, tone: "success" },
      { name: "Fatou Diallo", handle: "fatou-diallo", posts: 16, tone: "accent" },
    ],
    opportunities: [{ title: "Diaspora Angel Syndicate", meta: "Investor network · Online · Rolling", slug: "diaspora-angel-syndicate" }],
  },
  cleancooking: {
    tag: "CleanCooking",
    badge: "#3 in Climate today",
    description: "LPG, bioethanol and improved stoves — the business models getting clean cooking into African homes.",
    posts: "1,122",
    followers: "1,340",
    growth: "+151%",
    activity: [8, 9, 11, 10, 14, 18, 30],
    related: ["ClimateAction", "CleanEnergy", "NairobiChapter"],
    contributors: [
      { name: "Wanjiru Kamau", handle: "wanjiru-kamau", posts: 12, tone: "info" },
      { name: "Thabo Nkosi", handle: "thabo-nkosi", posts: 7, tone: "warning" },
    ],
    opportunities: [{ title: "Clean Cooking Hackathon mentors", meta: "Nairobi chapter · 28 Nov", slug: "clean-cooking-hackathon-mentors" }],
  },
  youthemployment: {
    tag: "YouthEmployment",
    badge: "#5 in Careers today",
    description: "Jobs, apprenticeships and skills programmes for Africa's young workforce.",
    posts: "908",
    followers: "4,012",
    growth: "+47%",
    activity: [14, 15, 13, 17, 16, 19, 24],
    related: ["CharterFellows", "AfricanTech", "AgriTech"],
    contributors: [{ name: "Amara Okafor", handle: "amara-okafor", posts: 9, tone: "accent" }],
    opportunities: [{ title: "Charter Mission Fellows 2027", meta: "40 fellows · 15 countries · Closes 30 Nov", slug: "charter-mission-fellows-2027" }],
  },
  agritech: {
    tag: "AgriTech",
    description: "Technology for farmers — supply chains, cold storage, inputs and market access.",
    posts: "2,760",
    followers: "3,544",
    growth: "+28%",
    activity: [20, 22, 21, 23, 25, 24, 30],
    related: ["AfCFTA", "ClimateAction", "TradeAfrica"],
    contributors: [{ name: "Amara Okafor", handle: "amara-okafor", posts: 22, tone: "accent" }],
    opportunities: [{ title: "Export Readiness Grant", meta: "SME fund · 12 countries · Closes 5 Dec", slug: "export-readiness-grant" }],
  },
  womeninleadership: {
    tag: "WomenInLeadership",
    description: "Women leading companies, chapters and initiatives across Africa and the diaspora.",
    posts: "1,480",
    followers: "5,206",
    growth: "+19%",
    activity: [16, 18, 17, 19, 20, 18, 22],
    related: ["AfricanTech", "DiasporaInvest", "YouthEmployment"],
    contributors: [
      { name: "Fatou Diallo", handle: "fatou-diallo", posts: 11, tone: "accent" },
      { name: "Wanjiru Kamau", handle: "wanjiru-kamau", posts: 8, tone: "info" },
    ],
    opportunities: [],
  },
};

/** Extra posts that only appear on topic pages (not in the home feed). */
export const topicOnlyPosts: FeedPost[] = [
  {
    id: "rules-of-origin",
    author: { name: "Leila Benali", verified: true, tone: "info" },
    meta: "Trade Economist · Casablanca, Morocco · 4h",
    body: "New rules-of-origin guidance is out. If you ship textiles between North and West Africa, the cumulation clause is the part to read twice.",
    linkPreview: {
      domain: "au-afcfta.org",
      title: "Rules of origin: updated guidance for exporters",
      description: "What changes for textiles, agri-processing and automotive parts.",
      href: "https://au-afcfta.org",
    },
    tags: ["AfCFTA", "TradeAfrica"],
    stats: "188 reactions · 40 comments · 66 reposts",
  },
];

/** Every tag that appears somewhere in the mock data, lower-cased for URLs. */
export function knownTopicSlugs(): string[] {
  const tags = new Set(Object.keys(topics));
  for (const post of [...feedPosts, ...topicOnlyPosts]) post.tags?.forEach((tag) => tags.add(tag.toLowerCase()));
  trendingTopics.forEach((topic) => tags.add(topic.tag.toLowerCase()));
  Object.values(topics).forEach((topic) => topic.related.forEach((tag) => tags.add(tag.toLowerCase())));
  return [...tags];
}

/** Display casing for a tag slug ("afcfta" → "AfCFTA"), falling back to the slug itself. */
export function topicDisplayName(slug: string): string {
  const lower = slug.toLowerCase();
  if (topics[lower]) return topics[lower].tag;
  for (const post of [...feedPosts, ...topicOnlyPosts]) {
    const match = post.tags?.find((tag) => tag.toLowerCase() === lower);
    if (match) return match;
  }
  for (const topic of Object.values(topics)) {
    const match = topic.related.find((tag) => tag.toLowerCase() === lower);
    if (match) return match;
  }
  return slug;
}

/** Posts tagged with a topic, most engaged first. */
export function postsForTopic(slug: string): FeedPost[] {
  const lower = slug.toLowerCase();
  return [...feedPosts, ...topicOnlyPosts].filter((post) => post.tags?.some((tag) => tag.toLowerCase() === lower));
}

/** Topic data for any tag, with neutral defaults for tags we have no details for. */
export function getTopic(slug: string): Topic {
  const lower = slug.toLowerCase();
  if (topics[lower]) return topics[lower];
  const tag = topicDisplayName(slug);
  const count = postsForTopic(lower).length;
  return {
    tag,
    description: `Posts, people and opportunities tagged #${tag} across Charter Mission.`,
    posts: count.toLocaleString("en-US"),
    activity: [],
    related: [],
    contributors: [],
    opportunities: [],
  };
}

/** Recent-activity lines for related tags that have no full topic entry above. */
const extraTopicStats: Record<string, string> = {
  tradeafrica: "644 posts · +38% today",
  logistics: "412 posts · +22% today",
  fintech: "1,388 posts · +17% today",
  madeinafrica: "296 posts · +12% today",
};

/** Context and stats line for a TrendingItem ("Trending in Africa" / "2,481 posts · +312% today"). */
export function topicSummary(tag: string, fallbackContext = "Related"): { tag: string; context: string; stats: string } {
  const lower = tag.toLowerCase();
  const trending = trendingTopics.find((item) => item.tag.toLowerCase() === lower);
  if (trending) return { tag: trending.tag, context: trending.context, stats: trending.stats };
  const topic = topics[lower];
  const stats = extraTopicStats[lower] ?? (topic ? `${topic.posts} posts${topic.growth ? ` · ${topic.growth} today` : ""}` : `${postsForTopic(lower).length} posts`);
  return { tag: topicDisplayName(tag), context: fallbackContext, stats };
}
