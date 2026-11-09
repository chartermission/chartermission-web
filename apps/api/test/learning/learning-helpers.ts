import { eq } from 'drizzle-orm';
import { s, type TestApp } from '../helpers.js';
import { CHARTER_CENTER_CLIENT, FixtureCharterCenterClient, loadFixture, type CharterCenterFixture } from '../../src/learning/charter-center.client.js';
import { FixtureLinkChecker, LINK_CHECKER } from '../../src/learning/link-checker.js';
import { LearningJobsService } from '../../src/learning/learning-jobs.service.js';
import { SettingsService } from '../../src/infra/settings.service.js';
import { LEARNING_ACCESS_DEFAULTS } from '@chartermission/contracts';

/** The shipped fixture, deep-copied so tests can edit it freely. */
export function fixture(): CharterCenterFixture {
  return structuredClone(loadFixture());
}

/** A course record in the assumed Charter Center shape. */
export function courseRecord(id: string | number, extra: Record<string, unknown> = {}) {
  return {
    id,
    slug: `course-${id}`,
    title: `Course ${id}`,
    provider: 'Charter Center',
    description: `About course ${id}`,
    level: 'beginner',
    topics: ['Business & trade'],
    duration_minutes: 90,
    lessons_count: 4,
    language: 'en',
    is_free: true,
    url: `https://chartercenter.org/courses/course-${id}`,
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

export function learning(t: TestApp) {
  const client = t.app.get<FixtureCharterCenterClient>(CHARTER_CENTER_CLIENT);
  const checker = t.app.get<FixtureLinkChecker>(LINK_CHECKER);
  const jobs = t.app.get(LearningJobsService);
  return {
    client,
    checker,
    jobs,
    /** Serve this catalogue from the "API" for the next sync. */
    setCatalogue: (data: CharterCenterFixture) => client.setData(data),
    sync: () => jobs.runJob('sync'),
    linkCheck: () => jobs.runJob('link_check'),
    course: async (slug: string) => (await t.db.select().from(s.courses).where(eq(s.courses.slug, slug)))[0]!,
  };
}

/** Switches the e-learning access gate off, so catalogue tests don't need fully set-up members. */
export async function openLearning(t: TestApp) {
  await t.app.get(SettingsService).set('learning_access', { ...LEARNING_ACCESS_DEFAULTS, enabled: false }, null);
}
