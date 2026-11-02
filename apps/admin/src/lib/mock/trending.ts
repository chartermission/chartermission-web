export type TrendScope = "africa" | "nigeria" | "kenya";
export type TrendStatus = "trending" | "pinned" | "suppressed";

export const trendScopes: { value: TrendScope; label: string }[] = [
  { value: "africa", label: "Africa" },
  { value: "nigeria", label: "Nigeria" },
  { value: "kenya", label: "Kenya" },
];

/** Who applied a pin or suppression, and why. Every control records a reason. */
export type TrendControl = {
  by: string;
  when: string;
  reason: string;
  /** Pins: "until 30 Nov". Suppressions: "expires in 7 days". */
  term: string;
  /** Suppressions only: policy category shown first, e.g. "Trend manipulation". */
  category?: string;
};

export type TrendRow = {
  tag: string;
  posts: number;
  authors: number;
  /** Rise against the topic's normal level, in percent. */
  velocity: number;
  status: TrendStatus;
  control?: TrendControl;
};

/** Trending rules summary (Figma "Rules", node 20:3595). */
export const trendRules = [
  { label: "Minimum distinct authors", value: "25", note: "before a topic can trend" },
  { label: "Windows", value: "24h · 7d", note: "both shown to members" },
  { label: "Scopes", value: "Africa · country · chapter", note: "computed separately" },
  { label: "Max per author", value: "3 posts / hour", note: "counted toward a trend" },
];

export const trendRankings: Record<TrendScope, TrendRow[]> = {
  africa: [
    { tag: "#AfCFTA", posts: 2481, authors: 1106, velocity: 312, status: "trending" },
    {
      tag: "#CharterFellows",
      posts: 1402,
      authors: 820,
      velocity: 98,
      status: "pinned",
      control: { by: "Owais I.", when: "1d ago", reason: "applications close", term: "until 30 Nov" },
    },
    { tag: "#DiasporaInvest", posts: 1906, authors: 744, velocity: 184, status: "trending" },
    { tag: "#CleanCooking", posts: 1122, authors: 389, velocity: 151, status: "trending" },
    {
      tag: "#CryptoGiveaway",
      posts: 3920,
      authors: 31,
      velocity: 2140,
      status: "suppressed",
      control: {
        by: "Aisha M.",
        when: "6h ago",
        reason: "Coordinated giveaway spam from new accounts",
        term: "expires in 7 days",
        category: "Trend manipulation",
      },
    },
    { tag: "#AfricanTech", posts: 3870, authors: 1520, velocity: 64, status: "trending" },
    { tag: "#YouthEmployment", posts: 908, authors: 402, velocity: 47, status: "trending" },
  ],
  nigeria: [
    { tag: "#NaijaTech", posts: 1288, authors: 604, velocity: 221, status: "trending" },
    { tag: "#LagosFintech", posts: 842, authors: 377, velocity: 140, status: "trending" },
    { tag: "#AfCFTA", posts: 760, authors: 341, velocity: 96, status: "trending" },
    { tag: "#AgriTech", posts: 512, authors: 268, velocity: 74, status: "trending" },
    { tag: "#YouthEmployment", posts: 433, authors: 201, velocity: 52, status: "trending" },
  ],
  kenya: [
    { tag: "#SiliconSavannah", posts: 934, authors: 455, velocity: 188, status: "trending" },
    { tag: "#CleanCooking", posts: 611, authors: 240, velocity: 162, status: "trending" },
    { tag: "#NairobiStartups", posts: 498, authors: 231, velocity: 87, status: "trending" },
    { tag: "#ClimateAction", posts: 402, authors: 198, velocity: 61, status: "trending" },
  ],
};

/** Reasons offered when suppressing a topic. */
export const suppressCategories = [
  "Trend manipulation",
  "Spam or scam",
  "Harassment campaign",
  "Misinformation",
  "Graphic or harmful content",
];

/** How long a pin or suppression lasts before it lapses automatically. */
export const controlDurations = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];
