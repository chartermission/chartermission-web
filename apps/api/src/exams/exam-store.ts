import { asc, eq, ilike, or } from 'drizzle-orm';
import { EXAM_MAX_SECTIONS, type ExamImportInput, type ExamImportQuestion, type ExamQuestionInput, type ExamSettingsInput } from '@chartermission/contracts';
import type { Db, Tx } from '../db/client.js';
import { examQuestions, examSections, exams, type ExamOptionRow } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { newOptionId, slugify } from './exam-marking.js';
import type { ExamRow } from './exam-views.js';

/*
 * Writing exams to the database. Plain functions over a connection or transaction, shared by the
 * admin service and the seed (which runs without the Nest app).
 */

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505' || (err as { cause?: { code?: string } })?.cause?.code === '23505';

type QuestionFields = Omit<ExamQuestionInput, 'sectionId'>;

/** Inserts the exam under a free link name ("capm-practice", "capm-practice-2"…). */
export async function insertExam(db: Db | Tx, input: ExamSettingsInput, createdBy: string | null, wantedSlug?: string): Promise<ExamRow> {
  const base = wantedSlug ?? slugify(input.title);
  const taken = new Set(
    (
      await db
        .select({ slug: exams.slug })
        .from(exams)
        .where(or(eq(exams.slug, base), ilike(exams.slug, `${base.replace(/[\\%_]/g, (ch) => `\\${ch}`)}-%`)))
    ).map((r) => r.slug),
  );
  if (wantedSlug && taken.has(wantedSlug)) throw Errors.conflict(`An exam with the link name “${wantedSlug}” already exists`);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  try {
    const [row] = await db.insert(exams).values({ ...input, slug, createdBy }).returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.conflict('An exam with that link name was just created. Try again.');
    throw err;
  }
}

/** Section ids by title (case-insensitive), creating the ones the exam doesn't have yet, in first-seen order. */
export async function ensureSections(tx: Db | Tx, examId: string, named: { section?: string | null; sectionAlt?: string | null }[]): Promise<Map<string, string>> {
  const existing = await tx.select().from(examSections).where(eq(examSections.examId, examId)).orderBy(asc(examSections.position));
  const byTitle = new Map(existing.map((s) => [s.title.toLowerCase(), s.id]));
  let position = existing.reduce((max, s) => Math.max(max, s.position + 1), 0);
  for (const item of named) {
    const title = item.section?.trim();
    if (!title || byTitle.has(title.toLowerCase())) continue;
    if (byTitle.size >= EXAM_MAX_SECTIONS) throw Errors.conflict(`An exam can have up to ${EXAM_MAX_SECTIONS} sections`);
    const [row] = await tx
      .insert(examSections)
      .values({ examId, title, titleAlt: item.sectionAlt ?? null, position: position++ })
      .returning({ id: examSections.id });
    byTitle.set(title.toLowerCase(), row!.id);
  }
  return byTitle;
}

export async function insertQuestions(tx: Db | Tx, examId: string, questions: ExamImportQuestion[], sectionIds: Map<string, string>, firstPosition: number): Promise<void> {
  const values = questions.map((q, i) => ({
    examId,
    sectionId: q.section ? (sectionIds.get(q.section.trim().toLowerCase()) ?? null) : null,
    position: firstPosition + i,
    ...questionColumns(q),
  }));
  for (let i = 0; i < values.length; i += 100) await tx.insert(examQuestions).values(values.slice(i, i + 100));
}

/** The stored columns for a question. Answers that came with a known id keep it; the rest get a new one. */
export function questionColumns(input: QuestionFields, existing: ExamOptionRow[] = []) {
  const known = new Set(existing.map((o) => o.id));
  const used = new Set<string>();
  const options: ExamOptionRow[] = input.options.map((o) => {
    const id = o.id && known.has(o.id) && !used.has(o.id) ? o.id : newOptionId([...known, ...used]);
    used.add(id);
    return { id, text: o.text, textAlt: o.textAlt ?? null };
  });
  return {
    reference: input.reference ?? null,
    tag: input.tag ?? null,
    prompt: input.prompt,
    promptAlt: input.promptAlt ?? null,
    options,
    correctOptionId: options[input.correctIndex]!.id,
    explanation: input.explanation ?? '',
    explanationAlt: input.explanationAlt ?? null,
  };
}

/** A whole exam (settings, sections, questions) as a draft. Run it inside a transaction. */
export async function importExam(tx: Db | Tx, input: ExamImportInput, createdBy: string | null): Promise<ExamRow> {
  const { sections, questions, slug, ...settings } = input;
  const exam = await insertExam(tx, settings, createdBy, slug);
  const sectionIds = await ensureSections(tx, exam.id, [...sections.map((s) => ({ section: s.title, sectionAlt: s.titleAlt })), ...questions]);
  await insertQuestions(tx, exam.id, questions, sectionIds, 0);
  return exam;
}
