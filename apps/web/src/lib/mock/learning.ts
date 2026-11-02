/*
 * Learning catalogue placeholder content (Figma "Web / Learning", node 19:2189).
 * Courses live on Charter Center; these URLs are placeholders until the
 * catalogue sync is wired up.
 */
import type { ChipTone, IconName } from "@chartermission/ui";

export const charterCenterBase = "https://chartercenter.org";

export const courseCategories = [
  { value: "all", label: "All" },
  { value: "business", label: "Business & trade" },
  { value: "tech", label: "Tech & data" },
  { value: "leadership", label: "Leadership" },
  { value: "climate", label: "Climate" },
  { value: "finance", label: "Finance" },
  { value: "policy", label: "Policy" },
] as const;

export type CourseCategory = Exclude<(typeof courseCategories)[number]["value"], "all">;

export const courseLevels = {
  Beginner: "success",
  Intermediate: "info",
  Advanced: "warning",
} as const satisfies Record<string, ChipTone>;

export type Course = {
  slug: string;
  title: string;
  level: keyof typeof courseLevels;
  duration: string;
  provider: string;
  categories: CourseCategory[];
  icon: IconName;
  /** Thumbnail gradient stops (Figma placeholder art). */
  gradient: [string, string];
};

export const courses: Course[] = [
  {
    slug: "export-readiness-for-african-smes",
    title: "Export Readiness for African SMEs",
    level: "Beginner",
    duration: "4 hours · 12 lessons",
    provider: "Charter Center",
    categories: ["business"],
    icon: "book",
    gradient: ["#233465", "#2d4280"],
  },
  {
    slug: "data-for-development-intro-to-sql",
    title: "Data for Development: Intro to SQL",
    level: "Beginner",
    duration: "6 hours · 18 lessons",
    provider: "Charter Center",
    categories: ["tech"],
    icon: "chart",
    gradient: ["#2d4280", "#3b82f6"],
  },
  {
    slug: "leading-distributed-teams",
    title: "Leading Distributed Teams",
    level: "Intermediate",
    duration: "3 hours · 9 lessons",
    provider: "Charter Center",
    categories: ["leadership"],
    icon: "users",
    gradient: ["#192550", "#e94e1d"],
  },
  {
    slug: "carbon-finance-fundamentals",
    title: "Carbon Finance Fundamentals",
    level: "Intermediate",
    duration: "5 hours · 14 lessons",
    provider: "Charter Center",
    categories: ["climate", "finance"],
    icon: "globe",
    gradient: ["#166534", "#22c55e"],
  },
  {
    slug: "pitching-to-diaspora-investors",
    title: "Pitching to Diaspora Investors",
    level: "Beginner",
    duration: "2 hours · 6 lessons",
    provider: "Charter Center",
    categories: ["business", "finance"],
    icon: "target",
    gradient: ["#d03e10", "#f59e0b"],
  },
  {
    slug: "product-management-in-emerging-markets",
    title: "Product Management in Emerging Markets",
    level: "Advanced",
    duration: "7 hours · 20 lessons",
    provider: "Charter Center",
    categories: ["tech", "leadership"],
    icon: "lightbulb",
    gradient: ["#233465", "#e94e1d"],
  },
  {
    slug: "mobile-money-and-payments-apis",
    title: "Mobile Money & Payments APIs",
    level: "Intermediate",
    duration: "4 hours · 11 lessons",
    provider: "Charter Center",
    categories: ["tech", "finance"],
    icon: "link",
    gradient: ["#192550", "#3b82f6"],
  },
  {
    slug: "grant-writing-that-wins",
    title: "Grant Writing That Wins",
    level: "Beginner",
    duration: "3 hours · 8 lessons",
    provider: "Charter Center",
    categories: ["policy", "finance"],
    icon: "briefcase",
    gradient: ["#2d4280", "#22c55e"],
  },
];

export const featuredPath = {
  slug: "from-idea-to-first-export",
  label: "Learning path · 5 courses",
  title: "From idea to first export",
  summary:
    "A guided path for founders selling across borders under AfCFTA — market research, certification, logistics and getting paid.",
  completed: 2,
  total: 5,
};

export function courseUrl(slug: string) {
  return `${charterCenterBase}/courses/${slug}`;
}

export function pathUrl(slug: string) {
  return `${charterCenterBase}/paths/${slug}`;
}
