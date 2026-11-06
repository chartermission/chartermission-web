import {
  CharterCenterCoursesPage,
  CharterCenterPathsPage,
  CourseLanguage,
  CourseLevel,
  type CharterCenterCourseRecord,
  type CharterCenterPathRecord,
} from '@chartermission/contracts';

/*
 * The one place that knows the Charter Center payload shape. Everything else in the Learning
 * module works with MappedCourse / MappedPath. When the real API differs from the assumed one in
 * packages/contracts/src/learning.ts, adapt the parse* functions and the two map* functions here
 * (and the CharterCenter* schemas in contracts if field names change).
 */

/** A source course converted to our columns (content only; curation and link columns are ours). */
export interface MappedCourse {
  externalId: string;
  slug: string;
  title: string;
  provider: string;
  description: string;
  level: CourseLevel;
  durationMinutes: number | null;
  lessons: number | null;
  language: string;
  free: boolean;
  eligibility: string | null;
  accessConditions: string | null;
  outcomes: string[];
  startUrl: string;
  thumbnailUrl: string | null;
  sourceUpdatedAt: Date | null;
  /** Topic names or slugs as sent; resolved by resolveTopic(). */
  topics: string[];
  /** Archived on Charter Center: treated like a course missing from the feed. */
  archived: boolean;
}

export interface MappedPath {
  externalId: string;
  slug: string;
  title: string;
  description: string;
  level: CourseLevel | null;
  sourceUrl: string | null;
  sourceUpdatedAt: Date | null;
  /** Charter Center course ids in path order. */
  courseExternalIds: string[];
}

export class MappingError extends Error {}

const MAX = { slug: 120, title: 300, provider: 200, description: 20_000, text: 2_000, outcome: 500, outcomes: 30, url: 2_000 };

/** "Business & trade" → "business-and-trade". */
export function slugify(v: string): string {
  return v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX.slug)
    .replace(/-+$/, '');
}

const clip = (v: string, n: number) => v.trim().slice(0, n);
const clipOrNull = (v: string | null | undefined, n: number) => {
  const t = v?.trim();
  return t ? t.slice(0, n) : null;
};

/** https URLs only, no credentials; anything else is unusable for "Start learning". */
function httpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const s = u.toString();
    return s.length <= MAX.url ? s : null;
  } catch {
    return null;
  }
}

function level(raw: string | null | undefined): CourseLevel {
  const parsed = CourseLevel.safeParse(raw?.trim().toLowerCase());
  return parsed.success ? parsed.data : 'beginner';
}

/** "PT-br" → "pt-BR"; invalid tags fall back to "en". */
export function normaliseLanguage(raw: string | null | undefined): string {
  const parsed = CourseLanguage.safeParse(raw ?? '');
  if (!parsed.success) return 'en';
  const [primary, ...rest] = parsed.data.split('-');
  return [primary!.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p.length === 4 ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()))].join('-');
}

function date(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Source course → our row. Throws MappingError when the record cannot be shown at all. */
export function mapCourse(r: CharterCenterCourseRecord): MappedCourse {
  const startUrl = httpsUrl(r.url);
  if (!startUrl) throw new MappingError(`Course ${r.id}: url must be an https link`);
  const slug = slugify(r.slug) || slugify(r.title);
  if (!slug) throw new MappingError(`Course ${r.id}: no usable slug`);
  const title = clip(r.title, MAX.title);
  if (!title) throw new MappingError(`Course ${r.id}: missing title`);
  return {
    externalId: r.id,
    slug,
    title,
    provider: clip(r.provider, MAX.provider) || 'Charter Center',
    description: clip(r.description, MAX.description),
    level: level(r.level),
    durationMinutes: r.duration_minutes,
    lessons: r.lessons_count,
    language: normaliseLanguage(r.language),
    free: r.is_free,
    eligibility: clipOrNull(r.eligibility, MAX.text),
    accessConditions: clipOrNull(r.access_conditions, MAX.text),
    outcomes: r.outcomes.map((o) => clip(o, MAX.outcome)).filter(Boolean).slice(0, MAX.outcomes),
    startUrl,
    thumbnailUrl: httpsUrl(r.thumbnail_url),
    sourceUpdatedAt: date(r.updated_at),
    topics: [...new Set(r.topics.map((t) => t.trim()).filter(Boolean))],
    archived: r.status.trim().toLowerCase() === 'archived',
  };
}

export function mapPath(r: CharterCenterPathRecord): MappedPath {
  const slug = slugify(r.slug) || slugify(r.title);
  if (!slug) throw new MappingError(`Path ${r.id}: no usable slug`);
  return {
    externalId: r.id,
    slug,
    title: clip(r.title, MAX.title),
    description: clip(r.description, MAX.description),
    level: r.level ? level(r.level) : null,
    sourceUrl: httpsUrl(r.url),
    sourceUpdatedAt: date(r.updated_at),
    courseExternalIds: [...new Set(r.course_ids)],
  };
}

/** Parse one GET /courses page (throws a readable error when the shape is wrong). */
export function parseCoursesPage(json: unknown): CharterCenterCoursesPage {
  const parsed = CharterCenterCoursesPage.safeParse(json);
  if (!parsed.success) throw new MappingError(`Unexpected /courses response: ${summariseIssues(parsed.error.issues)}`);
  return parsed.data;
}

export function parsePathsPage(json: unknown): CharterCenterPathsPage {
  const parsed = CharterCenterPathsPage.safeParse(json);
  if (!parsed.success) throw new MappingError(`Unexpected /paths response: ${summariseIssues(parsed.error.issues)}`);
  return parsed.data;
}

function summariseIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Matches a source topic (name or slug, any case) to one of our topics by slug, name or the
 * slugified name; returns the slug and display name to create when none matches.
 */
export function resolveTopic(
  raw: string,
  topics: { id: string; slug: string; name: string }[],
): { id: string } | { create: { slug: string; name: string } } {
  const lower = raw.trim().toLowerCase();
  const asSlug = slugify(raw);
  const hit = topics.find((t) => t.slug === lower || t.name.toLowerCase() === lower || t.slug === asSlug || slugify(t.name) === asSlug);
  if (hit) return { id: hit.id };
  return { create: { slug: asSlug.slice(0, 60) || 'topic', name: raw.trim().slice(0, 100) } };
}
