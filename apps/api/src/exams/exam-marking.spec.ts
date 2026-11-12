import { buildOrder, hasPassed, markAttempt, newOptionId, percentOf, slugify, UNSECTIONED_TITLE } from './exam-marking.js';

const opt = (id: string) => ({ id, text: id, textAlt: null });
const q = (id: string, sectionId: string | null, correctOptionId: string) => ({ id, sectionId, correctOptionId });

describe('exam marking', () => {
  const sections = [
    { id: 's1', title: 'Domain I', titleAlt: 'الأول' },
    { id: 's2', title: 'Domain II', titleAlt: null },
  ];
  const questions = new Map([q('q1', 's1', 'a'), q('q2', 's1', 'b'), q('q3', 's2', 'c'), q('q4', null, 'd')].map((x) => [x.id, x]));
  const order = ['q1', 'q2', 'q3', 'q4'].map((id) => ({ q: id, o: ['a', 'b', 'c', 'd'] }));

  it('scores the attempt and each section, in section order with unsectioned questions last', () => {
    const m = markAttempt(order, questions, sections, { q1: 'a', q2: 'a', q3: 'c' });
    expect(m).toMatchObject({ correct: 2, total: 4, answered: 3 });
    expect(m.sections).toEqual([
      { id: 's1', title: 'Domain I', titleAlt: 'الأول', correct: 1, total: 2 },
      { id: 's2', title: 'Domain II', titleAlt: null, correct: 1, total: 1 },
      { id: null, title: UNSECTIONED_TITLE, titleAlt: null, correct: 0, total: 1 },
    ]);
    expect(m.items.find((i) => i.q === 'q2')).toEqual({ q: 'q2', section: 's1', chosen: 'a', answer: 'b', ok: false });
    expect(m.items.find((i) => i.q === 'q4')).toMatchObject({ chosen: null, ok: false });
  });

  it('leaves out questions removed since the attempt started, and ignores answers that were never offered', () => {
    const fewer = new Map([...questions].filter(([id]) => id !== 'q3'));
    const m = markAttempt(order, fewer, sections, { q1: 'zz', q3: 'c', q4: 'd' });
    expect(m).toMatchObject({ correct: 1, total: 3, answered: 1 });
    expect(m.sections.map((s) => s.id)).toEqual(['s1', null]);
  });

  it('has no section scores for an exam without sections', () => {
    expect(markAttempt(order, questions, [], { q1: 'a' }).sections).toEqual([]);
  });

  it('rounds the percent but passes on the exact share', () => {
    expect(percentOf(7, 10)).toBe(70);
    expect(percentOf(0, 0)).toBe(0);
    // 16 of 23 is 69.57%: shown as 70%, but not a pass at a 70% mark.
    expect(percentOf(16, 23)).toBe(70);
    expect(hasPassed(16, 23, 70)).toBe(false);
    expect(hasPassed(35, 50, 70)).toBe(true);
    expect(hasPassed(0, 0, 1)).toBe(false);
  });

  it('keeps the written order unless shuffling is on, and shuffles answers per question', () => {
    const list = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `q${n}`, options: ['a', 'b', 'c', 'd'].map(opt) }));
    const plain = buildOrder(list, { shuffleQuestions: false, shuffleOptions: false });
    expect(plain.map((e) => e.q)).toEqual(list.map((x) => x.id));
    expect(plain[0]!.o).toEqual(['a', 'b', 'c', 'd']);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const mixed = buildOrder(list, { shuffleQuestions: true, shuffleOptions: true }, random);
    expect(mixed.map((e) => e.q).sort()).toEqual(list.map((x) => x.id));
    expect(mixed.map((e) => e.q)).not.toEqual(list.map((x) => x.id));
    for (const e of mixed) expect([...e.o].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('makes link names and answer ids', () => {
    expect(slugify('CAPM® Practice Exam — 50 Questions')).toBe('capm-practice-exam-50-questions');
    expect(slugify('Risk & Reward')).toBe('risk-and-reward');
    expect(slugify('اختبار')).toBe('exam');
    const id = newOptionId(['aaaaaaaa']);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});
