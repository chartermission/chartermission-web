import { z } from 'zod';
import type { CharterCenterCourseRecord } from '@chartermission/contracts';
import { MappingError, slugify } from './charter-center.mapper.js';

/*
 * The real Charter Center partner API (Bearer API key):
 *
 * GET {base}/courses?page=n
 *   { status_code, message, data: { categories: [{ id, name, name_ar, icon_url }],
 *     courses: { data: [course], current_page, last_page, per_page, total } } }
 *   course = { id, type ("course" | "live-course" | "exam"), category_id, title, title_ar,
 *              overview, overview_ar, price, price_after_discount, has_discount, discount_type,
 *              discount_value, currency ("SAR"), level ("Professional"), duration
 *              ("31 Hr , 2 Min and 36 sec" | "N/A"), lessons_count, featured_image_url, url,
 *              instructor: { name, photo_url } }
 *
 * GET {base}/courses/{id}
 *   { status_code, message, data: course + { description, description_ar, outcomes: string[],
 *     requirements: string[], syllabus: { sections: [{ title, lectures: [{ title,
 *     duration_minutes }] }], practice_tests, exams: [{ title, duration_minutes, questions_count }] } } }
 *
 * Each course becomes the internal CharterCenterCourseRecord the sync, fixture and tests use:
 *  - id → external id; the sync matches on it (new ids are created, missing ids removed);
 *  - slug from the title (the sync de-duplicates clashes);
 *  - url from the API (falls back to CHARTER_CENTER_COURSE_URL with {id});
 *  - topic = category name; level: Beginner / Intermediate / Advanced, Professional or Expert →
 *    advanced, anything else beginner; duration parsed to minutes; language "en";
 *  - description = overview (the detail "description" arrives with its formatting stripped, so
 *    headings run into sentences); outcomes and requirements (as eligibility) from the detail call;
 *  - free when the price after discount is 0; type and price go in access conditions.
 * Arabic fields are ignored for now.
 */

const Id = z.union([z.number(), z.string()]).transform(String);

const PartnerCategory = z.looseObject({ id: Id, name: z.string() });

const PartnerCourse = z.looseObject({
  id: Id,
  type: z.string().nullable().default(null),
  category_id: Id.nullable().default(null),
  title: z.string(),
  overview: z.string().nullable().default(null),
  price: z.number().nullable().default(null),
  price_after_discount: z.number().nullable().default(null),
  featured_image_url: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  level: z.string().nullable().default(null),
  duration: z.union([z.string(), z.number()]).nullable().default(null),
  lessons_count: z.number().int().nonnegative().nullable().default(null),
  url: z.string().nullable().default(null),
});

const PartnerCourseDetail = z.looseObject({
  data: z.looseObject({
    id: Id,
    outcomes: z.array(z.string()).nullable().default([]),
    requirements: z.array(z.string()).nullable().default([]),
  }),
});

const PartnerCoursesPage = z.looseObject({
  data: z.looseObject({
    categories: z.array(PartnerCategory).default([]),
    courses: z.looseObject({
      data: z.array(PartnerCourse),
      current_page: z.number().int(),
      last_page: z.number().int(),
    }),
  }),
});

const TYPE_LABELS: Record<string, string> = {
  course: 'Recorded course',
  'live-course': 'Live course',
  exam: 'Exam preparation',
};

function typeLabel(type: string | null): string | null {
  if (!type) return null;
  return TYPE_LABELS[type] ?? type.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export interface PartnerPage {
  records: CharterCenterCourseRecord[];
  page: number;
  lastPage: number;
}

/** "31 Hr , 2 Min and 36 sec" → 31; "45 min" → 45; "N/A" or nothing → null. Seconds round to the nearest minute. */
export function parseDurationMinutes(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const text = raw.toLowerCase();
  const part = (re: RegExp) => Number(text.match(re)?.[1] ?? 0);
  const hours = part(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minutes = part(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const seconds = part(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  const total = Math.round(hours * 60 + minutes + seconds / 60);
  return total > 0 ? total : null;
}

/** Charter Center's levels → ours. */
export function partnerLevel(raw: string | null): string {
  const v = raw?.trim().toLowerCase() ?? '';
  if (v === 'intermediate') return 'intermediate';
  if (v === 'advanced' || v === 'professional' || v === 'expert') return 'advanced';
  return 'beginner';
}

function money(amount: number, currency: string | null): string {
  const n = Number.isInteger(amount) ? amount.toLocaleString('en-US') : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency.trim().toUpperCase()} ${n}` : n;
}

function priceNote(price: number | null, after: number | null, currency: string | null): string {
  const now = after ?? price ?? 0;
  if (now <= 0) return 'Free on Charter Center';
  const was = price !== null && after !== null && price > after ? ` (was ${money(price, currency)})` : '';
  return `${money(now, currency)} on Charter Center${was}`;
}

const https = (v: string | null) => (v && /^https:\/\//i.test(v.trim()) ? v.trim() : null);

/** Parse one page of GET /courses from the partner API into internal course records. */
export function parsePartnerCoursesPage(json: unknown, courseUrl: (id: string) => string): PartnerPage {
  const parsed = PartnerCoursesPage.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MappingError(`Unexpected partner /courses response: ${issue ? `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}` : 'invalid'}`);
  }
  const { categories, courses } = parsed.data.data;
  const categoryName = new Map(categories.map((c) => [c.id, c.name.trim()]));
  const records = courses.data.map((c): CharterCenterCourseRecord => {
    const free = (c.price_after_discount ?? c.price ?? 0) <= 0;
    const category = c.category_id ? categoryName.get(c.category_id) : undefined;
    const access = [typeLabel(c.type), priceNote(c.price, c.price_after_discount, c.currency)].filter(Boolean).join(' · ');
    return {
      id: c.id,
      slug: slugify(c.title) || `course-${c.id}`,
      title: c.title,
      provider: 'Charter Center',
      description: c.overview ?? '',
      level: partnerLevel(c.level),
      topics: category ? [category] : [],
      duration_minutes: parseDurationMinutes(c.duration),
      lessons_count: c.lessons_count && c.lessons_count > 0 ? c.lessons_count : null,
      language: 'en',
      is_free: free,
      eligibility: null,
      access_conditions: access,
      outcomes: [],
      url: https(c.url) ?? courseUrl(c.id),
      thumbnail_url: c.featured_image_url,
      updated_at: null,
      status: 'published',
    };
  });
  return { records, page: courses.current_page, lastPage: courses.last_page };
}

export interface PartnerDetail {
  outcomes: string[];
  /** Requirements as one bullet per line, or null when none are listed. */
  eligibility: string | null;
}

/** Parse GET /courses/{id}: the extra fields the list doesn't carry. */
export function parsePartnerCourseDetail(json: unknown): PartnerDetail {
  const parsed = PartnerCourseDetail.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MappingError(`Unexpected partner /courses/{id} response: ${issue ? `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}` : 'invalid'}`);
  }
  const clean = (list: string[] | null) => (list ?? []).map((v) => v.trim()).filter(Boolean);
  const requirements = clean(parsed.data.data.requirements);
  return {
    outcomes: clean(parsed.data.data.outcomes),
    eligibility: requirements.length ? requirements.map((r) => `• ${r}`).join('\n') : null,
  };
}
