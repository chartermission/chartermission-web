import { cookies } from "next/headers";
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import { DICTS, SOURCE_PLURALS } from "./dict";
import { createTranslator, type Translate } from "./translate";

/** The console's language (Server Components). */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** const t = await getT(); t("Members") */
export async function getT(): Promise<Translate> {
  const locale = await getLocale();
  return createTranslator(locale, {}, {}, DICTS[locale], SOURCE_PLURALS);
}

/** The tag to give Intl and toLocaleDateString ("fr-FR"). */
export async function getIntlTag(): Promise<string> {
  return INTL_LOCALE[await getLocale()];
}
