import { DAILY_PROMPTS, promptFor } from './prompts.js';
import { excerpt, utcDayOfYear } from './text.js';
import { PROMPT_ANSWERS } from '../db/seed-home.js';
import { MEMBERS } from '../db/seed-data.js';

describe('daily prompts', () => {
  it('has about 30 prompts with unique ids, each with seed answers from 2+ demo members', () => {
    expect(DAILY_PROMPTS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(DAILY_PROMPTS.map((p) => p.id)).size).toBe(DAILY_PROMPTS.length);
    const keys = new Set(MEMBERS.map((m) => m.key));
    for (const p of DAILY_PROMPTS) {
      const answers = PROMPT_ANSWERS[p.id] ?? [];
      expect(answers.length, p.id).toBeGreaterThanOrEqual(2);
      expect(new Set(answers.map(([who]) => who)).size, p.id).toBe(answers.length);
      for (const [who] of answers) expect(keys.has(who), who).toBe(true);
    }
  });

  it('rotates by UTC day of the year', () => {
    expect(utcDayOfYear(new Date('2026-01-01T23:59:00Z'))).toBe(1);
    expect(utcDayOfYear(new Date('2026-11-05T00:00:00Z'))).toBe(309);
    expect(promptFor(new Date('2026-01-01T12:00:00Z'))).toBe(DAILY_PROMPTS[0]);
    expect(promptFor(new Date('2026-01-02T00:00:00Z'))).toBe(DAILY_PROMPTS[1]);
    expect(promptFor(new Date('2026-01-31T00:00:00Z'))).toBe(DAILY_PROMPTS[30 % DAILY_PROMPTS.length]);
  });
});

describe('excerpt', () => {
  it('strips markdown and collapses whitespace', () => {
    expect(excerpt('## Heading\n\n- **Bold** item\n- [a link](https://x.y)\n\n> quote', 200)).toBe('Heading Bold item a link quote');
  });

  it('cuts at a word boundary with an ellipsis', () => {
    const out = excerpt('one two three four five six seven eight nine ten', 20);
    expect(out).toBe('one two three four…');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(excerpt('short', 20)).toBe('short');
  });
});
