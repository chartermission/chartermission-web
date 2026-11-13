"use client";

import { useEffect, useState } from "react";
import { Button, Icon } from "@chartermission/ui";
import { usePathname, useT } from "@/i18n/client";
import { NO_TAB_BAR } from "@/components/mobile-nav";
import { canInstall, promptInstall, useInstallState } from "./install";

const DISMISSED_KEY = "cm_install_dismissed";
/** After "Not now" the banner stays away this long. The menus still offer "Install app". */
const QUIET_FOR = 1000 * 60 * 60 * 24 * 30;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && Date.now() - at < QUIET_FOR;
  } catch {
    return false;
  }
}

/**
 * Phones only: a card just above the bottom tab bar offering to install Charter Mission, for
 * members whose browser can install it (Android: the browser's dialog; iPhone: our instructions).
 */
export function InstallBanner() {
  const t = useT();
  const pathname = usePathname();
  const state = useInstallState();
  const [quiet, setQuiet] = useState(true);

  useEffect(() => {
    // Give the page a moment before offering anything.
    const timer = window.setTimeout(() => setQuiet(dismissedRecently()), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  if (quiet || !canInstall(state) || NO_TAB_BAR.some((re) => re.test(pathname))) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Private mode: it just comes back next visit.
    }
    setQuiet(true);
  }

  async function install() {
    const outcome = await promptInstall();
    if (outcome !== "dismissed") setQuiet(true);
  }

  return (
    <aside
      aria-label={t("Get the Charter Mission app")}
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-card border border-line bg-card p-3 shadow-[0px_12px_32px_0px_rgba(26,32,44,0.14)] md:hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold text-ink">{t("Get the Charter Mission app")}</span>
        <span className="text-xs text-secondary">{t("One tap from your home screen, with notifications.")}</span>
      </div>
      <Button size="small" onClick={() => void install()}>
        {t("Install")}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("Not now")}
        className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-light"
      >
        <Icon name="x" size={18} />
      </button>
    </aside>
  );
}
