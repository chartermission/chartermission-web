"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing Charter Mission as an app (PWA).
 *  - Chrome, Edge, Samsung Internet (Android and desktop) fire `beforeinstallprompt`; we keep the
 *    event and show the browser's own install dialog when the member taps "Install app".
 *  - iPhone and iPad have no install dialog: "Install app" opens our instructions for
 *    Share → Add to Home Screen (components/pwa/pwa-host.tsx).
 *  - Already running as the installed app: nothing to offer.
 * The root layout runs EARLY_CAPTURE (./early-capture.ts) before the page's scripts load, so an event fired early is kept.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Window {
    __cmInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** "unknown" on the server and during hydration; "prompt" = the browser's dialog is ready; "ios" = instructions. */
export type InstallState = "unknown" | "installed" | "prompt" | "ios" | "unsupported";

export const IOS_INSTRUCTIONS_EVENT = "cm:install-ios";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

if (typeof window !== "undefined") {
  deferred = window.__cmInstallPrompt ?? null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.__cmInstallPrompt = null;
    installed = true;
    emit();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", emit);
}

function snapshot(): InstallState {
  if (installed || standalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "unsupported";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this browser can install Charter Mission right now, and how. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => "unknown");
}

/** True when an "Install app" option should be shown. */
export const canInstall = (state: InstallState) => state === "prompt" || state === "ios";

/** Opens the browser's install dialog, or the Add to Home Screen instructions on iPhone and iPad. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "instructions" | "unavailable"> {
  if (deferred) {
    const event = deferred;
    // The event works once; the browser fires a new one later if the member says no.
    deferred = null;
    window.__cmInstallPrompt = null;
    emit();
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") {
      installed = true;
      emit();
    }
    return outcome;
  }
  if (isIos() && !standalone()) {
    window.dispatchEvent(new Event(IOS_INSTRUCTIONS_EVENT));
    return "instructions";
  }
  return "unavailable";
}
