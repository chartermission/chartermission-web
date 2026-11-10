import type { Locale } from "../config";
import type { Dict } from "../translate";
import { ar } from "./ar";
import { fr } from "./fr";

/**
 * Sentences written in English in the code, translated. English needs no dictionary: the sentence
 * itself is shown. `SOURCE_PLURALS` holds the English sentences that change with a count.
 * Server-only: the browser gets one language through <I18nProvider dict>.
 */
export const DICTS: Record<Locale, Dict | undefined> = { en: undefined, fr, ar };
export { SOURCE_PLURALS } from "./plurals";
