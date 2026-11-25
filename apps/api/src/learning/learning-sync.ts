import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { LEARNING_LINK_FAILURES_TO_BREAK, type SyncRunKind } from '@chartermission/contracts';
import type { Db, Tx } from '../db/client.js';
import { courses, courseTopicLinks, courseTopics, learningPathCourses, learningPaths, learningSyncRuns } from '../db/schema.js';
import { isUniqueViolation } from '../profiles/pg-error.js';
import type { CharterCenterClient } from './charter-center.client.js';
import { mapCourse, mapPath, MappingError, resolveTopic, type MappedCourse, type MappedPath } from './charter-center.mapper.js';
import { FixtureLinkChecker, type LinkChecker } from './link-checker.js';

/** Largest drop in the number of courses one sync may apply (0.3 = 30%). */
export const MAX_SHRINK = 0.3;
/** Details of an unchanged course are fetched again at least this often. */
export const DETAILS_MAX_AGE_MS = 7 * 24 * 3600_000;

/*
 * Catalogue sync and link check, as plain functions over the database so the API (queue jobs,
 * admin triggers) and the seed script share them. LearningJobsService wraps them for Nest.
 */

export type SyncRunRow = typeof learningSyncRuns.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;

/** A run of this kind is already in progress (partial unique index learning_sync_runs_running_uq). */
export class RunInProgressError extends Error {
  constructor(readonly kind: SyncRunKind) {
    super(kind === 'sync' ? 'A catalogue sync is already running' : 'A link check is already running');
  }
}

/** A run still "running" after this long is assumed dead (crashed worker) and marked failed. */
export const STALE_RUN_MS = 60 * 60_000;

/** Inserts a running row; throws RunInProgressError when one is already running. */
export async function startRun(
  db: Db,
  kind: SyncRunKind,
  trigger: 'schedule' | 'admin',
  triggeredBy: string | null = null,
): Promise<SyncRunRow> {
  await db
    .update(learningSyncRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: 'Did not finish (timed out or the worker stopped)' })
    .where(
      and(
        eq(learningSyncRuns.kind, kind),
        eq(learningSyncRuns.status, 'running'),
        lt(learningSyncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    );
  try {
    const [row] = await db.insert(learningSyncRuns).values({ kind, trigger, triggeredBy, status: 'running' }).returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err, 'learning_sync_runs_running_uq')) throw new RunInProgressError(kind);
    throw err;
  }
}

export interface SyncCounts {
  created: number;
  updated: number;
  removed: number;
  /** Records skipped because they could not be mapped (kept in the run's error text). */
  warnings: string[];
}

type ContentFields = Omit<MappedCourse, 'topics' | 'archived' | 'externalId' | 'slug'>;

const contentOf = (c: MappedCourse | CourseRow): ContentFields => ({
  title: c.title,
  provider: c.provider,
  description: c.description,
  level: c.level as MappedCourse['level'],
  durationMinutes: c.durationMinutes,
  lessons: c.lessons,
  language: c.language,
  free: c.free,
  eligibility: c.eligibility,
  accessConditions: c.accessConditions,
  outcomes: c.outcomes,
  startUrl: c.startUrl,
  thumbnailUrl: c.thumbnailUrl,
  sourceUpdatedAt: c.sourceUpdatedAt,
});

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v)) ===
  JSON.stringify(b, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v));

/** Keeps a row's current slug when it still matches the source slug (incl. a "-2" suffix); else the first free one. */
function pickSlug(desired: string, current: string | undefined, taken: Set<string>): string {
  if (current && (current === desired || new RegExp(`^${desired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(current))) return current;
  if (!taken.has(desired)) return desired;
  for (let n = 2; ; n++) {
    const s = `${desired}-${n}`;
    if (!taken.has(s)) return s;
  }
}

/**
 * Full sync: upserts every course and path by external id, marks courses and paths missing from
 * the source (or archived there) as removed, and never touches hidden / featured / link columns.
 */
export async function syncCatalogue(db: Db, client: CharterCenterClient): Promise<SyncCounts> {
  // Details (outcomes, requirements) cost one request per course; reuse what is stored for courses
  // whose list entry hasn't changed since, so a sync stays well inside Charter Center's rate limit.
  const stored = await db
    .select({
      externalId: courses.externalId,
      outcomes: courses.outcomes,
      eligibility: courses.eligibility,
      fingerprint: courses.detailsFingerprint,
      at: courses.detailsSyncedAt,
    })
    .from(courses);
  const storedByExternal = new Map(stored.map((c) => [c.externalId, c]));
  const freshAfter = Date.now() - DETAILS_MAX_AGE_MS;
  const [rawCourses, rawPaths] = await Promise.all([
    client.listCourses({
      reuseDetails: (r) => {
        const c = storedByExternal.get(r.id);
        const fingerprint = (r as { list_fingerprint?: string }).list_fingerprint;
        if (!c || !fingerprint || c.fingerprint !== fingerprint || !c.at || c.at.getTime() < freshAfter) return null;
        return { outcomes: c.outcomes, eligibility: c.eligibility };
      },
    }),
    client.listPaths(),
  ]);
  // Which records came with freshly fetched details, and their list fingerprints (HTTP client only).
  const detailsOf = new Map(
    rawCourses
      .filter((r) => (r as { details_fetched?: boolean }).details_fetched)
      .map((r) => [String(r.id), (r as { list_fingerprint?: string }).list_fingerprint ?? null]),
  );
  const warnings: string[] = [];
  const mapped: MappedCourse[] = [];
  const seenIds = new Set<string>();
  for (const r of rawCourses) {
    try {
      const m = mapCourse(r);
      if (seenIds.has(m.externalId)) continue;
      seenIds.add(m.externalId);
      mapped.push(m);
    } catch (err) {
      if (err instanceof MappingError) warnings.push(err.message);
      else throw err;
    }
  }
  const mappedPaths: MappedPath[] = [];
  for (const r of rawPaths) {
    try {
      mappedPaths.push(mapPath(r));
    } catch (err) {
      if (err instanceof MappingError) warnings.push(err.message);
      else throw err;
    }
  }

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(courses);
    const live = mapped.filter((m) => !m.archived);
    if (live.length === 0 && existing.some((c) => !c.removedAt)) {
      // An empty feed is far more likely an upstream fault than the whole catalogue being withdrawn.
      throw new Error('Charter Center returned no published courses; the catalogue was left unchanged');
    }
    // A feed that suddenly shrinks by more than 30% is far more likely a partial or faulty response
    // than courses being withdrawn, so nothing is changed and the run is marked failed for admins.
    const shown = existing.filter((c) => !c.removedAt).length;
    if (shown >= 10 && live.length < shown * (1 - MAX_SHRINK)) {
      throw new Error(
        `Charter Center returned ${live.length} courses but ${shown} are listed now (more than ${MAX_SHRINK * 100}% fewer); the catalogue was left unchanged`,
      );
    }
    const counts: SyncCounts = { created: 0, updated: 0, removed: 0, warnings };
    const now = new Date();
    const byExternal = new Map(existing.map((c) => [c.externalId, c]));
    const taken = new Set(existing.map((c) => c.slug));
    const topicRows = await tx.select({ id: courseTopics.id, slug: courseTopics.slug, name: courseTopics.name }).from(courseTopics);
    const links = await tx.select().from(courseTopicLinks);
    const linksByCourse = new Map<string, Set<string>>();
    for (const l of links) linksByCourse.set(l.courseId, (linksByCourse.get(l.courseId) ?? new Set()).add(l.topicId));
    const idByExternal = new Map<string, string>();

    for (const m of live) {
      const topicIds = await resolveTopicIds(tx, m.topics, topicRows);
      const current = byExternal.get(m.externalId);
      const ownSlug = current?.slug;
      if (ownSlug) taken.delete(ownSlug);
      const slug = pickSlug(m.slug, ownSlug, taken);
      taken.add(slug);
      const content = contentOf(m);
      const details = detailsOf.has(m.externalId) ? { detailsFingerprint: detailsOf.get(m.externalId) ?? null, detailsSyncedAt: now } : {};
      if (!current) {
        const [row] = await tx
          .insert(courses)
          .values({ externalId: m.externalId, slug, ...content, ...details, syncedAt: now })
          .returning({ id: courses.id });
        idByExternal.set(m.externalId, row!.id);
        if (topicIds.length) await tx.insert(courseTopicLinks).values(topicIds.map((topicId) => ({ courseId: row!.id, topicId })));
        counts.created++;
        continue;
      }
      idByExternal.set(m.externalId, current.id);
      const oldTopics = linksByCourse.get(current.id) ?? new Set<string>();
      const topicsChanged = oldTopics.size !== topicIds.length || topicIds.some((id) => !oldTopics.has(id));
      const changed = !same(contentOf(current), content) || slug !== current.slug || current.removedAt !== null || topicsChanged;
      // Content and removal only: hidden, featured and link-check columns stay as curated.
      await tx
        .update(courses)
        .set(changed ? { slug, ...content, ...details, removedAt: null, syncedAt: now } : { ...details, syncedAt: now })
        .where(eq(courses.id, current.id));
      if (topicsChanged) {
        await tx.delete(courseTopicLinks).where(eq(courseTopicLinks.courseId, current.id));
        if (topicIds.length) await tx.insert(courseTopicLinks).values(topicIds.map((topicId) => ({ courseId: current.id, topicId })));
      }
      if (changed) counts.updated++;
    }

    const liveIds = new Set(live.map((m) => m.externalId));
    const gone = existing.filter((c) => !liveIds.has(c.externalId) && !c.removedAt).map((c) => c.id);
    if (gone.length) {
      await tx.update(courses).set({ removedAt: now }).where(inArray(courses.id, gone));
      counts.removed += gone.length;
    }

    await syncPaths(tx, mappedPaths, idByExternal, counts, now);
    return counts;
  });
}

async function resolveTopicIds(tx: Tx, names: string[], topicRows: { id: string; slug: string; name: string }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const hit = resolveTopic(raw, topicRows);
    if ('id' in hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
      continue;
    }
    const [created] = await tx
      .insert(courseTopics)
      .values({ slug: hit.create.slug, name: hit.create.name, position: topicRows.length })
      .onConflictDoUpdate({ target: courseTopics.slug, set: { slug: sql`excluded.slug` } })
      .returning({ id: courseTopics.id, slug: courseTopics.slug, name: courseTopics.name });
    topicRows.push(created!);
    if (!ids.includes(created!.id)) ids.push(created!.id);
  }
  return ids;
}

async function syncPaths(tx: Tx, mappedPaths: MappedPath[], idByExternal: Map<string, string>, counts: SyncCounts, now: Date) {
  const existing = await tx.select().from(learningPaths);
  const byExternal = new Map(existing.map((p) => [p.externalId, p]));
  const taken = new Set(existing.map((p) => p.slug));
  const memberships = await tx.select().from(learningPathCourses);
  const seen = new Set<string>();
  let position = 0;
  for (const p of mappedPaths) {
    if (seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    const courseIds = p.courseExternalIds.map((x) => idByExternal.get(x)).filter((x): x is string => !!x);
    const current = byExternal.get(p.externalId);
    if (current) taken.delete(current.slug);
    const slug = pickSlug(p.slug, current?.slug, taken);
    taken.add(slug);
    const content = {
      slug,
      title: p.title,
      description: p.description,
      level: p.level,
      sourceUrl: p.sourceUrl,
      position: position++,
      sourceUpdatedAt: p.sourceUpdatedAt,
    };
    let pathId: string;
    let changed: boolean;
    if (!current) {
      const [row] = await tx
        .insert(learningPaths)
        .values({ externalId: p.externalId, ...content, syncedAt: now })
        .returning({ id: learningPaths.id });
      pathId = row!.id;
      counts.created++;
      changed = true;
    } else {
      pathId = current.id;
      const old = memberships
        .filter((m) => m.pathId === current.id)
        .sort((a, b) => a.position - b.position)
        .map((m) => m.courseId);
      const before = { slug: current.slug, title: current.title, description: current.description, level: current.level, sourceUrl: current.sourceUrl, position: current.position, sourceUpdatedAt: current.sourceUpdatedAt };
      changed = !same(before, content) || !same(old, courseIds) || current.removedAt !== null;
      await tx
        .update(learningPaths)
        .set(changed ? { ...content, removedAt: null, syncedAt: now } : { syncedAt: now })
        .where(eq(learningPaths.id, current.id));
      if (changed) counts.updated++;
    }
    if (changed) {
      await tx.delete(learningPathCourses).where(eq(learningPathCourses.pathId, pathId));
      if (courseIds.length) await tx.insert(learningPathCourses).values(courseIds.map((courseId, i) => ({ pathId, courseId, position: i })));
    }
  }
  const gone = existing.filter((p) => !seen.has(p.externalId) && !p.removedAt).map((p) => p.id);
  if (gone.length) {
    await tx.update(learningPaths).set({ removedAt: now }).where(inArray(learningPaths.id, gone));
    counts.removed += gone.length;
  }
}

/** Runs a sync for an already-started run row and records the outcome. Never throws. */
export async function executeSync(db: Db, client: CharterCenterClient, runId: string): Promise<SyncRunRow> {
  try {
    const counts = await syncCatalogue(db, client);
    const error = counts.warnings.length
      ? `Skipped ${counts.warnings.length} record(s): ${counts.warnings.slice(0, 5).join('; ')}`.slice(0, 2000)
      : null;
    return await finishRun(db, runId, {
      status: 'succeeded',
      createdCount: counts.created,
      updatedCount: counts.updated,
      removedCount: counts.removed,
      error,
    });
  } catch (err) {
    return finishRun(db, runId, { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 2000) });
  }
}

async function finishRun(db: Db, id: string, patch: Partial<typeof learningSyncRuns.$inferInsert>): Promise<SyncRunRow> {
  const [row] = await db
    .update(learningSyncRuns)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(learningSyncRuns.id, id))
    .returning();
  return row!;
}

export interface LinkCheckCounts {
  checked: number;
  ok: number;
  broken: number;
  /** Not checked this time because the site asked us to slow down (HTTP 429/503); retried next run. */
  skipped: number;
  /** Courses that became broken in this run (for notifications). */
  newlyBroken: CourseRow[];
}

/**
 * Checks each visible course's start URL. A success sets ok (and clears the failure count); a
 * failure increments it, and at LEARNING_LINK_FAILURES_TO_BREAK the link is broken. Courses that
 * just turned broken are passed to onBroken once (not again while they stay broken).
 *
 * Course pages mostly live on one site (charter-center.com), so links are checked one at a time per
 * site with a pause between them (gapMs). "Too many requests" (429) or "unavailable" (503) is not a
 * broken link: that course and the rest of that site are left for the next run, unchanged.
 */
export async function checkLinks(
  db: Db,
  checker: LinkChecker,
  onBroken: (course: CourseRow) => Promise<void> = async () => {},
  concurrency = 4,
  gapMs = 1_500,
): Promise<LinkCheckCounts> {
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.hidden, false), isNull(courses.removedAt)));
  const counts: LinkCheckCounts = { checked: 0, ok: 0, broken: 0, skipped: 0, newlyBroken: [] };
  const hostOf = (url: string) => {
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return '';
    }
  };
  // One queue per site; sites are checked in parallel (up to `concurrency`), each site's links in turn.
  const bySite = new Map<string, CourseRow[]>();
  for (const r of rows) bySite.set(hostOf(r.startUrl), [...(bySite.get(hostOf(r.startUrl)) ?? []), r]);
  const sites = [...bySite.values()];
  let nextSite = 0;
  const worker = async () => {
    while (nextSite < sites.length) {
      const queue = sites[nextSite++]!;
      for (let i = 0; i < queue.length; i++) {
        if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
        const done = await checkOne(queue[i]!);
        if (!done) {
          counts.skipped += queue.length - i;
          break;
        }
      }
    }
  };
  /** Returns false when the site asked us to slow down (the rest of the site waits for the next run). */
  const checkOne = async (course: CourseRow): Promise<boolean> => {
    {
      const result = await checker.check(course.startUrl);
      if (result.status === 429 || result.status === 503) return false;
      const now = new Date();
      counts.checked++;
      if (result.ok) {
        counts.ok++;
        await db
          .update(courses)
          .set({ linkStatus: 'ok', linkFailures: 0, linkHttpStatus: result.status, linkCheckedAt: now })
          .where(eq(courses.id, course.id));
        return true;
      }
      const failures = course.linkFailures + 1;
      const broken = failures >= LEARNING_LINK_FAILURES_TO_BREAK;
      // The conditional update makes the ok/unknown → broken transition happen once, even with overlapping runs.
      const [updated] = await db
        .update(courses)
        .set({
          linkFailures: sql`${courses.linkFailures} + 1`,
          linkHttpStatus: result.status,
          linkCheckedAt: now,
          ...(broken ? { linkStatus: 'broken' } : {}),
        })
        .where(eq(courses.id, course.id))
        .returning();
      if (broken) counts.broken++;
      if (broken && course.linkStatus !== 'broken' && updated) counts.newlyBroken.push(updated);
      return true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sites.length) }, worker));
  for (const c of counts.newlyBroken) await onBroken(c);
  return counts;
}

/** Runs a link check for an already-started run row and records the outcome. Never throws. */
export async function executeLinkCheck(
  db: Db,
  checker: LinkChecker,
  runId: string,
  onBroken?: (course: CourseRow) => Promise<void>,
): Promise<SyncRunRow> {
  try {
    // Real sites get a pause between links; the fixture checker makes no requests.
    const counts = await checkLinks(db, checker, onBroken, 4, checker instanceof FixtureLinkChecker ? 0 : 1_500);
    return await finishRun(db, runId, {
      status: 'succeeded',
      checkedCount: counts.checked,
      brokenCount: counts.broken,
      updatedCount: counts.ok,
      // Shown with the run in the admin (a note on a succeeded run, like skipped records on a sync).
      error: counts.skipped ? `${counts.skipped} course links weren’t checked because the site asked us to slow down (HTTP 429); they’ll be checked next time.` : null,
    });
  } catch (err) {
    return finishRun(db, runId, { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 2000) });
  }
}
