/*
 * What every chapter starts with: its own hashtag and an About text written for its country.
 * Used by the reference seed (production bootstrap) and when an admin creates a chapter.
 * Ambassadors and admins can change both afterwards; the seed never overwrites their edits.
 */

/** How a country reads in a sentence ("in the United Kingdom"), where the short name alone doesn't. */
const PLACE: Record<string, string> = {
  GB: 'the United Kingdom',
  US: 'the United States',
  AE: 'the United Arab Emirates',
  NL: 'the Netherlands',
  GM: 'The Gambia',
  CF: 'the Central African Republic',
  CD: 'the Democratic Republic of the Congo',
  CG: 'the Republic of the Congo',
  KM: 'the Comoros',
  SC: 'the Seychelles',
  CI: 'Côte d’Ivoire',
};

/** "Nigeria Chapter" → "Nigeria", "UK Diaspora Chapter" → "UK Diaspora". */
export const chapterLabel = (name: string) => name.replace(/\s+chapter$/i, '').trim() || name;

/**
 * The chapter's hashtag, from its name: "Nigeria", "SouthAfrica", "CoteDIvoire", "UKDiaspora".
 * ASCII letters and digits only (the same rule as every hashtag), each word capitalised.
 */
export function chapterHashtag(name: string): string {
  const words = chapterLabel(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const tag = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return (tag.length >= 2 ? tag : `${tag}Chapter`).slice(0, 50);
}

export type ChapterDefaults = { hashtag: string; about: string; hashtagDescription: string };

/** `hashtag`: the chapter's existing hashtag, when it already has one (the About text then names that one). */
export function chapterDefaults(chapter: { name: string; countryCode: string; countryName: string; region: string; hashtag?: string | null }): ChapterDefaults {
  const hashtag = chapter.hashtag || chapterHashtag(chapter.name);
  const place = PLACE[chapter.countryCode.toUpperCase()] ?? chapter.countryName;
  const name = /chapter$/i.test(chapter.name) ? chapter.name : `${chapter.name} Chapter`;
  const diaspora = chapter.region === 'Diaspora';
  const about = diaspora
    ? `The ${name} brings together members of the African diaspora in ${place}, and friends of the continent who are based there. ` +
      `Follow the chapter to meet members near you, find ways to invest in, mentor and build with Africa, and hear about local events first. ` +
      `Tag your posts #${hashtag} so the chapter can find them.`
    : `The ${name} is the home on Charter Mission for members living, working and building in ${place}. ` +
      `Follow the chapter to meet members near you, see what people in ${place} are working on, and hear about local events first. ` +
      `Tag your posts #${hashtag} so the chapter can find them.`;
  return {
    hashtag,
    about,
    hashtagDescription: diaspora
      ? `The African diaspora in ${place}: people, projects and events. The hashtag of the ${name}.`
      : `People, projects and news from ${place}. The hashtag of the ${name}.`,
  };
}
