import type { Locale } from "../config";
import type { Dict } from "../translate";
import { ar } from "./ar";
import { fr } from "./fr";

/** Server-only: the browser gets one language through <I18nProvider dict>. */
export const DICTS: Record<Locale, Dict | undefined> = { en: undefined, fr, ar };
export { SOURCE_PLURALS } from "./plurals";
