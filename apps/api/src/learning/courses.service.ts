import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  CourseLevel,
  LEARNING_FEATURED_LIMIT,
  type CourseDetail,
  type CourseSummary,
  type CoursesQuery,
  type LearningHub,
  type LearningPath,
  type Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookmarks, courses, courseTopicLinks, courseTopics, learningPathCourses, learningPaths, learningSyncRuns } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import type { AuthUser } from '../core/auth-context.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { isUuid } from '../media/uuid-param.js';
import { languageName, pathSummaries, summaries, topicsFor, savedIds, toSummary, visibleCourseSql, type CourseRow } from './course-views.js';

/** Outbound clicks recorded per member per window (CM-LRN-04); generous for real use, stops scripted inflation. */
export const CLICK_LIMIT = 60;
export const CLICK_WINDOW_SECONDS = 10 * 60;

type KeyType = 'int' | 'timestamptz' | 'text';
interface SortSpec {
  dir: 'asc' | 'desc';
  /** Sort expressions (the course id is always the final tie-breaker). */
  keys: { expr: SQL; type: KeyType }[];
}

const EPOCH = sql`'epoch'::timestamptz`;
const tsText = (e: SQL) => sql<string>`to_char(${e} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function likeContains(v: string) {
  return `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Member-facing catalogue: Learning hub, browse/filter, course and path pages, outbound clicks. */
@Injectable()
export class CoursesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly analytics: AnalyticsService,
    private readonly limits: RateLimitService,
  ) {}

  /** GET /learning */
  async hub(viewer: AuthUser): Promise<LearningHub> {
    const [featuredRows, pathRows, topicRows, langRows, levelRows, [total], [lastSync]] = await Promise.all([
      this.db
        .select()
        .from(courses)
        .where(and(visibleCourseSql, eq(courses.featured, true)))
        .orderBy(sql`${courses.featuredAt} desc nulls last`, desc(courses.sourceUpdatedAt), asc(courses.id))
        .limit(LEARNING_FEATURED_LIMIT),
      this.db.select().from(learningPaths).where(isNull(learningPaths.removedAt)).orderBy(asc(learningPaths.position), asc(learningPaths.title)),
      this.db
        .select({
          id: courseTopics.id,
          slug: courseTopics.slug,
          name: courseTopics.name,
          n: sql<number>`count(${courses.id})::int`,
        })
        .from(courseTopics)
        .leftJoin(courseTopicLinks, eq(courseTopicLinks.topicId, courseTopics.id))
        .leftJoin(courses, and(eq(courses.id, courseTopicLinks.courseId), visibleCourseSql))
        .groupBy(courseTopics.id)
        .orderBy(asc(courseTopics.position), asc(courseTopics.name)),
      this.db
        .select({ code: courses.language, n: sql<number>`count(*)::int` })
        .from(courses)
        .where(visibleCourseSql)
        .groupBy(courses.language)
        .orderBy(sql`count(*) desc`, asc(courses.language)),
      this.db.select({ level: courses.level, n: sql<number>`count(*)::int` }).from(courses).where(visibleCourseSql).groupBy(courses.level),
      this.db.select({ n: sql<number>`count(*)::int` }).from(courses).where(visibleCourseSql),
      this.db
        .select({ at: learningSyncRuns.finishedAt })
        .from(learningSyncRuns)
        .where(and(eq(learningSyncRuns.kind, 'sync'), eq(learningSyncRuns.status, 'succeeded')))
        .orderBy(desc(learningSyncRuns.finishedAt))
        .limit(1),
    ]);
    const levelCounts = new Map(levelRows.map((r) => [r.level, r.n]));
    return {
      featured: await summaries(this.db, featuredRows, viewer.id),
      paths: await pathSummaries(this.db, pathRows),
      topics: topicRows.map((t) => ({ topic: { id: t.id, slug: t.slug, name: t.name }, courses: t.n })),
      languages: langRows.map((l) => ({ code: l.code, name: languageName(l.code), courses: l.n })),
      levels: CourseLevel.options.map((level) => ({ level, courses: levelCounts.get(level) ?? 0 })),
      total: total?.n ?? 0,
      syncedAt: lastSync?.at?.toISOString() ?? null,
    };
  }

  /**
   * GET /courses. `sortGiven` says whether the client sent sort explicitly: saved=true without it
   * lists newest bookmark first.
   */
  async list(viewer: AuthUser, q: CoursesQuery, sortGiven = true): Promise<Page<CourseSummary>> {
    const filters: (SQL | undefined)[] = [visibleCourseSql];
    if (q.q) {
      const pat = likeContains(q.q);
      filters.push(or(ilike(courses.title, pat), ilike(courses.provider, pat), ilike(courses.description, pat)));
    }
    if (q.topic) {
      filters.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(courseTopicLinks)
            .innerJoin(courseTopics, eq(courseTopics.id, courseTopicLinks.topicId))
            .where(and(eq(courseTopicLinks.courseId, courses.id), eq(courseTopics.slug, q.topic.toLowerCase()))),
        ),
      );
    }
    if (q.level) filters.push(eq(courses.level, q.level));
    if (q.language) {
      // "pt" also matches regional tags such as "pt-BR".
      const lang = q.language.toLowerCase();
      filters.push(or(sql`lower(${courses.language}) = ${lang}`, sql`lower(${courses.language}) like ${`${lang}-%`}`));
    }
    if (q.duration === 'under_1h') filters.push(sql`${courses.durationMinutes} < 60`);
    if (q.duration === '1_5h') filters.push(sql`${courses.durationMinutes} between 60 and 300`);
    if (q.duration === 'over_5h') filters.push(sql`${courses.durationMinutes} > 300`);
    if (q.free !== undefined) filters.push(eq(courses.free, q.free));

    const bySaved = q.saved === true && !sortGiven;
    if (q.saved === true && !bySaved) {
      filters.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(bookmarks)
            .where(and(eq(bookmarks.userId, viewer.id), eq(bookmarks.targetType, 'course'), eq(bookmarks.targetId, courses.id))),
        ),
      );
    }

    const spec: SortSpec = bySaved
      ? { dir: 'desc', keys: [{ expr: sql`${bookmarks.createdAt}`, type: 'timestamptz' }] }
      : sortSpec(q.sort);
    const keyCols = spec.keys.map((k) => (k.type === 'timestamptz' ? tsText(k.expr) : sql<string>`(${k.expr})::text`));
    const c = decodeCursor<{ k: string; id: string }>(q.cursor);
    if (c) {
      let values: string[];
      try {
        values = JSON.parse(c.k) as string[];
      } catch {
        throw Errors.badRequest('Invalid cursor');
      }
      if (!Array.isArray(values) || values.length !== spec.keys.length || !isUuid(c.id)) throw Errors.badRequest('Invalid cursor');
      const left = sql.join([...spec.keys.map((k) => k.expr), sql`${courses.id}`], sql`, `);
      const right = sql.join([...spec.keys.map((k, i) => sql`${values[i]}::${sql.raw(k.type)}`), sql`${c.id}::uuid`], sql`, `);
      filters.push(spec.dir === 'desc' ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`);
    }
    const order = [...spec.keys.map((k) => (spec.dir === 'desc' ? sql`${k.expr} desc` : sql`${k.expr} asc`)), spec.dir === 'desc' ? desc(courses.id) : asc(courses.id)];
    const selection = { row: courses, ...Object.fromEntries(keyCols.map((k, i) => [`k${i}`, k])) } as { row: typeof courses } & Record<string, SQL<string>>;

    const base = this.db.select(selection).from(courses);
    const joined = bySaved
      ? base.innerJoin(bookmarks, and(eq(bookmarks.targetId, courses.id), eq(bookmarks.userId, viewer.id), eq(bookmarks.targetType, 'course')))
      : base;
    const rows = (await joined
      .where(and(...filters))
      .orderBy(...order)
      .limit(q.limit + 1)) as unknown as ({ row: CourseRow } & Record<string, string>)[];
    const page = paginate(rows, q.limit, (last) => ({ k: JSON.stringify(spec.keys.map((_, i) => last[`k${i}`])), id: last.row.id }));
    return { items: await summaries(this.db, page.items.map((r) => r.row), viewer.id), nextCursor: page.nextCursor };
  }

  /** A course members may see (hidden and removed → NOT_FOUND). */
  async findVisible(idOrSlug: { id?: string; slug?: string }): Promise<CourseRow> {
    if (idOrSlug.id !== undefined && !isUuid(idOrSlug.id)) throw Errors.notFound('Course');
    const where = idOrSlug.id !== undefined ? eq(courses.id, idOrSlug.id.toLowerCase()) : eq(courses.slug, (idOrSlug.slug ?? '').toLowerCase());
    const [row] = await this.db.select().from(courses).where(and(where, visibleCourseSql)).limit(1);
    if (!row) throw Errors.notFound('Course');
    return row;
  }

  /** GET /courses/:slug */
  async detail(viewer: AuthUser, slug: string): Promise<CourseDetail> {
    const row = await this.findVisible({ slug });
    const [topics, saved, pathRows] = await Promise.all([
      topicsFor(this.db, [row.id]),
      savedIds(this.db, viewer.id, 'course', [row.id]),
      this.db
        .select({ path: learningPaths })
        .from(learningPathCourses)
        .innerJoin(learningPaths, eq(learningPaths.id, learningPathCourses.pathId))
        .where(and(eq(learningPathCourses.courseId, row.id), isNull(learningPaths.removedAt)))
        .orderBy(asc(learningPaths.position)),
    ]);
    return {
      ...toSummary(row, topics.get(row.id) ?? [], saved.has(row.id)),
      description: row.description,
      eligibility: row.eligibility,
      accessConditions: row.accessConditions,
      outcomes: row.outcomes,
      sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
      paths: await pathSummaries(this.db, pathRows.map((p) => p.path)),
    };
  }

  /** GET /learning/paths/:slug — 404 when removed or when none of its courses is visible. */
  async path(viewer: AuthUser, slug: string): Promise<LearningPath> {
    const [p] = await this.db
      .select()
      .from(learningPaths)
      .where(and(eq(learningPaths.slug, slug.toLowerCase()), isNull(learningPaths.removedAt)))
      .limit(1);
    if (!p) throw Errors.notFound('Learning path');
    const [summary] = await pathSummaries(this.db, [p]);
    if (!summary) throw Errors.notFound('Learning path');
    const rows = await this.db
      .select({ course: courses })
      .from(learningPathCourses)
      .innerJoin(courses, eq(courses.id, learningPathCourses.courseId))
      .where(and(eq(learningPathCourses.pathId, p.id), visibleCourseSql))
      .orderBy(asc(learningPathCourses.position));
    return { ...summary, courses: await summaries(this.db, rows.map((r) => r.course), viewer.id), sourceUrl: p.sourceUrl };
  }

  /** POST /courses/:id/click — first-party charter_center_click with the course id only (CM-LRN-04). */
  async click(viewer: AuthUser, id: string): Promise<void> {
    const course = await this.findVisible({ id });
    await this.limits.consume(`course-click:${viewer.id}`, CLICK_LIMIT, CLICK_WINDOW_SECONDS);
    this.analytics.track('charter_center_click', viewer.id, viewer.countryCode, course.id);
  }
}

function sortSpec(sort: CoursesQuery['sort']): SortSpec {
  switch (sort) {
    case 'newest':
      return { dir: 'desc', keys: [{ expr: sql`coalesce(${courses.sourceUpdatedAt}, ${EPOCH})`, type: 'timestamptz' }] };
    case 'title':
      return { dir: 'asc', keys: [{ expr: sql`lower(${courses.title})`, type: 'text' }] };
    case 'shortest':
      return { dir: 'asc', keys: [{ expr: sql`coalesce(${courses.durationMinutes}, 2147483647)`, type: 'int' }] };
    case 'featured':
    default:
      return {
        dir: 'desc',
        keys: [
          { expr: sql`(${courses.featured})::int`, type: 'int' },
          { expr: sql`coalesce(${courses.sourceUpdatedAt}, ${EPOCH})`, type: 'timestamptz' },
        ],
      };
  }
}
