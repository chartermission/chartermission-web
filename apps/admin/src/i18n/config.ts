/** Console languages. English is the source; French and Arabic are translations of the same sentences. */
export const LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The console's language choice (the API reads it too, for its messages). */
export const LOCALE_COOKIE = "cm_admin_locale";

/** Each language in its own name, for the language menu. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", ar: "العربية" };

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const dirOf = (locale: Locale): "ltr" | "rtl" => (locale === "ar" ? "rtl" : "ltr");

/** BCP 47 tags for dates and numbers. Arabic keeps Western digits. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", ar: "ar-u-nu-latn" };
