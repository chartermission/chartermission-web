import { placeVar } from "./places";
import { INTL_LOCALE, type Locale } from "./config";

/** A message with plural forms. `other` is required; Arabic also uses zero, two, few and many. */
export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
type Leaf = string | Plural;

/** The console has no named messages: every key is an English sentence. */
export type MessageKey = never;

/** Values for the {placeholders}. A missing value prints nothing, as it would between tags. */
export type Vars = Record<string, string | number | null | undefined>;
/**
 * t("nav.home") for a named message, or t("Save changes") for a sentence written in English in
 * the code. Sentences are looked up in the language's dictionary (i18n/dict) and shown in English
 * when the dictionary has no entry yet.
 */
export type Translate = (key: MessageKey | (string & {}), vars?: Vars) => string;
/** A dictionary from the English sentence to its translation. */
export type Dict = Record<string, Leaf>;

/** Sentences are matched ignoring line breaks and runs of spaces, the way JSX collapses them. */
export const normalise = (text: string) => (/\s{2,}|[\n\t]|^\s|\s$/.test(text) ? text.replace(/\s+/g, " ").trim() : text);

const rules = new Map<Locale, Intl.PluralRules>();

const own = (dict: Dict | undefined, key: string): Leaf | undefined => (dict && Object.hasOwn(dict, key) ? dict[key] : undefined);

function lookup(messages: unknown, key: string): Leaf | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || (node && typeof node === "object" && "other" in node) ? (node as Leaf) : undefined;
}

/**
 * t("post.like"), t("post.comments", { count: 3 }) and t("Hello {name}", { name }). `{name}` placeholders are filled from vars;
 * a message with plural forms is chosen by vars.count, and `{count}` is written with the language's
 * own digit grouping.
 */
export function createTranslator(locale: Locale, messages: unknown, fallback: unknown, dict?: Dict, sourcePlurals?: Dict): Translate {
  const t: Translate = (key, vars) => {
    const sentence = normalise(key);
    const leaf: Leaf = lookup(messages, key) ?? own(dict, sentence) ?? lookup(fallback, key) ?? own(sourcePlurals, sentence) ?? sentence;
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
      if (!(name in vars)) return match;
      const value = vars[name] ?? "";
      if (typeof value === "number") return value.toLocaleString(INTL_LOCALE[locale]);
      // Country and chapter names arrive in English from the API.
      return locale === "en" ? value : placeVar(value, INTL_LOCALE[locale], t);
    });
  };
  return t;
}
