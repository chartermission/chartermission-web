"use client";

import { useSyncExternalStore } from "react";
import { Icon, cn } from "@chartermission/ui";

export type ToastTone = "success" | "error" | "info";
type Toast = { id: number; tone: ToastTone; text: string };

const DURATION_MS = { success: 5000, info: 5000, error: 9000 } as const;
const MAX_TOASTS = 3;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Show a short confirmation or error in the corner of the console (announced by screen readers). */
export function toast(text: string, tone: ToastTone = "success") {
  const id = nextId++;
  toasts = [...toasts, { id, tone, text }].slice(-MAX_TOASTS);
  timers.set(id, window.setTimeout(() => dismissToast(id), DURATION_MS[tone]));
  emit();
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => toasts;
const NO_TOASTS: Toast[] = [];
const getServerSnapshot = () => NO_TOASTS;

const toneStyles: Record<ToastTone, { box: string; icon: "check" | "alert" | "clock"; iconClass: string }> = {
  success: { box: "border-success/30", icon: "check", iconClass: "bg-success-light text-success" },
  error: { box: "border-error/40", icon: "alert", iconClass: "bg-error-light text-error" },
  info: { box: "border-info/30", icon: "clock", iconClass: "bg-info-light text-info" },
};

/**
 * Toast stack, mounted once in the console layout. Two live regions so errors are announced
 * assertively and confirmations politely; both exist from the first render so additions are read.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const render = (list: Toast[]) =>
    list.map((t) => {
      const style = toneStyles[t.tone];
      return (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-card border bg-card p-3.5 shadow-[0_8px_28px_rgba(25,37,80,0.16)]",
            style.box,
          )}
        >
          <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", style.iconClass)}>
            <Icon name={style.icon} size={16} />
          </span>
          <p className="min-w-0 flex-1 pt-0.5 text-sm text-ink">{t.text}</p>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name="x" size={16} label="Dismiss notification" />
          </button>
        </div>
      );
    });
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:right-6 sm:bottom-6">
      <div role="alert" aria-live="assertive" className="flex flex-col items-end gap-2">
        {render(items.filter((t) => t.tone === "error"))}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col items-end gap-2">
        {render(items.filter((t) => t.tone !== "error"))}
      </div>
    </div>
  );
}
