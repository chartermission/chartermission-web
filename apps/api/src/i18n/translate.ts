import { AsyncLocalStorage } from 'node:async_hooks';
import { ar } from './ar.js';
import { fr } from './fr.js';

/*
 * The API speaks the reader's language for what people read: error messages (and the fields of a
 * form that failed), emails and a few notices. Sentences stay written in English in the code; the
 * dictionaries (fr.ts, ar.ts) are keyed by that English. Sentences built around a name or a
 * number ("{name} replied to your comment") are matched as patterns, and the parts in the braces
 * are translated too when they are themselves known sentences ("That post was not found").
 */

export type ApiLocale = 'en' | 'fr' | 'ar';
const LOCALES: ApiLocale[] = ['en', 'fr', 'ar'];
const DICTS: Record<Exclude<ApiLocale, 'en'>, Record<string, string>> = {
  fr,
  ar,
};

export const isApiLocale = (value: unknown): value is ApiLocale =>
  typeof value === 'string' && (LOCALES as string[]).includes(value);

type Pattern = { regex: RegExp; template: string; weight: number };
const patterns = new Map<ApiLocale, Pattern[]>();
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

function patternsFor(locale: Exclude<ApiLocale, 'en'>): Pattern[] {
  let list = patterns.get(locale);
  if (!list) {
    list = Object.entries(DICTS[locale])
      .filter(([key]) => /\{\w+\}/.test(key))
      .map(([key, template]) => {
        const parts = key.split(/(\{\w+\})/);
        const regex = new RegExp(
          `^${parts.map((p) => (/^\{\w+\}$/.test(p) ? '([\\s\\S]*?)' : escape(p))).join('')}$`,
        );
        return {
          regex,
          template: substituteOrder(key, template),
          weight: key.replace(/\{\w+\}/g, '').length,
        };
      })
      // The most specific sentence (most fixed text) wins.
      .sort((a, b) => b.weight - a.weight);
    patterns.set(locale, list);
  }
  return list;
}

/** The translated template with its placeholders renamed to $1, $2… in the order they appear in the English. */
function substituteOrder(key: string, template: string): string {
  const names = key.match(/\{\w+\}/g) ?? [];
  let out = template;
  names.forEach((name, index) => {
    out = out.split(name).join(`\u0000${index + 1}\u0000`);
  });
  return out;
}

/** A sentence in the given language (English, or unknown sentences, come back unchanged). */
export function translateText(
  locale: ApiLocale | null | undefined,
  text: string,
  depth = 0,
): string {
  if (!locale || locale === 'en' || !text) return text;
  const dict = DICTS[locale];
  const exact = dict[text];
  if (exact !== undefined) return exact;
  if (depth > 1 || text.length > 2000) return text;
  for (const pattern of patternsFor(locale)) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    return pattern.template.replace(/\u0000(\d+)\u0000/g, (_, i: string) =>
      translateText(locale, match[Number(i)] ?? '', depth + 1),
    );
  }
  return text;
}

/* ---------------- the language of the current request ---------------- */

const store = new AsyncLocalStorage<ApiLocale>();

/** Runs the rest of a request with its language available to requestLocale(). */
export function withLocale<T>(locale: ApiLocale, run: () => T): T {
  return store.run(locale, run);
}

export function requestLocale(): ApiLocale | undefined {
  return store.getStore();
}

/** The language a request asks for: the language cookie the web app sets, else Accept-Language. */
export function localeFromHeaders(headers: {
  cookie?: string;
  'accept-language'?: string | string[];
}): ApiLocale {
  const cookie = /(?:^|;\s*)cm_locale=([a-z]{2})/.exec(
    headers.cookie ?? '',
  )?.[1];
  if (isApiLocale(cookie)) return cookie;
  const accept = String(headers['accept-language'] ?? '').toLowerCase();
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2);
    if (isApiLocale(code)) return code;
  }
  return 'en';
}
