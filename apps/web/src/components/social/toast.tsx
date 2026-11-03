"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Icon, cn } from "@chartermission/ui";
import { errorMessage, isStandingError, isVerifyError, VerifyEmailPrompt } from "./errors";

type Toast = { id: number; message: string; tone: "success" | "error"; error?: unknown };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function push(toast: Omit<Toast, "id">) {
  toasts = [...toasts.slice(-2), { ...toast, id: nextId++ }];
  emit();
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** App-wide notices for quick actions (react, follow, bookmark…). */
export const toast = {
  success: (message: string) => push({ message, tone: "success" }),
  error: (error: unknown) => push({ message: errorMessage(error), tone: "error", error }),
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => toasts;
const empty: Toast[] = [];
const serverSnapshot = () => empty;

function ToastItem({ item }: { item: Toast }) {
  const sticky = isVerifyError(item.error) || isStandingError(item.error);
  useEffect(() => {
    if (sticky) return;
    const timer = window.setTimeout(() => dismissToast(item.id), 5000);
    return () => window.clearTimeout(timer);
  }, [item.id, sticky]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[min(480px,calc(100vw-2rem))] items-start gap-3 rounded-card py-3 pl-4 pr-3 text-sm shadow-[0px_12px_24px_0px_rgba(0,0,0,0.2)]",
        item.tone === "success" ? "bg-primary-dark text-inverse" : "border border-line bg-card text-ink",
      )}
    >
      {item.tone === "success" ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success">
          <Icon name="check" size={14} />
        </span>
      ) : (
        <Icon name={isVerifyError(item.error) ? "mail" : "alert"} size={20} className="mt-0.5 shrink-0 text-error" />
      )}
      <div className="min-w-0 flex-1 self-center">
        {isVerifyError(item.error) ? (
          <VerifyEmailPrompt message={item.message} />
        ) : isStandingError(item.error) ? (
          <p>
            {item.message}.{" "}
            <Link href="/settings/moderation" className="font-medium text-primary-light hover:underline">
              See details
            </Link>
          </p>
        ) : (
          <p>{item.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss"
        className={cn("shrink-0 rounded-md p-1", item.tone === "success" ? "text-inverse/80 hover:bg-primary-light" : "text-secondary hover:bg-muted")}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/** Renders queued toasts. Mount once per page (PageColumns does). */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}
