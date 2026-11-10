"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { useIntlTag, useLocale, useT } from "./client";
import { translatePhrase, translatePlace } from "./places";
import { AUTO_ATTRIBUTES } from "./jsx/attributes";

/*
 * The pieces the JSX runtime (i18n/jsx/jsx-runtime.ts) puts around interface text. They are
 * ordinary client components: each reads the page's language from context and prints the
 * sentence in that language. In English they print what they were given.
 */

const NoTranslateContext = createContext(false);

/**
 * Everything inside is shown exactly as written, even where a piece of it happens to match a
 * sentence of the interface. Put it around what members write: posts, comments, messages, names.
 */
export function NoTranslate({ children }: { children: ReactNode }) {
  return <NoTranslateContext.Provider value={true}>{children}</NoTranslateContext.Provider>;
}

/** Translates a sentence and keeps the spaces around it, which JSX uses to separate words. */
function useSentence(): (text: string) => string {
  const t = useT();
  const { locale } = useLocale();
  const intl = useIntlTag();
  const off = useContext(NoTranslateContext);
  return (text) => {
    if (off) return text;
    const core = text.trim();
    if (!core) return text;
    const start = text.length - text.trimStart().length;
    const end = text.length - text.trimEnd().length;
    const one = (part: string) => {
      const out = t(part);
      return out === part && locale !== "en" ? (translatePlace(part, intl, t) ?? translatePhrase(part, intl, t) ?? part) : out;
    };
    let out = one(core);
    if (out === core && core.includes(" · ")) out = core.split(" · ").map(one).join(" · ");
    return text.slice(0, start) + out + (end ? text.slice(text.length - end) : "");
  };
}

/** A piece of interface text between tags. */
export function AutoText({ children }: { children: string }) {
  return useSentence()(children);
}

/**
 * A plain element whose attributes (placeholder, title, alt, aria-label…) carry interface text,
 * or which may only contain bare text (option, textarea, svg title).
 */
export function AutoElement({ as, textChild, ...props }: { as: string; textChild?: boolean } & Record<string, unknown>) {
  const sentence = useSentence();
  const next: Record<string, unknown> = { ...props };
  for (const name of AUTO_ATTRIBUTES) {
    const value = next[name];
    if (typeof value === "string") next[name] = sentence(value);
  }
  if (textChild && typeof next.children === "string") next.children = sentence(next.children);
  return createElement(as, next);
}
