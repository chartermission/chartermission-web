"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALE_COOKIE, dirOf, type Locale } from "./config";
import { SOURCE_PLURALS } from "./dict/plurals";
import { createTranslator, type Dict, type Translate, type Vars } from "./translate";

type Value = { locale: Locale; dir: "ltr" | "rtl"; t: Translate };

const I18nContext = createContext<Value>({ locale: DEFAULT_LOCALE, dir: "ltr", t: createTranslator(DEFAULT_LOCALE, {}, {}, undefined, SOURCE_PLURALS) });

/**
 * Set once in the root layout with the console's language (the cm_admin_locale cookie). Only that
 * language's dictionary reaches the browser. It also sets the page's lang and direction.
 */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict?: Dict; children: ReactNode }) {
  const value = useMemo<Value>(() => ({ locale, dir: dirOf(locale), t: createTranslator(locale, {}, {}, dict, SOURCE_PLURALS) }), [locale, dict]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** const t = useT(); t("Save changes") */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

/** The tag to give Intl and toLocaleDateString ("fr-FR"). */
export function useIntlTag(): string {
  return INTL_LOCALE[useContext(I18nContext).locale];
}

export function useLocale(): { locale: Locale; dir: "ltr" | "rtl" } {
  const { locale, dir } = useContext(I18nContext);
  return { locale, dir };
}

/** A translated sentence as an element: <T vars={{ name }}>{"Badges for {name}"}</T>. */
export function T({ vars, children }: { k?: never; vars?: Vars; children?: ReactNode }) {
  const t = useT();
  // The JSX runtime may already have wrapped a plain sentence in <AutoText>; it prints itself.
  if (typeof children !== "string") return <>{children}</>;
  return <>{t(children, vars)}</>;
}

/** Saves the choice and reloads, so server-rendered parts follow too. */
export function switchLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.location.reload();
}
