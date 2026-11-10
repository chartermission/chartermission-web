import type { Locale } from "../config";
import type { Dict } from "../translate";
import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";

/**
 * Sentences written in English in the code, translated. English needs no dictionary: the sentence
 * itself is shown. `SOURCE_PLURALS` holds the English sentences that change with a count.
 */
export const DICTS: Record<Locale, Dict | undefined> = { en: undefined, fr, ar };
export const SOURCE_PLURALS: Dict = en;
