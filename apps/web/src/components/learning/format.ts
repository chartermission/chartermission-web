import {
  COURSE_DURATION_LABELS,
  COURSE_LEVEL_LABELS,
  CourseDuration,
  CourseLanguage,
  CourseLevel,
  type CoursesQuery,
} from "@chartermission/contracts";
import type { ChipTone, IconName } from "@chartermission/ui";

/** Canonical in-app paths for Learning. Course tiles open our course page; the page links to Charter Center. */
export const courseHref = (slug: string) => `/learning/courses/${encodeURIComponent(slug)}`;
export const pathHref = (slug: string) => `/learning/paths/${encodeURIComponent(slug)}`;

/** Courses per catalogue page (GET /courses limit). */
export const COURSES_PAGE = 12;

export const levelTone: Record<CourseLevel, ChipTone> = {
  beginner: "success",
  intermediate: "info",
  advanced: "warning",
};

export const levelLabel = (level: CourseLevel) => COURSE_LEVEL_LABELS[level];

/** "45 min", "1 hour", "13.5 hours" (rounded to the half hour). */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/* ---------------- Catalogue filters (URL ⇄ state) ---------------- */

export type CourseSort = CoursesQuery["sort"];

export const courseSorts = [
  { value: "featured", label: "Featured first" },
  { value: "newest", label: "Recently updated" },
  { value: "title", label: "Title A–Z" },
  { value: "shortest", label: "Shortest first" },
] as const satisfies readonly { value: CourseSort; label: string }[];

export const durationOptions = (Object.keys(COURSE_DURATION_LABELS) as CourseDuration[]).map((value) => ({
  value,
  label: COURSE_DURATION_LABELS[value],
}));

export type CourseFilters = {
  q: string;
  topic: string | null;
  level: CourseLevel | null;
  language: string | null;
  duration: CourseDuration | null;
  free: boolean;
  saved: boolean;
  sort: CourseSort;
};

export const emptyFilters: CourseFilters = {
  q: "",
  topic: null,
  level: null,
  language: null,
  duration: null,
  free: false,
  saved: false,
  sort: "featured",
};

type RawParams = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const TOPIC = /^[a-z0-9-]{1,60}$/;
const isTrue = (value: string | undefined) => value === "true" || value === "1";

/** Reads ?q=&topic=&level=&language=&duration=&free=&saved=&sort=; invalid values are dropped. */
export function parseCourseFilters(params: RawParams): CourseFilters {
  const topic = one(params.topic)?.trim().toLowerCase();
  const sort = one(params.sort);
  return {
    q: (one(params.q) ?? "").trim().slice(0, 100),
    topic: topic && TOPIC.test(topic) ? topic : null,
    level: CourseLevel.safeParse(one(params.level)).data ?? null,
    language: CourseLanguage.safeParse(one(params.language)).data ?? null,
    duration: CourseDuration.safeParse(one(params.duration)).data ?? null,
    free: isTrue(one(params.free)),
    saved: isTrue(one(params.saved)),
    sort: courseSorts.some((s) => s.value === sort) ? (sort as CourseSort) : "featured",
  };
}

/** URL search string for the filters (defaults left out so links stay short). */
export function filtersToSearch(filters: CourseFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.level) params.set("level", filters.level);
  if (filters.language) params.set("language", filters.language);
  if (filters.duration) params.set("duration", filters.duration);
  if (filters.free) params.set("free", "true");
  if (filters.saved) params.set("saved", "true");
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  return params.toString();
}

/** GET /courses query for the filters. */
export function filtersToQuery(filters: CourseFilters) {
  return {
    q: filters.q || undefined,
    topic: filters.topic ?? undefined,
    level: filters.level ?? undefined,
    language: filters.language ?? undefined,
    duration: filters.duration ?? undefined,
    free: filters.free || undefined,
    saved: filters.saved || undefined,
    sort: filters.sort,
    limit: COURSES_PAGE,
  };
}

/** Any filter narrowing the catalogue (sort doesn't count). */
export const hasActiveFilters = (f: CourseFilters) =>
  !!(f.q || f.topic || f.level || f.language || f.duration || f.free || f.saved);

/* ---------------- Generated thumbnails ---------------- */

/** Thumbnail art per topic: token gradient + icon. Classes are static so Tailwind sees them. */
const topicArt: Record<string, { gradients: readonly string[]; icon: IconName }> = {
  business: { gradients: ["from-primary to-primary-light", "from-primary-dark to-info", "from-primary-dark via-primary to-accent"], icon: "briefcase" },
  tech: { gradients: ["from-primary-light to-info", "from-primary-dark to-info", "from-info to-success"], icon: "dashboard" },
  leadership: { gradients: ["from-primary-dark to-accent", "from-primary to-accent-hover"], icon: "users" },
  climate: { gradients: ["from-primary-dark to-success", "from-success to-info"], icon: "globe" },
  finance: { gradients: ["from-accent-hover to-warning", "from-primary-dark to-warning"], icon: "chart" },
  policy: { gradients: ["from-primary to-accent-hover", "from-primary-dark to-primary-light"], icon: "building" },
  health: { gradients: ["from-primary-light to-success", "from-info to-success"], icon: "shield" },
  agriculture: { gradients: ["from-success to-warning", "from-primary-dark to-success"], icon: "target" },
};
const fallbackArt = { gradients: ["from-primary to-primary-light"], icon: "book" as IconName };

const directions = ["bg-linear-to-br", "bg-linear-to-tr", "bg-linear-to-r", "bg-linear-to-bl"] as const;
const rings = [
  "-right-10 -bottom-14",
  "-left-12 -bottom-16",
  "-right-14 -top-16",
  "-left-10 -top-14",
] as const;

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic thumbnail art for a course without a thumbnail: colour by topic, layout by slug. */
export function courseArt(course: { slug: string; topics: { slug: string }[] }) {
  const art = topicArt[course.topics[0]?.slug ?? ""] ?? fallbackArt;
  const h = hash(course.slug);
  return {
    icon: art.icon,
    gradient: art.gradients[(h >>> 6) % art.gradients.length]!,
    direction: directions[h % directions.length]!,
    ring: rings[(h >>> 3) % rings.length]!,
  };
}
