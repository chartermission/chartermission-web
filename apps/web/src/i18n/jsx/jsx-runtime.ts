import * as runtime from "react/jsx-runtime";
import type { ElementType, Key, ReactNode } from "react";
import { adapt } from "./adapt";

/*
 * The web app's JSX runtime (tsconfig "jsxImportSource": "@/i18n/jsx"). It is React's own, with
 * one addition: interface text written in English in the code is handed to a small component
 * that prints it in the page's language. See ./adapt.ts for exactly what is touched.
 */

export const Fragment = runtime.Fragment;
export type { JSX } from "react/jsx-runtime";

type Props = Record<string, unknown> & { children?: ReactNode };
type Create = (type: ElementType, props: Props, key?: Key) => ReturnType<typeof runtime.jsx>;

export const jsx: Create = (type, props, key) => {
  const [nextType, nextProps] = adapt(type, props, runtime.jsx as Create);
  return runtime.jsx(nextType, nextProps, key);
};

export const jsxs: Create = (type, props, key) => {
  const [nextType, nextProps] = adapt(type, props, runtime.jsx as Create);
  return runtime.jsxs(nextType, nextProps, key);
};
