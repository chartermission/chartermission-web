"use client";

import { useState } from "react";
import { Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { signInUrl } from "@/lib/navigation";

/** Ends the admin session (POST /auth/logout) and returns to the sign-in page. */
export function SignOutButton({
  className,
  tone = "dark",
  compact = false,
}: {
  className?: string;
  tone?: "dark" | "light";
  /** Icon only on small screens (admin bar). */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST", authFlow: true });
    } catch {
      // Even if the session was already gone, leave the console.
    }
    window.location.assign(signInUrl({ signedOut: true }));
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 whitespace-nowrap sm:px-2.5 text-sm font-medium transition-colors disabled:opacity-60",
        tone === "dark" ? "text-primary-tint hover:bg-white/10 hover:text-inverse" : "text-primary hover:bg-primary-tint-2",
        className,
      )}
    >
      <Icon name="arrow-up-right" size={16} />
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
