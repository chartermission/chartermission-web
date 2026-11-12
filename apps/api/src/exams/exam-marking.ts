import { randomBytes } from 'node:crypto';
import type { ExamAttemptOrder, ExamAttemptResult, ExamOptionRow } from '../db/schema.js';

/** What marking needs to know about a question. */
export type MarkableQuestion = { id: string; sectionId: string | null; correctOptionId: string };
export type MarkableSection = { id: string; title: string; titleAlt: string | null };

/** Heading for questions that sit outside every section, when the exam has sections. */
export const UNSECTIONED_TITLE = 'Other questions';

/** A short id for an answer, unique within its question. */
export function newOptionId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = randomBytes(4).toString('hex');
    if (!used.has(id)) return id;
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The order one attempt shows the questions and each question's answers in. */
export function buildOrder(
  questions: readonly { id: string; options: ExamOptionRow[] }[],
  opts: { shuffleQuestions: boolean; shuffleOptions: boolean },
  random: () => number = Math.random,
): ExamAttemptOrder {
  const list = opts.shuffleQuestions ? shuffled(questions, random) : questions;
  return list.map((q) => {
    const ids = q.options.map((o) => o.id);
    return { q: q.id, o: opts.shuffleOptions ? shuffled(ids, random) : ids };
  });
}

/** Whole percent, rounded to the nearest (0 when there is nothing to mark). */
export const percentOf = (correct: number, total: number) => (total > 0 ? Math.round((correct * 100) / total) : 0);

/** Passing compares the exact share, so 69.6% does not pass a 70% mark by rounding. */
export const hasPassed = (correct: number, total: number, passPercent: number) => total > 0 && correct * 100 >= passPercent * total;

export type Marked = ExamAttemptResult & { correct: number; total: number; answered: number };

/**
 * Marks an attempt. Only questions that still exist count (one removed from the exam after the
 * attempt started is dropped from the total). Section scores come in the exam's section order;
 * questions outside every section are grouped last, and an exam without sections has none.
 */
export function markAttempt(
  order: ExamAttemptOrder,
  questions: ReadonlyMap<string, MarkableQuestion>,
  sections: readonly MarkableSection[],
  answers: Readonly<Record<string, string>>,
): Marked {
  const items: Marked['items'] = [];
  for (const entry of order) {
    const question = questions.get(entry.q);
    if (!question) continue;
    const given = answers[entry.q];
    // An answer that is no longer one of the question's choices counts as not answered.
    const chosen = given !== undefined && entry.o.includes(given) ? given : null;
    const known = sections.some((s) => s.id === question.sectionId);
    items.push({ q: question.id, section: known ? question.sectionId : null, chosen, answer: question.correctOptionId, ok: chosen === question.correctOptionId });
  }
  const tally = (match: (sectionId: string | null) => boolean) => {
    const own = items.filter((i) => match(i.section));
    return { correct: own.filter((i) => i.ok).length, total: own.length };
  };
  const sectionScores: Marked['sections'] = [];
  if (sections.length) {
    for (const s of sections) {
      const score = tally((id) => id === s.id);
      if (score.total) sectionScores.push({ id: s.id, title: s.title, titleAlt: s.titleAlt, ...score });
    }
    const rest = tally((id) => id === null);
    if (rest.total) sectionScores.push({ id: null, title: UNSECTIONED_TITLE, titleAlt: null, ...rest });
  }
  return {
    items,
    sections: sectionScores,
    correct: items.filter((i) => i.ok).length,
    total: items.length,
    answered: items.filter((i) => i.chosen !== null).length,
  };
}

/** "CAPM Practice — 50 Questions" → "capm-practice-50-questions". Titles with no Latin letters fall back to "exam". */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'exam';
}
