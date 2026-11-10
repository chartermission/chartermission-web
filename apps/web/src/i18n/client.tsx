"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname as useNextPathname } from "next/navigation";
import { DEFAULT_LOCALE, INTL_LOCALE, dirOf, stripLocale, type Locale } from "./config";
import { SOURCE_PLURALS } from "./dict/plurals";
import { en } from "./messages/en";
import { createTranslator, type Dict, type MessageKey, type Translate, type Vars } from "./translate";

type Value = { locale: Locale; dir: "ltr" | "rtl"; t: Translate };

const I18nContext = createContext<Value>({ locale: DEFAULT_LOCALE, dir: "ltr", t: createTranslator(DEFAULT_LOCALE, en, en, undefined, SOURCE_PLURALS) });

/**
 * Set once in the root layout with the language of the page being served. The layout hands over
 * that language's dictionary only, so a visitor downloads one language, not all of them.
 */
export function I18nProvider({ locale, messages, dict, children }: { locale: Locale; messages: unknown; dict?: Dict; children: ReactNode }) {
  const value = useMemo<Value>(() => ({ locale, dir: dirOf(locale), t: createTranslator(locale, messages, en, dict, SOURCE_PLURALS) }), [locale, messages, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** const t = useT(); t("post.like") */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

/** The tag to give Intl and toLocaleDateString for the page's language ("fr-FR"). */
export function useIntlTag(): string {
  return INTL_LOCALE[useContext(I18nContext).locale];
}

export function useLocale(): { locale: Locale; dir: "ltr" | "rtl" } {
  const { locale, dir } = useContext(I18nContext);
  return { locale, dir };
}

/**
 * A translated string as an element, for Server Components that only need to print it:
 * <T k="nav.home" /> for a named message, or <T>Save changes</T> for an English sentence.
 */
export function T({ k, vars, children }: { k?: MessageKey; vars?: Vars; children?: ReactNode }) {
  const t = useT();
  // The JSX runtime may already have wrapped a plain sentence in <AutoText>; it prints itself.
  if (!k && typeof children !== "string") return <>{children}</>;
  return <>{t(k ?? (children as string | undefined) ?? "", vars)}</>;
}

/**
 * The address the visitor sees. Pages are served from /{language}/… behind the scenes, so the
 * prerendered HTML knows the longer path; stripping the language keeps server and browser equal.
 */
export function usePathname(): string {
  return stripLocale(useNextPathname());
}
