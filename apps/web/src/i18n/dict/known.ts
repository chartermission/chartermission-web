import { ar } from "./ar";
import { fr } from "./fr";

/** Every English sentence that has a translation: what the JSX runtime looks for in the page. */
export const KNOWN_SENTENCES: ReadonlySet<string> = new Set([...Object.keys(fr), ...Object.keys(ar)]);
