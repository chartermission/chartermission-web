/*
 * Placeholder content for the public (signed-out) pages, taken from the Figma
 * frames "Web / Public landing page" (12:1324).
 */
import type { ChipTone, IconName } from "@chartermission/ui";
import { trendingTopics } from "@/lib/mock-data";

/** Public nav links scroll to the matching feature card on the landing page. */
export const publicNavLinks = [
  { label: "About", href: "/#features" },
  { label: "Opportunities", href: "/#opportunities" },
  { label: "Events", href: "/#events" },
  { label: "Chapters", href: "/#chapters" },
  { label: "Learning", href: "/#learning" },
];

export const landingStats = [
  { value: "54", label: "countries" },
  { value: "120+", label: "chapters" },
  { value: "2,400", label: "open opportunities" },
];

export const heroTrending = trendingTopics.slice(0, 3);

export const heroOpportunity: { title: string; meta: string; chips: { label: string; tone?: ChipTone }[] } = {
  title: "Charter Mission Fellows 2027",
  meta: "15 countries · Remote-friendly",
  chips: [{ label: "Fellowship" }, { label: "Leadership" }, { label: "Closes 30 Nov", tone: "warning" }],
};

export type LandingFeature = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  /** Tile background + icon colour classes (Figma tints per feature). */
  tone: string;
};

export const landingFeatures: LandingFeature[] = [
  {
    id: "network",
    title: "Network",
    description: "Search members by country, sector and skill. Connect, follow and build your circle.",
    icon: "users",
    tone: "bg-primary-tint text-primary",
  },
  {
    id: "opportunities",
    title: "Opportunities",
    description: "Reviewed jobs, fellowships, grants and calls for partners that close on time.",
    icon: "briefcase",
    tone: "bg-accent-light text-accent",
  },
  {
    id: "initiatives",
    title: "Initiatives",
    description: "Start or join projects, recruit collaborators and share milestones.",
    icon: "lightbulb",
    tone: "bg-warning-light text-warning",
  },
  {
    id: "events",
    title: "Events",
    description: "Online, in-person and hybrid events with one-click registration.",
    icon: "calendar",
    tone: "bg-info-light text-info",
  },
  {
    id: "learning",
    title: "Learning",
    description: "Curated courses from Charter Center, ready when you are.",
    icon: "book",
    tone: "bg-success-light text-success",
  },
  {
    id: "chapters",
    title: "Chapters",
    description: "Local chapters in cities across Africa and the diaspora.",
    icon: "globe",
    tone: "bg-primary-tint text-primary-light",
  },
];

export const communityTags = [
  { tag: "AfCFTA", posts: "2.4k posts" },
  { tag: "DiasporaInvest", posts: "1.9k posts" },
  { tag: "CleanCooking", posts: "1.1k posts" },
  { tag: "AfricanTech", posts: "3.8k posts" },
  { tag: "YouthEmployment", posts: "908 posts" },
  { tag: "WomenInLeadership", posts: "760 posts" },
  { tag: "AgriTech", posts: "644 posts" },
  { tag: "Fintech", posts: "1.2k posts" },
];

export const footerColumns = [
  {
    title: "Platform",
    links: [
      { label: "Opportunities", href: "/#opportunities" },
      { label: "Events", href: "/#events" },
      { label: "Initiatives", href: "/#initiatives" },
      { label: "Chapters", href: "/#chapters" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Guidelines", href: "/guidelines" },
      { label: "Trust & safety", href: "/trust-and-safety" },
      { label: "Become a partner", href: "/partners" },
      { label: "Help centre", href: "/help" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];
