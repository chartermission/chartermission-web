"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, cn } from "@chartermission/ui";
import { API_ACTIVITY_EVENT, api } from "@/lib/api/client";
import { signInUrl } from "@/lib/navigation";

/** Admin sessions end after 30 minutes without a request (spec 4.2, privileged roles). */
const IDLE_MS = 30 * 60_000;
const WARN_MS = 5 * 60_000;

/**
 * Minutes left before the admin session times out. Every API call and page load restarts the
 * countdown (the API slides the idle expiry on each request). At zero the admin is sent to sign in.
 */
export function SessionTimer() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const lastActivity = useRef<number | null>(null);
  const [left, setLeft] = useState(IDLE_MS);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    lastActivity.current = Date.now();
  }, [pathname, search]);

  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener(API_ACTIVITY_EVENT, onActivity);
    const id = window.setInterval(() => {
      const since = lastActivity.current ?? Date.now();
      const remaining = IDLE_MS - (Date.now() - since);
      setLeft(remaining);
      if (remaining <= 0) {
        window.location.assign(signInUrl({ next: window.location.pathname + window.location.search, expired: true }));
      }
    }, 5_000);
    return () => {
      window.removeEventListener(API_ACTIVITY_EVENT, onActivity);
      window.clearInterval(id);
    };
  }, []);

  async function stayActive() {
    setExtending(true);
    try {
      await api("/me");
      setLeft(IDLE_MS);
    } catch {
      // A 401 already redirects to sign in.
    } finally {
      setExtending(false);
    }
  }

  const minutes = Math.max(0, Math.ceil(left / 60_000));
  const warn = left <= WARN_MS;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <p
        className={cn("flex items-center gap-1.5 text-xs", warn ? "text-warning" : "text-primary-tint")}
        aria-live={warn ? "polite" : "off"}
      >
        <Icon name="shield" size={16} className={warn ? "text-warning" : "text-success"} />
        <span className="hidden sm:inline">MFA session · </span>
        {minutes} min left
      </p>
      {warn && (
        <button
          type="button"
          onClick={stayActive}
          disabled={extending}
          className="rounded-md bg-white/12 px-2 py-1 text-xs font-medium text-inverse hover:bg-white/20 disabled:opacity-60"
        >
          Stay signed in
        </button>
      )}
    </div>
  );
}
