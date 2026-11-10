import * as runtime from "react/jsx-dev-runtime";
import * as production from "react/jsx-runtime";
import type { ElementType, Key, ReactNode } from "react";
import { adapt } from "./adapt";

/* Development build of ./jsx-runtime.ts: the same additions around React's jsxDEV. */

export const Fragment = runtime.Fragment;
export type { JSX } from "react/jsx-runtime";

type Props = Record<string, unknown> & { children?: ReactNode };
type Create = (type: ElementType, props: Props, key?: Key) => ReturnType<typeof production.jsx>;

export function jsxDEV(type: ElementType, props: Props, key: Key | undefined, isStatic: boolean, source?: unknown, self?: unknown) {
  const [nextType, nextProps] = adapt(type, props, production.jsx as Create);
  return (runtime.jsxDEV as (...args: unknown[]) => ReturnType<typeof production.jsx>)(nextType, nextProps, key, isStatic, source, self);
}
