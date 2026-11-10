import type { Messages } from "./messages/en";
import type { Plural } from "./translate";

/** The shape every translation must have: the same keys as English, with any plural forms the language needs. */
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends { other: string } ? Plural : Shape<T[K]> };
export type Localized = Shape<Messages>;
