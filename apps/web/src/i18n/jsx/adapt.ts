import type { ElementType, Key, ReactNode } from "react";
import { AutoElement, AutoText } from "../auto";
import { AUTO_ATTRIBUTES } from "./attributes";
import { KNOWN_SENTENCES } from "../dict/known";
import { isPhrase, isPlaceName } from "../places";
import { normalise } from "../translate";

/*
 * What the JSX runtime changes, and only for plain elements (div, p, button, input…), never for
 * components:
 *
 *  - a text child that is a sentence of the interface (one the dictionaries know) is wrapped in
 *    <AutoText>, which prints it in the page's language;
 *  - an element whose placeholder, title, alt or aria-label is such a sentence is rendered
 *    through <AutoElement>, which translates those attributes;
 *  - elements that may only hold bare text (option, textarea, svg title and text) go through
 *    <AutoElement> too.
 *
 * Text handed as children to a component (a <Link>, say) is wrapped the same way, because the
 * component may render it with React's own runtime. Country and chapter names count as known
 * text (see ../places.ts).
 *
 * Anything else, including everything members write, passes through untouched: a string that is
 * not a known sentence is never wrapped. Sentences with a name or number in them ("Mute {name}")
 * can't be recognised this way and call t() themselves.
 */

type Props = Record<string, unknown> & { children?: ReactNode };
type Create = (type: ElementType, props: Props, key?: Key) => ReactNode;

/** Elements whose children must stay bare text. */
const TEXT_ONLY = new Set(["option", "textarea", "title", "text", "tspan", "desc"]);
/** Elements whose text is not prose. */
const SKIP = new Set(["script", "style", "code", "pre", "kbd", "samp"]);

function known(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 600) return false;
  return knownText(normalise(value));
}

function knownText(text: string): boolean {
  if (KNOWN_SENTENCES.has(text) || isPlaceName(text) || isPhrase(text)) return true;
  // "Founding Ambassador · Nigeria Chapter": every part known on its own.
  if (!text.includes(" · ")) return false;
  const parts = text.split(" · ").filter(Boolean);
  return parts.length > 1 && parts.every((part) => KNOWN_SENTENCES.has(part) || isPlaceName(part));
}

/** Components whose children must stay exactly as given. */
const OWN_CHILDREN = new Set<unknown>([AutoText, AutoElement]);

export function adapt(type: ElementType, props: Props, create: Create): [ElementType, Props] {
  if (!props) return [type, props];
  if (typeof type !== "string") {
    // A component (next/link and the like) may render its children with React's own runtime,
    // so interface text handed to it as children is wrapped here instead.
    if (OWN_CHILDREN.has(type)) return [type, props];
    const children = props.children;
    // Sentences with {placeholders} are keys for <T vars>, never text to print as is.
    const plain = (value: unknown): value is string => known(value) && !value.includes("{");
    if (plain(children)) return [type, { ...props, children: create(AutoText, { children }) }];
    if (Array.isArray(children) && children.some(plain)) {
      return [type, { ...props, children: children.map((child: unknown) => (plain(child) ? create(AutoText, { children: child }) : (child as ReactNode))) as ReactNode }];
    }
    return [type, props];
  }
  if (SKIP.has(type)) return [type, props];
  let next = props;
  const textOnly = TEXT_ONLY.has(type);

  const children = props.children;
  let textChild = false;
  if (textOnly) textChild = known(children);
  else if (known(children)) next = { ...next, children: create(AutoText, { children }) };
  else if (Array.isArray(children) && children.some(known)) {
    next = { ...next, children: children.map((child: unknown) => (known(child) ? create(AutoText, { children: child }) : child)) as ReactNode };
  }

  let attribute = false;
  for (const name of AUTO_ATTRIBUTES) {
    if (known(props[name])) {
      attribute = true;
      break;
    }
  }
  if (attribute || textChild) return [AutoElement as ElementType, { ...next, as: type, textChild: textChild || undefined }];
  return [type, next];
}
