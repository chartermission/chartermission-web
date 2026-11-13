"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Icon } from "@chartermission/ui";
import { Dialog } from "@/components/account/dialog";
import { useT } from "@/i18n/client";
import { IOS_INSTRUCTIONS_EVENT } from "./install";

/**
 * In the root layout on every page: registers the service worker (public/sw.js), which makes the
 * site installable, and holds the Add to Home Screen instructions for iPhone and iPad.
 */
export function PwaHost() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(IOS_INSTRUCTIONS_EVENT, show);
    return () => window.removeEventListener(IOS_INSTRUCTIONS_EVENT, show);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={t("Install Charter Mission")}
      description={t("Add Charter Mission to your home screen to open it like any other app.")}
    >
      <ol className="flex flex-col gap-3">
        <Step number={1} icon={<ShareGlyph />}>
          {t("Tap the Share button in your browser’s toolbar.")}
        </Step>
        <Step number={2} icon={<Icon name="plus" size={20} />}>
          {t("Scroll down and tap Add to Home Screen.")}
        </Step>
        <Step number={3} icon={<Icon name="check" size={20} />}>
          {t("Tap Add. Charter Mission appears on your home screen.")}
        </Step>
      </ol>
      <p className="text-sm text-secondary">{t("Open it from your home screen to get message notifications on your phone.")}</p>
      <div className="flex justify-end">
        <Button onClick={() => setOpen(false)}>{t("Got it")}</Button>
      </div>
    </Dialog>
  );
}

function Step({ number, icon, children }: { number: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary" aria-hidden>
        {icon}
      </span>
      <span className="text-sm text-body">
        <span className="sr-only">{number}. </span>
        {children}
      </span>
    </li>
  );
}

/** The iOS Share symbol (a box with an arrow out of the top), which members look for in Safari. */
function ShareGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
      <path d="M12 15V2" />
      <path d="M8 6l4-4 4 4" />
    </svg>
  );
}
