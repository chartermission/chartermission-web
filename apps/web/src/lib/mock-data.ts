/*
 * Placeholder content taken from the Figma designs. Each export mirrors the
 * shape the API will return, so screens can switch to real data by replacing
 * these imports with API calls.
 */
import type { AvatarTone, ChipTone, PostCardProps } from "@chartermission/ui";

export const viewer = {
  name: "Owais Iqbal",
  handle: "owais-iqbal",
  headline: "Founder · Dubai, UAE",
  connections: 412,
  profileViews: 87,
  profileComplete: 80,
};

export const followedHashtags = ["AfricanTech", "ClimateAction", "DiasporaInvest", "WomenInLeadership"];

export type FeedPost = PostCardProps & { id: string };

export const feedPosts: FeedPost[] = [
  {
    id: "fellows-2027",
    pinned: "Pinned announcement · Charter Mission team",
    author: { name: "Charter Mission", verified: true, tone: "primary", href: "/organisations/charter-mission" },
    meta: "Platform team · 1d",
    body: "Applications are open for the first Charter Mission Fellows cohort — 40 fellows across 15 countries, working on initiatives in climate, agritech and youth employment. Apply by 30 November.",
    linkPreview: {
      domain: "chartermission.org",
      title: "Charter Mission Fellows 2027 — call for applications",
      description: "A 6-month programme pairing fellows with mentors from across Africa and the diaspora.",
      href: "/opportunities/charter-mission-fellows-2027",
    },
    tags: ["CharterFellows", "YouthEmployment"],
    stats: "1,248 reactions · 186 comments · 402 reposts",
  },
  {
    id: "kigali-afcfta",
    author: { name: "Amara Okafor", verified: true, tone: "accent", href: "/members/amara-okafor" },
    meta: "Founder, Lagos AgriHub · Lagos, Nigeria · 2h",
    body: "Just back from the AfCFTA trade corridor workshop in Kigali. 3 takeaways for agri exporters: certify early, partner across borders, and price in naira AND cedi. Thread below 👇",
    image: { label: "Kigali Convention Centre · AfCFTA corridor workshop" },
    tags: ["AfCFTA", "AgriTech", "TradeAfrica"],
    stats: "343 reactions · 58 comments · 21 reposts",
  },
  {
    id: "diaspora-barriers",
    author: { name: "Kwame Mensah", verified: true, tone: "success", href: "/members/kwame-mensah" },
    meta: "Product Lead, PayBridge · Accra, Ghana · 5h",
    body: "Diaspora founders: what is the biggest barrier to investing back home?",
    poll: {
      question: "Biggest barrier to diaspora investment",
      options: [
        { label: "Trust in local partners", percent: 48, chosen: true },
        { label: "Currency and transfer costs", percent: 31 },
        { label: "Regulation and paperwork", percent: 21 },
      ],
      footer: "2,019 votes · 2 days left",
    },
    tags: ["DiasporaInvest", "Fintech"],
    stats: "211 reactions · 97 comments · 14 reposts",
  },
  {
    id: "clean-cooking-mentors",
    author: { name: "Wanjiru Kamau", tone: "info", href: "/members/wanjiru-kamau" },
    meta: "Climate Policy Analyst · Nairobi, Kenya · 8h",
    body: "Our Nairobi chapter is hosting a clean-cooking hackathon on 28 November. Looking for 3 more mentors with hardware or carbon-finance experience — reply or DM if you can give a Saturday.",
    tags: ["ClimateAction", "NairobiChapter"],
    stats: "96 reactions · 31 comments · 12 reposts",
  },
];

export const trendingTopics = [
  { tag: "AfCFTA", context: "Trending in Africa", stats: "2,481 posts · +312% today" },
  { tag: "DiasporaInvest", context: "Trending in Business", stats: "1,906 posts · +184% today" },
  { tag: "CleanCooking", context: "Trending in Climate", stats: "1,122 posts · +151% today" },
  { tag: "AfricanTech", context: "Trending in Tech", stats: "3,870 posts · +64% today" },
  { tag: "YouthEmployment", context: "Trending in Careers", stats: "908 posts · +47% today" },
];

export const trendingScopes = ["Africa", "Nigeria", "Lagos chapter"];

export const peopleToFollow: { name: string; handle: string; headline: string; tone: AvatarTone }[] = [
  { name: "Thabo Nkosi", handle: "thabo-nkosi", headline: "Renewable energy engineer · Johannesburg", tone: "warning" },
  { name: "Fatou Diallo", handle: "fatou-diallo", headline: "Fintech investor · Dakar", tone: "accent" },
  { name: "Yohannes Tesfaye", handle: "yohannes-tesfaye", headline: "Health-tech founder · Addis Ababa", tone: "info" },
];

export const upcomingEvents = [
  { slug: "diaspora-investment-forum-2026", month: "NOV", day: "21", title: "Diaspora Investment Forum", meta: "Accra & online · 312 going" },
  { slug: "clean-cooking-hackathon", month: "NOV", day: "28", title: "Clean Cooking Hackathon", meta: "Nairobi chapter · 64 going" },
];

export const statusTone: Record<string, ChipTone> = {
  Recruiting: "success",
  Active: "info",
  Idea: "neutral",
  Paused: "warning",
  Completed: "neutral",
};
