import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import type { SeedContext } from './seed-data.js';
import * as s from './schema.js';
import { FixtureCharterCenterClient } from '../learning/charter-center.client.js';
import { FixtureLinkChecker } from '../learning/link-checker.js';
import { executeLinkCheck, executeSync, startRun } from '../learning/learning-sync.js';
import { brokenLinkNotice, curatorIds } from '../learning/learning-jobs.service.js';

const FEATURED = ['export-readiness-for-african-smes', 'data-for-development-intro-to-sql', 'carbon-finance-fundamentals'];
const SAVED: Record<string, string[]> = {
  amara: ['export-readiness-for-african-smes', 'pitching-to-diaspora-investors', 'afcfta-rules-of-origin-explained'],
  kwame: ['mobile-money-and-payments-apis', 'data-for-development-intro-to-sql'],
};

/**
 * Demo learning catalogue (called from seed.ts after members and chapters; course topics are
 * reference data seeded by seedReference). Idempotent: re-running re-syncs and leaves curation as is.
 *
 * Runs the real sync over the fixture catalogue (recorded as an admin-triggered run), features
 * three courses, saves a few for amara and kwame, and runs the fixture link check twice (a link
 * is broken after two failed checks) so one course shows as broken, with the curator alert.
 */
export async function seedLearning(db: Db, ctx: SeedContext): Promise<void> {
  const admin = ctx.ids.owais ?? ctx.ids.team ?? null;
  const client = new FixtureCharterCenterClient();
  const sync = await executeSync(db, client, (await startRun(db, 'sync', 'admin', admin)).id);
  if (sync.status !== 'succeeded') throw new Error(`Learning seed sync failed: ${sync.error}`);

  const featured = await db
    .select({ id: s.courses.id, featured: s.courses.featured })
    .from(s.courses)
    .where(inArray(s.courses.slug, FEATURED));
  for (const [i, c] of featured.entries()) {
    if (!c.featured) {
      await db
        .update(s.courses)
        .set({ featured: true, featuredAt: new Date(Date.now() - i * 3600_000) })
        .where(eq(s.courses.id, c.id));
    }
  }

  for (const [key, slugs] of Object.entries(SAVED)) {
    const userId = ctx.ids[key];
    if (!userId) continue;
    const rows = await db.select({ id: s.courses.id }).from(s.courses).where(inArray(s.courses.slug, slugs));
    for (const [i, r] of rows.entries()) {
      await db
        .insert(s.bookmarks)
        .values({ userId, targetType: 'course', targetId: r.id, createdAt: new Date(Date.now() - (i + 1) * 86_400_000) })
        .onConflictDoNothing();
    }
  }

  // The admin and staff demo accounts hold course.curate through platform_admin / super_admin.
  const curators = await curatorIds(db);
  for (const key of ['owais', 'team']) {
    const id = ctx.ids[key];
    if (id && !curators.includes(id)) {
      const [role] = await db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, 'platform_admin'));
      if (role) await db.insert(s.userRoles).values({ userId: id, roleId: role.id }).onConflictDoNothing();
    }
  }

  const checker = new FixtureLinkChecker(client.fixture);
  const [{ broken } = { broken: 0 }] = await db
    .select({ broken: sql<number>`count(*)::int` })
    .from(s.courses)
    .where(and(eq(s.courses.linkStatus, 'broken'), isNull(s.courses.removedAt)));
  if (broken === 0) {
    const notifyCurators = async (course: typeof s.courses.$inferSelect) => {
      const { dedupeKey, ...data } = brokenLinkNotice(course);
      for (const userId of await curatorIds(db)) {
        // Same row NotifyService writes for an "always" notification (category stored as moderation).
        await db.insert(s.notifications).values({
          userId,
          type: 'course_link_broken',
          category: 'moderation',
          actorIds: [],
          actorCount: 0,
          objectType: 'course',
          objectId: course.id,
          data,
          dedupeKey,
        });
      }
    };
    for (const daysAgo of [7, 0]) {
      const run = await executeLinkCheck(db, checker, (await startRun(db, 'link_check', 'schedule')).id, notifyCurators);
      if (run.status !== 'succeeded') throw new Error(`Learning seed link check failed: ${run.error}`);
      if (daysAgo) {
        // Show the history as a weekly cadence: the first check ran last week.
        const shift = sql`interval '${sql.raw(String(daysAgo))} days'`;
        await db
          .update(s.learningSyncRuns)
          .set({ startedAt: sql`${s.learningSyncRuns.startedAt} - ${shift}`, finishedAt: sql`${s.learningSyncRuns.finishedAt} - ${shift}` })
          .where(eq(s.learningSyncRuns.id, run.id));
      }
    }
  }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(s.courses).where(isNull(s.courses.removedAt));
  console.log(`Seeded ${count?.n ?? 0} Charter Center courses (fixture), ${FEATURED.length} featured.`);
}
