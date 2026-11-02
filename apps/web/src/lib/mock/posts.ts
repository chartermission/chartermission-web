/*
 * Post detail and comment placeholder content
 * (Figma "Web / Post detail with comments", node 19:2487).
 */
import type { AvatarTone } from "@chartermission/ui";
import { feedPosts, type FeedPost } from "@/lib/mock-data";
import { topicOnlyPosts } from "./topics";

/** Comment text is stored as segments so mentions and hashtags can link. */
export type CommentSegment = { text: string } | { mention: string; handle?: string } | { tag: string };

export type PostComment = {
  id: string;
  author: { name: string; handle?: string; tone: AvatarTone };
  /** e.g. "1h" or "Author · 52m" */
  meta: string;
  body: CommentSegment[];
  likes: number;
  replies?: PostComment[];
};

/** A moderation placeholder rendered in place of a removed comment. */
export type HiddenComment = { id: string; hidden: true };

export type CommentEntry = PostComment | HiddenComment;

export type PostDetail = FeedPost & {
  /** Full post text, one entry per paragraph line (the feed shows a shortened version). */
  fullBody?: string[];
  authorHandle?: string;
  authorSummary: string;
  /** Tags for the "More in #Tag" panel; defaults to the first tag plus its related topics. */
  moreTopics?: string[];
  comments: CommentEntry[];
  commentCount: number;
};

const kigaliComments: CommentEntry[] = [
  {
    id: "c-kwame-fx",
    author: { name: "Kwame Mensah", handle: "kwame-mensah", tone: "success" },
    meta: "1h",
    body: [
      { text: "Point 3 is so underrated. We lost 6% on one shipment last year purely to FX timing. " },
      { mention: "Amara Okafor", handle: "amara-okafor" },
      { text: " did you hedge or just price in both?" },
    ],
    likes: 24,
    replies: [
      {
        id: "c-amara-reply",
        author: { name: "Amara Okafor", handle: "amara-okafor", tone: "accent" },
        meta: "Author · 52m",
        body: [{ text: "Priced in both and settled within 7 days. Simple, but it worked for our volumes." }],
        likes: 11,
      },
    ],
  },
  {
    id: "c-leila-origin",
    author: { name: "Leila Benali", tone: "info" },
    meta: "40m",
    body: [
      { text: "For anyone exporting textiles: the new rules-of-origin guidance changes cumulation. Sharing a summary under " },
      { tag: "AfCFTA" },
      { text: " this week." },
    ],
    likes: 18,
  },
  { id: "c-hidden-1", hidden: true },
  {
    id: "c-thabo-cold-chain",
    author: { name: "Thabo Nkosi", handle: "thabo-nkosi", tone: "warning" },
    meta: "22m",
    body: [{ text: "Would love to see the cold-chain numbers from Kigali if you have them." }],
    likes: 6,
  },
];

const details: Record<string, Partial<PostDetail>> = {
  "fellows-2027": {
    authorSummary: "Official Charter Mission platform team",
    comments: [
      {
        id: "c-fatou-fellows",
        author: { name: "Fatou Diallo", handle: "fatou-diallo", tone: "accent" },
        meta: "20h",
        body: [{ text: "Sharing with our Dakar chapter. Is there a stipend for fellows outside their home country?" }],
        likes: 32,
        replies: [
          {
            id: "c-cm-reply",
            author: { name: "Charter Mission", tone: "primary" },
            meta: "Author · 19h",
            body: [{ text: "Yes — travel and a monthly stipend are covered. Full details are on the application page." }],
            likes: 14,
          },
        ],
      },
      {
        id: "c-yohannes-fellows",
        author: { name: "Yohannes Tesfaye", handle: "yohannes-tesfaye", tone: "info" },
        meta: "16h",
        body: [{ text: "Would health-tech initiatives qualify, or only climate, agritech and " }, { tag: "YouthEmployment" }, { text: "?" }],
        likes: 9,
      },
    ],
  },
  "kigali-afcfta": {
    authorHandle: "amara-okafor",
    authorSummary: "Founder, Lagos AgriHub · Lagos chapter lead",
    moreTopics: ["AfCFTA", "TradeAfrica", "Logistics"],
    fullBody: [
      "Just back from the AfCFTA trade corridor workshop in Kigali. 3 takeaways for agri exporters:",
      "",
      "1. Certify early — buyers ask for it before they ask for price.",
      "2. Partner across borders — a Ghanaian co-packer halved our lead time.",
      "3. Price in naira AND cedi to avoid surprises at the border.",
    ],
    comments: kigaliComments,
  },
  "diaspora-barriers": {
    authorHandle: "kwame-mensah",
    authorSummary: "Product Lead, PayBridge · Accra chapter",
    comments: [
      {
        id: "c-fatou-trust",
        author: { name: "Fatou Diallo", handle: "fatou-diallo", tone: "accent" },
        meta: "4h",
        body: [{ text: "Trust, every time. Local co-investors with a track record change the conversation completely." }],
        likes: 41,
      },
      {
        id: "c-owais-fees",
        author: { name: "Owais Iqbal", handle: "owais-iqbal", tone: "primary" },
        meta: "3h",
        body: [{ text: "Transfer costs are still brutal from the Gulf. Would love to see a " }, { tag: "DiasporaInvest" }, { text: " corridor comparison." }],
        likes: 12,
      },
    ],
  },
  "clean-cooking-mentors": {
    authorHandle: "wanjiru-kamau",
    authorSummary: "Climate Policy Analyst · Nairobi chapter organiser",
    comments: [
      {
        id: "c-thabo-mentor",
        author: { name: "Thabo Nkosi", handle: "thabo-nkosi", tone: "warning" },
        meta: "6h",
        body: [{ text: "I can do the 28th — hardware side. " }, { mention: "Wanjiru Kamau", handle: "wanjiru-kamau" }, { text: " sending you a DM." }],
        likes: 8,
      },
    ],
  },
  "rules-of-origin": {
    authorSummary: "Trade Economist · Casablanca, Morocco",
    comments: [
      {
        id: "c-amara-origin",
        author: { name: "Amara Okafor", handle: "amara-okafor", tone: "accent" },
        meta: "3h",
        body: [{ text: "Thank you — this affects our co-packing plans with Ghana. Bookmarking." }],
        likes: 7,
      },
    ],
  },
};

const allPosts: FeedPost[] = [...feedPosts, ...topicOnlyPosts];

export const postIds = allPosts.map((post) => post.id);

/** "343 reactions · 58 comments · 21 reposts" → 58 */
function commentCountFrom(stats?: string): number {
  const match = stats?.match(/([\d,]+)\s+comments?/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

export function getPostDetail(id: string): PostDetail | undefined {
  const post = allPosts.find((item) => item.id === id);
  if (!post) return undefined;
  const extra = details[id] ?? {};
  return {
    ...post,
    ...extra,
    authorSummary: extra.authorSummary ?? post.meta.split(" · ").slice(0, -1).join(" · "),
    comments: extra.comments ?? [],
    commentCount: commentCountFrom(post.stats),
  };
}
