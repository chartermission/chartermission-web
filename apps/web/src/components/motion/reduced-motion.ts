"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the viewer asked for reduced motion (or when there is no window to ask). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** Live `prefers-reduced-motion: reduce`. Reduced (true) during server rendering. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => true);
}

/** Element.animate exists (Web Animations API) and motion is allowed. */
export function canAnimate(): boolean {
  return typeof document !== "undefined" && typeof document.body?.animate === "function" && !prefersReducedMotion();
}
