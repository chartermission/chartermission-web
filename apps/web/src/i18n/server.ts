import { locale as rootLocale } from "next/root-params";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { en } from "./messages/en";
import { fr } from "./messages/fr";
import { ar } from "./messages/ar";
import { createTranslator, type Translate } from "./translate";

const MESSAGES = { en, fr, ar } as const;

export const messagesFor = (locale: Locale) => MESSAGES[locale];

/** The language of the page being rendered (Server Components). */
export async function getLocale(): Promise<Locale> {
  const value = await rootLocale();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** const t = await getT(); t("nav.home") */
export async function getT(): Promise<Translate> {
  const locale = await getLocale();
  return createTranslator(locale, MESSAGES[locale], en);
}
