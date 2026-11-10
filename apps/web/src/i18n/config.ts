/** Interface languages. English is the source; French and Arabic are full translations of the same keys. */
export const LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Remembers the visitor's choice. Read by the proxy, which serves the matching language at the same address. */
export const LOCALE_COOKIE = "cm_locale";

/** Each language in its own name, for the language menu. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", ar: "العربية" };

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const dirOf = (locale: Locale): "ltr" | "rtl" => (locale === "ar" ? "rtl" : "ltr");

/** BCP 47 tags for dates and numbers. Arabic keeps Western digits, which is what members type and search with. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", ar: "ar-u-nu-latn" };

/** "/fr/feed" → "/feed": the address the visitor sees never carries the language. */
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (!isLocale(first)) return pathname;
  return `/${rest.join("/")}`;
}

/** Best match for an Accept-Language header, or null when none of our languages is listed. */
export function localeFromHeader(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: (tag ?? "").toLowerCase().split("-")[0] ?? "", q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) if (isLocale(tag)) return tag;
  return null;
}
