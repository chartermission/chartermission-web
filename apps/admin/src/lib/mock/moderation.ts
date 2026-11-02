import type { ReportStatus } from "@chartermission/contracts";
import type { ChipTone, IconName } from "@chartermission/ui";

export type QueueTab = "reports" | "hidden" | "appeals" | "uploads";
export type Priority = "high" | "medium" | "low";

export const priorityChip: Record<Priority, { label: string; tone: ChipTone }> = {
  high: { label: "High", tone: "error" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};

export type QueueItem = {
  /** Case reference, e.g. R-2041. */
  id: string;
  tab: QueueTab;
  /** Row label: content type and excerpt. */
  content: string;
  reason: string;
  reports: number;
  priority: Priority;
  age: string;
  status: ReportStatus;
  author: { handle: string; meta: string };
  excerpt: string;
  reporterReasons: { quote: string; count: number }[];
  history: { icon: IconName; text: string; flagged?: boolean }[];
};

export type ModerationStat = {
  label: string;
  value: string;
  note: string;
  tone: "error" | "success" | "warning" | "info";
};

/** Summary cards (Figma node 12:1648). */
export const moderationStats: ModerationStat[] = [
  { label: "Open reports", value: "8", note: "3 high priority", tone: "error" },
  { label: "Median time to resolve", value: "3h 12m", note: "Target under 24h", tone: "success" },
  { label: "Listings awaiting review", value: "15", note: "Oldest 9h ago", tone: "warning" },
  { label: "Open appeals", value: "2", note: "Different reviewer required", tone: "info" },
];

export const queueTabs: { value: QueueTab; label: string; total: number; caseLabel: string }[] = [
  { value: "reports", label: "Reports", total: 8, caseLabel: "Report" },
  { value: "hidden", label: "Hidden content", total: 5, caseLabel: "Hidden item" },
  { value: "appeals", label: "Appeals", total: 2, caseLabel: "Appeal" },
  { value: "uploads", label: "Blocked uploads", total: 1, caseLabel: "Upload" },
];

export const queueItems: QueueItem[] = [
  {
    id: "R-2041",
    tab: "reports",
    content: "Post · “Guaranteed 10x returns, DM me to join…”",
    reason: "Spam or scam",
    reports: 14,
    priority: "high",
    age: "12m",
    status: "open",
    author: { handle: "j.doe_invest", meta: "joined 2 days ago" },
    excerpt:
      "Guaranteed 10x returns in 30 days 🚀 Diaspora investors only. DM me to join the private group before spots close.",
    reporterReasons: [
      { quote: "Promises guaranteed returns — classic scam", count: 9 },
      { quote: "Asked me to send money via WhatsApp", count: 5 },
    ],
    history: [
      { icon: "flag", text: "2 previous reports · both actioned", flagged: true },
      { icon: "eye-off", text: "1 post hidden (24 Oct)" },
      { icon: "mail", text: "Email verified · no profile photo" },
    ],
  },
  {
    id: "R-2040",
    tab: "reports",
    content: "Comment on #DiasporaInvest thread",
    reason: "Harassment",
    reports: 3,
    priority: "high",
    age: "48m",
    status: "open",
    author: { handle: "kwame.builds", meta: "joined 8 months ago" },
    excerpt:
      "Nobody asked for your opinion. People like you should stay off this platform and stop wasting everyone's time.",
    reporterReasons: [
      { quote: "Personal attack on a member asking a question", count: 2 },
      { quote: "Hostile and repeated replies", count: 1 },
    ],
    history: [
      { icon: "flag", text: "1 previous report · dismissed" },
      { icon: "eye-off", text: "No hidden content" },
      { icon: "mail", text: "Email verified · profile complete" },
    ],
  },
  {
    id: "R-2037",
    tab: "reports",
    content: "Opportunity · “Remote data entry, pay upfront”",
    reason: "Misleading listing",
    reports: 6,
    priority: "medium",
    age: "2h",
    status: "open",
    author: { handle: "globaljobs_hr", meta: "organisation · unverified" },
    excerpt:
      "Remote data entry, $900/week. Registration fee of $45 required before onboarding. Limited slots, apply today.",
    reporterReasons: [
      { quote: "Asks applicants to pay a registration fee", count: 4 },
      { quote: "Company does not exist", count: 2 },
    ],
    history: [
      { icon: "flag", text: "First report on this organisation", flagged: false },
      { icon: "eye-off", text: "1 listing rejected (19 Oct)" },
      { icon: "mail", text: "Domain not verified" },
    ],
  },
  {
    id: "R-2033",
    tab: "reports",
    content: "Post · image attachment",
    reason: "Copyright",
    reports: 1,
    priority: "low",
    age: "5h",
    status: "open",
    author: { handle: "ama.designs", meta: "joined 1 year ago" },
    excerpt: "Our new Lagos skyline poster series is out! Full set below 👇 (image attachment, 1 of 4)",
    reporterReasons: [{ quote: "This is my photograph, used without credit", count: 1 }],
    history: [
      { icon: "flag", text: "No previous reports" },
      { icon: "eye-off", text: "No hidden content" },
      { icon: "mail", text: "Email verified · profile complete" },
    ],
  },
  {
    id: "R-2029",
    tab: "reports",
    content: "Hashtag · #CryptoGiveaway",
    reason: "Trend manipulation",
    reports: 22,
    priority: "high",
    age: "6h",
    status: "open",
    author: { handle: "31 accounts", meta: "most created this week" },
    excerpt: "3,920 posts in 6 hours from 31 accounts, most repeating the same giveaway link and wallet address.",
    reporterReasons: [
      { quote: "Same giveaway posted by dozens of new accounts", count: 15 },
      { quote: "Wallet scam pushed into trending", count: 7 },
    ],
    history: [
      { icon: "flag", text: "Suppressed in trending by Aisha M. · 6h ago", flagged: true },
      { icon: "eye-off", text: "212 posts auto-hidden by spam filter" },
      { icon: "mail", text: "24 of 31 accounts unverified" },
    ],
  },
  {
    id: "H-1188",
    tab: "hidden",
    content: "Post · “Send me your CV and $20 for review”",
    reason: "Spam or scam",
    reports: 7,
    priority: "medium",
    age: "1d",
    status: "actioned",
    author: { handle: "career.fasttrack", meta: "joined 3 weeks ago" },
    excerpt: "Want a guaranteed interview at a top bank? Send me your CV and $20 for a review. Payment via mobile money.",
    reporterReasons: [{ quote: "Charging for fake job placement", count: 7 }],
    history: [
      { icon: "flag", text: "Hidden by Aisha M. · 1d ago", flagged: true },
      { icon: "eye-off", text: "2 posts hidden in total" },
      { icon: "mail", text: "Email verified · no profile photo" },
    ],
  },
  {
    id: "H-1184",
    tab: "hidden",
    content: "Comment on “Fellowship results” post",
    reason: "Harassment",
    reports: 4,
    priority: "high",
    age: "2d",
    status: "actioned",
    author: { handle: "anon_2219", meta: "joined 4 days ago" },
    excerpt: "Everyone knows these results were rigged. The selection team should be ashamed of themselves.",
    reporterReasons: [{ quote: "Targets named staff members", count: 4 }],
    history: [
      { icon: "flag", text: "Hidden by Owais I. · 2d ago", flagged: true },
      { icon: "eye-off", text: "1 comment hidden" },
      { icon: "mail", text: "Email not verified" },
    ],
  },
  {
    id: "H-1179",
    tab: "hidden",
    content: "Event · “Free visa lottery seminar”",
    reason: "Misleading listing",
    reports: 3,
    priority: "medium",
    age: "3d",
    status: "actioned",
    author: { handle: "visa.help.africa", meta: "organisation · unverified" },
    excerpt: "Guaranteed visa lottery wins with our insider method. Seminar fee payable at the door.",
    reporterReasons: [{ quote: "Promises guaranteed visas", count: 3 }],
    history: [
      { icon: "flag", text: "Hidden by Aisha M. · 3d ago", flagged: true },
      { icon: "eye-off", text: "Event removed from calendar" },
      { icon: "mail", text: "Domain not verified" },
    ],
  },
  {
    id: "A-0311",
    tab: "appeals",
    content: "Appeal · hidden post on #AgriTech",
    reason: "Spam or scam",
    reports: 2,
    priority: "medium",
    age: "4h",
    status: "appealed",
    author: { handle: "farmlink.ng", meta: "organisation · verified" },
    excerpt:
      "Appeal: “This was a genuine announcement of our cooperative's input subsidy programme, not a scam. Link goes to our verified site.”",
    reporterReasons: [{ quote: "Original report: suspicious link", count: 2 }],
    history: [
      { icon: "flag", text: "Hidden by Owais I. · 1d ago · you cannot review", flagged: true },
      { icon: "eye-off", text: "1 post hidden" },
      { icon: "mail", text: "Organisation verified (Mar 2026)" },
    ],
  },
  {
    id: "A-0309",
    tab: "appeals",
    content: "Appeal · 7-day suspension",
    reason: "Harassment",
    reports: 5,
    priority: "high",
    age: "9h",
    status: "appealed",
    author: { handle: "tunde.o", meta: "joined 2 years ago" },
    excerpt: "Appeal: “I was replying to someone who insulted me first. I accept the comment was harsh but a suspension is too much.”",
    reporterReasons: [{ quote: "Original report: repeated insults", count: 5 }],
    history: [
      { icon: "flag", text: "Suspended by Aisha M. · 2d ago", flagged: true },
      { icon: "eye-off", text: "3 comments hidden" },
      { icon: "mail", text: "Email verified · profile complete" },
    ],
  },
  {
    id: "U-0087",
    tab: "uploads",
    content: "Upload · “Grant_application_form.pdf.exe”",
    reason: "Malware detected",
    reports: 0,
    priority: "high",
    age: "1h",
    status: "open",
    author: { handle: "funding.desk", meta: "joined today" },
    excerpt: "Attachment on a post in #Grants. Scanner flagged a Windows executable disguised as a PDF.",
    reporterReasons: [{ quote: "Automated scan: executable with double extension", count: 1 }],
    history: [
      { icon: "flag", text: "Account flagged by upload scanner", flagged: true },
      { icon: "eye-off", text: "Post held for review" },
      { icon: "mail", text: "Email not verified" },
    ],
  },
];
