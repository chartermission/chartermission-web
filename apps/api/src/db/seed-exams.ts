import { eq } from 'drizzle-orm';
import { ExamImportInput } from '@chartermission/contracts';
import type { Db } from './client.js';
import * as s from './schema.js';
import { CAPM_PRACTICE_EXAM, CAPM_PRACTICE_SLUG } from '../exams/data/capm-practice.js';
import { importExam } from '../exams/exam-store.js';

/**
 * Reference data: the Charter Center CAPM practice exam, added once as a draft so an admin can
 * review it and publish it from the console. Skipped when an exam already uses its link name.
 */
export async function seedExams(db: Db): Promise<void> {
  const [existing] = await db.select({ id: s.exams.id }).from(s.exams).where(eq(s.exams.slug, CAPM_PRACTICE_SLUG)).limit(1);
  if (existing) return;
  const input = ExamImportInput.parse(CAPM_PRACTICE_EXAM);
  await db.transaction((tx) => importExam(tx, input, null));
}

/** Demo data: publishes the seeded exam so the member site has one to take straight away. */
export async function seedDemoExams(db: Db): Promise<void> {
  await db
    .update(s.exams)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(s.exams.slug, CAPM_PRACTICE_SLUG));
}
