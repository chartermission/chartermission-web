import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CourseLevel, CourseSummary, CourseTopic, LearningPathSummary } from '@chartermission/contracts';
import type { Db } from '../db/client.js';
import { bookmarks, courses, courseTopicLinks, courseTopics, learningPathCourses, learningPaths } from '../db/schema.js';

export type CourseRow = typeof courses.$inferSelect;
export type PathRow = typeof learningPaths.$inferSelect;

/** Members see a course when it is neither hidden by an admin nor removed from the source. */
export const visibleCourseSql = and(eq(courses.hidden, false), isNull(courses.removedAt))!;

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });

/** "fr" → "French"; unknown tags come back as the tag itself. */
export function languageName(code: string): string {
  try {
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "4 hours · 12 lessons", "45 min", "1.5 hours", "2 h 15 min", "6 lessons", or "". */
export function durationLabel(minutes: number | null, lessons: number | null): string {
  const parts: string[] = [];
  if (minutes !== null && minutes > 0) {
    if (minutes < 60) parts.push(`${minutes} min`);
    else if (minutes % 60 === 0) parts.push(minutes === 60 ? '1 hour' : `${minutes / 60} hours`);
    else if (minutes % 30 === 0) parts.push(`${minutes / 60} hours`);
    else parts.push(`${Math.floor(minutes / 60)} h ${minutes % 60} min`);
  }
  if (lessons !== null && lessons > 0) parts.push(lessons === 1 ? '1 lesson' : `${lessons} lessons`);
  return parts.join(' · ');
}

/** Topics per course, in topic position order. */
export async function topicsFor(db: Db, courseIds: string[]): Promise<Map<string, CourseTopic[]>> {
  const map = new Map<string, CourseTopic[]>();
  if (!courseIds.length) return map;
  const rows = await db
    .select({ courseId: courseTopicLinks.courseId, id: courseTopics.id, slug: courseTopics.slug, name: courseTopics.name })
    .from(courseTopicLinks)
    .innerJoin(courseTopics, eq(courseTopics.id, courseTopicLinks.topicId))
    .where(inArray(courseTopicLinks.courseId, courseIds))
    .orderBy(asc(courseTopics.position), asc(courseTopics.name));
  for (const r of rows) {
    const list = map.get(r.courseId) ?? [];
    list.push({ id: r.id, slug: r.slug, name: r.name });
    map.set(r.courseId, list);
  }
  return map;
}

/** Ids among `targetIds` the user bookmarked with this target type. */
export async function savedIds(db: Db, userId: string | null | undefined, targetType: 'course' | 'event' | 'post', targetIds: string[]): Promise<Set<string>> {
  if (!userId || !targetIds.length) return new Set();
  const rows = await db
    .select({ id: bookmarks.targetId })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.targetType, targetType), inArray(bookmarks.targetId, targetIds)));
  return new Set(rows.map((r) => r.id));
}

export function toSummary(c: CourseRow, topics: CourseTopic[], saved: boolean): CourseSummary {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    provider: c.provider,
    level: c.level as CourseLevel,
    topics,
    durationMinutes: c.durationMinutes,
    durationLabel: durationLabel(c.durationMinutes, c.lessons),
    lessons: c.lessons,
    language: c.language,
    languageName: languageName(c.language),
    free: c.free,
    thumbnailUrl: c.thumbnailUrl,
    featured: c.featured,
    linkStatus: c.linkStatus as CourseSummary['linkStatus'],
    saved,
    // CM-LRN-05: no "Start learning" while the link is broken.
    startUrl: c.linkStatus === 'broken' ? null : c.startUrl,
  };
}

/** CourseSummary for each row, in the given order. */
export async function summaries(db: Db, rows: CourseRow[], viewerId: string | null | undefined): Promise<CourseSummary[]> {
  const ids = rows.map((r) => r.id);
  const [topics, saved] = await Promise.all([topicsFor(db, ids), savedIds(db, viewerId, 'course', ids)]);
  return rows.map((r) => toSummary(r, topics.get(r.id) ?? [], saved.has(r.id)));
}

/**
 * Path summaries counting visible courses only. Paths that are removed, or have no visible course
 * left, are omitted. Keeps the order of `paths`.
 */
export async function pathSummaries(db: Db, paths: PathRow[]): Promise<LearningPathSummary[]> {
  if (!paths.length) return [];
  const stats = await db
    .select({
      pathId: learningPathCourses.pathId,
      n: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${courses.durationMinutes}), 0)::int`,
    })
    .from(learningPathCourses)
    .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
    .where(and(inArray(learningPathCourses.pathId, paths.map((p) => p.id)), visibleCourseSql))
    .groupBy(learningPathCourses.pathId);
  const byPath = new Map(stats.map((s) => [s.pathId, s]));
  return paths
    .filter((p) => !p.removedAt && (byPath.get(p.id)?.n ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      level: (p.level as CourseLevel | null) ?? null,
      courseCount: byPath.get(p.id)!.n,
      totalMinutes: byPath.get(p.id)!.minutes,
    }));
}
