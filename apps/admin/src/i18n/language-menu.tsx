"use client";

import { Icon, cn } from "@chartermission/ui";
import { NoTranslate } from "./auto";
import { LOCALES, LOCALE_NAMES, type Locale } from "./config";
import { switchLocale, useLocale, useT } from "./client";

/** Console language: a small select (each language named in its own language). */
export function LanguageSwitcher({ className, dark = false }: { className?: string; dark?: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-sm", dark ? "text-primary-tint" : "text-secondary", className)}>
      <Icon name="globe" size={16} />
      <span className="sr-only">{t("Language")}</span>
      <NoTranslate>
        <select
          value={locale}
          onChange={(event) => switchLocale(event.target.value as Locale)}
          className={cn(
            "cursor-pointer rounded-md bg-transparent py-1 pe-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary-light",
            dark ? "text-inverse [&>option]:text-body" : "text-body",
          )}
        >
          {LOCALES.map((option) => (
            <option key={option} value={option} lang={option}>
              {LOCALE_NAMES[option]}
            </option>
          ))}
        </select>
      </NoTranslate>
    </label>
  );
}
