import { INTERESTS, LANGUAGES, MEMBERS, SECTORS, SKILLS, taxonomySlug } from './seed-data.js';

/*
 * The live site gets these catalogues from seedReference() on every start: rows are matched by slug
 * and positions are list indexes, so the items it already has must stay first, in the same order.
 */
const ORIGINAL = {
  sectors: [
    'Agriculture & food', 'Climate & energy', 'Education', 'Finance & fintech', 'Health', 'Technology',
    'Trade & logistics', 'Creative industries', 'Public policy', 'Infrastructure', 'Manufacturing', 'Social impact',
  ],
  skills: [
    'Product management', 'Software engineering', 'Data analysis', 'Design', 'Marketing', 'Sales',
    'Fundraising', 'Policy research', 'Project management', 'Supply chain', 'Solar', 'Grid finance',
    'Partnerships', 'M&E', 'Public speaking', 'Mentoring', 'Legal', 'Accounting',
  ],
  interests: [
    'AfCFTA and trade', 'Diaspora investment', 'Clean cooking', 'Youth employment', 'Women in leadership',
    'AgriTech', 'Fintech', 'African tech', 'Climate action', 'Health tech', 'Education access', 'Creative economy',
  ],
  languages: ['English', 'French', 'Arabic', 'Portuguese', 'Swahili', 'Hausa', 'Yoruba', 'Igbo', 'Amharic', 'Zulu', 'Wolof', 'Twi'],
};
const LISTS = { sectors: SECTORS, skills: SKILLS, interests: INTERESTS, languages: LANGUAGES };

describe('profile catalogues', () => {
  it.each(Object.keys(LISTS) as (keyof typeof LISTS)[])('%s: original items first and in place, slugs unique', (kind) => {
    const list = LISTS[kind];
    expect(list.slice(0, ORIGINAL[kind].length)).toEqual(ORIGINAL[kind]);
    const slugs = list.map(taxonomySlug);
    expect(slugs.every((s) => s.length > 0)).toBe(true);
    expect(new Set(slugs).size).toBe(list.length);
    expect(new Set(list.map((n) => n.toLowerCase())).size).toBe(list.length);
  });

  it('are full lists', () => {
    expect(SECTORS.length).toBeGreaterThanOrEqual(28);
    expect(SKILLS.length).toBeGreaterThanOrEqual(140);
    expect(INTERESTS.length).toBeGreaterThanOrEqual(65);
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(42);
  });

  it('demo members pick from the lists, in realistic numbers', () => {
    const profiles = MEMBERS.filter((m) => m.skills?.length);
    expect(profiles.length).toBeGreaterThanOrEqual(12);
    for (const m of profiles) {
      for (const kind of Object.keys(LISTS) as (keyof typeof LISTS)[]) {
        const picked = m[kind] ?? [];
        expect(new Set(picked).size, `${m.key} ${kind}`).toBe(picked.length);
        for (const name of picked) expect(LISTS[kind], `${m.key} ${kind}`).toContain(name);
      }
      expect(m.skills!.length, m.key).toBeGreaterThanOrEqual(6);
      expect(m.skills!.length, m.key).toBeLessThanOrEqual(14);
      expect(m.interests!.length, m.key).toBeGreaterThanOrEqual(4);
      expect(m.interests!.length, m.key).toBeLessThanOrEqual(8);
      expect(m.sectors!.length, m.key).toBeGreaterThanOrEqual(2);
      expect(m.sectors!.length, m.key).toBeLessThanOrEqual(3);
      expect(m.languages!.length, m.key).toBeGreaterThanOrEqual(2);
      expect(m.languages!.length, m.key).toBeLessThanOrEqual(4);
    }
  });
});
