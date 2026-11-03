/*
 * Placeholder content for screens whose modules arrive in later phases (chapters, events,
 * the public landing page). The social product (feed, posts, topics, profiles, network,
 * notifications) reads the real API; don't add social data here.
 */

/** Chapter pages (later phase) still greet a placeholder viewer. */
export const viewer = {
  name: "Owais Iqbal",
  handle: "owais-iqbal",
  headline: "Founder · Dubai, UAE",
};

/** Read by lib/mock/settings.ts (settings workstream) until it moves to GET /me/follows. */
export const followedHashtags = ["AfricanTech", "ClimateAction", "DiasporaInvest", "WomenInLeadership"];

/** Landing-page hero (lib/mock/public.ts). */
export const trendingTopics = [
  { tag: "AfCFTA", context: "Trending in Africa", stats: "2,481 posts · +312% today" },
  { tag: "DiasporaInvest", context: "Trending in Business", stats: "1,906 posts · +184% today" },
  { tag: "CleanCooking", context: "Trending in Climate", stats: "1,122 posts · +151% today" },
  { tag: "AfricanTech", context: "Trending in Tech", stats: "3,870 posts · +64% today" },
  { tag: "YouthEmployment", context: "Trending in Careers", stats: "908 posts · +47% today" },
];

/** Right-rail events widget; events arrive in a later phase. */
export const upcomingEvents = [
  { slug: "diaspora-investment-forum-2026", month: "NOV", day: "21", title: "Diaspora Investment Forum", meta: "Accra & online · 312 going" },
  { slug: "clean-cooking-hackathon", month: "NOV", day: "28", title: "Clean Cooking Hackathon", meta: "Nairobi chapter · 64 going" },
];
