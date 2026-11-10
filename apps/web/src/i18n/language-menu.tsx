"use client";

import { useEffect } from "react";
import { Icon, cn } from "@chartermission/ui";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "./config";
import { useLocale, useT } from "./client";
import { NoTranslate } from "./auto";

/**
 * Switch the interface language: remember it on this device (cookie, read by the proxy), save it
 * to the account when signed in so other devices follow, and load the page again in that language.
 */
export function switchLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  void fetch("/api/v1/me/locale", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale }),
    keepalive: true,
  })
    .catch(() => undefined)
    .finally(() => window.location.reload());
}

/** The three languages as menu items (account menu). */
export function LanguageMenuItems({ itemClasses }: { itemClasses: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <>
      <div role="separator" className="my-1 h-px bg-line" />
      <span
        role="none"
        className="px-3 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-secondary uppercase"
      >
        {t("common.language")}
      </span>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          role="menuitemradio"
          aria-checked={option === locale}
          tabIndex={-1}
          lang={option}
          onClick={() => option !== locale && switchLocale(option)}
          className={cn(
            itemClasses,
            option === locale && "font-medium text-ink",
          )}
        >
          <span className="flex-1 text-start">
            <NoTranslate>{LOCALE_NAMES[option]}</NoTranslate>
          </span>
          {option === locale && (
            <Icon name="check" size={16} className="text-primary" />
          )}
        </button>
      ))}
    </>
  );
}

/** A compact language picker for pages without the account menu (landing page, sign-in, footer). */
export function LanguageSwitcher({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "inverse";
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        tone === "inverse" ? "text-inverse/80" : "text-secondary",
        className,
      )}
    >
      <Icon name="globe" size={16} />
      <span className="sr-only">{t("common.language")}</span>
      <NoTranslate>
        <select
          value={locale}
          onChange={(event) => switchLocale(event.target.value as Locale)}
          className={cn(
            "cursor-pointer rounded-md bg-transparent py-1 pe-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary-light",
            tone === "inverse" ? "text-inverse" : "text-body",
          )}
        >
          {LOCALES.map((option) => (
            <option
              key={option}
              value={option}
              lang={option}
              className="text-ink"
            >
              {LOCALE_NAMES[option]}
            </option>
          ))}
        </select>
      </NoTranslate>
    </label>
  );
}

/** The languages as a list of choices, for menus on small screens (the select is hidden there). */
export function LanguageList({ className }: { className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn("flex flex-col", className)}
    >
      <span className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-secondary">
        <Icon name="globe" size={14} />
        {t("common.language")}
      </span>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === locale}
          onClick={() => switchLocale(option)}
          className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2.5 text-start text-sm font-medium hover:bg-muted",
            option === locale ? "text-primary" : "text-ink",
          )}
        >
          <NoTranslate>{LOCALE_NAMES[option]}</NoTranslate>
          {option === locale && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

/**
 * Signed-in members: when the language saved on the account differs from this device's, follow
 * the account (once, on arrival). Rendered by the member layout with the account's language.
 */
export function LocaleSync({
  accountLocale,
}: {
  accountLocale: Locale | null;
}) {
  const { locale } = useLocale();
  useEffect(() => {
    if (!accountLocale || accountLocale === locale) return;
    // An explicit choice on this device wins; otherwise adopt the account's language.
    if (
      document.cookie.split("; ").some((c) => c.startsWith(`${LOCALE_COOKIE}=`))
    )
      return;
    document.cookie = `${LOCALE_COOKIE}=${accountLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.reload();
  }, [accountLocale, locale]);
  return null;
}
