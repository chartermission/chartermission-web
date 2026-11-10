"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname as useNextPathname } from "next/navigation";
import { DEFAULT_LOCALE, dirOf, stripLocale, type Locale } from "./config";
import { en } from "./messages/en";
import { createTranslator, type MessageKey, type Translate, type Vars } from "./translate";

type Value = { locale: Locale; dir: "ltr" | "rtl"; t: Translate };

const I18nContext = createContext<Value>({ locale: DEFAULT_LOCALE, dir: "ltr", t: createTranslator(DEFAULT_LOCALE, en, en) });

/** Set once in the root layout with the language of the page being served. */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: unknown; children: ReactNode }) {
  const value = useMemo<Value>(() => ({ locale, dir: dirOf(locale), t: createTranslator(locale, messages, en) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** const t = useT(); t("post.like") */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

export function useLocale(): { locale: Locale; dir: "ltr" | "rtl" } {
  const { locale, dir } = useContext(I18nContext);
  return { locale, dir };
}

/** A translated string as an element, for Server Components that only need to print it. */
export function T({ k, vars }: { k: MessageKey; vars?: Vars }) {
  return <>{useT()(k, vars)}</>;
}

/**
 * The address the visitor sees. Pages are served from /{language}/… behind the scenes, so the
 * prerendered HTML knows the longer path; stripping the language keeps server and browser equal.
 */
export function usePathname(): string {
  return stripLocale(useNextPathname());
}
