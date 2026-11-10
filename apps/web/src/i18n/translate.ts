import { INTL_LOCALE, type Locale } from "./config";
import type { Messages } from "./messages/en";

/** A message with plural forms. `other` is required; Arabic also uses zero, two, few and many. */
export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type Leaf = string | Plural;

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = { [K in keyof T]: T[K] extends Leaf ? K : Join<K, Paths<T[K]>> }[keyof T];
/** Every message key, as a dotted path ("post.like"). */
export type MessageKey = Paths<Messages>;

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

const rules = new Map<Locale, Intl.PluralRules>();

function lookup(messages: unknown, key: string): Leaf | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || (node && typeof node === "object" && "other" in node) ? (node as Leaf) : undefined;
}

/**
 * t("post.like") and t("post.comments", { count: 3 }). `{name}` placeholders are filled from vars;
 * a message with plural forms is chosen by vars.count, and `{count}` is written with the language's
 * own digit grouping.
 */
export function createTranslator(locale: Locale, messages: unknown, fallback: unknown): Translate {
  return (key, vars) => {
    const leaf = lookup(messages, key) ?? lookup(fallback, key);
    if (leaf === undefined) return key;
    let text: string;
    if (typeof leaf === "string") text = leaf;
    else {
      let rule = rules.get(locale);
      if (!rule) rules.set(locale, (rule = new Intl.PluralRules(INTL_LOCALE[locale])));
      const count = Number(vars?.count ?? 0);
      text = (count === 0 && leaf.zero !== undefined ? leaf.zero : leaf[rule.select(count) as keyof Plural]) ?? leaf.other;
    }
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      if (value === undefined) return match;
      return typeof value === "number" ? value.toLocaleString(INTL_LOCALE[locale]) : value;
    });
  };
}
